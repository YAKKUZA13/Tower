/**
 * Чистые функции tile-логики (Phase T — референс 'Isometric Fantasy Tiles').
 *
 * Без зависимости от Babylon → headless-тесты сима. Используется:
 *  - placement.ts (canPlaceWall/Tower/Relic учитывают проходимость тайла);
 *  - sim/game-sim.ts recomputeRoute (A* обходит water/rock);
 *  - tile-renderer.ts (резолвит TileType клетки → master-меш).
 *
 * Контракт тайла:
 *  - grass/dirt/road/sand — проходимы врагами и пригодны для застройки;
 *  - water/rock            — НЕ проходимы и НЕ пригодны для застройки.
 *    Rock — твёрдый блокер (камни/скалы), water — водная преграда. Для A*
 *    оба дают одинаковый эффект (клетка заблокирована).
 */

import type { GridData, TileType } from '@tower/shared';
import { hasValidRoute } from './pathfinding';

/** Тайлы, блокирующие движение и застройку. */
export const BLOCKING_TILES: ReadonlySet<TileType> = new Set<TileType>(['water', 'rock']);

/** Тайлы, по которым нельзя ставить башни/стены/реликвии/здания. */
export const NON_BUILDABLE_TILES: ReadonlySet<TileType> = BLOCKING_TILES;

/**
 * Безопасное чтение TileType клетки.
 * Возвращает 'grass' если tiles отсутствует или клетка за пределами поля
 * (back-compat: карта без tiles трактуется как uniform grass).
 */
export function getTile(
  tiles: TileType[][] | undefined,
  grid: GridData,
  col: number,
  row: number
): TileType {
  if (!tiles) return 'grass';
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return 'grass';
  const rowArr = tiles[row];
  if (!rowArr) return 'grass';
  return rowArr[col] ?? 'grass';
}

/** Тайл блокирует движение врагов (water/rock). */
export function isTileBlocking(
  tiles: TileType[][] | undefined,
  grid: GridData,
  col: number,
  row: number
): boolean {
  return BLOCKING_TILES.has(getTile(tiles, grid, col, row));
}

/** На этом тайле можно ставить башню/стену/реликвию/здание (не water/rock). */
export function isTileBuildable(
  tiles: TileType[][] | undefined,
  grid: GridData,
  col: number,
  row: number
): boolean {
  return !NON_BUILDABLE_TILES.has(getTile(tiles, grid, col, row));
}

/**
 * Предикат «клетка заблокирована» для A-star/BFS (pathfinding.ts).
 * Учитывает только непроходимые тайлы — без стен (стены добавляет вызывающий).
 * Возвращает stable-замыкание, пригодное для hasValidRoute/findGridRoute.
 */
export function makeTileBlockPredicate(
  tiles: TileType[][] | undefined,
  grid: GridData
): (col: number, row: number) => boolean {
  return (col, row) => isTileBlocking(tiles, grid, col, row);
}

/**
 * Валидность карты: spawn и base на проходимых тайлах, и существует маршрут
 * spawn→base с учётом только blocking-tiles (без стен). Запускается при
 * инициализации сима и в tools (smoke-тесты).
 */
export function mapHasTileRoute(
  tiles: TileType[][] | undefined,
  grid: GridData,
  spawn: { col: number; row: number },
  base: { col: number; row: number }
): boolean {
  if (isTileBlocking(tiles, grid, spawn.col, spawn.row)) return false;
  if (isTileBlocking(tiles, grid, base.col, base.row)) return false;
  return hasValidRoute(spawn, base, grid, makeTileBlockPredicate(tiles, grid));
}
