import { readAssets, addAsset, getAssetWithDataById, deleteAsset } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

interface UploadBody {
  name: string;
  dataBase64: string;
  mime?: string;
}

interface AssetParams {
  id: string;
}

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

const assetsRoutes: FastifyPluginAsync = async (app) => {
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
  }, async (req: FastifyRequest<{ Body: UploadBody }>, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'missing_auth' });
    const { name, dataBase64, mime } = req.body;
    const buf = Buffer.from(dataBase64, 'base64');
    const MAX_BYTES = 10 * 1024 * 1024;
    if (buf.byteLength > MAX_BYTES) return reply.code(400).send({ error: 'file_too_large' });
    const record = await addAsset({
      name,
      ...(mime ? { mime } : {}),
      dataBuffer: buf,
      ownerUserId: req.user.userId
    });
    return reply.send(record);
  });

  app.get('/:id', async (req: FastifyRequest<{ Params: AssetParams }>, reply) => {
    const asset = await getAssetWithDataById(req.params.id);
    if (!asset?.data) return reply.code(404).send({ error: 'not_found' });
    reply.type(asset.mime || 'application/octet-stream');
    return reply.send(asset.data);
  });

  app.delete('/:id', async (req: FastifyRequest<{ Params: AssetParams }>, reply) => {
    const ok = await deleteAsset(req.params.id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    return reply.send({ ok: true });
  });
};

export default assetsRoutes;

