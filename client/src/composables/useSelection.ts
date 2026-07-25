/**
 * M8.2 — Selection state (composable).
 * Хранит массив выделенных unit-ids; методы: select/addToSelection/toggle/boxSelect/clear.
 *
 * Используется из Game.vue (setupPointerHandlers) и SelectionBox.vue / ControlGroupBar.vue.
 * Хранит ИД в Ref<string[]> для реактивности. Не знает про sim — только id'ы.
 */
import { ref, type Ref } from 'vue';

export interface UseSelection {
  selectedIds: Ref<string[]>;
  /** Заменить выделение одним id. */
  select(id: string | null): void;
  /** Заменить выделение списком. */
  selectMany(ids: string[]): void;
  /** Добавить (shift-click) или убрать если уже есть (toggle). */
  addToSelection(ids: string[], mode: 'add' | 'toggle' | 'replace'): void;
  /** Box-select: ids внутри прямоугольника (caller сам делает picking). */
  boxSelect(ids: string[], additive: boolean): void;
  /** Снять выделение со всех. */
  clear(): void;
  /** Выделен ли id. */
  has(id: string): boolean;
  /** Количество выделенных. */
  count(): number;
}

export function useSelection(): UseSelection {
  const selectedIds = ref<string[]>([]);

  return {
    selectedIds,
    select(id) {
      selectedIds.value = id ? [id] : [];
    },
    selectMany(ids) {
      selectedIds.value = [...ids];
    },
    addToSelection(ids, mode) {
      if (mode === 'replace') {
        selectedIds.value = [...ids];
        return;
      }
      const current = new Set(selectedIds.value);
      if (mode === 'add') {
        for (const id of ids) current.add(id);
      } else { // toggle
        for (const id of ids) {
          if (current.has(id)) current.delete(id);
          else current.add(id);
        }
      }
      selectedIds.value = Array.from(current);
    },
    boxSelect(ids, additive) {
      if (!additive) {
        selectedIds.value = [...ids];
        return;
      }
      const current = new Set(selectedIds.value);
      for (const id of ids) current.add(id);
      selectedIds.value = Array.from(current);
    },
    clear() {
      selectedIds.value = [];
    },
    has(id) {
      return selectedIds.value.indexOf(id) >= 0;
    },
    count() {
      return selectedIds.value.length;
    }
  };
}
