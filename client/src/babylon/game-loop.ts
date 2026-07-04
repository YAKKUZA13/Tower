/**
 * Игровой цикл: onBeforeRenderObservable → sim.step(dt) → sync renderers.
 * Phase 1 задача 1.11. Рендереры читают live state сима; для UI-стора снапшот
 * раздаётся с троттлингом ~10 Гц.
 */
import type { Engine, Scene } from 'babylonjs';
import type { GameSnapshot } from '@tower/shared';
import type { GameSim } from '../sim/game-sim';
import type { EnemyRenderer } from './enemies/enemy-renderer';
import type { TowerRenderer } from './towers/tower-renderer';
import type { ProjectilePool } from './projectiles/projectile-pool';
import type { AtmosphereRenderer } from './atmosphere';

export interface GameRenderers {
  enemies: EnemyRenderer;
  towers: TowerRenderer;
  projectiles: ProjectilePool;
  /** Атмосфера (день/ночь/погода/пост-процесс). Опционально (нет в редакторе). */
  atmosphere?: AtmosphereRenderer;
}

export interface GameLoopHandle {
  stop: () => void;
}

const SNAPSHOT_INTERVAL = 0.1; // сек

export function startGameLoop(
  engine: Engine,
  scene: Scene,
  sim: GameSim,
  renderers: GameRenderers,
  onSnapshot?: (snapshot: GameSnapshot) => void
): GameLoopHandle {
  let snapshotAcc = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    sim.step(dt);
    const state = sim.state;
    renderers.enemies.sync(state);
    renderers.towers.sync(state);
    renderers.projectiles.sync(state);
    renderers.atmosphere?.sync(state, dt);
    snapshotAcc += dt;
    if (onSnapshot && snapshotAcc >= SNAPSHOT_INTERVAL) {
      snapshotAcc = 0;
      onSnapshot(sim.serialize());
    }
  });
  return {
    stop: () => scene.onBeforeRenderObservable.remove(observer)
  };
}
