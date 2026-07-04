/**
 * Система спавна врагов из волны. Phase 1 задача 1.4.
 * Детерминирована: порядок спавна фиксирован (группы по порядку, внутри — по времени).
 */

import type { Enemy, EnemyType, Wave } from '@tower/shared';
import { positionAtProgress } from '../../domain/path';
import type { BuiltPath } from '../../domain/path';

export interface SpawnGroupState {
  spawned: number;
}

export interface WaveSpawnState {
  time: number;                 // сек с начала волны
  groups: SpawnGroupState[];
  totalToSpawn: number;         // sum count
  resolved: number;             // убитые + дошедшие до базы
}

export function createWaveState(wave: Wave): WaveSpawnState {
  return {
    time: 0,
    groups: wave.groups.map(() => ({ spawned: 0 })),
    totalToSpawn: wave.groups.reduce((acc, g) => acc + g.count, 0),
    resolved: 0
  };
}

export interface SpawnResult {
  spawned: Enemy[];
}

export interface SpawnDeps {
  wave: Wave;
  state: WaveSpawnState;
  dt: number;
  enemyTypes: Map<string, EnemyType>;
  path: BuiltPath;
  nextId: () => string;
}

/** Спавнит врагов, чьё время пришло за этот шаг. Не мутирует state.enemies — возвращает новых. */
export function tickSpawner(deps: SpawnDeps): SpawnResult {
  const { wave, state, dt, enemyTypes, path, nextId } = deps;
  state.time += dt;
  const out: Enemy[] = [];
  for (let gi = 0; gi < wave.groups.length; gi++) {
    const group = wave.groups[gi];
    const gs = state.groups[gi];
    const type = enemyTypes.get(group.enemyTypeId);
    if (!type) continue;
    while (gs.spawned < group.count && state.time >= group.startDelay + gs.spawned * group.interval) {
      const pos = positionAtProgress(path, 0);
      out.push({
        id: nextId(),
        typeId: group.enemyTypeId,
        hp: type.baseHp,
        maxHp: type.baseHp,
        pathProgress: 0,
        position: { ...pos },
        alive: true
      });
      gs.spawned += 1;
    }
  }
  return { spawned: out };
}

/** Все ли враги волны отспавнены. */
export function allSpawned(state: WaveSpawnState): boolean {
  return sumSpawned(state) >= state.totalToSpawn;
}

function sumSpawned(state: WaveSpawnState): number {
  return state.groups.reduce((acc, g) => acc + g.spawned, 0);
}

/** Волна завершена: все отспавнены и все разрешены (убиты/дошли). */
export function waveFinished(state: WaveSpawnState): boolean {
  return sumSpawned(state) >= state.totalToSpawn && state.resolved >= state.totalToSpawn;
}
