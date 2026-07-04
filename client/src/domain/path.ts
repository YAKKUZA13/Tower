/**
 * Чистая геометрия пути (без зависимости от Scene/Babylon).
 * Phase 1 задача 1.1. Используется sim-системой movement и рендерерами.
 */

import type { GridData, Vector3Data, Waypoint } from './map';
import { sampleHeight } from './grid-math';

export interface PathSegment {
  start: Vector3Data;
  end: Vector3Data;
  length: number;
  /** Накопленная дистанция от начала пути до segment.start. */
  cumulativeStart: number;
}

export interface BuiltPath {
  segments: PathSegment[];
  totalLength: number;
  waypoints: Waypoint[];
}

/** Центр клетки (col;row) в world-координатах с высотой из хэйтмапа. */
export function cellToWorld(grid: GridData, heightmap: number[][] | null, col: number, row: number): Vector3Data {
  const x = (col + 0.5) * grid.cellSize - (grid.cols * grid.cellSize) / 2;
  const z = (row + 0.5) * grid.cellSize - (grid.rows * grid.cellSize) / 2;
  const y = sampleHeight(heightmap ?? undefined, grid, col, row, true);
  return { x, y, z };
}

/** Превращает список waypoints в сегменты с длинами. Пустой путь → totalLength 0. */
export function buildPath(waypoints: Waypoint[], grid: GridData, heightmap: number[][] | null): BuiltPath {
  const points = waypoints.map((wp) => cellToWorld(grid, heightmap, wp.col, wp.row));
  const segments: PathSegment[] = [];
  let cumulative = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
    segments.push({ start, end, length, cumulativeStart: cumulative });
    cumulative += length;
  }
  return { segments, totalLength: cumulative, waypoints };
}

/**
 * Позиция на пути по прогрессу (0..totalLength). За пределами — clamp к концам.
 * Возвращает последнюю точку пути, если progress выходит за totalLength.
 */
export function positionAtProgress(path: BuiltPath, progress: number): Vector3Data {
  if (path.segments.length === 0) return { x: 0, y: 0, z: 0 };
  const clamped = Math.max(0, progress);
  if (clamped >= path.totalLength) {
    const last = path.segments[path.segments.length - 1].end;
    return { ...last };
  }
  // бинарный поиск не нужен — путей короткие; линейно
  for (const seg of path.segments) {
    const segEnd = seg.cumulativeStart + seg.length;
    if (clamped <= segEnd) {
      const t = seg.length > 0 ? (clamped - seg.cumulativeStart) / seg.length : 0;
      return {
        x: seg.start.x + (seg.end.x - seg.start.x) * t,
        y: seg.start.y + (seg.end.y - seg.start.y) * t,
        z: seg.start.z + (seg.end.z - seg.start.z) * t
      };
    }
  }
  const last = path.segments[path.segments.length - 1].end;
  return { ...last };
}
