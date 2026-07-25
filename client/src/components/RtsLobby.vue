<script setup lang="ts">
/**
 * M8 RTS-solo lobby: выбор карты (2p / 3p / 4p) и старт соло-матча против AI.
 *
 * Не требует сети (всё локально). Карты берутся из shared/src/maps/rts-maps.ts.
 */
import { ref } from 'vue';
import { RTS_MAPS } from '@tower/shared';

const emit = defineEmits<{ (e: 'start', mapId: string): void; (e: 'back'): void }>();

const selectedMapId = ref<string>(String(RTS_MAPS[0]!.metadata!.name));

function modeLabel(mode: string | undefined): string {
  if (mode === '1v1') return '1v1 (vs AI)';
  if (mode === '1v1v1') return '1v1v1 (vs 2 AI)';
  if (mode === '1v1v1v1') return '1v1v1v1 (vs 3 AI)';
  return mode ?? '';
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
        <div class="map-meta muted">{{ (m.metadata!.difficulty as string) ?? 'medium' }}</div>
        <div class="map-stats">
          <span>🏠 {{ m.playerStarts?.length ?? 0 }} базы</span>
          <span>⛏ {{ m.resourceNodes?.length ?? 0 }} узлов</span>
        </div>
      </button>
    </div>

    <div class="lobby-foot">
      <p class="hint">
        Цель: развить экономику (workers → ресурсы → Barracks → армия),
        уничтожить вражеский оплот и не дать разрушить свой Town Hall.
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
  padding: 24px;
  gap: 18px;
  color: #e5e7eb;
  background: #0b1021;
  overflow-y: auto;
}
.lobby-head {
  display: flex;
  align-items: center;
  gap: 16px;
}
.lobby-head h2 { margin: 0; font-weight: 800; }
.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}
.map-card {
  text-align: left;
  padding: 16px;
  border-radius: 12px;
  background: #0f172a;
  border: 1px solid rgba(120, 140, 170, 0.35);
  color: #e5e7eb;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.map-card:hover { border-color: rgba(168, 85, 247, 0.6); }
.map-card.active {
  border-color: #a855f7;
  background: rgba(168, 85, 247, 0.12);
  box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.25);
}
.map-title { font-size: 18px; font-weight: 800; }
.map-id { font-size: 11px; color: #94a3b8; margin-bottom: 6px; }
.map-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  color: #cbd5e1;
}
.map-meta.muted { color: #94a3b8; font-size: 11px; text-transform: capitalize; }
.map-stats {
  display: flex;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
}
.lobby-foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  margin-top: 8px;
}
.hint {
  max-width: 600px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.5;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn.ghost { background: #1e293b; color: #e5e7eb; border: 1px solid rgba(255,255,255,0.12); }
.btn.primary { background: #2563eb; color: #fff; }
.btn.primary.big { padding: 12px 28px; font-size: 16px; }
</style>
