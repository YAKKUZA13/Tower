import { findAuthSessionByToken } from './store.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

function extractBearerToken(headers: FastifyRequest['headers']): string | null {
  const raw = headers?.authorization || headers?.Authorization;
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  if (!lower.startsWith('bearer ')) return null;
  return raw.slice(7).trim();
}

export async function authenticateRequest(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const token = extractBearerToken(req.headers);

  if (!token) {
    reply.code(401).send({ error: 'missing_auth' });
    return false;
  }

  const result = await findAuthSessionByToken(token);
  if (!result?.user) {
    reply.code(401).send({ error: 'invalid_auth' });
    return false;
  }

  req.user = result.user;
  req.authSession = result.authSession;
  return true;
}


