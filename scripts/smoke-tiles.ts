/**
 * Headless smoke-тест тайловой системы (Phase T — референс 'Isometric Fantasy Tiles').
 * Проверяет:
 *  1. Чистые функции tile-логики (isTileBlocking/isTileBuildable).
 *  2. A* обходит blocking-тайлы (water/rock).
 *  3. canPlaceWall/canPlaceTower/canPlaceRelic отклоняют water/rock.
 *  4. canPlaceWall не даёт запереть базу с учётом blocking-тайлов.
 *  5. Сим корректно инициализируется на карте с tiles (встроенные карты).
 *  6. Маршрут существует для всех 3 встроенных карт (validates map design).
 *  7. place-tower на water/rock отклоняется симом.
 *  8. Детерминизм сохраняется: тот же seed → тот же route на карте с tiles.
 *
 * Запуск: npx tsx scripts/smoke-tiles.ts
 */
import { GameSim } from '../client/src/sim/game-sim';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import { BUILTIN_MAPS, BUILTIN_MAP_LIST } from '../shared/src/maps/index';
import type { MapDocument, TileType, PlayerInput } from '../shared/src/index';
import {
  isTileBlocking,
  isTileBuildable,
  getTile,
  makeTileBlockPredicate,
  mapHasTileRoute
} from '../client/src/domain/tiles';
import { findGridRoute } from '../client/src/domain/pathfinding';
import {
  canPlaceWall,
  canPlaceTower,
  canPlaceRelic
} from '../client/src/domain/placement';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 FAIL: ${name} ${details}`);
  }
}

// ── Helper: тайловая карта с узким коридором и water-стенами ────────────────
function makeTileMap(): MapDocument {
  // 10×7, путь (0,3) → (9,3). Water в rows 0-2 и 4-6 — ОСТАВЛЯЕТ только row 3
  // как единственный проходимый коридор. Стена в любой клетке row 3 → запирает.
  const cols = 10;
  const rows = 7;
  const tiles: TileType[][] = Array.from({ length: rows }, () =>
    new Array<TileType>(cols).fill('water')
  );
  // row 3 — проходимый коридор (grass)
  for (let c = 0; c < cols; c++) tiles[3]![c] = 'grass';
  // rock-«островки» в water (декор, не критично)
  tiles[0]![3] = 'rock';
  tiles[0]![4] = 'rock';
  return {
    version: 2,
    grid: { cols, rows, cellSize: 1.5 },
    heightmap: Array.from({ length: rows }, () => new Array(cols).fill(0)),
    path: { waypoints: [{ col: 0, row: 3 }, { col: 9, row: 3 }] },
    spawnPoint: { col: 0, row: 3 },
    base: { col: 9, row: 3, hp: 20 },
    startingGold: 100,
    waves: [],
    tiles
  };
}

console.log('1. Чистые функции tile-логики:');
{
  const map = makeTileMap();
  check('water — blocking', isTileBlocking(map.tiles, map.grid, 0, 0));
  check('rock — blocking', isTileBlocking(map.tiles, map.grid, 3, 0));
  check('grass — not blocking', !isTileBlocking(map.tiles, map.grid, 1, 3));
  check('water — not buildable', !isTileBuildable(map.tiles, map.grid, 0, 0));
  check('grass — buildable', isTileBuildable(map.tiles, map.grid, 1, 3));
  check('getTile out-of-bounds → grass', getTile(map.tiles, map.grid, -1, -1) === 'grass');
  check('getTile undefined tiles → grass', getTile(undefined, map.grid, 1, 1) === 'grass');
}

console.log('2. A* обходит blocking-тайлы:');
{
  const map = makeTileMap();
  // Спавн (0,3), база (9,3). Прямой путь по row 3 — проходим (grass).
  // A* должен вернуть маршрут по прямой.
  const route = findGridRoute(
    map.spawnPoint,
    map.base,
    map.grid,
    makeTileBlockPredicate(map.tiles, map.grid)
  );
  check('A* нашёл маршрут', route !== null && route.length >= 2);
  check('A* маршрут начинается в spawn', route !== null && route[0]!.col === 0 && route[0]!.row === 3);
  check('A* маршрут заканчивается в base', route !== null && route[route!.length - 1]!.col === 9);
  // Проверка: blocking-tiles не входят в маршрут
  let routeHasBlocking = false;
  if (route) {
    for (const wp of route) {
      if (isTileBlocking(map.tiles, map.grid, wp.col, wp.row)) routeHasBlocking = true;
    }
  }
  check('A* маршрут не проходит через water/rock', !routeHasBlocking);
}

console.log('3. Placement отклоняет water/rock:');
{
  const map = makeTileMap();
  const ctx = {
    grid: map.grid,
    spawn: map.spawnPoint,
    base: map.base,
    walls: [],
    towers: [],
    relics: [],
    tiles: map.tiles
  };
  // water-клетка (0,0) — нельзя ставить
  check('canPlaceTower на water → false', !canPlaceTower(ctx, 0, 0));
  check('canPlaceWall на water → false', !canPlaceWall(ctx, 0, 0));
  check('canPlaceRelic на water → false', !canPlaceRelic(ctx, 0, 0));
  check('canPlaceTower на rock → false', !canPlaceTower(ctx, 3, 0));
  // grass-клетки коридора заняты spawn (0,3) и base (9,3); берём (1,3) и (2,3)
  check('canPlaceTower на grass → true', canPlaceTower(ctx, 1, 3));
  // canPlaceRelic на (1,3) тоже разрешён (не блокирует A*)
  check('canPlaceRelic на grass → true', canPlaceRelic(ctx, 1, 3));
}

console.log('4. canPlaceWall учитывает тайлы при валидации маршрута:');
{
  // Узкий коридор с water-стенами по бокам. Запереть коридор стеной — нельзя.
  const map = makeTileMap(); // только row 3 проходима по бокам
  const ctx = {
    grid: map.grid,
    spawn: map.spawnPoint,
    base: map.base,
    walls: [],
    towers: [],
    relics: [],
    tiles: map.tiles
  };
  // Поставить стену в (5,3) — запирает единственный коридор → должно быть отклонено
  check('canPlaceWall в единственном коридоре → false (нельзя запереть)', !canPlaceWall(ctx, 5, 3));
}

console.log('5. Сим инициализируется на карте с tiles:');
{
  const map = makeTileMap();
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'tester', seed: 42 });
  check('сим создан', sim !== null);
  check('tick = 0', sim.state.tick === 0);
  const route = sim.getRouteWaypoints();
  check('сим имеет маршрут', route.length >= 2);
  // маршрут не проходит через blocking-тайлы
  let routeOnBlocking = false;
  for (const wp of route) {
    if (isTileBlocking(map.tiles, map.grid, wp.col, wp.row)) routeOnBlocking = true;
  }
  check('маршрут сима обходит blocking-тайлы', !routeOnBlocking);
}

console.log('6. Все встроенные карты имеют валидный маршрут с tiles:');
{
  for (let i = 0; i < BUILTIN_MAPS.length; i++) {
    const map = BUILTIN_MAPS[i]!;
    const info = BUILTIN_MAP_LIST[i]!;
    const ok = mapHasTileRoute(map.tiles, map.grid, map.spawnPoint, map.base);
    check(`карта '${info.id}': маршрут spawn→base существует с учётом тайлов`, ok);
    // spawn и base на проходимых тайлах
    const spawnOk = !isTileBlocking(map.tiles, map.grid, map.spawnPoint.col, map.spawnPoint.row);
    const baseOk = !isTileBlocking(map.tiles, map.grid, map.base.col, map.base.row);
    check(`карта '${info.id}': spawn на проходимом тайле`, spawnOk);
    check(`карта '${info.id}': base на проходимом тайле`, baseOk);
  }
}

console.log('7. place-tower/wall на water/rock отклоняется симом:');
{
  const map = makeTileMap();
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'tester', seed: 42 });
  const towerInput: PlayerInput = {
    tick: 0,
    userId: 'tester',
    action: { kind: 'place-tower', typeId: 'arrow', col: 0, row: 0 } // water
  };
  sim.applyInput(towerInput);
  sim.step(0.001);
  check('place-tower на water отклонён', sim.state.towers.length === 0);
  const wallInput: PlayerInput = {
    tick: 0,
    userId: 'tester',
    action: { kind: 'place-wall', col: 3, row: 0, material: 'stone' } // rock
  };
  sim.applyInput(wallInput);
  sim.step(0.001);
  check('place-wall на rock отклонён', sim.state.walls.length === 0);
}

console.log('8. Детерминизм: тот же seed → тот же route на карте с tiles:');
{
  const map = makeTileMap();
  const sim1 = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'tester', seed: 42 });
  const sim2 = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'tester', seed: 42 });
  const r1 = sim1.getRouteWaypoints();
  const r2 = sim2.getRouteWaypoints();
  check('длины маршрутов равны', r1.length === r2.length);
  let same = r1.length === r2.length;
  for (let i = 0; i < r1.length && same; i++) {
    if (r1[i]!.col !== r2[i]!.col || r1[i]!.row !== r2[i]!.row) same = false;
  }
  check('точки маршрутов идентичны', same);
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
