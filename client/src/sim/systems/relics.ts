/**
 * Система реликвий (Phase 5, концепция 1).
 * См. TD-MVP-PLAN.md §4.1 и §2.5.
 *
 *  - computeRelicModifiers: по размещённым реликвиям считает итоговые мультипликаторы
 *    для башен (per-typeId), экономики и стен. Эффекты стекаются АДДИТИВНО по бонусам
 *    (Σ(mult−1)); slowOnHit — сильнейший; splashAdded/goldOnKillBonus — плоско.
 *    Функция чистая (без Babylon) → headless-тесты сима.
 *
 *  - rollRelicDraft: seeded взвешенный рандом 3 реликвий по редкости (common> rare> epic).
 *    Детерминирован (ADR-2): тот же rng → тот же набор.
 *
 *  - RelicModifiers: кеш (appliedRelicEffects), который GameSim пересчитывает при
 *    place/remove реликвии и пробрасывает в targeting/projectiles/rules каждый шаг.
 */

import type { PlacedRelic, RelicRarity, RelicType } from '@tower/shared';
import type { TowerType } from '@tower/shared';

/** Модификаторы одной башни (по typeId). */
export interface TowerMods {
  damageMult: number;
  rangeMult: number;
  fireRateMult: number;
  /** Множитель скорости врага при попадании (0..1), если реликвия даёт замедление. */
  slowOnHit?: number;
  /** Плоский прирост радиуса splash (в клетках). */
  splashAdded?: number;
}

/** Итоговые модификаторы всех размещённых реликвий. */
export interface RelicModifiers {
  /** per tower-typeId модификаторы (объединение all-towers + by-category). */
  towers: Map<string, TowerMods>;
  /** Множитель золота за убийства и зачистку волн. */
  goldMult: number;
  /** Плоский бонус золота за убийство. */
  goldOnKillBonus: number;
  /** Множитель maxHp стен. */
  wallHpMult: number;
}

export const EMPTY_MODS: RelicModifiers = {
  towers: new Map(),
  goldMult: 1,
  goldOnKillBonus: 0,
  wallHpMult: 1
};

interface TowerAccum {
  dmg: number;
  rng: number;
  rate: number;
  slow: number | undefined;
  splash: number;
}

const RARITY_WEIGHT: Record<RelicRarity, number> = {
  common: 60,
  rare: 30,
  epic: 10
};

/**
 * Считает итоговые модификаторы по размещённым реликвиям.
 * towerTypes нужен для применения 'all-towers'/'global'/'towers-by-category'.
 */
export function computeRelicModifiers(
  relics: PlacedRelic[],
  relicTypes: Map<string, RelicType>,
  towerTypes: Map<string, TowerType>
): RelicModifiers {
  const accum = new Map<string, TowerAccum>();
  let goldMultBonus = 0;
  let goldFlat = 0;
  let wallMultBonus = 0;

  const ensure = (typeId: string): TowerAccum => {
    let a = accum.get(typeId);
    if (!a) {
      a = { dmg: 0, rng: 0, rate: 0, slow: undefined, splash: 0 };
      accum.set(typeId, a);
    }
    return a;
  };

  const applyToTower = (typeId: string, eff: RelicType['effect']): void => {
    const a = ensure(typeId);
    if (eff.damageMult) a.dmg += eff.damageMult - 1;
    if (eff.rangeMult) a.rng += eff.rangeMult - 1;
    if (eff.fireRateMult) a.rate += eff.fireRateMult - 1;
    if (eff.slowOnHit != null) {
      a.slow = a.slow == null ? eff.slowOnHit : Math.min(a.slow, eff.slowOnHit);
    }
    if (eff.splashAdded) a.splash += eff.splashAdded;
  };

  for (const placed of relics) {
    const type = relicTypes.get(placed.typeId);
    if (!type) continue;
    const eff = type.effect;

    const hitsTowers = eff.target === 'all-towers' || eff.target === 'global';
    if (hitsTowers) {
      for (const tid of towerTypes.keys()) applyToTower(tid, eff);
    } else if (eff.target === 'towers-by-category' && eff.categoryFilter) {
      for (const [tid, tt] of towerTypes) {
        if (tt.category === eff.categoryFilter) applyToTower(tid, eff);
      }
    }

    if (eff.target === 'economy' || eff.target === 'global') {
      if (eff.goldMult) goldMultBonus += eff.goldMult - 1;
      if (eff.goldOnKillBonus) goldFlat += eff.goldOnKillBonus;
    }

    if (eff.target === 'walls' || eff.target === 'global') {
      if (eff.wallHpMult) wallMultBonus += eff.wallHpMult - 1;
    }
  }

  const towers = new Map<string, TowerMods>();
  for (const [tid, a] of accum) {
    towers.set(tid, {
      damageMult: Math.max(0.05, 1 + a.dmg),
      rangeMult: Math.max(0.1, 1 + a.rng),
      fireRateMult: Math.max(0.05, 1 + a.rate),
      slowOnHit: a.slow,
      splashAdded: a.splash > 0 ? a.splash : undefined
    });
  }

  return {
    towers,
    goldMult: Math.max(0, 1 + goldMultBonus),
    goldOnKillBonus: Math.max(0, goldFlat),
    wallHpMult: Math.max(0.1, 1 + wallMultBonus)
  };
}

/** Соединяет базовое замедление башни и замедление от реликвии (сильнейшее). */
export function combineSlow(base?: number, relic?: number): number | undefined {
  if (base == null && relic == null) return undefined;
  if (base == null) return relic;
  if (relic == null) return base;
  return Math.min(base, relic);
}

/**
 * Детерминированно выбирает `count` различных реликвий (по typeId) из пула,
 * взвешенно по редкости (common 60 / rare 30 / epic 10).
 */
export function rollRelicDraft(rng: () => number, relicTypes: RelicType[], count: number): string[] {
  if (relicTypes.length === 0 || count <= 0) return [];
  const pool = [...relicTypes];
  const chosen: string[] = [];
  while (chosen.length < count && pool.length > 0) {
    let total = 0;
    for (const r of pool) total += RARITY_WEIGHT[r.rarity];
    let roll = rng() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      roll -= RARITY_WEIGHT[pool[i].rarity];
      if (roll <= 0) {
        idx = i;
        break;
      }
    }
    chosen.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return chosen;
}
