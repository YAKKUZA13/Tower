/**
 * Валидация размещения объектов (Phase 1 — редактор карт) и стен/башен на сетке
 * (Phase 4 задача 4.5). Чистые функции без зависимости от Babylon → headless-тесты.
 */

import type { GridData, Tower, Waypoint, Wall } from '@tower/shared';
import type { PlacedObject, WorldTransform } from './map';
import { hasValidRoute } from './pathfinding';

// ── Редактор: размещение свободных объектов в мире (bounds-overlap) ──────────────

export interface PlacementBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface PlacementCandidate {
  id?: string;
  transform: WorldTransform;
  collision?: {
    blocking?: boolean;
    selectable?: boolean;
  };
}

export function getPlacementBounds(candidate: PlacementCandidate): PlacementBounds {
  const position = candidate.transform.position;
  const scale = candidate.transform.scale;
  const rotationY = Number(candidate.transform.rotation?.y || 0);
  const width = Math.max(0.1, Math.abs(Number(scale.x || 1)));
  const depth = Math.max(0.1, Math.abs(Number(scale.z || 1)));
  const cos = Math.abs(Math.cos(rotationY));
  const sin = Math.abs(Math.sin(rotationY));
  const rotatedWidth = width * cos + depth * sin;
  const rotatedDepth = width * sin + depth * cos;
  return {
    minX: position.x - rotatedWidth / 2,
    maxX: position.x + rotatedWidth / 2,
    minZ: position.z - rotatedDepth / 2,
    maxZ: position.z + rotatedDepth / 2
  };
}

export function boundsOverlap(a: PlacementBounds, b: PlacementBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

export function isBlockingObject(obj: PlacedObject): boolean {
  return obj.collision?.blocking !== false;
}

export function canPlaceObject(candidate: PlacementCandidate, objects: PlacedObject[], ignoreId: string | null = null): boolean {
  if (candidate.collision?.blocking === false) return true;
  const candidateBounds = getPlacementBounds(candidate);
  return !objects.some((obj) => {
    if (ignoreId && obj.id === ignoreId) return false;
    if (!isBlockingObject(obj)) return false;
    return boundsOverlap(candidateBounds, getPlacementBounds(obj));
  });
}

// ── TD-сетка: стены и башни (Фаза 4) ────────────────────────────────────────────

export interface PlacementContext {
  grid: GridData;
  spawn: Waypoint;
  base: Waypoint;
  walls: Wall[];
  towers: Tower[];
}

export function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function inBounds(grid: GridData, col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
}

/**
 * Можно ли поставить стену в (col;row):
 *  - в пределах поля;
 *  - не на клетке спавна/базы;
 *  - не на существующей стене/башне;
 *  - ПОСЛЕ установки остаётся валидный маршрут spawn→base (нельзя запереть базу).
 */
export function canPlaceWall(ctx: PlacementContext, col: number, row: number): boolean {
  const { grid, spawn, base, walls, towers } = ctx;
  if (!inBounds(grid, col, row)) return false;
  if (col === spawn.col && row === spawn.row) return false;
  if (col === base.col && row === base.row) return false;
  for (const w of walls) {
    if (w.col === col && w.row === row) return false;
  }
  for (const t of towers) {
    if (t.col === col && t.row === row) return false;
  }
  // валидность маршрута с учётом новой стены
  const blockedSet = new Set<string>();
  for (const w of walls) blockedSet.add(cellKey(w.col, w.row));
  blockedSet.add(cellKey(col, row));
  const isBlocked = (c: number, r: number) => blockedSet.has(cellKey(c, r));
  return hasValidRoute(spawn, base, grid, isBlocked);
}

/** Можно ли поставить башню (вне стен, вне других башен, вне спавна/базы). */
export function canPlaceTower(ctx: PlacementContext, col: number, row: number): boolean {
  const { grid, spawn, base, walls, towers } = ctx;
  if (!inBounds(grid, col, row)) return false;
  if (col === spawn.col && row === spawn.row) return false;
  if (col === base.col && row === base.row) return false;
  for (const w of walls) {
    if (w.col === col && w.row === row) return false;
  }
  for (const t of towers) {
    if (t.col === col && t.row === row) return false;
  }
  return true;
}
