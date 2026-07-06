import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ensureDataDirs } from './services/store.js';
import { query } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { connectRedis, getRedis } from './redis/client.js';
import authRoutes from './routes/auth.js';
import sessionRoutes from './routes/session.js';
import runRoutes from './routes/run.js';
import { CoopRooms } from './services/coop-rooms.js';
import type { CoopClient } from './services/coop-rooms.js';
import type { FastifyRequest } from 'fastify';
import type { ServerMessage, WsClient } from './types/realtime.js';
import type { ClientMessage } from './types/realtime.js';
import type { GameRole } from './types/game-session.js';
import type { CoopClientMessage } from '@tower/shared';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BODY_LIMIT_BYTES = 20 * 1024 * 1024;

interface WsQuery {
  sessionId?: string;
  token?: string;
}

function isCoopMessage(data: unknown): data is CoopClientMessage {
  if (typeof data !== 'object' || data === null) return false;
  const t = (data as { type?: unknown }).type;
  return typeof t === 'string' && t.startsWith('coop:');
}

async function start() {
  const app = Fastify({ logger: true, ignoreTrailingSlash: true, bodyLimit: BODY_LIMIT_BYTES });

  await runMigrations();
  await connectRedis();
  await ensureDataDirs();

  await app.register(cors, {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-session-id', 'authorization', 'Authorization']
  });

  await app.register(websocket);

  // Глобальный пул клиентов — для legacy `broadcast` (map_updated) и presence.
  // Co-op маршрутизация идёт через отдельный CoopRooms (Phase 7).
  const clients = new Set<WsClient>();
  const coopRooms = new CoopRooms();

  app.decorate('wsClients', clients);
  app.decorate('broadcast', (sessionId: string | null, payload: ServerMessage) => {
    const msg = JSON.stringify(payload);
    for (const c of clients) {
      if (sessionId && c.sessionId !== sessionId) continue;
      try {
        c.socket.send(msg);
      } catch (e) {
        app.log.warn(e);
      }
    }
  });

  app.get('/health', async (_req, reply) => {
    await query('SELECT 1');
    const redis = getRedis();
    await redis.ping();
    return reply.send({ ok: true, postgres: 'ok', redis: 'ok' });
  });

  app.get('/ws', { websocket: true }, async (connection: any, req: FastifyRequest<{ Querystring: WsQuery }>) => {
    const socket = connection.socket || connection;
    const sessionId = (req.headers['x-session-id'] || req.query?.sessionId || '').toString().trim() || null;
    const bearer = req.headers['authorization'] || req.headers['Authorization'];
    const tokenFromHeader = (typeof bearer === 'string' && bearer.toLowerCase().startsWith('bearer ')) ? bearer.slice(7).trim() : null;
    const token = tokenFromHeader || req.query?.token;
    if (!token) {
      socket.close(4001, 'missing_auth');
      return;
    }
    const { findAuthSessionByToken, getActiveSession } = await import('./services/store.js');
    const auth = await findAuthSessionByToken(String(token));
    if (!auth?.user) {
      socket.close(4002, 'invalid_auth');
      return;
    }
    const user = auth.user;
    const session = sessionId ? await getActiveSession(sessionId) : await getActiveSession(null);
    const role: GameRole = session ? (session.gmUserId === user.userId ? 'gm' : (session.players.find(p => p.userId === user.userId) ? 'player' : 'spectator')) : 'spectator';
    const baseClient: WsClient = { socket, sessionId: session?.sessionId || null, userId: user.userId, role };
    clients.add(baseClient);
    const { getRedisOrNull } = await import('./redis/client.js');
    const redis = await getRedisOrNull();
    if (redis && baseClient.sessionId) {
      await redis.hSet(`presence:session:${baseClient.sessionId}`, user.userId, JSON.stringify({
        userId: user.userId,
        username: user.username || user.login,
        role,
        connectedAt: Date.now()
      }));
      await redis.expire(`presence:session:${baseClient.sessionId}`, 120);
    }
    const send = (obj: ServerMessage) => socket.send(JSON.stringify(obj));
    send({ type: 'welcome', role, sessionId: baseClient.sessionId });

    // ── Co-op: регистрируем клиента в комнате, если есть активная сессия ──
    let coopClient: CoopClient | null = null;
    if (session && baseClient.sessionId) {
      coopClient = {
        socket,
        sessionId: baseClient.sessionId,
        userId: user.userId,
        username: user.username || user.login,
        isHost: session.gmUserId === user.userId,
        coopRole: 'free',
        ready: false
      };
      const welcome = coopRooms.join(coopClient, session.gmUserId);
      send(welcome as unknown as ServerMessage);
    }

    socket.on('message', (raw: Buffer | string) => {
      let data: ClientMessage | null = null;
      try { data = JSON.parse(String(raw)) as ClientMessage; } catch {}
      if (data?.type === 'ping') {
        send({ type: 'pong', t: Date.now() });
        return;
      }
      // ── Co-op маршрутизация (Phase 7) ──
      if (coopClient && isCoopMessage(data)) {
        try {
          coopRooms.handleMessage(coopClient, data);
        } catch (e) {
          app.log.warn({ err: e }, 'coop message handling failed');
        }
      }
    });

    socket.on('close', () => {
      clients.delete(baseClient);
      if (coopClient) {
        const out = coopRooms.leave(coopClient);
        if (out.hostLeft && out.sessionId) {
          // хост ушёл — комната распущена; уведомить бывших гостей напрямую
          // (leave уже удалил комнату, поэтому через базовый пул по sessionId)
          const msg = JSON.stringify({ type: 'coop:host-left' } as ServerMessage);
          for (const c of clients) {
            if (c.sessionId === out.sessionId) {
              try { c.socket.send(msg); } catch (e) { app.log.warn(e); }
            }
          }
        }
      }
      if (redis && baseClient.sessionId) {
        redis.hDel(`presence:session:${baseClient.sessionId}`, user.userId).catch((err: unknown) => app.log.warn(err));
      }
    });
  });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(sessionRoutes, { prefix: '/session' });
  await app.register(runRoutes, { prefix: '/run' });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
