/**
 * Поиск пути на сетке (BFS). Phase 1 задача 1.2.
 * В Фазе 4 (стены) используется для валидации: нельзя полностью перекрыть
 * маршрут от spawn до base. Здесь закладываем чистую функцию.
 */

import type { GridData, Waypoint } from './map';

export type BlockedPredicate = (col: number, row: number) => boolean;

/**
 * Проверяет, существует ли связный маршрут от spawn до base по 4-связной сетке,
 * обходя заблокированные клетки.
 */
export function hasValidRoute(
  spawn: Waypoint,
  base: Waypoint,
  grid: GridData,
  isBlocked: BlockedPredicate = () => false
): boolean {
  const sc = clampCell(spawn.col, grid.cols);
  const sr = clampCell(spawn.row, grid.rows);
  const bc = clampCell(base.col, grid.cols);
  const br = clampCell(base.row, grid.rows);
  if (sc === bc && sr === br) return !isBlocked(bc, br);
  if (isBlocked(sc, sr) || isBlocked(bc, br)) return false;

  const cols = grid.cols;
  const visited = new Uint8Array(cols * grid.rows);
  const queue: number[] = [sr * cols + sc];
  visited[sr * cols + sc] = 1;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const c = cur % cols;
    const r = (cur - c) / cols;
    if (c === bc && r === br) return true;
    for (const [dc, dr] of neighbors) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= grid.rows) continue;
      const idx = nr * cols + nc;
      if (visited[idx]) continue;
      if (isBlocked(nc, nr)) continue;
      visited[idx] = 1;
      queue.push(idx);
    }
  }
  return false;
}

function clampCell(value: number, maxInclusive: number): number {
  return Math.max(0, Math.min(maxInclusive - 1, Math.floor(value)));
}
