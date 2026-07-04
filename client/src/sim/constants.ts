/** Константы симуляции. ADR-2: fixed-step для детерминизма. */

/** Фиксированный шаг симуляции (сек). 1/30 — гладкое движение, детерминировано. */
export const FIXED_DT = 1 / 30;

/** Длительность эффекта замедления (сек) при попадании ice-снаряда. */
export const SLOW_DURATION = 1.6;

/** Радиус «попадания» снаряда по цели (world units). */
export const PROJECTILE_HIT_RADIUS = 0.35;

/** Доля стоимости, возвращаемая при продаже башни. */
export const SELL_REFUND_RATIO = 0.5;

/** Базовый seed (single-player; в co-op задаётся хостом). */
export const DEFAULT_SEED = 1337;

/** Длительность полных суток в секундах сима (Фаза 3 — день/ночь). 0..1 в snapshot.timeOfDay. */
export const DAY_LENGTH_SECONDS = 180;

// ── Стены (Фаза 4) ──
/** Длительность горения стены после поджога (сек). */
export const BURN_DURATION = 3;
/** Урон в секунду по горящей стене. */
export const BURN_DPS = 14;
