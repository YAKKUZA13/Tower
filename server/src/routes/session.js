import { createSession, getActiveSession, joinSession, resetSession } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';

async function requireAuth(req, reply) {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

export default async function sessionRoutes(app) {
  app.addHook('preHandler', requireAuth);

  app.post('/session', async (req, reply) => {
    const user = req.user;
    const session = await createSession(user);
    return reply.send({ sessionId: session.sessionId, role: 'gm', gmName: session.gmName, players: session.players });
  });

  app.post('/join', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string', minLength: 10 },
          characterName: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { sessionId, characterName } = req.body;
    const session = await joinSession(sessionId, req.user, characterName || '');
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    const role = session.gmUserId === req.user.userId ? 'gm' : 'player';
    return reply.send({ sessionId: session.sessionId, role, gmName: session.gmName, players: session.players });
  });

  app.get('/session', async (req, reply) => {
    const sid = req.headers['x-session-id'] ? String(req.headers['x-session-id']) : null;
    const session = await getActiveSession(sid);
    if (!session) return reply.send(null);
    const role = session.gmUserId === req.user.userId ? 'gm' : (session.players.find(p => p.userId === req.user.userId) ? 'player' : 'spectator');
    return reply.send({ sessionId: session.sessionId, role, gmName: session.gmName, players: session.players });
  });

  app.post('/session/reset', {
    schema: {
      body: {
        type: 'object',
        required: ['sessionId'],
        properties: {
          sessionId: { type: 'string', minLength: 10 }
        }
      }
    }
  }, async (req, reply) => {
    const { sessionId } = req.body;
    const session = await getActiveSession(sessionId);
    if (!session) return reply.code(404).send({ error: 'session_not_found' });
    if (session.gmUserId !== req.user.userId) return reply.code(403).send({ error: 'gm_only' });
    await resetSession(sessionId);
    return reply.send({ ok: true });
  });
}

