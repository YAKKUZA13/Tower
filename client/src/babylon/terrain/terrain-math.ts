import { Vector3 } from 'babylonjs';
import type { GridData, Vector3Data } from '../../domain/map';
import { gridToWorldData, worldToGridData, sampleHeight as sampleHeightPure, computeHeightRange } from '../../domain/grid-math';

/**
 * Babylon-обёртки над чистой геометрией поля боя.
 * Чистая математика (без Babylon) живёт в domain/grid-math.ts — это позволяет
 * тестировать TD-симуляцию headless (без Babylon). См. ADR-2 / раздел 7.
 */

export function gridToWorld(grid: GridData, col: number, row: number): Vector3 {
  const d = gridToWorldData(grid, col, row);
  return new Vector3(d.x, 0, d.z);
}

export function worldToGrid(grid: GridData, point: Vector3Data): { col: number; row: number } {
  return worldToGridData(grid, point);
}

export const sampleHeight = sampleHeightPure;

export { computeHeightRange };
