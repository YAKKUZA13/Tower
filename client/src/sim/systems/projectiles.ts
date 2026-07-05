/**
 * Система движения снарядов + применение урона (combat). Phase 1 задачи 1.7 + 1.8.
 * Снаряд — самонаводящийся: летит к текущей позиции цели; при достижении — удар.
 * Если цель умерла/ушла — снаряд гаснет.
 */

import type { Enemy, Projectile, TowerType, EnemyType, Wall, GridData } from '@tower/shared';
import { SLOW_DURATION, PROJECTILE_HIT_RADIUS, FIXED_DT } from '../constants';
import { gridToWorldData } from '../../domain/grid-math';
import type { RelicModifiers } from './relics';

export interface ProjectileOutcome {
  /** Награда золота за этот шаг (сумма reward убитых, с учётом реликвий). */
  goldGained: number;
  /** Сколько врагов убито за этот шаг. */
  killed: number;
}

export interface ProjectileDeps {
  projectiles: Projectile[];
  enemies: Enemy[];
  aliveEnemies: Map<string, Enemy>;
  enemyTypes: Map<string, EnemyType>;
  towerTypes: Map<string, TowerType>;
  grid: GridData;
  cellSize: number;
  dt: number;
  tick: number;
  /** Стены (Фаза 4): снаряды с splash поджигают стены в радиусе. */
  walls?: Wall[];
  /** Длительность горения в тиках. */
  burnTicks?: number;
  /** Модификаторы реликвий (Фаза 5): goldMult/goldOnKillBonus к награде за убийство. */
  relicMods?: RelicModifiers;
}

export function tickProjectiles(deps: ProjectileDeps): ProjectileOutcome {
  const { projectiles, aliveEnemies, enemyTypes, towerTypes, cellSize, dt, tick, relicMods } = deps;
  const goldMult = relicMods?.goldMult ?? 1;
  const goldOnKillBonus = relicMods?.goldOnKillBonus ?? 0;
  let goldGained = 0;
  let killed = 0;

  for (const proj of projectiles) {
    if (!proj.alive) continue;
    const target = proj.targetEnemyId ? aliveEnemies.get(proj.targetEnemyId) : null;
    if (!target) {
      proj.alive = false;
      continue;
    }
    const towerType = towerTypes.get(proj.typeId);
    const speedCells = towerType?.projectileSpeed ?? 12;
    const projStep = speedCells * cellSize * dt;

    const dx = target.position.x - proj.x;
    const dy = target.position.y - proj.y;
    const dz = target.position.z - proj.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist <= projStep + PROJECTILE_HIT_RADIUS) {
      const justDied = onHit(proj, target, deps);
      proj.alive = false;
      if (justDied) {
        killed += 1;
        const baseReward = enemyTypes.get(target.typeId)?.reward ?? 0;
        goldGained += baseReward * goldMult + goldOnKillBonus;
      }
      continue;
    }
    const inv = projStep / dist;
    proj.x += dx * inv;
    proj.y += dy * inv;
    proj.z += dz * inv;
  }

  return { goldGained, killed };
}

/** Применяет урон; возвращает true, если враг перешёл alive→dead именно от этого удара. */
function onHit(proj: Projectile, target: Enemy, deps: ProjectileDeps): boolean {
  const { enemies, enemyTypes, tick, grid, walls, burnTicks } = deps;
  const mainKilled = applyDamage(target, proj.damage, proj.category, enemyTypes);
  if (proj.splashRadius && proj.splashRadius > 0) {
    const r2 = proj.splashRadius * proj.splashRadius;
    for (const other of enemies) {
      if (!other.alive || other === target) continue;
      const dx = other.position.x - target.position.x;
      const dz = other.position.z - target.position.z;
      if (dx * dx + dz * dz <= r2) {
        applyDamage(other, proj.damage * 0.6, proj.category, enemyTypes);
      }
    }
    // Фаза 4: осадные/зажигательные снаряды поджигают стены в радиусе splash.
    if (walls && walls.length > 0 && burnTicks && burnTicks > 0) {
      for (const wall of walls) {
        const w = gridToWorldData(grid, wall.col, wall.row);
        const dx = w.x - target.position.x;
        const dz = w.z - target.position.z;
        if (dx * dx + dz * dz <= r2) {
          wall.burning = true;
          wall.burningUntilTick = tick + burnTicks;
        }
      }
    }
  }
  if (proj.slowFactor != null && proj.slowFactor > 0 && proj.slowFactor < 1) {
    target.slowFactor = proj.slowFactor;
    target.slowUntilTick = tick + Math.round(SLOW_DURATION / FIXED_DT);
  }
  return mainKilled;
}

/** Физ/siege урон снижается бронёй (плоско, min 1); magic игнорирует броню. */
function applyDamage(enemy: Enemy, rawDamage: number, category: Projectile['category'], enemyTypes: Map<string, EnemyType>): boolean {
  if (!enemy.alive) return false;
  const armor = enemyTypes.get(enemy.typeId)?.armor ?? 0;
  let dmg = rawDamage;
  if (category !== 'magic' && armor > 0) {
    dmg = Math.max(1, rawDamage - armor);
  }
  enemy.hp -= dmg;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.alive = false;
    return true;
  }
  return false;
}
