/**
 * Система правил: переходы статусов и win/lose. Phase 1 задача 1.10.
 * Status flow (Phase 1): prep → wave → prep (next) … → won. draft вставляется в Фазе 5.
 */

import type { GameSnapshot, Wave } from '@tower/shared';
import { award, loseLives } from './economy';

export interface RulesInput {
  state: GameSnapshot;
  wave: Wave | null;
  waveFinished: boolean;
  damageToBaseThisStep: number;
  totalWaves: number;
}

/** Применяет урон базе; определяет переходы статусов. */
export function tickRules(input: RulesInput): void {
  const { state, wave, waveFinished, damageToBaseThisStep, totalWaves } = input;

  if (state.status === 'lost' || state.status === 'won') return;

  if (damageToBaseThisStep > 0) {
    loseLives(state, damageToBaseThisStep);
  }
  if (state.lives <= 0) {
    state.status = 'lost';
    return;
  }

  if (state.status === 'wave' && wave && waveFinished) {
    // волна зачищена
    award(state, wave.rewardBonus);
    if (state.waveIndex >= totalWaves - 1) {
      state.status = 'won';
    } else {
      // между волнами: готовим следующую (draft будет в Фазе 5)
      state.status = 'prep';
    }
  }
}
