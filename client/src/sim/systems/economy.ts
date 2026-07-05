/**
 * Система экономики: gold/lives + проверка стоимости. Phase 1 задача 1.9.
 * Phase 6 (RTS): добавлены ресурсы (wood/stone/ore/gold), тик производства
 * зданий (input/output perSec), проверка/списание ResourceBag.
 *
 * Броня/награды применяются в projectiles.ts; здесь — операции над кошельком.
 */

import type { TowerType } from '@tower/shared';
import type {
  ProductionBuilding,
  ProductionBuildingType,
  ResourceBag,
  ResourceId
} from '@tower/shared';
import { SELL_REFUND_RATIO } from '../constants';

export interface EconomyState {
  gold: number;
  lives: number;
}

/** Состояние с RTS-ресурсами (Phase 6). */
export interface RtsEconomyState {
  resources?: Record<ResourceId, number>;
}

export function canAfford(state: EconomyState, cost: number): boolean {
  return state.gold >= cost;
}

export function spend(state: EconomyState, cost: number): void {
  state.gold = Math.max(0, state.gold - cost);
}

export function refund(state: EconomyState, type: TowerType): void {
  state.gold += Math.floor(type.cost * SELL_REFUND_RATIO);
}

export function award(state: EconomyState, amount: number): void {
  state.gold += amount;
}

export function loseLives(state: EconomyState, amount: number): void {
  state.lives = Math.max(0, state.lives - amount);
}

// ── RTS: ресурсы (Phase 6) ─────────────────────────────────────────────

/** Гарантирует, что в bag есть все 4 ключа ресурсов (0 для отсутствующих). */
export function ensureResources(bag: Partial<Record<ResourceId, number>> | undefined): Record<ResourceId, number> {
  return {
    wood: bag?.wood ?? 0,
    stone: bag?.stone ?? 0,
    ore: bag?.ore ?? 0,
    gold: bag?.gold ?? 0
  };
}

/** Достаточно ли ресурсов для оплаты cost-пакета. */
export function canAffordResources(bag: Record<ResourceId, number>, cost: ResourceBag): boolean {
  for (const key of Object.keys(cost) as ResourceId[]) {
    if (key === 'gold') continue; // gold живёт в state.gold, не в bag
    if ((bag[key] ?? 0) < (cost[key] ?? 0)) return false;
  }
  return true;
}

/** Списывает cost-пакет из bag (без проверки — caller обязан вызвать canAffordResources). */
export function spendResources(bag: Record<ResourceId, number>, cost: ResourceBag): void {
  for (const key of Object.keys(cost) as ResourceId[]) {
    if (key === 'gold') continue;
    bag[key] = Math.max(0, (bag[key] ?? 0) - (cost[key] ?? 0));
  }
}

/**
 * Полная проверка стоимости с учётом gold (в state.gold) и ресурсов (в bag).
 * gold-стоимость списывается из state.gold, остальные — из bag.
 */
export function canAffordCost(
  state: { gold: number; resources?: Record<ResourceId, number> },
  cost: ResourceBag
): boolean {
  if ((cost.gold ?? 0) > 0 && state.gold < (cost.gold ?? 0)) return false;
  if (!state.resources) return (cost.gold ?? 0) > 0 || Object.keys(cost).every((k) => k === 'gold' || !(cost[k as ResourceId] ?? 0));
  for (const key of Object.keys(cost) as ResourceId[]) {
    if (key === 'gold') continue;
    if ((state.resources[key] ?? 0) < (cost[key] ?? 0)) return false;
  }
  return true;
}

/** Списывает cost: gold → из state.gold, остальные ресурсы → из state.resources. */
export function spendCost(state: { gold: number; resources?: Record<ResourceId, number> }, cost: ResourceBag): void {
  if ((cost.gold ?? 0) > 0) state.gold = Math.max(0, state.gold - (cost.gold ?? 0));
  if (!state.resources) return;
  for (const key of Object.keys(cost) as ResourceId[]) {
    if (key === 'gold') continue;
    state.resources[key] = Math.max(0, (state.resources[key] ?? 0) - (cost[key] ?? 0));
  }
}

/**
 * Тик производства: для каждого здания проверяет, хватает ли input-ресурса; если да —
 * списывает input*dt и накапливает output*dt в accum (фракции складываются, целое
 * переносится в bag). GOLD из output не идёт в bag — он возвращается отдельно, чтобы
 * GameSim сложил его в state.gold (единый кошелёк).
 *
 * Детерминирован (без rng). Не мутирует список зданий — только accum-поля и bag.
 *
 * Возвращает прирост gold за этот тик (чтобы сим сложил в общий кошелёк).
 */
export interface ProductionTickDeps {
  bag: Record<ResourceId, number>;
  buildings: ProductionBuilding[];
  buildingTypes: Map<string, ProductionBuildingType>;
  dt: number;
  /** Доля эффективности производства (0..1) — для будущих модификаторов. */
  efficiency?: number;
}

export function tickProduction(deps: ProductionTickDeps): number {
  const { bag, buildings, buildingTypes, dt, efficiency = 1 } = deps;
  let goldOut = 0;
  for (const b of buildings) {
    const type = buildingTypes.get(b.typeId);
    if (!type) continue;

    // проверить input — хватает ли на этот тик (gold не используется как input)
    if (type.input && type.input.length > 0) {
      let canRun = true;
      for (const inp of type.input) {
        if (inp.resource === 'gold') continue;
        const need = inp.perSec * dt * efficiency;
        if ((bag[inp.resource] ?? 0) < need) {
          canRun = false;
          break;
        }
      }
      if (!canRun) continue; // не хватает сырья — простой на этом тике
      // списать input
      for (const inp of type.input) {
        if (inp.resource === 'gold') continue;
        const need = inp.perSec * dt * efficiency;
        bag[inp.resource] = (bag[inp.resource] ?? 0) - need;
      }
    }

    // накопить output в accum-фракции
    if (!b.accum) b.accum = {};
    for (const out of type.output) {
      const amount = out.perSec * dt * efficiency;
      if (out.resource === 'gold') {
        // gold — напрямую в return (эффект в state.gold)
        goldOut += amount;
        continue;
      }
      b.accum[out.resource] = (b.accum[out.resource] ?? 0) + amount;
      // переносим целые единицы в bag (стабильный accrual — нет потери ресурсов)
      const whole = Math.floor(b.accum[out.resource] ?? 0);
      if (whole >= 1) {
        bag[out.resource] = (bag[out.resource] ?? 0) + whole;
        b.accum[out.resource] = (b.accum[out.resource] ?? 0) - whole;
      }
    }
  }
  return goldOut;
}
