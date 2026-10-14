<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { BUILTIN_MAP_LIST, getBuiltinMapInfo } from '@tower/shared';
import type { CoopRole } from '@tower/shared';
import { useCoopStore } from '../stores/coop-store';
import { useAuthStore } from '../stores/auth-store';

const coopStore = useCoopStore();
const authStore = useAuthStore();
const { isHost, players, role, ready, status, sessionId, error, phase, canStart, rolePermissions, selectedMapId } = storeToRefs(coopStore);

const joiningId = ref('');
const emit = defineEmits<{ (e: 'start-game'): void }>();

const roleOptions: { role: CoopRole; label: string; hint: string }[] = [
  { role: 'free', label: 'Свободная', hint: 'Все действия: башни, стены, экономика, заклинания' },
  { role: 'builder', label: 'Строитель', hint: 'Башни и стены лабиринта' },
  { role: 'economist', label: 'Экономист', hint: 'Здания и юниты RTS' },
  { role: 'commander', label: 'Командир', hint: 'Заклинания командира' }
];

const selfUserId = computed(() => authStore.user?.userId || 'local');
const selfUsername = computed(() => authStore.user?.username || authStore.user?.login || '');
const currentMap = computed(() => getBuiltinMapInfo(selectedMapId.value));
const statusLabel = computed(() => {
  switch (status.value) {
    case 'connected': return 'подключено';
    case 'connecting': return 'подключение...';
    case 'reconnecting': return 'переподключение...';
    case 'error': return 'ошибка сети';
    default: return 'не подключено';
  }
});

async function hostRoom(): Promise<void> {
  await coopStore.createRoom(selfUserId.value, selfUsername.value);
}

async function joinRoom(): Promise<void> {
  const sid = joiningId.value.trim();
  if (!sid) return;
  try {
    await coopStore.joinRoom(sid, selfUserId.value, selfUsername.value);
    joiningId.value = '';
  } catch {
    /* ошибка уже в store.error */
  }
}

function copySessionId(): void {
  if (!sessionId.value) return;
  navigator.clipboard?.writeText(sessionId.value).catch(() => { /* ignore */ });
}

function pickRole(r: CoopRole): void {
  coopStore.setRole(r);
}

function pickMap(id: string): void {
  coopStore.setSelectedMap(id);
}

function toggleReady(): void {
  coopStore.setReady(!ready.value);
}

function leave(): void {
  coopStore.leaveRoom();
}

function start(): void {
  if (!canStart.value) return;
  coopStore.startGame();
  emit('start-game');
}

// Если хост уже стартовал (фаза playing) — тоже эмитим start-game родителю.
defineExpose({ phase });
</script>

<template>
  <div class="coop-lobby">
    <div class="lobby-grid">
      <!-- Создание/присоединение -->
      <section v-if="phase === 'idle'" class="card">
        <div class="card-title">Co-op игра</div>
        <p class="hint">Создайте комнату (вы — хост) или подключитесь к существующей по ID.</p>

        <div class="block">
          <button class="btn primary" @click="hostRoom">Создать комнату (хост)</button>
        </div>

        <div class="divider">или</div>

        <div class="block">
          <label class="field-label">ID комнаты</label>
          <input v-model="joiningId" class="input" placeholder="вставьте ID комнаты" />
          <button class="btn ghost" :disabled="!joiningId.trim()" @click="joinRoom">Подключиться</button>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
      </section>

      <!-- Лобби комнаты -->
      <section v-else class="card wide">
        <div class="card-row">
          <div class="card-title">Комната</div>
          <button class="btn ghost small" @click="leave">Выйти</button>
        </div>

        <div class="session-id" @click="copySessionId" title="Нажмите, чтобы скопировать">
          <span class="muted">ID комнаты (передайте друзьям):</span>
          <code>{{ sessionId }}</code>
        </div>

        <div class="status">
          <span class="dot" :data-status="status"></span>
          <span>{{ statusLabel }}</span>
          <span class="muted">· вы: {{ isHost ? 'хост' : 'гость' }}</span>
        </div>

        <div v-if="error" class="error">{{ error }}</div>

        <!-- Выбор карты (только хост) -->
        <div class="block">
          <div class="field-label">Карта <span v-if="!isHost" class="muted">(выбрал хост)</span></div>
          <div class="map-grid">
            <button
              v-for="m in BUILTIN_MAP_LIST"
              :key="m.id"
              class="map-btn"
              :class="{ active: selectedMapId === m.id }"
              :disabled="!isHost"
              @click="pickMap(m.id)"
            >
              <span class="map-name">{{ m.title }}</span>
              <span class="map-meta">
                <span class="map-diff" :data-diff="m.difficulty">{{ m.difficulty }}</span>
                <span v-if="m.hasRts" class="map-rts">RTS</span>
              </span>
              <span class="map-desc">{{ m.description }}</span>
            </button>
          </div>
          <p class="hint">Текущая карта: <strong>{{ currentMap.title }}</strong> · {{ currentMap.difficulty }}{{ currentMap.hasRts ? ' · RTS' : '' }}</p>
        </div>

        <!-- Выбор роли -->
        <div class="block">
          <div class="field-label">Ваша роль</div>
          <div class="role-grid">
            <button
              v-for="r in roleOptions"
              :key="r.role"
              class="role-btn"
              :class="{ active: role === r.role }"
              :title="r.hint"
              @click="pickRole(r.role)"
            >
              <span class="role-name">{{ r.label }}</span>
              <span class="role-hint">{{ r.hint }}</span>
            </button>
          </div>
        </div>

        <!-- Список игроков -->
        <div class="block">
          <div class="field-label">Игроки ({{ players.length }}/4)</div>
          <ul class="player-list">
            <li v-for="p in players" :key="p.userId" :class="{ self: p.userId === selfUserId }">
              <span class="p-name">{{ p.username }}{{ p.userId === selfUserId ? ' (вы)' : '' }}</span>
              <span v-if="p.isHost" class="badge host">хост</span>
              <span class="badge role">{{ p.role }}</span>
              <span class="badge ready" :class="{ on: p.ready }">{{ p.ready ? 'готов' : 'не готов' }}</span>
            </li>
          </ul>
        </div>

        <!-- Ready / Start -->
        <div class="actions">
          <button class="btn ghost" :class="{ active: ready }" @click="toggleReady">
            {{ ready ? 'Готов' : 'Не готов' }}
          </button>
          <button v-if="isHost" class="btn primary" :disabled="!canStart" @click="start">
            Старт игры
          </button>
        </div>
        <p v-if="isHost && !canStart" class="hint">Все игроки должны нажать «Готов».</p>
        <p v-if="!isHost" class="hint">Дождитесь, пока хост начнёт игру.</p>

        <div class="perms">
          <span class="muted">Разрешено ролью:</span>
          <span class="perm" :class="{ on: rolePermissions.canBuildTowers }">башни</span>
          <span class="perm" :class="{ on: rolePermissions.canBuildWalls }">стены</span>
          <span class="perm" :class="{ on: rolePermissions.canEconomy }">экономика</span>
          <span class="perm" :class="{ on: rolePermissions.canCastSpells }">заклинания</span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.coop-lobby {
  box-sizing: border-box;
  flex: 1;
  width: 100%;
  padding: clamp(20px, 4vw, 56px);
  color: #cbb99f;
  background: radial-gradient(circle at 50% 0%, rgba(116, 72, 48, .1), transparent 42%), #0d0e13;
  overflow-y: auto;
}
.lobby-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
  gap: 18px;
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
}
.card {
  background: #14151a;
  border: 1px solid #403733;
  border-left: 3px solid #6f5140;
  border-radius: 0;
  padding: clamp(18px, 2.5vw, 28px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: inset 0 0 0 2px #090a0d, 6px 6px 0 rgba(0, 0, 0, .2);
}
.card.wide { grid-column: 1 / -1; }
.card-row { display: flex; justify-content: space-between; align-items: center; }
.card-title { color: #ead7ba; font-weight: 700; font-size: clamp(20px, 1.8vw, 26px); }
.hint { color: #928478; font-size: 14px; line-height: 1.55; }
.muted { color: #71665e; font-size: 12px; }
.error { color: #d77868; font-size: 13px; }
.divider {
  text-align: center;
  color: #66574f;
  font-size: 12px;
  margin: 4px 0;
}
.block { display: flex; flex-direction: column; gap: 8px; }
.field-label { color: #a18f7c; font: 10px 'Lucida Console', Consolas, monospace; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
.input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #4e403a;
  border-radius: 0;
  padding: 11px 12px;
  background: #18191e;
  color: #dfcdb4;
  font-size: 14px;
}
.input:focus { outline: 1px solid #9f7256; border-color: #9f7256; }
.session-id {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: #18191e;
  border: 1px dashed #5d4b42;
  border-radius: 0;
  padding: 10px 12px;
  cursor: pointer;
}
.session-id code {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: #c99a72;
  word-break: break-all;
}
.status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #64748b;
}
.dot[data-status='connected'] { background: #6fa17e; }
.dot[data-status='connecting'], .dot[data-status='reconnecting'] { background: #c59352; }
.dot[data-status='error'] { background: #b84b3e; }

.role-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}
.role-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px;
  border-radius: 0;
  border: 1px solid #453a36;
  background: #18191e;
  color: #cbb99f;
  cursor: pointer;
  text-align: left;
}
.role-btn.active {
  border-color: #a16b4c;
  background: rgba(126, 70, 43, 0.22);
}
.role-name { font-weight: 700; }
.role-hint { font-size: 11px; color: #81746a; }

.map-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
.map-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px;
  border-radius: 0;
  border: 1px solid #453a36;
  background: #18191e;
  color: #cbb99f;
  cursor: pointer;
  text-align: left;
}
.map-btn:disabled { cursor: default; opacity: 0.85; }
.map-btn.active {
  border-color: #5f8d70;
  background: rgba(67, 105, 82, 0.2);
}
.map-name { font-weight: 800; }
.map-meta {
  display: flex;
  gap: 6px;
  font-size: 10px;
}
.map-diff {
  padding: 2px 6px;
  border-radius: 0;
  background: #242126;
  color: #aa9987;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.map-diff[data-diff='easy'] { background: rgba(34, 197, 94, 0.2); color: #86efac; }
.map-diff[data-diff='medium'] { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.map-diff[data-diff='hard'] { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
.map-rts {
  padding: 2px 6px;
  border-radius: 0;
  background: rgba(135, 72, 42, .24);
  color: #d2a17d;
  letter-spacing: 0.5px;
}
.map-desc { font-size: 11px; color: #81746a; line-height: 1.4; }

.player-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.player-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 0;
  background: #18191e;
  font-size: 13px;
}
.player-list li.self { background: rgba(68, 111, 87, .18); }
.p-name { flex: 1; }
.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 0;
  background: #242126;
  color: #b5a28d;
}
.badge.host { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.badge.ready.on { background: rgba(34, 197, 94, 0.2); color: #86efac; }

.actions { display: flex; gap: 10px; }
.btn {
  border-radius: 0;
  padding: 11px 16px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary { background: #7b3d2f; color: #f1ddbf; border: 1px solid #b26c49; box-shadow: inset 0 0 0 2px #351b19; }
.btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.ghost { background: #1a1b20; color: #bba891; border: 1px solid #4e403a; }
.btn.ghost.active { background: rgba(67, 105, 82, .22); color: #96bea1; border-color: #5f8d70; }
.btn.ghost.small { padding: 4px 10px; font-size: 12px; }

.perms { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.perm {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #64748b;
}
.perm.on { background: rgba(135, 72, 42, .24); color: #d2a17d; }

@media (max-width: 620px) {
  .role-grid { grid-template-columns: 1fr; }
  .actions { flex-direction: column; }
  .actions .btn { width: 100%; }
}
</style>
