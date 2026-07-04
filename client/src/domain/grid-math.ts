/**
 * Чистая математика сетки/высот (без зависимости от Babylon).
 * Используется domain-слоем (path/pathfinding) и sim-системами — это позволяет
 * тестировать симуляцию headless (ADR-2, стратегия тестирования раздел 7).
 * Babylon-обёртки живут в babylon/terrain/terrain-math.ts.
 */

import type { GridData, Vector3Data } from '@tower/shared';

export function gridToWorldData(grid: GridData, col: number, row: number): Vector3Data {
  const x = (col + 0.5) * grid.cellSize - (grid.cols * grid.cellSize) / 2;
  const z = (row + 0.5) * grid.cellSize - (grid.rows * grid.cellSize) / 2;
  return { x, y: 0, z };
}

export function worldToGridData(grid: GridData, point: Vector3Data): { col: number; row: number } {
  const halfW = (grid.cols * grid.cellSize) / 2;
  const halfH = (grid.rows * grid.cellSize) / 2;
  return {
    col: (point.x + halfW) / grid.cellSize,
    row: (point.z + halfH) / grid.cellSize
  };
}

export function sampleHeight(heightmap: number[][] | undefined | null, grid: GridData, col: number, row: number, bilinear = false): number {
  const maxRow = Math.max(0, grid.rows - 1);
  const maxCol = Math.max(0, grid.cols - 1);
  if (!bilinear) {
    const rIdx = Math.max(0, Math.min(maxRow, Math.round(row)));
    const cIdx = Math.max(0, Math.min(maxCol, Math.round(col)));
    const val = Number(heightmap?.[rIdx]?.[cIdx]);
    return Number.isFinite(val) ? val : 0;
  }
  const clampedRow = Math.max(0, Math.min(maxRow, row));
  const clampedCol = Math.max(0, Math.min(maxCol, col));
  const r0 = Math.floor(clampedRow);
  const r1 = Math.min(maxRow, Math.ceil(clampedRow));
  const c0 = Math.floor(clampedCol);
  const c1 = Math.min(maxCol, Math.ceil(clampedCol));
  const fr = clampedRow - r0;
  const fc = clampedCol - c0;
  const h00 = Number(heightmap?.[r0]?.[c0]) || 0;
  const h10 = Number(heightmap?.[r1]?.[c0]) || 0;
  const h01 = Number(heightmap?.[r0]?.[c1]) || 0;
  const h11 = Number(heightmap?.[r1]?.[c1]) || 0;
  const h0 = h00 * (1 - fc) + h01 * fc;
  const h1 = h10 * (1 - fc) + h11 * fc;
  return h0 * (1 - fr) + h1 * fr;
}

export function computeHeightRange(heightmap: number[][] | undefined): { minH: number; maxH: number } {
  let minH = Infinity;
  let maxH = -Infinity;
  for (const row of heightmap || []) {
    for (const raw of row || []) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      minH = Math.min(minH, value);
      maxH = Math.max(maxH, value);
    }
  }
  if (minH === Infinity || maxH === -Infinity) return { minH: 0, maxH: 1 };
  if (minH === maxH) return { minH, maxH: minH + 1 };
  return { minH, maxH };
}
