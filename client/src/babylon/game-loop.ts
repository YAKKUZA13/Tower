/**
 * Игровой цикл: onBeforeRenderObservable → sim.step(dt) → sync renderers.
 * Phase 1 задача 1.11. Рендереры читают live state сима; для UI-стора снапшот
 * раздаётся с троттлингом ~10 Гц.
 *
 * Phase 7 (co-op): опция `stepping` — гость НЕ шагает сим (его state обновляется
 * через `GameSim.reconcile(snapshot)` извне по сети). Рендереры и атмосфера
 * продолжают синхронизироваться каждый кадр.
 */
import type { Engine, Scene } from 'babylonjs';
import type { GameSnapshot } from '@tower/shared';
import type { GameSim } from '../sim/game-sim';
import type { EnemyRenderer } from './enemies/enemy-renderer';
import type { TowerRenderer } from './towers/tower-renderer';
import type { ProjectilePool } from './projectiles/projectile-pool';
import type { WallRenderer } from './walls/wall-renderer';
import type { RelicRenderer } from './relics/relic-renderer';
import type { UnitRenderer } from './units/unit-renderer';
import type { AtmosphereRenderer } from './atmosphere';

export interface GameRenderers {
  enemies: EnemyRenderer;
  towers: TowerRenderer;
  projectiles: ProjectilePool;
  /** Стены лабиринта (Фаза 4). Опционально. */
  walls?: WallRenderer;
  /** Реликвии-тотемы (Фаза 5). Опционально. */
  relics?: RelicRenderer;
  /** RTS юниты/здания/заклинания (Фаза 6). Опционально. */
  units?: UnitRenderer;
  /** Атмосфера (день/ночь/погода/пост-процесс). Опционально (нет в редакторе). */
  atmosphere?: AtmosphereRenderer;
}

export interface GameLoopOptions {
  /**
   * Запускать ли `sim.step(dt)` каждый кадр. Хост/single-player → true.
   * Гость → false (state обновляется через `GameSim.reconcile`).
   * По умолчанию true.
   */
  stepping?: boolean;
  /**
   * Вызывается каждый кадр ПОСЛЕ возможного step, НО до sync рендереров.
   * Гость использует это, чтобы запихнуть интерполированный снапшот из GuestSync
   * в sim через `applyRenderState`. nowMs — performance.now().
   */
  onPreRender?: (dt: number, nowMs: number) => void;
}

export interface GameLoopHandle {
  stop: () => void;
  /** Phase 8: пауза симуляции (рендер продолжается). */
  setPaused: (paused: boolean) => void;
  /** Phase 8: множитель скорости симуляции (1 = нормально, 2 = ускорено). */
  setSpeed: (speed: number) => void;
}

const SNAPSHOT_INTERVAL = 0.1; // сек

export function startGameLoop(
  engine: Engine,
  scene: Scene,
  sim: GameSim,
  renderers: GameRenderers,
  onSnapshot?: (snapshot: GameSnapshot) => void,
  onRouteChange?: (waypoints: { col: number; row: number }[]) => void,
  options: GameLoopOptions = {}
): GameLoopHandle {
  const stepping = options.stepping !== false;
  const onPreRender = options.onPreRender;
  let snapshotAcc = 0;
  let lastRouteVersion = -1;
  // Phase 8: runtime-флаги паузы/скорости (меняются через handle без пересоздания цикла)
  let paused = false;
  let speed = 1;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    if (stepping && !paused) {
      // speed домножает реальный dt; сим внутри ограничен MAX_STEPS_PER_FRAME.
      sim.step(dt * speed);
    }
    if (onPreRender) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      onPreRender(dt, nowMs);
    }
    const state = sim.state;
    renderers.enemies.sync(state);
    renderers.towers.sync(state);
    renderers.projectiles.sync(state);
    renderers.walls?.sync(state);
    renderers.relics?.sync(state);
    renderers.units?.sync(state, dt);
    renderers.atmosphere?.sync(state, dt);
    if (onRouteChange && state.routeVersion !== lastRouteVersion) {
      lastRouteVersion = state.routeVersion;
      onRouteChange(sim.getRouteWaypoints());
    }
    // снапшот для UI/сети раздаём только если сим шагает (хост/single-player);
    // гость получает авторитетные снапшоты снаружи и не должен плодить свои.
    if (stepping) {
      snapshotAcc += dt;
      if (onSnapshot && snapshotAcc >= SNAPSHOT_INTERVAL) {
        snapshotAcc = 0;
        onSnapshot(sim.serialize());
      }
    }
  });
  // Запуск рендера: без явного runRenderLoop Babylon не рисует сцену.
  // Один loop на engine; renderer-observer срабатывает каждый кадр до stop().
  engine.runRenderLoop(() => {
    scene.render();
  });
  return {
    stop: () => {
      scene.onBeforeRenderObservable.remove(observer);
      engine.stopRenderLoop();
    },
    setPaused: (p: boolean) => { paused = p; },
    setSpeed: (s: number) => { speed = Math.max(1, Math.min(4, s)); }
  };
}
