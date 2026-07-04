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
import type { WallRenderer } from './walls/wall-renderer';
import type { AtmosphereRenderer } from './atmosphere';

export interface GameRenderers {
  enemies: EnemyRenderer;
  towers: TowerRenderer;
  projectiles: ProjectilePool;
  /** Стены лабиринта (Фаза 4). Опционально. */
  walls?: WallRenderer;
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
  onSnapshot?: (snapshot: GameSnapshot) => void,
  onRouteChange?: (waypoints: { col: number; row: number }[]) => void
): GameLoopHandle {
  let snapshotAcc = 0;
  let lastRouteVersion = -1;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    sim.step(dt);
    const state = sim.state;
    renderers.enemies.sync(state);
    renderers.towers.sync(state);
    renderers.projectiles.sync(state);
    renderers.walls?.sync(state);
    renderers.atmosphere?.sync(state, dt);
    if (onRouteChange && state.routeVersion !== lastRouteVersion) {
      lastRouteVersion = state.routeVersion;
      onRouteChange(sim.getRouteWaypoints());
    }
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
