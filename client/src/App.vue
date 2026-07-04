<script setup>
import { computed, onMounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import LoginForm from './components/LoginForm.vue';
import MapEditor from './components/MapEditor.vue';
import Play from './components/Play.vue';
import { useSessionSocket } from './composables/use-session-socket';
import { useAuthStore } from './stores/auth-store';
import { useGameSessionStore } from './stores/game-session-store';

const authStore = useAuthStore();
const sessionStore = useGameSessionStore();
const { user, isAuthed } = storeToRefs(authStore);
const { sessionId, role, roleLabel } = storeToRefs(sessionStore);
const view = ref('lobby'); // lobby | editor | play
const joiningId = ref('');
const characterName = ref('');
const username = computed(() => user.value?.username || user.value?.login || '');
const accountRoleLabel = computed(() => authStore.defaultRole === 'gm' ? 'Мастер' : 'Игрок');
const { status: wsStatus, connectSocket, closeSocket } = useSessionSocket({ sessionId, isAuthed });

function handleAuthed() {
  view.value = authStore.defaultRole === 'gm' ? 'lobby' : 'lobby';
}

async function logout() {
  closeSocket();
  sessionStore.clearSession();
  await authStore.logoutAccount();
  view.value = 'lobby';
}

async function hostSession() {
  await sessionStore.createGameSession();
  view.value = 'editor';
  connectSocket();
}

async function joinExisting() {
  const sid = joiningId.value.trim();
  if (!sid) return;
  const res = await sessionStore.joinGameSession(sid, characterName.value.trim());
  view.value = role.value === 'gm' ? 'editor' : 'play';
  joiningId.value = '';
  connectSocket();
}

async function refreshSession() {
  try {
    await sessionStore.refreshGameSession();
  } catch (e) {
    console.warn('session refresh failed', e);
  }
}

async function resetCurrentSession() {
  await sessionStore.resetCurrentSession();
  view.value = 'lobby';
  closeSocket();
}

onMounted(async () => {
  await authStore.restoreSession();
  if (sessionStore.sessionId) {
    await refreshSession();
    view.value = sessionStore.role === 'gm' ? 'editor' : 'play';
  }
});
</script>


<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-left">
        <div class="app-brand">Tower Defense</div>
        <div v-if="isAuthed && sessionId" class="app-nav">
          <button class="nav-button" :class="{ active: view === 'lobby' }" @click="view='lobby'">Лобби</button>
          <button v-if="role === 'gm'" class="nav-button" :class="{ active: view === 'editor' }" @click="view='editor'">Редактор карты</button>
          <button class="nav-button" :class="{ active: view === 'play' }" @click="view='play'">Игровой экран</button>
        </div>
      </div>
      <div v-if="isAuthed" class="app-header-right">
        <div class="user-meta">
          <span>{{ username }}</span>
          <span class="muted">({{ accountRoleLabel }})</span>
          <span v-if="roleLabel" class="muted">({{ roleLabel }})</span>
        </div>
        <div v-if="sessionId" class="muted">Сессия: {{ sessionId }}</div>
        <div class="muted">{{ wsStatus }}</div>
        <button class="btn ghost" @click="logout">Выйти</button>
      </div>
    </header>

    <div class="app-body">
      <LoginForm v-if="!isAuthed" @authed="handleAuthed" />
      <template v-else>
        <div v-if="view==='lobby'" class="lobby">
          <div v-if="authStore.defaultRole === 'gm'" class="lobby-card">
            <div class="card-title">Создать сессию (ведущий)</div>
            <div class="card-help">Создаёт новую игру, вы — ведущий.</div>
            <button class="btn primary" :disabled="sessionStore.isLoading" @click="hostSession">Создать сессию</button>
            <button v-if="sessionId && role==='gm'" class="btn danger" @click="resetCurrentSession">Сбросить сессию</button>
          </div>

          <div class="lobby-card">
            <div class="card-title">Присоединиться к сессии</div>
            <label class="field-label">ID сессии</label>
            <input v-model="joiningId" class="input" placeholder="введите ID сессии" />
            <label class="field-label">Имя персонажа</label>
            <input v-model="characterName" class="input" placeholder="необязательно" />
            <button class="btn primary" :disabled="sessionStore.isLoading" @click="joinExisting">Подключиться</button>
          </div>

          <div v-if="sessionId" class="lobby-card">
            <div class="card-title">Текущая сессия</div>
            <div>ID: {{ sessionId }}</div>
            <div>Роль: {{ roleLabel || 'неизвестно' }}</div>
            <button class="btn ghost" @click="refreshSession">Обновить</button>
          </div>
        </div>

        <MapEditor v-else-if="view==='editor'" />
        <Play v-else />
      </template>
    </div>
  </div>
</template>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: #0b1021;
}
button {
  cursor: pointer;
}
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
}
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #0f172a;
  color: #e2e8f0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.app-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.app-brand {
  font-weight: 700;
  letter-spacing: 0.2px;
}
.app-nav {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.nav-button {
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  color: #e2e8f0;
  padding: 6px 10px;
  border-radius: 8px;
}
.nav-button.active {
  background: rgba(59, 130, 246, 0.2);
  border-color: #3b82f6;
}
.app-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.user-meta {
  display: flex;
  gap: 6px;
  align-items: center;
}
.muted {
  opacity: 0.7;
}
.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.lobby {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
  padding: 16px;
}
.lobby-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #0f172a;
}
.card-title {
  font-weight: 700;
}
.card-help {
  color: #64748b;
  font-size: 13px;
}
.field-label {
  font-size: 12px;
  color: #475569;
}
.input {
  border: 1px solid #cbd5f5;
  border-radius: 8px;
  padding: 6px 8px;
  width: 100%;
}
.input.small {
  width: 80px;
}
.input.tiny {
  width: 60px;
}
.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 600;
}
.btn.primary {
  background: #2563eb;
  color: #fff;
}
.btn.ghost {
  background: #f1f5f9;
  color: #0f172a;
  border: 1px solid #e2e8f0;
}
.btn.danger {
  background: #dc2626;
  color: #fff;
}
</style>
