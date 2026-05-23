import { createAuthSession, createUserWithPassword, deleteAuthSession, toPublicUser, verifyPasswordLogin } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AuthSession, PublicUser, UserAccount } from '../types/auth.js';

interface RegisterBody {
  login: string;
  password: string;
  defaultRole: 'gm' | 'player';
}

interface LoginBody {
  login: string;
  password: string;
}

function extractBearerToken(headers: FastifyRequest['headers']): string | null {
  const raw = headers?.authorization || headers?.Authorization;
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.toLowerCase().startsWith('bearer ')) return null;
  return raw.slice(7).trim();
}

function createAuthResponse(user: UserAccount | PublicUser, authSession: AuthSession, token: string) {
  return {
    user: toPublicUser(user),
    authSession: {
      sessionId: authSession.sessionId,
      token,
      expiresAt: authSession.expiresAt
    },
    token
  };
}

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password', 'defaultRole'],
        properties: {
          login: { type: 'string', minLength: 2, maxLength: 40 },
          password: { type: 'string', minLength: 8, maxLength: 200 },
          defaultRole: { type: 'string', enum: ['gm', 'player'] }
        }
      }
    }
  }, async (req: FastifyRequest<{ Body: RegisterBody }>, reply) => {
    const { login, password, defaultRole } = req.body;
    const user = await createUserWithPassword(login, password, defaultRole);
    if (!user) return reply.code(409).send({ error: 'login_taken' });
    const { authSession, token } = await createAuthSession(user);
    return reply.send(createAuthResponse(user, authSession, token));
  });

  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['login', 'password'],
        properties: {
          login: { type: 'string', minLength: 2, maxLength: 40 },
          password: { type: 'string', minLength: 8, maxLength: 200 }
        }
      }
    }
  }, async (req: FastifyRequest<{ Body: LoginBody }>, reply) => {
    const { login, password } = req.body;
    const user = await verifyPasswordLogin(login, password);
    if (!user) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const { authSession, token } = await createAuthSession(user);
    return reply.send(createAuthResponse(user, authSession, token));
  });

  app.post('/logout', async (req, reply) => {
    const ok = await authenticateRequest(req, reply);
    if (!ok) return;
    const token = extractBearerToken(req.headers);
    if (token) await deleteAuthSession(token);
    return reply.send({ ok: true });
  });

  app.get('/me', async (req, reply) => {
    const ok = await authenticateRequest(req, reply);
    if (!ok) return;
    return reply.send(toPublicUser(req.user));
  });
};

export default authRoutes;
