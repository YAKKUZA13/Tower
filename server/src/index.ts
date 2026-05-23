import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ensureDataDirs } from './services/store.js';
import { query } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { connectRedis, getRedis } from './redis/client.js';
import authRoutes from './routes/auth.js';
import mapRoutes from './routes/map.js';
import sessionRoutes from './routes/session.js';
import assetsRoutes from './routes/assets.js';
import type { FastifyRequest } from 'fastify';
import type { LiveSessionState, ServerMessage, WsClient } from './types/realtime.js';
import type { ClientMessage } from './types/realtime.js';
import type { GameRole } from './types/game-session.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BODY_LIMIT_BYTES = 20 * 1024 * 1024;

interface WsQuery {
  sessionId?: string;
  token?: string;
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

  const clients = new Set<WsClient>();
  const liveState = new Map<string, LiveSessionState>();
  const ensureState = (sessionId: string | null): LiveSessionState | null => {
    if (!sessionId) return null;
    if (!liveState.has(sessionId)) {
      liveState.set(sessionId, { entities: [], turn: { order: [], current: 0 } });
    }
    return liveState.get(sessionId) || null;
  };

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
    const client: WsClient = { socket, sessionId: session?.sessionId || null, userId: user.userId, role };
    clients.add(client);
    const { getRedisOrNull } = await import('./redis/client.js');
    const redis = await getRedisOrNull();
    if (redis && client.sessionId) {
      await redis.hSet(`presence:session:${client.sessionId}`, user.userId, JSON.stringify({
        userId: user.userId,
        username: user.username || user.login,
        role,
        connectedAt: Date.now()
      }));
      await redis.expire(`presence:session:${client.sessionId}`, 120);
    }
    const send = (obj: ServerMessage) => socket.send(JSON.stringify(obj));
    send({ type: 'welcome', role, sessionId: client.sessionId });
    socket.on('message', (raw: Buffer | string) => {
      let data: ClientMessage | null = null;
      try { data = JSON.parse(String(raw)) as ClientMessage; } catch {}
      if (data?.type === 'ping') {
        send({ type: 'pong', t: Date.now() });
        return;
      }
      if (!client.sessionId) return;
      const state = ensureState(client.sessionId);
      if (!state) return;
      switch (data?.type) {
        case 'chat_send':
          app.broadcast(client.sessionId, { type: 'chat', from: user.username, text: String(data.text || '').slice(0, 500), ts: Date.now() });
          break;
        case 'dice_roll': {
          const sides = Math.max(2, Math.min(1000, Number(data.sides || 20)));
          const count = Math.max(1, Math.min(10, Number(data.count || 1)));
          const results = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
          app.broadcast(client.sessionId, { type: 'dice_roll', from: user.username, sides, count, results, ts: Date.now() });
          break;
        }
        case 'entity_update':
          if (client.role !== 'gm') break;
          state.entities = Array.isArray(data.entities) ? data.entities : state.entities;
          app.broadcast(client.sessionId, { type: 'entity_update', entities: state.entities, ts: Date.now() });
          break;
        case 'turn_set':
          if (client.role !== 'gm') break;
          state.turn = { order: Array.isArray(data.order) ? data.order : [], current: 0 };
          app.broadcast(client.sessionId, { type: 'turn_update', turn: state.turn, ts: Date.now() });
          break;
        case 'turn_next':
          if (client.role !== 'gm') break;
          if (state.turn.order.length) {
            state.turn.current = (state.turn.current + 1) % state.turn.order.length;
            app.broadcast(client.sessionId, { type: 'turn_update', turn: state.turn, ts: Date.now() });
          }
          break;
        case 'request_state':
          send({ type: 'state', entities: state.entities, turn: state.turn });
          break;
        default:
          break;
      }
    });
    socket.on('close', () => {
      clients.delete(client);
      if (redis && client.sessionId) {
        redis.hDel(`presence:session:${client.sessionId}`, user.userId).catch((err: unknown) => app.log.warn(err));
      }
    });
  });

  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(sessionRoutes, { prefix: '/session' });
  await app.register(mapRoutes, { prefix: '/map' });
  await app.register(assetsRoutes, { prefix: '/assets' });

  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    app.log.info(`Server listening on http://localhost:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
