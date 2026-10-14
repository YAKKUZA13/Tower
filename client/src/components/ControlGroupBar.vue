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
  position: absolute;
  top: 140px;
  left: 14px;
  z-index: 6;
  display: flex;
  gap: 3px;
  padding: 4px;
  background: rgba(13, 14, 18, 0.86);
  border: 1px solid rgba(159, 125, 104, 0.28);
  pointer-events: auto;
}
.group-badge {
  width: 30px;
  height: 30px;
  border-radius: 0;
  background: #17181d;
  border: 1px solid #4c403a;
  color: #d7c3a7;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font: 11px 'Lucida Console', Consolas, monospace;
  padding: 0;
}
.group-badge:hover { background: #252026; border-color: #9f7d68; }
.group-badge.empty { opacity: 0.35; }
.group-badge .num { font-weight: 700; }
.group-badge .count { font-size: 9px; color: #83c7a3; }

@media (max-width: 1180px) {
  .ctrl-groups { top: 136px; left: 12px; }
  .group-badge { width: 27px; height: 27px; }
}

@media (max-width: 820px) {
  .ctrl-groups { top: auto; bottom: 124px; }
  .group-badge.empty { display: none; }
}
</style>
