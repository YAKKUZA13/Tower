/**
 * Система правил: переходы статусов и win/lose. Phase 1 задача 1.10, Phase 5 задача 5.6.
 * Status flow: prep → wave → draft (между волнами) → prep → … → won.
 * draft вставляется между волнами (кроме последней → won); игрок выбирает/скипает реликвию.
 */

import type { GameSnapshot, Wave } from '@tower/shared';
import type { RelicModifiers } from './relics';
import { award, loseLives } from './economy';

export interface RulesInput {
  state: GameSnapshot;
  wave: Wave | null;
  waveFinished: boolean;
  damageToBaseThisStep: number;
  totalWaves: number;
  /** Модификаторы реликвий (Фаза 5): goldMult применяется к rewardBonus волны. */
  relicMods?: RelicModifiers;
}

/** Применяет урон базе; определяет переходы статусов. */
export function tickRules(input: RulesInput): void {
  const { state, wave, waveFinished, damageToBaseThisStep, totalWaves, relicMods } = input;

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
    const goldMult = relicMods?.goldMult ?? 1;
    award(state, wave.rewardBonus * goldMult);
    if (state.waveIndex >= totalWaves - 1) {
      state.status = 'won';
    } else {
      // между волнами — драфт реликвий (Фаза 5). GameSim сгенерирует pendingRelicChoices.
      state.status = 'draft';
    }
  }
}
