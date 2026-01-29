import { readMap, writeMap, getDefaultMap, getActiveSession } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';

const MIN_HEIGHT = -50;
const MAX_HEIGHT = 200;
const MAX_GRID = 1000;
const MIN_CELL_SIZE = 0.1;
const MAX_CELL_SIZE = 100;

function clampGrid(grid) {
  const rawCols = Number(grid?.cols);
  const rawRows = Number(grid?.rows);
  const rawCell = Number(grid?.cellSize);
  const cols = Math.max(1, Math.min(MAX_GRID, Number.isFinite(rawCols) ? rawCols : 1));
  const rows = Math.max(1, Math.min(MAX_GRID, Number.isFinite(rawRows) ? rawRows : 1));
  const cellSize = Math.max(MIN_CELL_SIZE, Math.min(MAX_CELL_SIZE, Number.isFinite(rawCell) ? rawCell : 1));
  return { cols, rows, cellSize };
}

function normalizeHeightmap(grid, incoming) {
  const rows = Math.max(1, Number(grid.rows) || 1);
  const cols = Math.max(1, Number(grid.cols) || 1);
  const result = [];
  for (let r = 0; r < rows; r++) {
    const rowSrc = Array.isArray(incoming?.[r]) ? incoming[r] : null;
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

function isSessionMember(session, userId) {
  if (!session) return false;
  if (session.gmUserId === userId) return true;
  return Array.isArray(session.players) && session.players.some(p => p.userId === userId);
}

function clampCell(value, maxInclusive) {
  return Math.max(0, Math.min(maxInclusive, Number(value)));
}

async function requireAuth(req, reply) {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

export default async function mapRoutes(app) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req, reply) => {
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
        required: ['version', 'grid', 'towers'],
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
          }
        }
      }
    }
  }, async (req, reply) => {
    const sessionIdRaw = req.headers['x-session-id'];
    const sessionId = sessionIdRaw ? String(sessionIdRaw).trim() : null;
    let ownerId = req.user.userId;
    if (sessionId) {
      const session = await getActiveSession(sessionId);
      if (!session) return reply.code(404).send({ error: 'session_not_found' });
      if (!isSessionMember(session, req.user.userId)) return reply.code(403).send({ error: 'not_in_session' });
      ownerId = session.sessionId;
    }
    const existing = await readMap(ownerId);
    const incoming = req.body;

    const grid = clampGrid(incoming.grid);
    const heightmap = normalizeHeightmap(grid, incoming.heightmap);

    const normalized = {
      version: (existing?.version || 1) + 1,
      grid,
      heightmap,
      path: {
        waypoints: Array.isArray(incoming?.path?.waypoints) ? incoming.path.waypoints.map(wp => ({
          col: clampCell(wp.col, grid.cols - 1),
          row: clampCell(wp.row, grid.rows - 1)
        })) : []
      },
      base: {
        hp: Math.max(1, Number(incoming?.base?.hp || 20))
      },
      waves: Array.isArray(incoming?.waves) ? incoming.waves.map(w => ({
        count: Math.max(1, Number(w.count)),
        interval: Math.max(0.01, Number(w.interval)),
        type: String(w.type || 'basic'),
        hp: Math.max(1, Number(w.hp)),
        speed: Math.max(0.01, Number(w.speed)),
        reward: Math.max(0, Number(w.reward))
      })) : [
        { count: 10, interval: 1, type: 'basic', hp: 10, speed: 1, reward: 1 },
        { count: 12, interval: 0.9, type: 'basic', hp: 12, speed: 1, reward: 1 },
        { count: 15, interval: 0.8, type: 'basic', hp: 15, speed: 1.1, reward: 2 }
      ],
      towers: Array.isArray(incoming.towers) ? incoming.towers.map(t => {
        const lvl = Math.max(1, Number(t.level || 1));
        const sizeW = Math.max(1, Number(t?.size?.w || 1));
        const sizeH = Math.max(1, Number(t?.size?.h || 1));
        const explicitHeight = Number(t?.height);
        const height = Number.isFinite(explicitHeight) ? Math.max(0.1, explicitHeight) : Math.max(0.1, 2 + lvl * 0.2);
        const props = (t && typeof t === 'object' && t.props && typeof t.props === 'object') ? t.props : {};
        const colorObj = (t && typeof t === 'object' && t.color && typeof t.color === 'object') ? t.color : null;
        const r = Math.max(0, Math.min(1, Number(colorObj?.r ?? 0.6)));
        const g = Math.max(0, Math.min(1, Number(colorObj?.g ?? 0.6)));
        const b = Math.max(0, Math.min(1, Number(colorObj?.b ?? 0.6)));
        return {
          id: String(t.id),
          type: String(t.type || 'basic'),
          col: clampCell(t.col, grid.cols - 1),
          row: clampCell(t.row, grid.rows - 1),
          level: lvl,
          size: { w: sizeW, h: sizeH },
          height,
          color: { r, g, b },
          props
        };
      }) : []
    };

    await writeMap(ownerId, normalized);
    if (sessionId && typeof app.broadcast === 'function') {
      app.broadcast(ownerId, { type: 'map_updated', sessionId: ownerId, version: normalized.version });
    }
    return reply.send({ ok: true });
  });
}
