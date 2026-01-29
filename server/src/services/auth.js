import { verifyUser, findUserByApiKey } from './store.js';

function extractBearerToken(headers) {
  const raw = headers?.authorization || headers?.Authorization;
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.toLowerCase();
  if (!lower.startsWith('bearer ')) return null;
  return raw.slice(7).trim();
}

export async function authenticateRequest(req, reply) {
  let token = extractBearerToken(req.headers);
  if (!token && req.headers['x-api-key']) {
    token = String(req.headers['x-api-key']).trim();
  }
  let username = req.headers['x-username'];
  if (username) {
    try {
      username = decodeURIComponent(String(username));
    } catch {
      username = String(username);
    }
    username = username.trim();
  }

  if (!token) {
    reply.code(401).send({ error: 'missing_auth' });
    return false;
  }

  let user = null;
  if (username) {
    user = await verifyUser(username, token);
  } else {
    user = await findUserByApiKey(token);
  }

  if (!user) {
    reply.code(401).send({ error: 'invalid_auth' });
    return false;
  }

  req.user = user;
  return true;
}


