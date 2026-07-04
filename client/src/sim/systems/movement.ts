/**
 * Система движения врагов по пути. Phase 1 задача 1.5.
 * Не блокируется стенами (стены — Фаза 4). При progress>=pathLength — урон базе.
 */

import type { Enemy, EnemyType } from '@tower/shared';
import { positionAtProgress } from '../../domain/path';
import type { BuiltPath } from '../../domain/path';

export interface MoveDeps {
  enemies: Enemy[];
  enemyTypes: Map<string, EnemyType>;
  path: BuiltPath;
  cellSize: number;
  dt: number;
  tick: number;
}

export interface MoveOutcome {
  /** Суммарный урон базе за этот шаг от врагов, дошедших до конца. */
  damageToBase: number;
  /** Сколько врагов дошло до базы за этот шаг. */
  reached: number;
}

/** Двигает врагов на месте (mutate position/pathProgress); помечает дошедших alive=false. */
export function tickMovement(deps: MoveDeps): MoveOutcome {
  const { enemies, enemyTypes, path, cellSize, dt, tick } = deps;
  let damageToBase = 0;
  let reached = 0;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const type = enemyTypes.get(enemy.typeId);
    if (!type) continue;
    const slowed = enemy.slowUntilTick != null && tick < enemy.slowUntilTick;
    const speedMult = slowed && enemy.slowFactor != null ? enemy.slowFactor : 1;
    const worldSpeed = type.speed * cellSize * speedMult;
    enemy.pathProgress += worldSpeed * dt;
    if (enemy.pathProgress >= path.totalLength) {
      // дошёл до базы
      damageToBase += type.damageToBase;
      reached += 1;
      enemy.alive = false;
      enemy.pathProgress = path.totalLength;
      continue;
    }
    enemy.position = positionAtProgress(path, enemy.pathProgress);
  }
  return { damageToBase, reached };
}
