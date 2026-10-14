<script setup lang="ts">
/**
 * M8 RTS-solo lobby: выбор карты (2p / 3p / 4p) и старт соло-матча против AI.
 *
 * Не требует сети (всё локально). Карты берутся из shared/src/maps/rts-maps.ts.
 */
import { ref } from 'vue';
import { RTS_MAPS } from '@tower/shared';
import RtsIcon from './RtsIcon.vue';

const emit = defineEmits<{ (e: 'start', mapId: string): void; (e: 'back'): void }>();

const selectedMapId = ref<string>(String(RTS_MAPS[0]!.metadata!.name));

function modeLabel(mode: string | undefined): string {
  if (mode === '1v1') return '1 на 1 · против ИИ';
  if (mode === '1v1v1') return '1 на 1 на 1 · два ИИ';
  if (mode === '1v1v1v1') return 'четыре стороны · три ИИ';
  return mode ?? '';
}

function difficultyLabel(difficulty: string | undefined): string {
  return difficulty === 'hard' ? 'Тяжёлая' : difficulty === 'easy' ? 'Разведочная' : 'Средняя';
}

function start(): void {
  emit('start', selectedMapId.value);
}
</script>

<template>
  <div class="rts-lobby">
    <div class="lobby-head">
      <button class="btn ghost" @click="emit('back')">← Назад</button>
      <h2>RTS соло — выбор карты</h2>
    </div>

    <div class="map-grid">
      <button
        v-for="m in RTS_MAPS"
        :key="String(m.metadata!.name)"
        class="map-card"
        :class="{ active: selectedMapId === m.metadata!.name }"
        @click="selectedMapId = String(m.metadata!.name)"
      >
        <div class="map-title">{{ m.metadata!.title }}</div>
        <div class="map-id">{{ m.metadata!.name }}</div>
        <div class="map-meta">
          <span>{{ m.grid.cols }}×{{ m.grid.rows }}</span>
          <span>·</span>
          <span>{{ modeLabel(m.metadata!.mode as string | undefined) }}</span>
        </div>
        <div class="map-meta muted">{{ difficultyLabel(m.metadata!.difficulty as string | undefined) }}</div>
        <div class="map-stats">
          <span><RtsIcon name="home" :size="13" /> {{ m.playerStarts?.length ?? 0 }} базы</span>
          <span><RtsIcon name="ore" :size="13" /> {{ m.resourceNodes?.length ?? 0 }} узлов</span>
        </div>
      </button>
    </div>

    <div class="lobby-foot">
      <p class="hint">
        Цель: развить экономику (рабочие → ресурсы → казармы → армия),
        уничтожить вражеский оплот и не дать разрушить свою ратушу.
        AI каждые 30с шлёт волны атакующих юнитов.
      </p>
      <button class="btn primary big" @click="start">⚔ Начать битву</button>
    </div>
  </div>
</template>

<style scoped>
.rts-lobby {
  flex: 1;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: 100%;
  padding: clamp(18px, 3vw, 42px);
  gap: clamp(20px, 3vw, 36px);
  color: #cbb99f;
  background:
    radial-gradient(circle at 50% 0%, rgba(116, 72, 48, .12), transparent 42%),
    #0d0e13;
  overflow-y: auto;
}
.lobby-head {
  display: flex;
  align-items: center;
  gap: 18px;
  width: min(1240px, 100%);
  margin: 0 auto;
  border-bottom: 1px solid #4c3e39;
  padding-bottom: 16px;
}
.lobby-head h2 { margin: 0; color: #dfcdb4; font-size: clamp(22px, 2.2vw, 34px); font-weight: 700; }
.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: clamp(12px, 1.5vw, 20px);
  width: min(1240px, 100%);
  margin: 0 auto;
}
.map-card {
  position: relative;
  box-sizing: border-box;
  min-width: 0;
  text-align: left;
  padding: clamp(17px, 2vw, 24px);
  border-radius: 0;
  background: #14151a;
  border: 1px solid #403733;
  border-left: 3px solid #5b4b43;
  color: #cbb99f;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, transform .15s;
}
.map-card::after { content: ''; position: absolute; right: 7px; top: 7px; width: 14px; height: 14px; border-top: 1px solid #745743; border-right: 1px solid #745743; }
.map-card:hover { border-color: #806757; background: #19191e; transform: translateY(-2px); }
.map-card.active {
  border-color: #a06a48;
  border-left-color: #cc7b4c;
  background: linear-gradient(120deg, rgba(135, 72, 42, .22), #17171c 54%);
  box-shadow: inset 0 0 0 2px #090a0d, 5px 5px 0 rgba(0, 0, 0, .25);
}
.map-title { color: #ead7ba; font-size: clamp(19px, 1.5vw, 24px); font-weight: 700; }
.map-id { margin: 3px 0 12px; color: #746860; font: 10px 'Lucida Console', Consolas, monospace; text-transform: uppercase; }
.map-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 14px;
  color: #b6a48f;
}
.map-meta.muted { color: #776b62; font: 10px 'Lucida Console', Consolas, monospace; text-transform: uppercase; }
.map-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 15px;
  padding-top: 11px;
  border-top: 1px solid #302a29;
  color: #987f6d;
  font: 11px 'Lucida Console', Consolas, monospace;
}
.map-stats span { display: inline-flex; align-items: center; gap: 5px; }
.lobby-foot {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  width: min(820px, 100%);
  margin: 0 auto;
}
.hint {
  max-width: 760px;
  margin: 0;
  text-align: center;
  color: #928478;
  font-size: clamp(13px, 1vw, 15px);
  line-height: 1.6;
}
.btn {
  border-radius: 0;
  padding: 10px 16px;
  font-weight: 700;
  cursor: pointer;
}
.btn.ghost { background: #17181d; color: #bca88f; border: 1px solid #4e403a; }
.btn.primary { background: #7b3d2f; color: #f1ddbf; border: 1px solid #b26c49; box-shadow: inset 0 0 0 2px #351b19; }
.btn.primary:hover { background: #934a34; }
.btn.primary.big { padding: 13px 34px; font: 700 14px 'Lucida Console', Consolas, monospace; text-transform: uppercase; letter-spacing: .04em; }

@media (max-width: 620px) {
  .lobby-head { align-items: flex-start; flex-direction: column; }
  .lobby-head h2 { font-size: 24px; }
}
</style>
