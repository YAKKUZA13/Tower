/**
 * M8.4 — Fog of War: visibility computation + snapshot filtering.
 * Источник: AoE/Warcraft/StarCraft fog of war.
 *
 * Sim-authoritative visibility: сервер считает visible-множество клеток per-player
 * (объединение радиусов units/buildings). Snapshot фильтруется per-player перед
 * отправкой (клиент видит только свои + видимые чужие).
 *
 * Этот модуль PURE (без Babylon) — может работать и на сервере, и в клиенте
 * (для UI-debug и minimap-overlay).
 */
import type { GameSnapshot, GridData, PlayerState } from '@tower/shared';

export interface VisibilityDeps {
  grid: GridData;
  /** Все игроки в матче. */
  players: PlayerState[];
}

/** cellKey = `${col}:${row}`. */
export function cellKey(col: number, row: number): string {
  return `${col}:${row}`;
}

/**
 * Считает видимые клетки для ОДНОГО игрока (объединение радиусов units + buildings).
 * `sightRange` — в клетках (по умолчанию 5 для unit, 8 для building — caller override).
 */
export function computeVisibilityForPlayer(
  player: PlayerState,
  grid: GridData,
  options: { unitSight?: number; buildingSight?: number } = {}
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
  for (const u of player.units) {
    add(u.col, u.row, unitSight);
  }
  for (const b of player.buildings) {
    add(b.col, b.row, buildingSight);
  }
  return visible;
}

/**
 * Считает per-player visibility для всех игроков.
 * Возвращает Map<slot, Set<cellKey>>.
 */
export function computeVisibilityAll(deps: VisibilityDeps): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const p of deps.players) {
    out.set(p.slot, computeVisibilityForPlayer(p, deps.grid));
  }
  return out;
}

/**
 * Фильтрует snapshot для конкретного игрока:
 *  - Свой PlayerState — полностью.
 *  - Чужие PlayerState — оставляем только units/buildings в видимых клетках.
 *  - exploredCells (исторически разведанные) — caller-side (не в этом проходе).
 *
 * Возвращает NEW snapshot (deep-clone + filter) — не мутирует исходный.
 */
export function filterSnapshotForPlayer(
  snapshot: GameSnapshot,
  viewerSlot: number,
  visible: Set<string>
): GameSnapshot {
  if (!snapshot.playersState) return snapshot;
  const cloned: GameSnapshot = structuredClone(snapshot);
  const players = cloned.playersState ?? [];
  for (const p of players) {
    if (p.slot === viewerSlot) continue;     // свой — целиком
    if (p.defeated) continue;                // побеждённый — виден весь (для статистики)
    // filter units/buildings — только видимые клетки
    p.units = p.units.filter((u) => visible.has(cellKey(u.col, u.row)));
    p.buildings = p.buildings.filter((b) => visible.has(cellKey(b.col, b.row)));
    // hide researching / resources от чужих игроков (anti-spy)
    p.researching = null;
  }
  return cloned;
}

/**
 * Merge union всех игроков → "globally explored" cells (для UI minimap draw).
 */
export function computeExploredCells(
  players: PlayerState[],
  grid: GridData,
  previouslyExplored: Set<string> = new Set()
): Set<string> {
  const explored = new Set(previouslyExplored);
  for (const p of players) {
    const vis = computeVisibilityForPlayer(p, grid);
    for (const c of vis) explored.add(c);
  }
  return explored;
}
