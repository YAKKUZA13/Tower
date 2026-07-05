/**
 * Карта и сетка — единый источник типов для client и server (@tower/shared).
 * См. ADR-3 в docs/adr.md.
 */

import type { Wave } from './td.js';
import type { ResourceBag } from './economy.js';

export interface Vector3Data {
  x: number;
  y: number;
  z: number;
}

export interface WorldTransform {
  position: Vector3Data;
  rotation: Vector3Data;
  scale: Vector3Data;
}

export interface TerrainData {
  heightmap: number[][];
  materialLayers?: unknown[];
  water?: unknown[];
  biome?: string;
}

export interface PlacedObject {
  id: string;
  type: string;
  assetId?: string | null;
  primitiveType?: 'box' | 'cylinder' | 'sphere' | string;
  transform: WorldTransform;
  collision?: {
    blocking?: boolean;
    selectable?: boolean;
  };
  tags?: string[];
  properties?: Record<string, unknown>;
}

export interface GridData {
  cols: number;
  rows: number;
  cellSize: number;
}

export interface Waypoint {
  col: number;
  row: number;
}

export interface BaseDef {
  col: number;
  row: number;
  hp: number;
}

export interface MapDocument {
  version: number;
  grid: GridData;
  heightmap: number[][];
  terrain?: TerrainData;
  objects?: PlacedObject[];
  lighting?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  // ── TD level definition (поле боя) ──
  path: { waypoints: Waypoint[] };
  spawnPoint: Waypoint;
  base: BaseDef;
  startingGold: number;
  waves: Wave[];
  // ── RTS-режим «Тёмная крепость» (Phase 6, концепция 3). Опциональный. ──
  rts?: RtsConfig;
}

/**
 * Конфигурация RTS-режима на карте (Phase 6).
 * Когда rts отсутствует или enabled=false — карта играется как чистый TD.
 */
export interface RtsConfig {
  enabled: boolean;
  /** Стартовый запас ресурсов экономки. */
  startingResources?: ResourceBag;
  /** Id каталога командира (какой лорд ведёт оборону). Опц. — дефолт = 'commander:necromancer'. */
  commanderTypeId?: string;
  /** Стартовые здания (typeId + col/row) — размещаются при инициализации сима. */
  startBuildings?: Array<{ typeId: string; col: number; row: number }>;
}
