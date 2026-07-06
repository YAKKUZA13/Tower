/**
 * Встроенные карты TD (Phase B новой концепции).
 *
 * Карты авторуются разработчиком в коде (см. ADR в docs/adr.md, Phase B).
 * В рантайме проект только проигрывает их — без редактора карт и без БД.
 *
 * Контракт:
 *   - heightmap плоский (нули) — поле боя ровное, воксельный пол рисует рендерер.
 *   - path.waypoints — референсный маршрут; реальный маршрут врагов считается A*
 *     вокруг стен (Фаза 4), но waypoints задают «ожидаемый» коридор для оверлея.
 *   - waves может быть [] — тогда GameSim берёт DEFAULT_CATALOG.waves (10 волн).
 *   - rts опционален: без поля `rts` — чистый TD.
 */

import type { MapDocument } from '../types/map.js';

/**
 * Плоский heightmap заданного размера (все высоты = 0).
 * sim/domain это разрешают: таргетинг башен считается только по XZ,
 * длины сегментов пути чуть короче, но валидны; все рендереры ставят
 * `groundY = sampleHeight(...) = 0`.
 */
export function flatHeightmap(cols: number, rows: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

// ── Карта 1: «Тропа» (easy, чистый TD) ───────────────────────────────────────
// 20×12, длинный S-образный коридор. Простой ритм волн, низкая база HP.
const MAP_TRAIL: MapDocument = {
  version: 1,
  grid: { cols: 20, rows: 12, cellSize: 1.5 },
  heightmap: flatHeightmap(20, 12),
  metadata: { name: 'trail', title: 'Тропа', difficulty: 'easy' },
  spawnPoint: { col: 0, row: 6 },
  base: { col: 19, row: 5, hp: 20 },
  startingGold: 120,
  waves: [],
  path: {
    waypoints: [
      { col: 0, row: 6 },
      { col: 4, row: 6 },
      { col: 4, row: 2 },
      { col: 10, row: 2 },
      { col: 10, row: 9 },
      { col: 15, row: 9 },
      { col: 15, row: 5 },
      { col: 19, row: 5 }
    ]
  }
};

// ── Карта 2: «Развилка» (medium, чистый TD) ──────────────────────────────────
// 24×14, двойной зигзаг с узкими горлами — простор для maze-стен.
const MAP_CROSSROADS: MapDocument = {
  version: 1,
  grid: { cols: 24, rows: 14, cellSize: 1.5 },
  heightmap: flatHeightmap(24, 14),
  metadata: { name: 'crossroads', title: 'Развилка', difficulty: 'medium' },
  spawnPoint: { col: 0, row: 7 },
  base: { col: 23, row: 6, hp: 18 },
  startingGold: 130,
  waves: [],
  path: {
    waypoints: [
      { col: 0, row: 7 },
      { col: 5, row: 7 },
      { col: 5, row: 2 },
      { col: 12, row: 2 },
      { col: 12, row: 11 },
      { col: 18, row: 11 },
      { col: 18, row: 4 },
      { col: 21, row: 4 },
      { col: 21, row: 6 },
      { col: 23, row: 6 }
    ]
  }
};

// ── Карта 3: «Крепость» (hard, RTS enabled) ──────────────────────────────────
// 26×14, разворот вокруг центрального костра (база). RTS включён: экономика,
// юниты, командир-заклинатель. Стартовый набор из лесопилки и шахты.
const MAP_FORTRESS: MapDocument = {
  version: 1,
  grid: { cols: 26, rows: 14, cellSize: 1.5 },
  heightmap: flatHeightmap(26, 14),
  metadata: { name: 'fortress', title: 'Крепость', difficulty: 'hard' },
  spawnPoint: { col: 0, row: 7 },
  base: { col: 25, row: 6, hp: 15 },
  startingGold: 100,
  waves: [],
  path: {
    waypoints: [
      { col: 0, row: 7 },
      { col: 4, row: 7 },
      { col: 4, row: 1 },
      { col: 13, row: 1 },
      { col: 13, row: 12 },
      { col: 22, row: 12 },
      { col: 22, row: 6 },
      { col: 25, row: 6 }
    ]
  },
  rts: {
    enabled: true,
    commanderTypeId: 'commander:necromancer',
    startingResources: { wood: 60, stone: 30, ore: 0, gold: 0 },
    startBuildings: [
      { typeId: 'sawmill', col: 2, row: 11 },
      { typeId: 'mine', col: 3, row: 11 }
    ]
  }
};

export type MapDifficulty = 'easy' | 'medium' | 'hard';

export interface BuiltinMapInfo {
  /** Идентификатор карты (равен `metadata.name`) — ключ для лидерборда и co-op. */
  id: string;
  /** Человекочитаемое название. */
  title: string;
  difficulty: MapDifficulty;
  /** Короткое описание для лобби. */
  description: string;
  /** Включён ли RTS-режим. */
  hasRts: boolean;
}

/** Метаданные встроенных карт (для UI лобби / меню выбора). */
export const BUILTIN_MAP_LIST: readonly BuiltinMapInfo[] = [
  {
    id: 'trail',
    title: 'Тропа',
    difficulty: 'easy',
    description: 'Просторный коридор с одним S-образным изгибом. Неспешный ритм волн.',
    hasRts: false
  },
  {
    id: 'crossroads',
    title: 'Развилка',
    difficulty: 'medium',
    description: 'Узкое горло и двойной зигзаг — простор для лабиринта из стен.',
    hasRts: false
  },
  {
    id: 'fortress',
    title: 'Крепость',
    difficulty: 'hard',
    description: 'Разворот вокруг базы + экономика RTS: лесопилка, шахта, командир-заклинатель.',
    hasRts: true
  }
];

/** Полные MapDocument-ы встроенных карт (порядок соответствует BUILTIN_MAP_LIST). */
export const BUILTIN_MAPS: readonly MapDocument[] = [MAP_TRAIL, MAP_CROSSROADS, MAP_FORTRESS];

const BUILTIN_MAP_BY_ID: ReadonlyMap<string, MapDocument> = new Map(
  BUILTIN_MAPS.map((m) => [String(m.metadata?.name), m])
);

/** Id карты по умолчанию (используется в single-player, если выбор не задан). */
export const DEFAULT_MAP_ID: string = String(MAP_TRAIL.metadata?.name);

/**
 * Возвращает встроенный MapDocument по id (`metadata.name`).
 * Если id неизвестен — возвращает дефолтную карту (не бросает).
 */
export function getBuiltinMap(mapId: string | null | undefined): MapDocument {
  if (mapId) {
    const found = BUILTIN_MAP_BY_ID.get(mapId);
    if (found) return found;
  }
  return MAP_TRAIL;
}

/** Метаданные карты по id (для UI). */
export function getBuiltinMapInfo(mapId: string | null | undefined): BuiltinMapInfo {
  if (mapId) {
    const found = BUILTIN_MAP_LIST.find((m) => m.id === mapId);
    if (found) return found;
  }
  return BUILTIN_MAP_LIST[0]!;
}
