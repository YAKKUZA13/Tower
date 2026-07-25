/**
 * M8.5 — RTS maps (2-/3-/4-player стартовые позиции, resource-узлы, neutral buildings).
 * Источник: AoE/Warcraft RTS maps; symmetric/near-symmetric layouts.
 *
 * 3 встроенные карты:
 *  - rts-2p-crossroads: 64×64, 2 игрока, симметричные углы (NW/SE), центральный neutral mine.
 *  - rts-3p-trident: 72×72, 3 игрока (треугольник), shared central forest.
 *  - rts-4p-quadrants: 80×80, 4 игрока (4 угла), центральный contested area.
 *
 * Все карты — gameMode:'rts', grid ≥64×64 (M8.1), terrain heightmap ≠ 0 (M8.1 sampleHeight),
 * resource-nodes per player + neutral. Symmetric layout (баланс стартов).
 */
import type { MapDocument, TileType, PlayerStart, ResourceNode } from '../types/map.js';
import { flatHeightmap, fillTiles, paintTileRect } from './index.js';

// ── Map 1: rts-2p-crossroads (64×64, 2P) ─────────────────────────────────

function buildRts2pTiles(): TileType[][] {
  const tiles = fillTiles(64, 64, 'grass');
  // центральный road-patch (для визуальной читаемости neutral area)
  paintTileRect(tiles, 64, 64, 28, 35, 28, 35, 'dirt');
  // реки (water) по диагоналям — декор + лёгкое препятствие (M8.1: water НЕ проходим)
  paintTileRect(tiles, 64, 64, 0, 8, 50, 56, 'water');
  paintTileRect(tiles, 64, 64, 56, 63, 8, 14, 'water');
  // горы (rock) в углах — framing
  paintTileRect(tiles, 64, 64, 0, 3, 0, 3, 'rock');
  paintTileRect(tiles, 64, 64, 60, 63, 60, 63, 'rock');
  // neutral stone-pile в центре (декор)
  paintTileRect(tiles, 64, 64, 31, 32, 31, 32, 'rock');
  return tiles;
}

function buildRts2pHeightmap(): number[][] {
  // плавный rolling-terrain: sin/cos-based low-amplitude (детерминированный)
  const hm = flatHeightmap(64, 64);
  for (let r = 0; r < 64; r++) {
    for (let c = 0; c < 64; c++) {
      // low-amplitude noise (1.0 .. 2.0)
      const v = 1.0 + 0.5 * Math.sin(c * 0.18) * Math.cos(r * 0.21) + 0.3 * Math.sin((c + r) * 0.07);
      hm[r]![c] = Math.max(0, v);
    }
  }
  return hm;
}

const RTS_2P_CROSSROADS_STARTS: PlayerStart[] = [
  { slot: 0, color: '2E86DE', townHall: { col: 8, row: 8 }, workers: [{ col: 10, row: 8 }, { col: 8, row: 10 }, { col: 10, row: 10 }] },
  { slot: 1, color: 'E74C3C', townHall: { col: 56, row: 56 }, workers: [{ col: 54, row: 56 }, { col: 56, row: 54 }, { col: 54, row: 54 }] }
];

const RTS_2P_CROSSROADS_NODES: ResourceNode[] = [
  // per-player wood
  { id: 'rn-2p-w0', col: 12, row: 6, kind: 'wood', amount: 800 },
  { id: 'rn-2p-w1', col: 6, row: 12, kind: 'wood', amount: 800 },
  { id: 'rn-2p-w2', col: 52, row: 58, kind: 'wood', amount: 800 },
  { id: 'rn-2p-w3', col: 58, row: 52, kind: 'wood', amount: 800 },
  // per-player stone
  { id: 'rn-2p-s0', col: 14, row: 12, kind: 'stone', amount: 500 },
  { id: 'rn-2p-s1', col: 50, row: 52, kind: 'stone', amount: 500 },
  // central neutral gold
  { id: 'rn-2p-g0', col: 32, row: 32, kind: 'gold', amount: 1500 },
  // central neutral ore
  { id: 'rn-2p-o0', col: 28, row: 32, kind: 'ore', amount: 600 },
  { id: 'rn-2p-o1', col: 36, row: 32, kind: 'ore', amount: 600 }
];

const RTS_2P_CROSSROADS: MapDocument = {
  version: 1,
  gameMode: 'rts',
  grid: { cols: 64, rows: 64, cellSize: 1.5 },
  heightmap: buildRts2pHeightmap(),
  metadata: { name: 'rts-2p-crossroads', title: 'Crossroads', difficulty: 'medium', mode: '1v1' },
  tiles: buildRts2pTiles(),
  playerStarts: RTS_2P_CROSSROADS_STARTS,
  resourceNodes: RTS_2P_CROSSROADS_NODES,
  chunkedStreaming: true,
  // M8 RTS-solo: rts-config — стартовые ресурсы игрока (slot 0) и командир.
  // Town-hall + workers берутся из playerStarts[0]; slot 1+ → AI (spawner).
  rts: {
    enabled: true,
    commanderTypeId: 'commander:necromancer',
    startingResources: { wood: 250, stone: 120, ore: 20, gold: 80 }
  }
};

// ── Map 2: rts-3p-trident (72×72, 3P) ───────────────────────────────────

function buildRts3pTiles(): TileType[][] {
  const tiles = fillTiles(72, 72, 'grass');
  // центральный contested triangle
  paintTileRect(tiles, 72, 72, 33, 38, 33, 38, 'dirt');
  // реки от центра к 3-м сторонам
  paintTileRect(tiles, 72, 72, 35, 36, 0, 30, 'water');
  // горы по углам треугольника (не на player-base'ах)
  paintTileRect(tiles, 72, 72, 0, 5, 67, 72, 'rock');
  paintTileRect(tiles, 72, 72, 67, 72, 67, 72, 'rock');
  paintTileRect(tiles, 72, 72, 33, 38, 0, 5, 'rock');
  return tiles;
}

function buildRts3pHeightmap(): number[][] {
  const hm = flatHeightmap(72, 72);
  for (let r = 0; r < 72; r++) {
    for (let c = 0; c < 72; c++) {
      const v = 1.0 + 0.5 * Math.sin(c * 0.16) * Math.cos(r * 0.18) + 0.25 * Math.cos((c + r) * 0.06);
      hm[r]![c] = Math.max(0, v);
    }
  }
  return hm;
}

const RTS_3P_TRIDENT_STARTS: PlayerStart[] = [
  { slot: 0, color: '2E86DE', townHall: { col: 8, row: 64 }, workers: [{ col: 10, row: 64 }, { col: 8, row: 62 }] },
  { slot: 1, color: 'E74C3C', townHall: { col: 64, row: 64 }, workers: [{ col: 62, row: 64 }, { col: 64, row: 62 }] },
  { slot: 2, color: 'F4D03F', townHall: { col: 36, row: 8 }, workers: [{ col: 38, row: 8 }, { col: 36, row: 10 }] }
];

const RTS_3P_TRIDENT_NODES: ResourceNode[] = [
  { id: 'rn-3p-w0', col: 12, row: 60, kind: 'wood', amount: 800 },
  { id: 'rn-3p-w1', col: 60, row: 60, kind: 'wood', amount: 800 },
  { id: 'rn-3p-w2', col: 40, row: 12, kind: 'wood', amount: 800 },
  { id: 'rn-3p-s0', col: 14, row: 62, kind: 'stone', amount: 500 },
  { id: 'rn-3p-s1', col: 58, row: 62, kind: 'stone', amount: 500 },
  { id: 'rn-3p-s2', col: 38, row: 12, kind: 'stone', amount: 500 },
  { id: 'rn-3p-g0', col: 36, row: 36, kind: 'gold', amount: 1500 },
  { id: 'rn-3p-o0', col: 32, row: 36, kind: 'ore', amount: 600 },
  { id: 'rn-3p-o1', col: 40, row: 36, kind: 'ore', amount: 600 }
];

const RTS_3P_TRIDENT: MapDocument = {
  version: 1,
  gameMode: 'rts',
  grid: { cols: 72, rows: 72, cellSize: 1.5 },
  heightmap: buildRts3pHeightmap(),
  metadata: { name: 'rts-3p-trident', title: 'Trident', difficulty: 'medium', mode: '1v1v1' },
  tiles: buildRts3pTiles(),
  playerStarts: RTS_3P_TRIDENT_STARTS,
  resourceNodes: RTS_3P_TRIDENT_NODES,
  chunkedStreaming: true,
  rts: {
    enabled: true,
    commanderTypeId: 'commander:necromancer',
    startingResources: { wood: 250, stone: 120, ore: 20, gold: 80 }
  }
};

// ── Map 3: rts-4p-quadrants (80×80, 4P) ─────────────────────────────────

function buildRts4pTiles(): TileType[][] {
  const tiles = fillTiles(80, 80, 'grass');
  // central contested square
  paintTileRect(tiles, 80, 80, 36, 43, 36, 43, 'dirt');
  // rivers forming quadrant boundaries
  paintTileRect(tiles, 80, 80, 38, 41, 0, 35, 'water');
  paintTileRect(tiles, 80, 80, 38, 41, 44, 79, 'water');
  paintTileRect(tiles, 80, 80, 0, 35, 38, 41, 'water');
  paintTileRect(tiles, 80, 80, 44, 79, 38, 41, 'water');
  // mountains in 4 corners
  paintTileRect(tiles, 80, 80, 0, 4, 0, 4, 'rock');
  paintTileRect(tiles, 80, 80, 75, 79, 0, 4, 'rock');
  paintTileRect(tiles, 80, 80, 0, 4, 75, 79, 'rock');
  paintTileRect(tiles, 80, 80, 75, 79, 75, 79, 'rock');
  return tiles;
}

function buildRts4pHeightmap(): number[][] {
  const hm = flatHeightmap(80, 80);
  for (let r = 0; r < 80; r++) {
    for (let c = 0; c < 80; c++) {
      const v = 1.0 + 0.5 * Math.sin(c * 0.15) * Math.cos(r * 0.17) + 0.25 * Math.sin((c - r) * 0.08);
      hm[r]![c] = Math.max(0, v);
    }
  }
  return hm;
}

const RTS_4P_QUADRANTS_STARTS: PlayerStart[] = [
  { slot: 0, color: '2E86DE', townHall: { col: 8, row: 8 }, workers: [{ col: 10, row: 8 }, { col: 8, row: 10 }] },
  { slot: 1, color: 'E74C3C', townHall: { col: 72, row: 8 }, workers: [{ col: 70, row: 8 }, { col: 72, row: 10 }] },
  { slot: 2, color: 'F4D03F', townHall: { col: 8, row: 72 }, workers: [{ col: 10, row: 72 }, { col: 8, row: 70 }] },
  { slot: 3, color: '58D68D', townHall: { col: 72, row: 72 }, workers: [{ col: 70, row: 72 }, { col: 72, row: 70 }] }
];

const RTS_4P_QUADRANTS_NODES: ResourceNode[] = [
  // per-quadrant wood+stone
  { id: 'rn-4p-w0', col: 12, row: 6, kind: 'wood', amount: 800 },
  { id: 'rn-4p-w1', col: 68, row: 6, kind: 'wood', amount: 800 },
  { id: 'rn-4p-w2', col: 12, row: 74, kind: 'wood', amount: 800 },
  { id: 'rn-4p-w3', col: 68, row: 74, kind: 'wood', amount: 800 },
  { id: 'rn-4p-s0', col: 6, row: 12, kind: 'stone', amount: 500 },
  { id: 'rn-4p-s1', col: 74, row: 12, kind: 'stone', amount: 500 },
  { id: 'rn-4p-s2', col: 6, row: 68, kind: 'stone', amount: 500 },
  { id: 'rn-4p-s3', col: 74, row: 68, kind: 'stone', amount: 500 },
  // central gold (contested)
  { id: 'rn-4p-g0', col: 40, row: 40, kind: 'gold', amount: 2500 },
  // central ore (contested)
  { id: 'rn-4p-o0', col: 36, row: 40, kind: 'ore', amount: 800 },
  { id: 'rn-4p-o1', col: 44, row: 40, kind: 'ore', amount: 800 },
  { id: 'rn-4p-o2', col: 40, row: 36, kind: 'ore', amount: 800 },
  { id: 'rn-4p-o3', col: 40, row: 44, kind: 'ore', amount: 800 }
];

const RTS_4P_QUADRANTS: MapDocument = {
  version: 1,
  gameMode: 'rts',
  grid: { cols: 80, rows: 80, cellSize: 1.5 },
  heightmap: buildRts4pHeightmap(),
  metadata: { name: 'rts-4p-quadrants', title: 'Quadrants', difficulty: 'hard', mode: '1v1v1v1' },
  tiles: buildRts4pTiles(),
  playerStarts: RTS_4P_QUADRANTS_STARTS,
  resourceNodes: RTS_4P_QUADRANTS_NODES,
  chunkedStreaming: true,
  rts: {
    enabled: true,
    commanderTypeId: 'commander:necromancer',
    startingResources: { wood: 250, stone: 120, ore: 20, gold: 80 }
  }
};

// ── exports ────────────────────────────────────────────────────────────

export const RTS_MAPS: readonly MapDocument[] = [
  RTS_2P_CROSSROADS,
  RTS_3P_TRIDENT,
  RTS_4P_QUADRANTS
];

export const RTS_MAP_BY_ID: ReadonlyMap<string, MapDocument> = new Map(
  RTS_MAPS.map((m) => [String(m.metadata?.name), m])
);

export function getRtsMap(mapId: string | null | undefined): MapDocument | null {
  if (!mapId) return null;
  return RTS_MAP_BY_ID.get(mapId) ?? null;
}
