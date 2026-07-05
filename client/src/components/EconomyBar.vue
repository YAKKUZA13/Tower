<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useGameStore } from '../stores/game-store';

const emit = defineEmits<{ (e: 'start-wave'): void }>();
const store = useGameStore();
const { gold, lives, maxLives, waveLabel, status, canStartWave, waveEnemiesRemaining, enemiesAlive, timePhase, weatherLabel, rtsEnabled, resources, resourcesLabel } = storeToRefs(store);

const statusLabel: Record<string, string> = {
  prep: 'Подготовка',
  wave: 'Волна идёт',
  draft: 'Драфт',
  won: 'Победа',
  lost: 'Поражение'
};
</script>

<template>
  <div class="economy-bar">
    <div class="stat gold">
      <span class="stat-label">Золото</span>
      <span class="stat-value">{{ gold }}</span>
    </div>
    <template v-if="rtsEnabled">
      <div class="stat res">
        <span class="stat-label">Дерево</span>
        <span class="stat-value">{{ resources.wood }}</span>
      </div>
      <div class="stat res">
        <span class="stat-label">Камень</span>
        <span class="stat-value">{{ resources.stone }}</span>
      </div>
      <div class="stat res">
        <span class="stat-label">Руда</span>
        <span class="stat-value">{{ resources.ore }}</span>
      </div>
    </template>
    <div class="stat lives">
      <span class="stat-label">Жизни</span>
      <span class="stat-value">{{ lives }}<span class="muted">/{{ maxLives }}</span></span>
    </div>
    <div class="stat wave">
      <span class="stat-label">Волна</span>
      <span class="stat-value">{{ waveLabel }}</span>
    </div>
    <div class="stat status">
      <span class="stat-label">Статус</span>
      <span class="stat-value" :class="status">{{ statusLabel[status] }}</span>
    </div>
    <div class="stat env">
      <span class="stat-label">Время суток</span>
      <span class="stat-value">{{ timePhase }}</span>
    </div>
    <div class="stat env">
      <span class="stat-label">Погода</span>
      <span class="stat-value">{{ weatherLabel }}</span>
    </div>
    <div v-if="status === 'wave'" class="stat minor">
      <span class="stat-label">Осталось</span>
      <span class="stat-value">{{ waveEnemiesRemaining }} <span class="muted">({{ enemiesAlive }} на поле)</span></span>
    </div>
    <button class="btn primary start" :disabled="!canStartWave" @click="emit('start-wave')">
      Старт волны
    </button>
  </div>
</template>

<style scoped>
.economy-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(15, 23, 42, 0.96);
  color: #e5e7eb;
  flex-wrap: wrap;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 72px;
}
.stat-label {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.stat-value {
  font-size: 18px;
  font-weight: 800;
  color: #f8fafc;
}
.stat.gold .stat-value { color: #fbbf24; }
.stat.lives .stat-value { color: #f87171; }
.stat.wave .stat-value { color: #60a5fa; }
.stat.status .stat-value.won { color: #22c55e; }
.stat.status .stat-value.lost { color: #ef4444; }
.stat.env .stat-value { color: #94a3b8; font-size: 15px; }
.stat.res .stat-value { color: #86efac; font-size: 15px; }
.muted { color: #64748b; font-weight: 600; }
.minor .stat-value { font-size: 14px; color: #cbd5e1; }
.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-weight: 700;
  margin-left: auto;
}
.btn.primary { background: #2563eb; color: #fff; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
