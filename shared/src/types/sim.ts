/**
 * Симуляция TD: снапшот состояния, ввод игрока, события.
 * Источник для Phase 1 (game-sim + game-store + renderers). См. TD-MVP-PLAN.md раздел 2.7.
 *
 * Сим детерминирован (ADR-2): seeded-rng, fixed-step, input-ordered.
 * Single-player = host=local; co-op (Фаза 7) использует тот же GameSnapshot.
 */

import type { Enemy, EnemyType, Tower, TowerType, Wave } from './td.js';

export type SimStatus = 'prep' | 'wave' | 'draft' | 'won' | 'lost';
export type CoopRole = 'builder' | 'economist' | 'commander' | 'free';
export type Weather = 'clear' | 'rain' | 'storm';

/** Снаряд (runtime, не персистится в карте). */
export interface Projectile {
  id: string;
  /** typeId башни, выпустившей снаряд (для цвета/эффекта рендера). */
  typeId: string;
  x: number;
  y: number;
  z: number;
  targetEnemyId: string | null;
  damage: number;
  splashRadius?: number;
  slowFactor?: number;
  /** Категория башни — для учёта брони (physical/magic/siege). */
  category: TowerType['category'];
  alive: boolean;
}

/**
 * Полный снапшот сима (ADR-2 — сериализуем, детерминирован).
 * Поля для стен/реликвий/RTS — опциональны; заполняются в Фазах 4/5/6.
 */
export interface GameSnapshot {
  tick: number;
  status: SimStatus;
  /** Индекс текущей/следующей волны. -1 до первой волны. */
  waveIndex: number;
  gold: number;
  lives: number;
  pathLength: number;
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  /** Сколько врагов ещё не убито в текущей волне (pending + живые). Для UI/rules. */
  waveEnemiesRemaining: number;
  // ── окружение (Фаза 3 использует; заложено с Фазы 1 для детерминированности) ──
  timeOfDay: number; // 0..1
  weather: Weather;
  // ── co-op (Фаза 7; в single-player один игрок-owner) ──
  ownerId: string;
  players: Array<{ userId: string; role: CoopRole; ready: boolean }>;
}

/**
 * Действия игрока. Phase 1 реализует подмножество (place-tower/sell-tower/
 * start-wave/set-targeting); остальные добавляются в Фазах 4/5/6.
 */
export type PlayerAction =
  | { kind: 'place-tower'; typeId: string; col: number; row: number }
  | { kind: 'sell-tower'; towerId: string }
  | { kind: 'start-wave' }
  | { kind: 'set-targeting'; towerId: string; mode: TowerType['targetingMode'] };

export interface PlayerInput {
  tick: number;
  userId: string;
  action: PlayerAction;
}

/** Каталоги правил игры (башни/враги/волны). Источник для sim + UI. */
export interface GameCatalog {
  towers: TowerType[];
  enemies: EnemyType[];
  waves: Wave[];
}
