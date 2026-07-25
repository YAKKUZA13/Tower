/**
 * Карта и сетка — единый источник типов для client и server (@tower/shared).
 * См. ADR-3 в docs/adr.md.
 */

import type { Wave } from './td.js';
import type { ResourceBag, ResourceKind } from './economy.js';

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

/**
 * Тип тайла террейна (Phase T — референс 'Isometric Fantasy Tiles').
 *
 * Тайл = одна клетка поля боя с тематическим биомом. Влияет на:
 *  - визуал (TileRenderer рисует per-type воксель-мастера через thin instances);
 *  - проходимость: water/rock НЕ проходимы врагами (A* их обходит);
 *  - застройку: water/rock НЕ подходят для башен/стен/реликвий.
 *
 * Строки = rows, столбцы внутри строки = cols. tiles[row][col].
 * Опционально: при отсутствии рендер использует fallback-плиту (back-compat).
 */
export type TileType = 'grass' | 'dirt' | 'road' | 'water' | 'rock' | 'sand';

export interface Waypoint {
  col: number;
  row: number;
}

export interface BaseDef {
  col: number;
  row: number;
  hp: number;
}

// ── M8: game-mode (RTS = канонический; TD = legacy sandbox) ──────────────
export type GameMode = 'rts' | 'td';

/**
 * Стартовая позиция игрока на RTS-карте (M8.1, M8.5).
 *  - slot: 0..3 (поддержка 1v1 / 1v1v1 / 1v1v1v1)
 *  - color: hex RGB без '#' (например '2E86DE')
 *  - townHall: клетка под стартовое здание
 *  - workers: клетки спавна первых workers (M8.3)
 */
export interface PlayerStart {
  slot: number;
  color: string;
  townHall: Waypoint;
  workers?: Waypoint[];
}

/**
 * Узел ресурсов на RTS-карте (M8.3).
 * Исчерпаемый (amount → 0 → узел исчезает, рендер снимается).
 */
export interface ResourceNode {
  id: string;
  col: number;
  row: number;
  kind: ResourceKind;
  /** Начальный запас (сколько единиц можно добыть). */
  amount: number;
}

export interface MapDocument {
  version: number;
  grid: GridData;
  heightmap: number[][];
  terrain?: TerrainData;
  objects?: PlacedObject[];
  lighting?: Record<string, unknown>;
  metadata?: Record<string, unknown>;

  // ── M8: gameMode ──
  // 'rts' (canonical, default) | 'td' (legacy sandbox).
  // Если отсутствует — считается 'rts' для M8+ карт и 'td' для legacy.
  gameMode?: GameMode;

  // ── M8: RTS-extensions ──
  /** Стартовые позиции игроков (2..4). */
  playerStarts?: PlayerStart[];
  /** Ресурсные узлы (M8.3). */
  resourceNodes?: ResourceNode[];
  /** Чанковый стриминг (для карт > 64×64; см. M8.1 chunked rendering). */
  chunkedStreaming?: boolean;

  // ── TD level definition (поле боя) — LEGACY, не используется в RTS-режиме ──
  /** @deprecated M8 — только для legacy TD-режима. */
  path?: { waypoints: Waypoint[] };
  /** @deprecated M8 — только для legacy TD-режима. */
  spawnPoint?: Waypoint;
  /** @deprecated M8 — только для legacy TD-режима. */
  base?: BaseDef;
  /** @deprecated M8 — только для legacy TD-режима. */
  startingGold?: number;
  /** @deprecated M8 — только для legacy TD-режима. */
  waves?: Wave[];
  /**
   * Тайловая разметка поля боя (Phase T — референс 'Isometric Fantasy Tiles').
   * Размер: `tiles.length === grid.rows`, `tiles[row].length === grid.cols`.
   * Опционально: при отсутствии всё поле = grass (fallback-плита).
   * Spawn и base клетки должны быть на проходимых тайлах (grass/dirt/road/sand).
   */
  tiles?: TileType[][];
  // ── RTS-режим «Тёмная крепость» (Phase 6, концепция 3). Опциональный. ──
  /** @deprecated M8 — заменено на gameMode='rts' + rtsConfig. */
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
