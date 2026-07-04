/**
 * Система экономики: gold/lives + проверка стоимости. Phase 1 задача 1.9.
 * Броня/награды применяются в projectiles.ts; здесь — операции над кошельком.
 */

import type { TowerType } from '@tower/shared';
import { SELL_REFUND_RATIO } from '../constants';

export interface EconomyState {
  gold: number;
  lives: number;
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
