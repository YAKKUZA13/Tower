import { findAuthSessionByToken } from './store.js';

function extractBearerToken(headers) {
  const raw = headers?.authorization || headers?.Authorization;
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  if (!lower.startsWith('bearer ')) return null;
  return raw.slice(7).trim();
}

export async function authenticateRequest(req, reply) {
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


