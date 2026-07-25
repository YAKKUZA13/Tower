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

import type { MapDocument, TileType, Waypoint } from '../types/map.js';
import type { Wave } from '../types/td.js';

/**
 * Плоский heightmap заданного размера (все высоты = 0).
 * sim/domain это разрешают: таргетинг башен считается только по XZ,
 * длины сегментов пути чуть короче, но валидны; все рендереры ставят
 * `groundY = sampleHeight(...) = 0`.
 */
export function flatHeightmap(cols: number, rows: number): number[][] {
  return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

// ── Phase T: тайловая разметка (референс 'Isometric Fantasy Tiles') ───────────

/**
 * Заполняет tiles-сетку rows×cols одним тайлом (дефолт = 'grass').
 * Возвращает свежий массив (не мутирует вход).
 */
export function fillTiles(rows: number, cols: number, fill: TileType = 'grass'): TileType[][] {
  return Array.from({ length: rows }, () => new Array<TileType>(cols).fill(fill));
}

/**
 * Растеризует waypoint-маршрут в `road` тайлы. Сегменты между соседними
 * waypoints должны быть ортогональными (горизонтальными/вертикальными) —
 * как в текущих встроенных картах. Все клетки вдоль маршрута помечаются
 * `road`; остальные клетки не трогаются (остаются как есть — обычно grass).
 *
 * Мутирует tiles на месте (для композиции нескольких операций).
 */
export function markRoadAlong(
  tiles: TileType[][],
  cols: number,
  rows: number,
  waypoints: readonly Waypoint[]
): void {
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    if (a.row === b.row) {
      const r = clampCell(a.row, rows);
      const c0 = Math.min(a.col, b.col);
      const c1 = Math.max(a.col, b.col);
      for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) tiles[r]![c] = 'road';
    } else if (a.col === b.col) {
      const c = clampCell(a.col, cols);
      const r0 = Math.min(a.row, b.row);
      const r1 = Math.max(a.row, b.row);
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) tiles[r]![c] = 'road';
    }
    // диагональные сегменты не используются в существующих картах — пропускаем
  }
}

/**
 * Ставит прямоугольник [c0..c1]×[r0..r1] в заданный tile. Для декора water/rock.
 * Никаких проверок блокировки пути — вызывающий должен гарантировать безопасность.
 */
export function paintTileRect(
  tiles: TileType[][],
  cols: number,
  rows: number,
  c0: number,
  c1: number,
  r0: number,
  r1: number,
  tile: TileType
): void {
  for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
      tiles[r]![c] = tile;
    }
  }
}

function clampCell(v: number, maxInclusive: number): number {
  return Math.max(0, Math.min(maxInclusive - 1, Math.floor(v)));
}

// ── Карта 1: «Тропа» (easy, чистый TD) ───────────────────────────────────────
// 20×12, длинный S-образный коридор. Простой ритм волн, низкая база HP.
const MAP_TRAIL_WAYPOINTS: Waypoint[] = [
  { col: 0, row: 6 },
  { col: 4, row: 6 },
  { col: 4, row: 2 },
  { col: 10, row: 2 },
  { col: 10, row: 9 },
  { col: 15, row: 9 },
  { col: 15, row: 5 },
  { col: 19, row: 5 }
];

function buildTrailTiles(): TileType[][] {
  // 20×12, дефолт = grass; путь отмечен road; пара декоративных water/rock пятен
  // в углах, гарантированно не блокирующих маршрут (путь в rows 2..9).
  const tiles = fillTiles(12, 20, 'grass');
  markRoadAlong(tiles, 20, 12, MAP_TRAIL_WAYPOINTS);
  // верхний-левый угол: каменная осыпь (декор, не на пути)
  paintTileRect(tiles, 20, 12, 0, 2, 0, 1, 'rock');
  // верхний-правый угол: маленькое озеро (декор, не на пути)
  paintTileRect(tiles, 20, 12, 17, 19, 0, 1, 'water');
  // нижний-левый: песчаный «берег» (декор)
  paintTileRect(tiles, 20, 12, 0, 1, 10, 11, 'sand');
  return tiles;
}

const MAP_TRAIL: MapDocument = {
  version: 1,
  grid: { cols: 20, rows: 12, cellSize: 1.5 },
  heightmap: flatHeightmap(20, 12),
  metadata: { name: 'trail', title: 'Тропа', difficulty: 'easy' },
  spawnPoint: { col: 0, row: 6 },
  base: { col: 19, row: 5, hp: 20 },
  startingGold: 120,
  waves: [],
  path: { waypoints: MAP_TRAIL_WAYPOINTS },
  tiles: buildTrailTiles()
};

// ── Карта 2: «Развилка» (medium, чистый TD) ──────────────────────────────────
// 24×14, двойной зигзаг с узкими горлами — простор для maze-стен.
const MAP_CROSSROADS_WAYPOINTS: Waypoint[] = [
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
];

function buildCrossroadsTiles(): TileType[][] {
  // 24×14, дефолт = grass; путь зигзагом. Декоративные преграды:
  // - горы (rock) по углам
  // - небольшое озеро в нижнем-левом квадранте (между первым и вторым зигзагом)
  // Все блокирующие пятна в зонах, где путь гарантированно не проходит.
  const tiles = fillTiles(14, 24, 'grass');
  markRoadAlong(tiles, 24, 14, MAP_CROSSROADS_WAYPOINTS);
  // углы — камни (декор + тематический «край крепости»)
  paintTileRect(tiles, 24, 14, 0, 2, 12, 13, 'rock');
  paintTileRect(tiles, 24, 14, 22, 23, 0, 1, 'rock');
  // озеро в нижнем-левом квадранте (путь в rows 2,7,11)
  paintTileRect(tiles, 24, 14, 7, 10, 5, 6, 'water');
  // песчаная отмель возле базы (декор)
  paintTileRect(tiles, 24, 14, 22, 23, 12, 13, 'sand');
  return tiles;
}

const MAP_CROSSROADS: MapDocument = {
  version: 1,
  grid: { cols: 24, rows: 14, cellSize: 1.5 },
  heightmap: flatHeightmap(24, 14),
  metadata: { name: 'crossroads', title: 'Развилка', difficulty: 'medium' },
  spawnPoint: { col: 0, row: 7 },
  base: { col: 23, row: 6, hp: 18 },
  startingGold: 130,
  waves: [],
  path: { waypoints: MAP_CROSSROADS_WAYPOINTS },
  tiles: buildCrossroadsTiles()
};

// ── Карта 3: «Крепость» (hard, RTS enabled) ──────────────────────────────────
// 26×14, разворот вокруг центрального костра (базы). RTS включён: экономика,
// юниты, командир-заклинатель. Стартовый набор из лесопилки и шахты.
const MAP_FORTRESS_WAYPOINTS: Waypoint[] = [
  { col: 0, row: 7 },
  { col: 4, row: 7 },
  { col: 4, row: 1 },
  { col: 13, row: 1 },
  { col: 13, row: 12 },
  { col: 22, row: 12 },
  { col: 22, row: 6 },
  { col: 25, row: 6 }
];

function buildFortressTiles(): TileType[][] {
  // 26×14, дефолт = dirt (земля крепости — отличает от «дикой природы» других карт).
  // Путь — road. Декор: mountains (rock) по углам + water-ров у базы.
  // RTS startBuildings ставятся в (2,11) и (3,11) — они на dirt, проходимо.
  const tiles = fillTiles(14, 26, 'dirt');
  markRoadAlong(tiles, 26, 14, MAP_FORTRESS_WAYPOINTS);
  // углы — горы (rock): визуально «крепость в горах»
  paintTileRect(tiles, 26, 14, 0, 1, 0, 1, 'rock');
  paintTileRect(tiles, 26, 14, 24, 25, 0, 1, 'rock');
  paintTileRect(tiles, 26, 14, 0, 1, 12, 13, 'rock');
  // внешний двор-маршрута вокруг базы (col 22..25, row 6) — безопасно
  // каменная осыпь под базой (визуальный «постамент»)
  paintTileRect(tiles, 26, 14, 23, 25, 7, 8, 'rock');
  // озеро в нижнем-правом углу — декор (путь в row 1 и row 12, всё мимо)
  paintTileRect(tiles, 26, 14, 16, 20, 5, 6, 'water');
  // песок у спавна (визуальный «вход»)
  paintTileRect(tiles, 26, 14, 0, 1, 6, 8, 'sand');
  return tiles;
}

const MAP_FORTRESS: MapDocument = {
  version: 1,
  grid: { cols: 26, rows: 14, cellSize: 1.5 },
  heightmap: flatHeightmap(26, 14),
  metadata: { name: 'fortress', title: 'Крепость', difficulty: 'hard' },
  spawnPoint: { col: 0, row: 7 },
  base: { col: 25, row: 6, hp: 15 },
  startingGold: 100,
  waves: [],
  path: { waypoints: MAP_FORTRESS_WAYPOINTS },
  tiles: buildFortressTiles(),
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

// ── Карта 4: «Кладбище» (hard, чистый TD, post-MVP) ──────────────────────────
// 22×13, двойной S-образный коридор через «кладбищенскую» землю. Волны с
// призраками, пауками и слизнем — новые силуэты (variety). Босс-волна с ghost-роем.
const MAP_GRAVEYARD_WAYPOINTS: Waypoint[] = [
  { col: 0, row: 6 },
  { col: 4, row: 6 },
  { col: 4, row: 2 },
  { col: 9, row: 2 },
  { col: 9, row: 10 },
  { col: 14, row: 10 },
  { col: 14, row: 3 },
  { col: 18, row: 3 },
  { col: 18, row: 8 },
  { col: 21, row: 8 }
];

function buildGraveyardTiles(): TileType[][] {
  // 22×13, дефолт = dirt (кладбищенская земля). Путь — road. Декор:
  // - rock-надгробия по углам и между зигзагами (не на пути)
  // - sand-могилы вдоль верхнего края
  // - water-ров в нижнем-левом квадранте
  const tiles = fillTiles(13, 22, 'dirt');
  markRoadAlong(tiles, 22, 13, MAP_GRAVEYARD_WAYPOINTS);
  // надгробия (rock) — по углам
  paintTileRect(tiles, 22, 13, 0, 1, 0, 1, 'rock');
  paintTileRect(tiles, 22, 13, 20, 21, 0, 1, 'rock');
  paintTileRect(tiles, 22, 13, 0, 1, 11, 12, 'rock');
  paintTileRect(tiles, 22, 13, 20, 21, 11, 12, 'rock');
  // центральные надгробия (между зигзагами, не на пути: путь в rows 2,6,8,10)
  paintTileRect(tiles, 22, 13, 6, 7, 5, 6, 'rock');
  paintTileRect(tiles, 22, 13, 11, 12, 6, 7, 'rock');
  // песчаная «тропа мёртвых» в верхнем-правом углу (декор)
  paintTileRect(tiles, 22, 13, 19, 21, 10, 12, 'sand');
  // мёртвый пруд в нижнем-левом (декор, между 1-м и 2-м зигзагом — путь в rows 2,6,10)
  paintTileRect(tiles, 22, 13, 5, 8, 4, 5, 'water');
  return tiles;
}

const MAP_GRAVEYARD_WAVES: Wave[] = [
  { index: 0, rewardBonus: 22, groups: [{ enemyTypeId: 'spider', count: 10, interval: 0.7, startDelay: 0 }] },
  { index: 1, rewardBonus: 28, groups: [{ enemyTypeId: 'spider', count: 8, interval: 0.6, startDelay: 0 }, { enemyTypeId: 'ghost', count: 3, interval: 1.5, startDelay: 4 }] },
  { index: 2, rewardBonus: 32, groups: [{ enemyTypeId: 'ghost', count: 8, interval: 1.0, startDelay: 0 }] },
  { index: 3, rewardBonus: 38, groups: [{ enemyTypeId: 'slime', count: 5, interval: 1.2, startDelay: 0 }, { enemyTypeId: 'spider', count: 10, interval: 0.45, startDelay: 3 }] },
  { index: 4, rewardBonus: 44, groups: [{ enemyTypeId: 'ghost', count: 10, interval: 0.8, startDelay: 0 }, { enemyTypeId: 'slime', count: 4, interval: 1.6, startDelay: 5 }] },
  { index: 5, rewardBonus: 55, groups: [{ enemyTypeId: 'slime', count: 8, interval: 1.0, startDelay: 0 }, { enemyTypeId: 'spider', count: 14, interval: 0.4, startDelay: 2 }] },
  { index: 6, rewardBonus: 65, groups: [{ enemyTypeId: 'ghost', count: 14, interval: 0.6, startDelay: 0 }, { enemyTypeId: 'slime', count: 6, interval: 1.4, startDelay: 4 }] },
  { index: 7, rewardBonus: 80, groups: [{ enemyTypeId: 'spider', count: 20, interval: 0.35, startDelay: 0 }, { enemyTypeId: 'ghost', count: 10, interval: 0.7, startDelay: 3 }] },
  { index: 8, rewardBonus: 100, groups: [{ enemyTypeId: 'slime', count: 12, interval: 0.8, startDelay: 0 }, { enemyTypeId: 'ghost', count: 16, interval: 0.5, startDelay: 4 }] },
  { index: 9, rewardBonus: 220, isBoss: true, groups: [{ enemyTypeId: 'boss', count: 1, interval: 1, startDelay: 0 }, { enemyTypeId: 'ghost', count: 14, interval: 0.6, startDelay: 2 }] }
];

const MAP_GRAVEYARD: MapDocument = {
  version: 1,
  grid: { cols: 22, rows: 13, cellSize: 1.5 },
  heightmap: flatHeightmap(22, 13),
  metadata: { name: 'graveyard', title: 'Кладбище', difficulty: 'hard' },
  spawnPoint: { col: 0, row: 6 },
  base: { col: 21, row: 8, hp: 18 },
  startingGold: 130,
  waves: MAP_GRAVEYARD_WAVES,
  path: { waypoints: MAP_GRAVEYARD_WAYPOINTS },
  tiles: buildGraveyardTiles()
};

// ── Карта 5: «Болото» (medium, чистый TD, post-MVP) ───────────────────────────
// 24×12, разветвлённый коридор через трясину. Волны с слизнем и нетопырями —
// flyer-вариант (bat) тестирует мобильную оборону; слизень — медленный танковый.
const MAP_SWAMP_WAYPOINTS: Waypoint[] = [
  { col: 0, row: 6 },
  { col: 5, row: 6 },
  { col: 5, row: 2 },
  { col: 11, row: 2 },
  { col: 11, row: 9 },
  { col: 17, row: 9 },
  { col: 17, row: 3 },
  { col: 20, row: 3 },
  { col: 20, row: 6 },
  { col: 23, row: 6 }
];

function buildSwampTiles(): TileType[][] {
  // 24×12, дефолт = grass (болотистая зелень). Путь — road. Декор:
  // - water-трясина (большая, занимает нижнюю часть — путь в rows 2,6,9)
  // - sand-острова (декор)
  // - rock по углам
  const tiles = fillTiles(12, 24, 'grass');
  markRoadAlong(tiles, 24, 12, MAP_SWAMP_WAYPOINTS);
  // трясина (water) — большая, в нижней-левой части, не блокирует путь
  paintTileRect(tiles, 24, 12, 6, 16, 7, 10, 'water');
  // верхние углы — камни (декор)
  paintTileRect(tiles, 24, 12, 0, 2, 0, 1, 'rock');
  paintTileRect(tiles, 24, 12, 21, 23, 0, 1, 'rock');
  // песчаные острова в трясине
  paintTileRect(tiles, 24, 12, 9, 10, 8, 9, 'sand');
  paintTileRect(tiles, 24, 12, 13, 14, 8, 9, 'sand');
  return tiles;
}

const MAP_SWAMP_WAVES: Wave[] = [
  { index: 0, rewardBonus: 24, groups: [{ enemyTypeId: 'bat', count: 12, interval: 0.5, startDelay: 0 }] },
  { index: 1, rewardBonus: 28, groups: [{ enemyTypeId: 'bat', count: 10, interval: 0.45, startDelay: 0 }, { enemyTypeId: 'slime', count: 3, interval: 1.6, startDelay: 4 }] },
  { index: 2, rewardBonus: 32, groups: [{ enemyTypeId: 'slime', count: 6, interval: 1.0, startDelay: 0 }] },
  { index: 3, rewardBonus: 38, groups: [{ enemyTypeId: 'bat', count: 16, interval: 0.35, startDelay: 0 }, { enemyTypeId: 'goblin', count: 6, interval: 0.7, startDelay: 3 }] },
  { index: 4, rewardBonus: 44, groups: [{ enemyTypeId: 'slime', count: 8, interval: 0.9, startDelay: 0 }, { enemyTypeId: 'bat', count: 14, interval: 0.4, startDelay: 4 }] },
  { index: 5, rewardBonus: 55, groups: [{ enemyTypeId: 'goblin', count: 18, interval: 0.4, startDelay: 0 }, { enemyTypeId: 'slime', count: 5, interval: 1.5, startDelay: 3 }] },
  { index: 6, rewardBonus: 65, groups: [{ enemyTypeId: 'bat', count: 22, interval: 0.3, startDelay: 0 }, { enemyTypeId: 'slime', count: 8, interval: 1.0, startDelay: 3 }] },
  { index: 7, rewardBonus: 80, groups: [{ enemyTypeId: 'slime', count: 12, interval: 0.8, startDelay: 0 }, { enemyTypeId: 'bat', count: 18, interval: 0.35, startDelay: 4 }] },
  { index: 8, rewardBonus: 100, groups: [{ enemyTypeId: 'goblin', count: 20, interval: 0.35, startDelay: 0 }, { enemyTypeId: 'slime', count: 10, interval: 1.0, startDelay: 3 }] },
  { index: 9, rewardBonus: 240, isBoss: true, groups: [{ enemyTypeId: 'boss', count: 1, interval: 1, startDelay: 0 }, { enemyTypeId: 'bat', count: 16, interval: 0.35, startDelay: 3 }, { enemyTypeId: 'slime', count: 6, interval: 1.5, startDelay: 6 }] }
];

const MAP_SWAMP: MapDocument = {
  version: 1,
  grid: { cols: 24, rows: 12, cellSize: 1.5 },
  heightmap: flatHeightmap(24, 12),
  metadata: { name: 'swamp', title: 'Болото', difficulty: 'medium' },
  spawnPoint: { col: 0, row: 6 },
  base: { col: 23, row: 6, hp: 18 },
  startingGold: 140,
  waves: MAP_SWAMP_WAVES,
  path: { waypoints: MAP_SWAMP_WAYPOINTS },
  tiles: buildSwampTiles()
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
  },
  {
    id: 'swamp',
    title: 'Болото',
    difficulty: 'medium',
    description: 'Трясина и рои нетопырей. Тест мобильной обороны против лёгких летунов и слизня.',
    hasRts: false
  },
  {
    id: 'graveyard',
    title: 'Кладбище',
    difficulty: 'hard',
    description: 'Двойной S-образный коридор через кладбище: призраки, пауки, слизень и босс-волна.',
    hasRts: false
  }
];

/** Полные MapDocument-ы встроенных карт (порядок соответствует BUILTIN_MAP_LIST). */
export const BUILTIN_MAPS: readonly MapDocument[] = [MAP_TRAIL, MAP_CROSSROADS, MAP_FORTRESS, MAP_SWAMP, MAP_GRAVEYARD];

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
