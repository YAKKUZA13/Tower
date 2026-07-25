<script setup lang="ts">
/**
 * M8.2 — Selection box overlay.
 * Прямоугольник-оверлей над canvas; рисуется при drag (mouse-down → move → up).
 * Координаты в CSS-pixels (canvas bounding rect).
 */
import { ref } from 'vue';

const props = defineProps<{
  /** Активен ли drag (родитель контролирует pointer-state). */
  active: boolean;
  start: { x: number; y: number } | null;
  current: { x: number; y: number } | null;
}>();

const rectStyle = ref<Record<string, string>>({});

function computeStyle(): Record<string, string> {
  if (!props.active || !props.start || !props.current) return { display: 'none' };
  const x = Math.min(props.start.x, props.current.x);
  const y = Math.min(props.start.y, props.current.y);
  const w = Math.abs(props.current.x - props.start.x);
  const h = Math.abs(props.current.y - props.start.y);
  return {
    display: w > 2 || h > 2 ? 'block' : 'none',
    left: `${x}px`,
    top: `${y}px`,
    width: `${w}px`,
    height: `${h}px`
  };
}
</script>

<template>
  <div class="selection-box" :style="computeStyle()" />
</template>

<style scoped>
.selection-box {
  position: absolute;
  pointer-events: none;
  background: rgba(80, 180, 255, 0.12);
  border: 1px solid rgba(120, 200, 255, 0.85);
  z-index: 7;
}
</style>
