/**
 * Система стен лабиринта (Phase 4 задачи 4.2).
 *
 *  - tickWalls: горящие стены получают DoT (BURN_DPS), огонь затухает к burningUntilTick.
 *  - applyEnemyWallDamage: враги бьют соседние стены (wallDamage dps) — лабиринт
 *    деградирует по мере прохождения волн, маршрут со временем сокращается.
 *
 * Функции чистые (мутируют переданные walls/enemies), без Babylon → headless-тесты.
 */

import type { Enemy, EnemyType, GridData, Wall } from '@tower/shared';
import { worldToGridData } from '../../domain/grid-math';
import { BURN_DPS } from '../constants';

export interface WallTickDeps {
  walls: Wall[];
  tick: number;
  dt: number;
}

export interface WallTickOutcome {
  /** id разрушенных стен на этом шаге. */
  destroyed: string[];
}

/** Горение: DoT + затухание. Не мутирует список — только поля стен. */
export function tickWalls(deps: WallTickDeps): WallTickOutcome {
  const { walls, tick, dt } = deps;
  const destroyed: string[] = [];
  for (const w of walls) {
    if (w.burning) {
      if (w.burningUntilTick != null && tick >= w.burningUntilTick) {
        w.burning = false;
        w.burningUntilTick = undefined;
      } else {
        w.hp -= BURN_DPS * dt;
      }
    }
    if (w.hp <= 0) {
      w.hp = 0;
      destroyed.push(w.id);
    }
  }
  return { destroyed };
}

export interface EnemyWallDeps {
  enemies: Enemy[];
  enemyTypes: Map<string, EnemyType>;
  walls: Wall[];
  grid: GridData;
  dt: number;
}

export interface EnemyWallOutcome {
  /** id разрушенных стен на этом шаге. */
  destroyed: string[];
}

/** Враги атакуют стены в 4 соседних клетках от их текущей позиции (maze-bashing). */
export function applyEnemyWallDamage(deps: EnemyWallDeps): EnemyWallOutcome {
  const { enemies, enemyTypes, walls, grid, dt } = deps;
  if (walls.length === 0) return { destroyed: [] };

  // индекс стен по клеткам для O(1) поиска соседей
  const byCell = new Map<string, Wall>();
  for (const w of walls) byCell.set(`${w.col}:${w.row}`, w);

  const destroyed = new Set<string>();
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
  ];

  for (const e of enemies) {
    if (!e.alive) continue;
    const type = enemyTypes.get(e.typeId);
    if (!type) continue;
    if (type.wallDamage <= 0) continue;
    if (type.flies) continue; // летающие игнорируют стены

    const g = worldToGridData(grid, e.position);
    const cc = Math.floor(g.col);
    const cr = Math.floor(g.row);

    for (const [dc, dr] of neighbors) {
      const wall = byCell.get(`${cc + dc}:${cr + dr}`);
      if (!wall) continue;
      wall.hp -= type.wallDamage * dt;
      if (wall.hp <= 0) {
        wall.hp = 0;
        destroyed.add(wall.id);
      }
    }
  }

  return { destroyed: Array.from(destroyed) };
}

/** Стоимость полного ремонта стены (пропорционально утерянному HP). */
export function repairCost(def: { cost: number; maxHp: number; repairRatio: number }, wall: Wall): number {
  const missing = Math.max(0, wall.maxHp - wall.hp);
  return Math.ceil(def.cost * def.repairRatio * (missing / def.maxHp));
}
