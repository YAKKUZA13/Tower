import { createOrGetUser, verifyUser } from '../services/store.js';

export default async function authRoutes(app) {
  app.post('/register', {
    schema: {
      body: {
        type: 'object',
        required: ['username'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 40 }
        }
      }
    }
  }, async (req, reply) => {
    const { username } = req.body;
    const user = await createOrGetUser(String(username).trim());
    return reply.send({ userId: user.userId, username: user.username, token: user.apiKey, apiKey: user.apiKey });
  });

  app.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'apiKey'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 40 },
          apiKey: { type: 'string', minLength: 10, maxLength: 200 }
        }
      }
    }
  }, async (req, reply) => {
    const { username, apiKey } = req.body;
    const user = await verifyUser(String(username).trim(), String(apiKey));
    if (!user) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    return reply.send({ userId: user.userId, username: user.username, token: user.apiKey, apiKey: user.apiKey });
  });
}
