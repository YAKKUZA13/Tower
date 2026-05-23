import crypto from 'crypto';
import type { GridData, MapDocument } from '../types/map.js';

const DEFAULT_GRID = { cols: 32, rows: 18, cellSize: 1.5 };

type MapInput = Partial<MapDocument> & Record<string, any>;
type LegacyTower = Record<string, any>;

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
    paths: [],
    encounters: [],
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
    base: { hp: 20 },
    waves: [],
    towers: []
  };
}

export function towerToPlacedObject(tower: LegacyTower, grid: GridData) {
  const size = tower?.size || { w: 1, h: 1 };
  const cellSize = Number(grid?.cellSize) || 1;
  const col = Number(tower?.col) || 0;
  const row = Number(tower?.row) || 0;
  const x = (col + size.w / 2) * cellSize - ((grid?.cols || 1) * cellSize) / 2;
  const z = (row + size.h / 2) * cellSize - ((grid?.rows || 1) * cellSize) / 2;
  return {
    id: String(tower?.id || crypto.randomUUID()),
    type: String(tower?.type || 'object'),
    primitiveType: 'box',
    transform: {
      position: { x, y: 0, z },
      rotation: { x: 0, y: 0, z: 0 },
      scale: {
        x: Math.max(0.1, Number(size.w || 1) * cellSize),
        y: Math.max(0.1, Number(tower?.height || 2)),
        z: Math.max(0.1, Number(size.h || 1) * cellSize)
      }
    },
    tags: [String(tower?.type || 'object')],
    properties: {
      legacyTower: true,
      level: Math.max(1, Number(tower?.level || 1)),
      color: tower?.color || { r: 0.6, g: 0.6, b: 0.6 },
      props: tower?.props || {}
    }
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
    : (Array.isArray(input.towers) ? input.towers.map(tower => towerToPlacedObject(tower as LegacyTower, grid)) : []);

  return {
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
    paths: Array.isArray(input.paths) ? input.paths : [],
    encounters: Array.isArray(input.encounters) ? input.encounters : [],
    lighting: { ...fallback.lighting, ...(input.lighting || {}) },
    metadata: { ...fallback.metadata, ...(input.metadata || {}) },
    towers: Array.isArray(input.towers) ? input.towers : [],
    path: input.path || { waypoints: [] },
    base: input.base || { hp: 20 },
    waves: Array.isArray(input.waves) ? input.waves : []
  };
}
