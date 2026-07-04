/**
 * Система выбора цели башнями и спавна снарядов. Phase 1 задача 1.6 + 1.7 (спавн).
 */

import type { Enemy, Projectile, TargetingMode, Tower, TowerType } from '@tower/shared';
import { cellToWorld } from '../../domain/path';
import type { GridData } from '@tower/shared';

export interface TargetOutcome {
  /** Созданные снаряды (нужно добавить в state.projectiles). */
  projectiles: Projectile[];
}

export interface TargetDeps {
  towers: Tower[];
  towerTypes: Map<string, TowerType>;
  enemies: Enemy[];
  grid: GridData;
  heightmap: number[][] | null;
  cellSize: number;
  dt: number;
  nextProjectileId: () => string;
}

/** Уменьшает cooldown; башня, готовая стрелять с целью в радиусе, выпускает снаряд. */
export function tickTargeting(deps: TargetDeps): TargetOutcome {
  const { towers, towerTypes, enemies, grid, heightmap, cellSize, dt, nextProjectileId } = deps;
  const projectiles: Projectile[] = [];
  for (const tower of towers) {
    tower.cooldown = Math.max(0, tower.cooldown - dt);
    const type = towerTypes.get(tower.typeId);
    if (!type) continue;
    const target = pickTarget(tower, type, enemies, grid, heightmap, cellSize);
    if (!target) continue;
    // повернуть башню к цели (визуально)
    tower.rotationY = aimYaw(tower, target, grid, heightmap);
    if (tower.cooldown > 0) continue;
    const origin = cellToWorld(grid, heightmap, tower.col, tower.row);
    projectiles.push({
      id: nextProjectileId(),
      typeId: tower.typeId,
      x: origin.x,
      y: origin.y + 0.8,
      z: origin.z,
      targetEnemyId: target.id,
      damage: type.damage,
      splashRadius: type.splashRadius,
      slowFactor: type.slowFactor,
      category: type.category,
      alive: true
    });
    tower.cooldown += 1 / Math.max(1e-3, type.fireRate);
  }
  return { projectiles };
}

function pickTarget(
  tower: Tower,
  type: TowerType,
  enemies: Enemy[],
  grid: GridData,
  heightmap: number[][] | null,
  cellSize: number
): Enemy | null {
  const origin = cellToWorld(grid, heightmap, tower.col, tower.row);
  const radius = type.range * cellSize;
  const radius2 = radius * radius;
  const mode: TargetingMode = tower.targetingMode ?? type.targetingMode;
  let best: Enemy | null = null;
  let bestScore = Number.NaN;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const dx = enemy.position.x - origin.x;
    const dz = enemy.position.z - origin.z;
    if (dx * dx + dz * dz > radius2) continue;
    const score = scoreForMode(mode, enemy, dx, dz);
    if (best === null || score > bestScore) {
      best = enemy;
      bestScore = score;
    }
  }
  return best;
}

/** Чем больше score — тем приоритетнее цель. */
function scoreForMode(mode: TargetingMode, enemy: Enemy, dx: number, dz: number): number {
  switch (mode) {
    case 'first':
      return enemy.pathProgress; // ближайший к базе
    case 'last':
      return -enemy.pathProgress; // только появившийся
    case 'nearest': {
      const d2 = dx * dx + dz * dz;
      return -d2;
    }
    case 'strongest':
      return enemy.hp;
    case 'weakest':
      return -enemy.hp;
    default:
      return enemy.pathProgress;
  }
}

function aimYaw(tower: Tower, target: Enemy, grid: GridData, heightmap: number[][] | null): number {
  const origin = cellToWorld(grid, heightmap, tower.col, tower.row);
  return Math.atan2(target.position.x - origin.x, target.position.z - origin.z);
}
