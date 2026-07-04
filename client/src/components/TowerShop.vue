<script setup lang="ts">
import type { TowerType } from '@tower/shared';
import { towerTypeColor, towerAccentColor } from '../babylon/colors';

defineProps<{
  towers: TowerType[];
  selectedTypeId: string | null;
  sellMode: boolean;
  gold: number;
}>();

const emit = defineEmits<{
  (e: 'select', typeId: string): void;
  (e: 'sell-mode', enabled: boolean): void;
}>();

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}
</script>

<template>
  <div class="tower-shop">
    <div class="shop-title">Башни</div>
    <button
      v-for="t in towers"
      :key="t.id"
      class="shop-card"
      :class="{ active: !sellMode && selectedTypeId === t.id, disabled: gold < t.cost }"
      :disabled="gold < t.cost"
      @click="emit('sell-mode', false); emit('select', t.id)"
    >
      <div class="card-head">
        <svg class="card-icon" viewBox="0 0 16 16" :style="{ color: rgb(towerTypeColor(t.id)) }" aria-hidden="true">
          <template v-if="t.id === 'arrow'">
            <g fill="currentColor">
              <rect x="3" y="11" width="2" height="4" />
              <rect x="11" y="11" width="2" height="4" />
              <rect x="2" y="8" width="12" height="3" />
              <polygon points="8,2 13,8 3,8" />
            </g>
            <rect :fill="rgb(towerAccentColor(t.id))" x="7.4" y="3.2" width="1.2" height="1.6" />
          </template>
          <template v-else-if="t.id === 'cannon'">
            <g fill="currentColor">
              <rect x="3" y="9" width="10" height="6" />
              <rect x="2" y="8" width="12" height="2" />
              <rect x="10" y="6" width="6" height="3" />
            </g>
            <rect :fill="rgb(towerAccentColor(t.id))" x="15" y="6.6" width="1" height="1.4" />
          </template>
          <template v-else-if="t.id === 'arcane'">
            <g fill="currentColor">
              <rect x="4" y="11" width="8" height="4" />
              <polygon points="8,2 12,7 8,11 4,7" />
            </g>
            <rect :fill="rgb(towerAccentColor(t.id))" x="7" y="5" width="2" height="2" />
          </template>
          <template v-else-if="t.id === 'ice'">
            <g fill="currentColor">
              <rect x="4" y="12" width="8" height="3" />
              <polygon points="8,2 12,8 8,14 4,8" />
              <rect x="2" y="9" width="2" height="3" />
              <rect x="12" y="9" width="2" height="3" />
            </g>
            <rect :fill="rgb(towerAccentColor(t.id))" x="7" y="6" width="2" height="2" />
          </template>
          <template v-else>
            <g fill="currentColor"><rect x="4" y="6" width="8" height="9" /></g>
          </template>
        </svg>
        <span class="card-name">{{ t.name }}</span>
      </div>
      <div class="card-meta">{{ t.category }} · урон {{ t.damage }} · скор. {{ t.fireRate.toFixed(1) }}/с</div>
      <div class="card-meta">радиус {{ t.range.toFixed(1) }} · {{ t.projectileType }}</div>
      <div class="card-cost">{{ t.cost }}g</div>
      <div class="card-desc">{{ t.description }}</div>
    </button>

    <button class="sell-toggle" :class="{ active: sellMode }" @click="emit('sell-mode', !sellMode)">
      {{ sellMode ? 'Режим продажи активен' : 'Продать башню' }}
    </button>
  </div>
</template>

<style scoped>
.tower-shop {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: auto;
}
.shop-title {
  font-weight: 800;
  color: #f8fafc;
}
.shop-card {
  text-align: left;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
  padding: 10px;
  cursor: pointer;
}
.shop-card.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.18);
}
.shop-card.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-icon {
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.6));
}
.card-name { font-weight: 800; }
.card-meta {
  margin-top: 4px;
  color: #94a3b8;
  font-size: 12px;
}
.card-cost {
  margin-top: 4px;
  color: #fbbf24;
  font-weight: 800;
  font-size: 13px;
}
.card-desc {
  margin-top: 6px;
  color: #cbd5e1;
  font-size: 12px;
  line-height: 1.35;
}
.sell-toggle {
  margin-top: 6px;
  border: 1px solid rgba(239, 68, 68, 0.5);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  border-radius: 10px;
  padding: 9px;
  font-weight: 700;
  cursor: pointer;
}
.sell-toggle.active {
  background: rgba(239, 68, 68, 0.35);
  color: #fff;
}
</style>
