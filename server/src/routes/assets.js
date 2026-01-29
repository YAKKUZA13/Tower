import { readAssets, addAsset, getAssetById, deleteAsset, buildAssetPath } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';
import fs from 'fs';

async function requireAuth(req, reply) {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

export default async function assetsRoutes(app) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (_req, reply) => {
    const list = await readAssets();
    return reply.send(list);
  });

  app.post('/upload', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'dataBase64'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          dataBase64: { type: 'string', minLength: 1 },
          mime: { type: 'string' }
        }
      }
    }
  }, async (req, reply) => {
    const { name, dataBase64, mime } = req.body;
    const buf = Buffer.from(dataBase64, 'base64');
    const MAX_BYTES = 10 * 1024 * 1024;
    if (buf.byteLength > MAX_BYTES) return reply.code(400).send({ error: 'file_too_large' });
    const record = await addAsset({ name, mime, dataBuffer: buf });
    return reply.send(record);
  });

  app.get('/:id', async (req, reply) => {
    const asset = await getAssetById(req.params.id);
    if (!asset) return reply.code(404).send({ error: 'not_found' });
    const stream = fs.createReadStream(buildAssetPath(asset.file));
    reply.type(asset.mime || 'application/octet-stream');
    return reply.send(stream);
  });

  app.delete('/:id', async (req, reply) => {
    const ok = await deleteAsset(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ ok: true });
  });
}

