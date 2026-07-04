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

/**
 * A* по 4-связной сетке от spawn до base, обходя заблокированные клетки.
 * Возвращает маршрут как список waypoint-клеток (с объединением коллинеарных
 * участков в прямые сегменты — чистый tube/движение). null если маршрута нет.
 * Детерминирован (без rng). Phase 4 задача 4.3.
 */
export function findGridRoute(
  spawn: Waypoint,
  base: Waypoint,
  grid: GridData,
  isBlocked: BlockedPredicate = () => false
): Waypoint[] | null {
  const cols = grid.cols;
  const rows = grid.rows;
  const sc = clampCell(spawn.col, cols);
  const sr = clampCell(spawn.row, rows);
  const bc = clampCell(base.col, cols);
  const br = clampCell(base.row, rows);
  if (isBlocked(sc, sr) || isBlocked(bc, br)) return null;
  if (sc === bc && sr === br) return [{ col: sc, row: sr }];

  const size = cols * rows;
  const came = new Int32Array(size).fill(-1);
  const g = new Float64Array(size).fill(Infinity);
  const f = new Float64Array(size).fill(Infinity);
  const open: number[] = [];
  const inOpen = new Uint8Array(size);

  const startIdx = sr * cols + sc;
  const goalIdx = br * cols + bc;
  g[startIdx] = 0;
  f[startIdx] = hexManhattan(sc, sr, bc, br);
  open.push(startIdx);
  inOpen[startIdx] = 1;

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  let found = false;
  // простой массив-как-очередь с линейным поиском минимума f (сетки TD небольшие → ок)
  while (open.length > 0) {
    // выбрать узел с min f
    let bestI = 0;
    for (let i = 1; i < open.length; i++) {
      if (f[open[i]] < f[open[bestI]]) bestI = i;
    }
    const cur = open[bestI];
    open.splice(bestI, 1);
    inOpen[cur] = 0;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const c = cur % cols;
    const r = (cur - c) / cols;
    for (const [dc, dr] of neighbors) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      if (isBlocked(nc, nr)) continue;
      const nIdx = nr * cols + nc;
      const tentative = g[cur] + 1; // шаг клетки = 1
      if (tentative < g[nIdx]) {
        came[nIdx] = cur;
        g[nIdx] = tentative;
        f[nIdx] = tentative + hexManhattan(nc, nr, bc, br);
        if (!inOpen[nIdx]) {
          open.push(nIdx);
          inOpen[nIdx] = 1;
        }
      }
    }
  }

  if (!found) return null;

  // восстановить путь (клетки от base до spawn), затем развернуть
  const cells: Waypoint[] = [];
  let node: number = goalIdx;
  let guard = 0;
  while (node !== -1 && guard++ < size + 1) {
    const c = node % cols;
    const r = (node - c) / cols;
    cells.push({ col: c, row: r });
    if (node === startIdx) break;
    node = came[node];
  }
  cells.reverse();

  return mergeCollinear(cells);
}

function hexManhattan(c1: number, r1: number, c2: number, r2: number): number {
  return Math.abs(c1 - c2) + Math.abs(r1 - r2);
}

/** Объединяет подряд коллинеарные клетки в угловые точки (меньше сегментов пути). */
function mergeCollinear(cells: Waypoint[]): Waypoint[] {
  if (cells.length <= 2) return cells;
  const out: Waypoint[] = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const c = cells[i + 1];
    const dx1 = b.col - a.col;
    const dy1 = b.row - a.row;
    const dx2 = c.col - b.col;
    const dy2 = c.row - b.row;
    // сохраняем клетку, если направление меняется (это угол)
    if (dx1 !== dx2 || dy1 !== dy2) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return out;
}
