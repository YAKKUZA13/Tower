import { createSession, getActiveSession, joinSession, resetSession } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';

async function requireAuth(req, reply) {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

function getSessionRole(session, userId) {
  if (!session) return 'spectator';
  if (session.gmUserId === userId) return 'gm';
  if (session.players.find(p => p.userId === userId)) return 'player';
  return 'spectator';
}

function toSessionDto(session, userId) {
  if (!session) return null;
  const gmName = session.gmName || session.gm?.username || '';
  return {
    sessionId: session.sessionId,
    role: getSessionRole(session, userId),
    gmName,
    gm: session.gm || {
      userId: session.gmUserId,
      username: gmName,
      characterName: '',
      role: 'gm'
    },
    players: session.players || [],
    mapId: session.mapId || session.sessionId,
    createdAt: session.createdAt || null,
    status: session.status || 'active'
  };
}

export default async function sessionRoutes(app) {
  app.addHook('preHandler', requireAuth);

  app.post('/session', async (req, reply) => {
    const user = req.user;
    const session = await createSession(user);
    return reply.send(toSessionDto(session, user.userId));
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
    return reply.send(toSessionDto(session, req.user.userId));
  });

  app.get('/session', async (req, reply) => {
    const sid = req.headers['x-session-id'] ? String(req.headers['x-session-id']) : null;
    const session = await getActiveSession(sid);
    if (!session) return reply.send(null);
    return reply.send(toSessionDto(session, req.user.userId));
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

