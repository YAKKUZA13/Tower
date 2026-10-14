<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useGameStore } from '../stores/game-store';
import RtsIcon from './RtsIcon.vue';

const emit = defineEmits<{ (e: 'start-wave'): void }>();
const store = useGameStore();
const { gold, lives, maxLives, waveLabel, status, canStartWave, waveEnemiesRemaining, enemiesAlive, timePhase, weatherLabel, rtsEnabled, resources } = storeToRefs(store);

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
      <RtsIcon name="gold" :size="17" /><span class="stat-copy"><span class="stat-label">Золото</span><span class="stat-value">{{ gold }}</span></span>
    </div>
    <template v-if="rtsEnabled">
      <div class="stat res">
        <RtsIcon name="wood" :size="17" /><span class="stat-copy"><span class="stat-label">Дерево</span><span class="stat-value">{{ resources.wood }}</span></span>
      </div>
      <div class="stat res">
        <RtsIcon name="stone" :size="17" /><span class="stat-copy"><span class="stat-label">Камень</span><span class="stat-value">{{ resources.stone }}</span></span>
      </div>
      <div class="stat res">
        <RtsIcon name="ore" :size="17" /><span class="stat-copy"><span class="stat-label">Руда</span><span class="stat-value">{{ resources.ore }}</span></span>
      </div>
    </template>
    <div class="stat lives">
      <RtsIcon name="home" :size="17" /><span class="stat-copy"><span class="stat-label">{{ rtsEnabled ? 'Ратуша' : 'Жизни' }}</span><span class="stat-value">{{ lives }}<span class="muted">/{{ maxLives }}</span></span></span>
    </div>
    <template v-if="!rtsEnabled">
      <div class="stat wave">
        <span class="stat-label">Волна</span>
        <span class="stat-value">{{ waveLabel }}</span>
      </div>
      <div class="stat status">
        <span class="stat-label">Статус</span>
        <span class="stat-value" :class="status">{{ statusLabel[status] }}</span>
      </div>
    </template>
    <div class="stat env">
      <RtsIcon name="spell" :size="15" /><span class="stat-copy"><span class="stat-label">Время суток</span><span class="stat-value">{{ timePhase }}</span></span>
    </div>
    <div class="stat env">
      <RtsIcon name="stone" :size="15" /><span class="stat-copy"><span class="stat-label">Погода</span><span class="stat-value">{{ weatherLabel }}</span></span>
    </div>
    <div v-if="!rtsEnabled && status === 'wave'" class="stat minor">
      <span class="stat-label">Осталось</span>
      <span class="stat-value">{{ waveEnemiesRemaining }} <span class="muted">({{ enemiesAlive }} на поле)</span></span>
    </div>
    <button v-if="!rtsEnabled" class="btn primary start" :disabled="!canStartWave" @click="emit('start-wave')">
      Старт волны
    </button>
  </div>
</template>

<style scoped>
.economy-bar {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(104px, 1fr);
  align-items: center;
  gap: 0;
  min-height: 58px;
  padding: 0 10px;
  border-bottom: 1px solid #5c4940;
  background: #131419;
  color: #cbb99f;
  overflow-x: auto;
  scrollbar-color: #5c4940 #131419;
  font-family: 'Lucida Console', Consolas, monospace;
}
.stat {
  display: grid;
  grid-template-columns: 19px auto;
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 43px;
  padding: 5px clamp(8px, 1vw, 14px);
  border-right: 1px solid #362e2c;
  color: #a98a73;
}
.stat-copy { display: flex; flex-direction: column; gap: 1px; }
.stat-label {
  font-size: clamp(9px, 0.66vw, 11px);
  color: #776b62;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.stat-value {
  font-size: clamp(14px, 1vw, 17px);
  font-weight: 800;
  color: #d9c8ad;
}
.stat.gold { color: #d1a258; }
.stat.gold .stat-value { color: #d1a258; }
.stat.lives .stat-value { color: #c96254; }
.stat.wave .stat-value { color: #6ea6cc; }
.stat.status .stat-value.won { color: #22c55e; }
.stat.status .stat-value.lost { color: #ef4444; }
.stat.env .stat-value { color: #a5a99d; font-size: clamp(12px, .9vw, 15px); }
.stat.res .stat-value { color: #9bb89a; font-size: clamp(14px, 1vw, 16px); }
.muted { color: #64748b; font-weight: 600; }
.minor .stat-value { font-size: 14px; color: #cbd5e1; }
.btn {
  border: 1px solid #b26c49;
  border-radius: 0;
  padding: 8px 14px;
  font-weight: 700;
  margin-left: auto;
}
.btn.primary { background: #7b3d2f; color: #f1ddbf; box-shadow: inset 0 0 0 2px #351b19; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

@media (max-width: 760px) {
  .economy-bar { grid-auto-columns: minmax(94px, 1fr); padding: 0; }
  .stat { padding-inline: 8px; }
}
</style>
