import { readMap, writeMap, getDefaultMap, getActiveSession } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';
import { normalizeMapDocument } from '../domain/map.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { GameSession } from '../types/game-session.js';
import type { GridData, MapDocument } from '../types/map.js';

const MIN_HEIGHT = -50;
const MAX_HEIGHT = 200;
const MAX_GRID = 1000;
const MIN_CELL_SIZE = 0.1;
const MAX_CELL_SIZE = 100;

type MapBody = Partial<MapDocument> & Record<string, any>;

function clampGrid(grid: Partial<GridData> | undefined): GridData {
  const rawCols = Number(grid?.cols);
  const rawRows = Number(grid?.rows);
  const rawCell = Number(grid?.cellSize);
  const cols = Math.max(1, Math.min(MAX_GRID, Number.isFinite(rawCols) ? rawCols : 1));
  const rows = Math.max(1, Math.min(MAX_GRID, Number.isFinite(rawRows) ? rawRows : 1));
  const cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Number.isFinite(rawCell) ? rawCell : 1));
  return { cols, rows, cellSize };
}

function normalizeHeightmap(grid: GridData, incoming: unknown): number[][] {
  const rows = Math.max(1, Number(grid.rows) || 1);
  const cols = Math.max(1, Number(grid.cols) || 1);
  const result = [];
  for (let r = 0; r < rows; r++) {
    const rowsSource = Array.isArray(incoming) ? incoming : [];
    const rowSrc = Array.isArray(rowsSource[r]) ? rowsSource[r] as unknown[] : null;
    const normalizedRow = [];
    for (let c = 0; c < cols; c++) {
      const raw = rowSrc && Number.isFinite(Number(rowSrc[c])) ? Number(rowSrc[c]) : 0;
      const clamped = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, raw));
      normalizedRow.push(clamped);
    }
    result.push(normalizedRow);
  }
  return result;
}

function isSessionMember(session: GameSession | null, userId: string): boolean {
  if (!session) return false;
  if (session.gmUserId === userId) return true;
  return Array.isArray(session.players) && session.players.some(p => p.userId === userId);
}

function clampCell(value: unknown, maxInclusive: number): number {
  return Math.max(0, Math.min(maxInclusive, Number(value)));
}

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

const mapRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'missing_auth' });
    const sessionIdRaw = req.headers['x-session-id'];
    const sessionId = sessionIdRaw ? String(sessionIdRaw).trim() : null;
    let ownerId = req.user.userId;
    if (sessionId) {
      const session = await getActiveSession(sessionId);
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      if (!isSessionMember(session, req.user.userId)) return reply.code(403).send({ error: 'not_in_session' });
      ownerId = session.sessionId;
    }
    const data = await readMap(ownerId);
    const grid = clampGrid(data?.grid || {});
    const heightmap = normalizeHeightmap(grid, data?.heightmap);
    return reply.send({
      ...getDefaultMap(),
      ...data,
      grid,
      heightmap
    });
  });

  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['version', 'grid'],
        additionalProperties: true,
        properties: {
          version: { type: 'integer' },
          grid: {
            type: 'object',
            required: ['cols', 'rows', 'cellSize'],
            properties: {
              cols: { type: 'integer', minimum: 1, maximum: 1000 },
              rows: { type: 'integer', minimum: 1, maximum: 1000 },
              cellSize: { type: 'number', minimum: 0.1, maximum: 100 }
            }
          },
          heightmap: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'number' }
            }
          },
          path: {
            type: 'object',
            required: [],
            properties: {
              waypoints: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['col', 'row'],
                  properties: {
                    col: { type: 'integer', minimum: 0 },
                    row: { type: 'integer', minimum: 0 }
                  }
                }
              }
            }
          },
          base: {
            type: 'object',
            required: [],
            properties: {
              hp: { type: 'integer', minimum: 1, maximum: 100000 }
            }
          },
          waves: {
            type: 'array',
            items: {
              type: 'object',
              required: ['count', 'interval', 'type', 'hp', 'speed', 'reward'],
              properties: {
                count: { type: 'integer', minimum: 1, maximum: 10000 },
                interval: { type: 'number', minimum: 0.01, maximum: 3600 },
                type: { type: 'string' },
                hp: { type: 'number', minimum: 1, maximum: 1e9 },
                speed: { type: 'number', minimum: 0.01, maximum: 1000 },
                reward: { type: 'integer', minimum: 0, maximum: 1e9 }
              }
            }
          },
          towers: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'type', 'col', 'row', 'level'],
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                col: { type: 'integer', minimum: 0 },
                row: { type: 'integer', minimum: 0 },
                level: { type: 'integer', minimum: 1 },
                size: {
                  type: 'object',
                  required: [],
                  properties: {
                    w: { type: 'integer', minimum: 1, maximum: 1000 },
                    h: { type: 'integer', minimum: 1, maximum: 1000 }
                  }
                },
                height: { type: 'number', minimum: 0.1, maximum: 10000 },
                color: {
                  type: 'object',
                  required: [],
                  properties: {
                    r: { type: 'number', minimum: 0, maximum: 1 },
                    g: { type: 'number', minimum: 0, maximum: 1 },
                    b: { type: 'number', minimum: 0, maximum: 1 }
                  }
                },
                props: { type: 'object', additionalProperties: true }
              }
            }
          },
          objects: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              required: ['id', 'type', 'transform'],
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                assetId: { type: ['string', 'null'] },
                primitiveType: { type: 'string' },
                transform: {
                  type: 'object',
                  additionalProperties: true,
                  required: ['position', 'rotation', 'scale'],
                  properties: {
                    position: { type: 'object', additionalProperties: true },
                    rotation: { type: 'object', additionalProperties: true },
                    scale: { type: 'object', additionalProperties: true }
                  }
                },
                collision: { type: 'object', additionalProperties: true },
                tags: { type: 'array', items: { type: 'string' } },
                properties: { type: 'object', additionalProperties: true }
              }
            }
          },
          terrain: { type: 'object', additionalProperties: true },
          lighting: { type: 'object', additionalProperties: true },
          metadata: { type: 'object', additionalProperties: true }
        }
      }
    }
  }, async (req: FastifyRequest<{ Body: MapBody }>, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'missing_auth' });
    const sessionIdRaw = req.headers['x-session-id'];
    const sessionId = sessionIdRaw ? String(sessionIdRaw).trim() : null;
    let ownerId = req.user.userId;
    if (sessionId) {
      const session = await getActiveSession(sessionId);
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      if (!isSessionMember(session, req.user.userId)) return reply.code(403).send({ error: 'not_in_session' });
      ownerId = session.sessionId;
    }
    const incoming = req.body;

    const grid = clampGrid(incoming.grid);
    const heightmap = normalizeHeightmap(grid, incoming.heightmap);
    const existing = await readMap(ownerId);
    const normalized = normalizeMapDocument({
      ...existing,
      ...incoming,
      version: (existing?.version || 1) + 1,
      grid,
      heightmap,
      terrain: { ...(incoming.terrain || {}), heightmap },
      path: {
        waypoints: Array.isArray(incoming?.path?.waypoints) ? incoming.path.waypoints.map((wp: any) => ({
          col: clampCell(wp.col, grid.cols - 1),
          row: clampCell(wp.row, grid.rows - 1)
        })) : []
      }
    });

    await writeMap(ownerId, normalized);
    if (sessionId && typeof app.broadcast === 'function') {
      app.broadcast(ownerId, { type: 'map_updated', sessionId: ownerId, version: normalized.version });
    }
    return reply.send({ ok: true });
  });
};

export default mapRoutes;
