import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ensureDataDirs } from './services/store.js';
import authRoutes from './routes/auth.js';
import mapRoutes from './routes/map.js';
import sessionRoutes from './routes/session.js';
import assetsRoutes from './routes/assets.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

async function start() {
  const app = Fastify({ logger: true, ignoreTrailingSlash: true });

  await ensureDataDirs();

  await app.register(cors, {
    origin: 'http://localhost:5173',
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-username', 'x-api-key', 'x-session-id', 'authorization', 'Authorization']
  });

  await app.register(websocket);

  const clients = new Set();
  const liveState = new Map(); // sessionId -> { turn, entities }
  const ensureState = (sessionId) => {
    if (!sessionId) return null;
    if (!liveState.has(sessionId)) {
      liveState.set(sessionId, { entities: [], turn: { order: [], current: 0 } });
    }
    return liveState.get(sessionId);
  };

  app.decorate('wsClients', clients);
  app.decorate('broadcast', (sessionId, payload) => {
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

  app.get('/ws', { websocket: true }, async (connection, req) => {
    const usernameRaw = req.headers['x-username'] || req.query?.username;
    const sessionId = (req.headers['x-session-id'] || req.query?.sessionId || '').toString().trim() || null;
    const bearer = req.headers['authorization'] || req.headers['Authorization'];
    const tokenFromHeader = (typeof bearer === 'string' && bearer.toLowerCase().startsWith('bearer ')) ? bearer.slice(7).trim() : null;
    const token = tokenFromHeader || req.headers['x-api-key'] || req.query?.apiKey || req.query?.token;
    if (!token) {
      connection.socket.close(4001, 'missing_auth');
      return;
    }
    const { verifyUser, getActiveSession, findUserByApiKey } = await import('./services/store.js');
    let usernameDecoded = usernameRaw ? String(usernameRaw) : null;
    try { if (usernameDecoded) usernameDecoded = decodeURIComponent(usernameDecoded); } catch {}
    const tokenStr = String(token);
    let user = null;
    if (usernameDecoded) {
      user = await verifyUser(usernameDecoded, tokenStr);
    }
    if (!user) {
      user = await findUserByApiKey(tokenStr);
    }
    if (!user) {
      connection.socket.close(4002, 'invalid_auth');
      return;
    }
    const session = sessionId ? await getActiveSession(sessionId) : await getActiveSession(null);
    const role = session ? (session.gmUserId === user.userId ? 'gm' : (session.players.find(p => p.userId === user.userId) ? 'player' : 'spectator')) : 'spectator';
    const client = { socket: connection.socket, sessionId: session?.sessionId || null, userId: user.userId, role };
    clients.add(client);
    const send = (obj) => connection.socket.send(JSON.stringify(obj));
    send({ type: 'welcome', role, sessionId: client.sessionId });
    connection.socket.on('message', (raw) => {
      let data = null;
      try { data = JSON.parse(raw); } catch {}
      if (data?.type === 'ping') {
        send({ type: 'pong', t: Date.now() });
        return;
      }
      if (!client.sessionId) return;
      const state = ensureState(client.sessionId);
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
    connection.socket.on('close', () => {
      clients.delete(client);
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
