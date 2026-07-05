import crypto from 'crypto';
import type { BaseDef, MapDocument, RtsConfig, Waypoint } from '../types/map.js';

const DEFAULT_GRID = { cols: 32, rows: 18, cellSize: 1.5 };

type MapInput = Partial<MapDocument> & Record<string, any>;

function valueNoise(x: number, y: number, seed = 1): number {
  const h = Math.sin(seed + x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function fbmNoise(x: number, y: number, seed = 1, octaves = 4, persistence = 0.5, lacunarity = 2): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const xf = x * freq;
    const yf = y * freq;
    const x0 = Math.floor(xf);
    const y0 = Math.floor(yf);
    const tx = xf - x0;
    const ty = yf - y0;
    const v00 = valueNoise(x0, y0, seed);
    const v10 = valueNoise(x0 + 1, y0, seed);
    const v01 = valueNoise(x0, y0 + 1, seed);
    const v11 = valueNoise(x0 + 1, y0 + 1, seed);
    const vx0 = v00 * (1 - tx) + v10 * tx;
    const vx1 = v01 * (1 - tx) + v11 * tx;
    const blended = vx0 * (1 - ty) + vx1 * ty;
    sum += blended * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function generateDefaultHeightmap(rows: number, cols: number, seed = 11): number[][] {
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeCols = Math.max(1, Number(cols) || 1);
  const hm = [];
  const scale = 0.08;
  const amplitude = 8;
  for (let r = 0; r < safeRows; r++) {
    const row = [];
    for (let c = 0; c < safeCols; c++) {
      row.push(fbmNoise(c * scale, r * scale, seed, 4, 0.55, 2.1) * amplitude);
    }
    hm.push(row);
  }
  return hm;
}

function defaultTransform() {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  };
}

export function createDefaultMap(): MapDocument {
  const heightmap = generateDefaultHeightmap(DEFAULT_GRID.rows, DEFAULT_GRID.cols, 11);
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    heightmap,
    terrain: {
      heightmap,
      materialLayers: [],
      water: [],
      biome: 'temperate'
    },
    objects: [],
    lighting: {
      timeOfDay: 'day',
      fog: 0.02,
      ambient: '#8793b5',
      directional: '#ffffff'
    },
    metadata: {
      name: 'Новая карта',
      setting: '',
      author: '',
      version: 1
    },
    path: { waypoints: [] },
    spawnPoint: { col: 0, row: 0 },
    base: { col: DEFAULT_GRID.cols - 1, row: DEFAULT_GRID.rows - 1, hp: 20 },
    startingGold: 100,
    waves: []
  };
}

export function normalizeMapDocument(input: MapInput = {}): MapDocument {
  const fallback = createDefaultMap();
  const grid = input.grid || fallback.grid;
  const heightmap = Array.isArray(input.heightmap) ? input.heightmap : fallback.heightmap;
  const objects = Array.isArray(input.objects)
    ? input.objects.map(obj => ({
      id: String(obj.id || crypto.randomUUID()),
      type: String(obj.type || obj.primitiveType || 'object'),
      assetId: obj.assetId || null,
      primitiveType: obj.primitiveType || 'box',
      transform: {
        ...defaultTransform(),
        ...(obj.transform || {}),
        position: { ...defaultTransform().position, ...(obj.transform?.position || {}) },
        rotation: { ...defaultTransform().rotation, ...(obj.transform?.rotation || {}) },
        scale: { ...defaultTransform().scale, ...(obj.transform?.scale || {}) }
      },
      collision: obj.collision || { blocking: true, selectable: true },
      tags: Array.isArray(obj.tags) ? obj.tags : [],
      properties: obj.properties || {}
    }))
    : [];

  const lastCol = Math.max(0, grid.cols - 1);
  const lastRow = Math.max(0, grid.rows - 1);
  const spawnPoint: Waypoint = clampWaypoint(input.spawnPoint, lastCol, lastRow, { col: 0, row: 0 });
  const base: BaseDef = normalizeBase(input.base, lastCol, lastRow);

  const result: MapDocument = {
    ...fallback,
    ...input,
    version: Number(input.version || fallback.version),
    grid,
    heightmap,
    terrain: {
      ...(fallback.terrain),
      ...(input.terrain || {}),
      heightmap
    },
    objects,
    lighting: { ...fallback.lighting, ...(input.lighting || {}) },
    metadata: { ...fallback.metadata, ...(input.metadata || {}) },
    path: normalizePath(input.path, lastCol, lastRow),
    spawnPoint,
    base,
    startingGold: Math.max(0, Number(input.startingGold) || 100),
    waves: Array.isArray(input.waves) ? input.waves : []
  };
  const rts = normalizeRts(input.rts, lastCol, lastRow);
  if (rts) result.rts = rts;
  return result;
}

/**
 * Нормализация RTS-конфигурации (Phase 6). Если поле отсутствует или enabled=false —
 * возвращаем undefined (карта играется как чистый TD).
 */
function normalizeRts(input: any, maxCol: number, maxRow: number): RtsConfig | undefined {
  if (!input || typeof input !== 'object' || !input.enabled) return undefined;
  const startingResources = input.startingResources && typeof input.startingResources === 'object'
    ? {
      wood: Math.max(0, Number(input.startingResources.wood) || 0),
      stone: Math.max(0, Number(input.startingResources.stone) || 0),
      ore: Math.max(0, Number(input.startingResources.ore) || 0),
      gold: Math.max(0, Number(input.startingResources.gold) || 0)
    }
    : undefined;
  const startBuildings = Array.isArray(input.startBuildings)
    ? input.startBuildings
      .filter((b: any) => b && typeof b.typeId === 'string')
      .map((b: any) => ({
        typeId: String(b.typeId),
        col: clampInt(b.col, 0, maxCol, 0),
        row: clampInt(b.row, 0, maxRow, 0)
      }))
    : undefined;
  const rts: RtsConfig = { enabled: true };
  if (input.commanderTypeId) rts.commanderTypeId = String(input.commanderTypeId);
  if (startingResources) rts.startingResources = startingResources;
  if (startBuildings && startBuildings.length > 0) rts.startBuildings = startBuildings;
  return rts;
}

function clampWaypoint(input: any, maxCol: number, maxRow: number, fallback: Waypoint): Waypoint {
  const col = clampInt(input?.col, 0, maxCol, fallback.col);
  const row = clampInt(input?.row, 0, maxRow, fallback.row);
  return { col, row };
}

function normalizeBase(input: any, maxCol: number, maxRow: number): BaseDef {
  return {
    col: clampInt(input?.col, 0, maxCol, maxCol),
    row: clampInt(input?.row, 0, maxRow, maxRow),
    hp: Math.max(1, Number(input?.hp) || 20)
  };
}

function normalizePath(input: any, maxCol: number, maxRow: number): { waypoints: Waypoint[] } {
  const raw = Array.isArray(input?.waypoints) ? input.waypoints : [];
  return { waypoints: raw.map((wp: any) => clampWaypoint(wp, maxCol, maxRow, { col: 0, row: 0 })) };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
