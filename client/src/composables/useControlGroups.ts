/**
 * M8.2 — Control groups (Ctrl+1..9 / 1..9 recall).
 * Хранит Map<groupNumber, unitId[]>. Bindings живут в session (не персистятся).
 *
 * API:
 *  - assign(group, ids) — Ctrl+digit → сохранить выделение
 *  - recall(group) → Ref<string[]> для выделения
 *  - has(group), clear(group)
 *
 * Используется из Game.vue keyboard handler + ControlGroupBar.vue UI.
 */
import { reactive } from 'vue';

const MIN_GROUP = 1;
const MAX_GROUP = 9;

export interface UseControlGroups {
  groups: Record<number, string[]>;
  assign(group: number, ids: string[]): void;
  recall(group: number): string[];
  has(group: number): boolean;
  clear(group: number): void;
  clearAll(): void;
}

export function useControlGroups(): UseControlGroups {
  const groups = reactive<Record<number, string[]>>({});
  for (let i = MIN_GROUP; i <= MAX_GROUP; i++) groups[i] = [];

  return {
    groups,
    assign(group, ids) {
      if (group < MIN_GROUP || group > MAX_GROUP) return;
      groups[group] = [...ids];
    },
    recall(group) {
      if (group < MIN_GROUP || group > MAX_GROUP) return [];
      return groups[group] ?? [];
    },
    has(group) {
      return group >= MIN_GROUP && group <= MAX_GROUP && (groups[group]?.length ?? 0) > 0;
    },
    clear(group) {
      if (group >= MIN_GROUP && group <= MAX_GROUP) groups[group] = [];
    },
    clearAll() {
      for (let i = MIN_GROUP; i <= MAX_GROUP; i++) groups[i] = [];
    }
  };
}

export { MIN_GROUP, MAX_GROUP };
