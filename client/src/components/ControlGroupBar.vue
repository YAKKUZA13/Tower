<script setup lang="ts">
/**
 * M8.2 — Control-group bar (1..9 badges).
 * Каждый badge показывает число юнитов в группе. Клик → recall выделения.
 */
import { computed } from 'vue';
import { MIN_GROUP, MAX_GROUP, type UseControlGroups } from '../composables/useControlGroups';

const props = defineProps<{
  ctrl: UseControlGroups;
}>();

const emit = defineEmits<{
  (e: 'recall', group: number): void;
}>();

const groups = computed(() => {
  const out: Array<{ n: number; count: number }> = [];
  for (let i = MIN_GROUP; i <= MAX_GROUP; i++) {
    out.push({ n: i, count: props.ctrl.groups[i]?.length ?? 0 });
  }
  return out;
});
</script>

<template>
  <div class="ctrl-groups">
    <button
      v-for="g in groups"
      :key="g.n"
      class="group-badge"
      :class="{ empty: g.count === 0 }"
      :title="`Control group ${g.n} (${g.count} units)`"
      @click="emit('recall', g.n)"
    >
      <span class="num">{{ g.n }}</span>
      <span v-if="g.count > 0" class="count">{{ g.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.ctrl-groups {
  display: flex;
  gap: 4px;
  pointer-events: auto;
}
.group-badge {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  background: rgba(20, 28, 40, 0.85);
  border: 1px solid rgba(120, 140, 170, 0.55);
  color: #cfe1ff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 11px;
  padding: 0;
}
.group-badge:hover { background: rgba(40, 60, 90, 0.95); }
.group-badge.empty { opacity: 0.45; }
.group-badge .num { font-weight: 700; }
.group-badge .count { font-size: 9px; opacity: 0.8; }
</style>
