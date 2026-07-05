/**
 * Реликвии и драфт (Phase 5, концепция 1).
 * См. TD-MVP-PLAN.md §2.5 и §4.1.
 *
 * Реликвия = воксельный тотем со эффектом. Между волнами (status==='draft')
 * сим предлагает 3 реликвии (seeded взвешенный рандом по редкости); игрок
 * выбирает одну и физически размещает её в клетке лабиринта. Эффект применяется
 * к подходящим сущностям и стекается с другими реликвиями (аддитивно по бонусам).
 *
 * Реликвия занимает клетку (как стена), но НЕ блокирует маршрут врагов — это
 * источник эффекта + визуальный якорь (тотем со свечением/PointLight).
 */

import type { ModelRef, TowerType } from './td.js';

export type RelicRarity = 'common' | 'rare' | 'epic';

/**
 * Эффект реликвии. target определяет scope применения полей:
 *  - 'all-towers'        → damageMult/rangeMult/fireRateMult/slowOnHit/splashAdded ко ВСЕМ башням.
 *  - 'towers-by-category'→ то же, но только к categoryFilter (physical/magic/siege).
 *  - 'economy'           → goldMult/goldOnKillBonus.
 *  - 'walls'             → wallHpMult.
 *  - 'global'            → все поля ко всем сущностям (и башни, и экономика, и стены).
 *
 * Множители (damageMult/rangeMult/fireRateMult/goldMult/wallHpMult) — это итоговый
 * коэффициент (1.25 = +25%). При сте­ковании нескольких реликвий их БОНУСЫ
 * (mult − 1) суммируются: итог = 1 + Σ(mult_i − 1).
 * slowOnHit — берётся сильнейшее (минимальный множитель скорости).
 * splashAdded / goldOnKillBonus — суммируются плоско.
 */
export interface RelicEffect {
  target: 'all-towers' | 'towers-by-category' | 'economy' | 'global' | 'walls';
  categoryFilter?: TowerType['category'];
  damageMult?: number;
  rangeMult?: number;
  fireRateMult?: number;
  goldMult?: number;
  goldOnKillBonus?: number;
  wallHpMult?: number;
  /** Множитель скорости врага при попадании (0..1; меньше = сильнее замедление). */
  slowOnHit?: number;
  /** Плоский прирост радиуса splash к снарядам подходящих башен (в клетках). */
  splashAdded?: number;
}

export interface RelicType {
  id: string;
  name: string;
  rarity: RelicRarity;
  description: string;
  effect: RelicEffect;
  modelRef: ModelRef;
}

/** Экземпляр реликвии на поле (runtime, не персистится в карте). */
export interface PlacedRelic {
  id: string;
  typeId: string;
  col: number;
  row: number;
}
