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
  padding: 16px;
  color: #e5e7eb;
}
.lobby-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
  max-width: 920px;
  margin: 0 auto;
}
.card {
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.card.wide { grid-column: 1 / -1; }
.card-row { display: flex; justify-content: space-between; align-items: center; }
.card-title { font-weight: 800; font-size: 18px; }
.hint { color: #94a3b8; font-size: 13px; line-height: 1.45; }
.muted { color: #64748b; font-size: 12px; }
.error { color: #fca5a5; font-size: 13px; }
.divider {
  text-align: center;
  color: #475569;
  font-size: 12px;
  margin: 4px 0;
}
.block { display: flex; flex-direction: column; gap: 8px; }
.field-label { font-size: 12px; color: #94a3b8; font-weight: 600; }
.input {
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
}
.session-id {
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
}
.session-id code {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: #c4b5fd;
  word-break: break-all;
}
.status { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #64748b;
}
.dot[data-status='connected'] { background: #22c55e; }
.dot[data-status='connecting'], .dot[data-status='reconnecting'] { background: #f59e0b; }
.dot[data-status='error'] { background: #ef4444; }

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
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
  cursor: pointer;
  text-align: left;
}
.role-btn.active {
  border-color: #8b5cf6;
  background: rgba(139, 92, 246, 0.18);
}
.role-name { font-weight: 700; }
.role-hint { font-size: 11px; color: #94a3b8; }

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
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #e5e7eb;
  cursor: pointer;
  text-align: left;
}
.map-btn:disabled { cursor: default; opacity: 0.85; }
.map-btn.active {
  border-color: #22c55e;
  background: rgba(34, 197, 94, 0.16);
}
.map-name { font-weight: 800; }
.map-meta {
  display: flex;
  gap: 6px;
  font-size: 10px;
}
.map-diff {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.map-diff[data-diff='easy'] { background: rgba(34, 197, 94, 0.2); color: #86efac; }
.map-diff[data-diff='medium'] { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.map-diff[data-diff='hard'] { background: rgba(239, 68, 68, 0.2); color: #fca5a5; }
.map-rts {
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.2);
  color: #c4b5fd;
  letter-spacing: 0.5px;
}
.map-desc { font-size: 11px; color: #94a3b8; line-height: 1.4; }

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
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  font-size: 13px;
}
.player-list li.self { background: rgba(59, 130, 246, 0.12); }
.p-name { flex: 1; }
.badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}
.badge.host { background: rgba(245, 158, 11, 0.2); color: #fcd34d; }
.badge.ready.on { background: rgba(34, 197, 94, 0.2); color: #86efac; }

.actions { display: flex; gap: 10px; }
.btn {
  border: none;
  border-radius: 8px;
  padding: 9px 14px;
  font-weight: 700;
  cursor: pointer;
}
.btn.primary { background: #2563eb; color: #fff; }
.btn.primary:disabled { opacity: 0.45; cursor: not-allowed; }
.btn.ghost { background: rgba(255, 255, 255, 0.06); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.12); }
.btn.ghost.active { background: rgba(34, 197, 94, 0.2); color: #86efac; border-color: #22c55e; }
.btn.ghost.small { padding: 4px 10px; font-size: 12px; }

.perms { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
.perm {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  color: #64748b;
}
.perm.on { background: rgba(139, 92, 246, 0.2); color: #c4b5fd; }
</style>
