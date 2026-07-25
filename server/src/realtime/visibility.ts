/**
 * M8.4 — Server-side Fog of War (authoritative visibility).
 *
 * Та же логика, что в client/src/sim/visibility.ts, но сервер-сторона:
 *  - Compute per-player visibility по state.playersState (units + buildings радиусы).
 *  - Filter snapshot per-player перед broadcast (security: клиент не должен видеть
 *    чужие units вне своего sight-radius).
 *
 * Этот модуль PURE (без Babylon, без Fastify) — может unit-test'иться headless.
 * Реализован как separate-модуль на сервере для изоляции (не импортирует client/).
 */
import type { GameSnapshot, GridData, PlayerState } from '@tower/shared';

export function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export interface ServerVisibilityOptions {
  unitSight?: number;
  buildingSight?: number;
}

/**
 * Считает видимые клетки для конкретного slot.
 */
export function computeVisibilityForSlot(
  player: PlayerState,
  grid: GridData,
  options: ServerVisibilityOptions = {}
): Set<string> {
  const unitSight = options.unitSight ?? 5;
  const buildingSight = options.buildingSight ?? 8;
  const visible = new Set<string>();
  const add = (col: number, row: number, radius: number): void => {
    const r2 = radius * radius;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const c = col + dx;
        const r = row + dz;
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
        visible.add(cellKey(c, r));
      }
    }
  };
  for (const u of player.units) add(u.col, u.row, unitSight);
  for (const b of player.buildings) add(b.col, b.row, buildingSight);
  return visible;
}

/**
 * Все per-player visibilities (snapshot broadcast pre-compute).
 */
export function computeAllVisibilities(
  players: PlayerState[],
  grid: GridData,
  options: ServerVisibilityOptions = {}
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const p of players) {
    out.set(p.slot, computeVisibilityForSlot(p, grid, options));
  }
  return out;
}

/**
 * Фильтрует snapshot для конкретного viewer-slot.
 *  - Свои units/buildings: видны полностью.
 *  - Чужие: только если в visible-множестве viewer'а.
 *  - defeated-игроки: видны целиком (для stats/leaderboard).
 *  - researching: спрятано от чужих (anti-spy).
 *
 * НЕ мутирует входной snapshot — возвращает clone.
 */
export function filterSnapshotForViewer(
  snapshot: GameSnapshot,
  viewerSlot: number,
  visible: Set<string>
): GameSnapshot {
  if (!snapshot.playersState) return snapshot;
  const cloned: GameSnapshot = structuredClone(snapshot);
  const players = cloned.playersState ?? [];
  for (const p of players) {
    if (p.slot === viewerSlot) continue;
    if (p.defeated) continue;
    p.units = p.units.filter((u) => visible.has(cellKey(u.col, u.row)));
    p.buildings = p.buildings.filter((b) => visible.has(cellKey(b.col, b.row)));
    p.researching = null;
    // hide resources from opponents (опц. — anti-spy)
    // (В merc'е AoE2 это видимо через espionage, здесь пока нет.)
  }
  return cloned;
}
