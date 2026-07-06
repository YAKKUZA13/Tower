<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import LoginForm from './components/LoginForm.vue';
import CoopLobby from './components/CoopLobby.vue';
// Игровой 3D-компонент грузится лениво (Babylon.js выносится в отдельный чанк).
const Game = defineAsyncComponent(() => import('./components/Game.vue'));
import { useAuthStore } from './stores/auth-store';
import { useCoopStore } from './stores/coop-store';

const authStore = useAuthStore();
const coopStore = useCoopStore();
const { user, isAuthed } = storeToRefs(authStore);
const { phase: coopPhase } = storeToRefs(coopStore);

type View = 'lobby' | 'game';
const view = ref<View>('lobby');
const username = computed(() => user.value?.username || user.value?.login || '');

function handleAuthed(): void {
  view.value = 'lobby';
}

async function logout(): Promise<void> {
  coopStore.leaveRoom();
  await authStore.logoutAccount();
  view.value = 'lobby';
}

/** CoopLobby: хост нажал «Старт» → перейти в игру (co-op). */
function onStartGame(): void {
  view.value = 'game';
}

/** Возврат из игры в лобби. */
function backToLobby(): void {
  coopStore.endGame();
  view.value = 'lobby';
}

/** Game.vue: гость просит вернуться в лобби (например, после отключения хоста). */
function onBackToLobby(): void {
  coopStore.leaveRoom();
  view.value = 'lobby';
}

// Если co-op фаза стала 'playing' (хост стартовал) — автоматически в Game.
watch(coopPhase, (p) => {
  if (p === 'playing' && view.value !== 'game') view.value = 'game';
  if (p === 'closed' && view.value === 'game') view.value = 'lobby';
});

onMounted(async () => {
  await authStore.restoreSession();
});
onBeforeUnmount(() => {
  coopStore.disconnect();
});
</script>


<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-left">
        <div class="app-brand">Tower Defense</div>
        <div v-if="isAuthed" class="app-nav">
          <button class="nav-button" :class="{ active: view === 'lobby' }" @click="view='lobby'">Co-op лобби</button>
          <button class="nav-button" :class="{ active: view === 'game' }" @click="view='game'">
            {{ coopStore.sessionId && coopPhase === 'playing' ? 'Игра (co-op)' : 'Одиночная игра' }}
          </button>
        </div>
      </div>
      <div v-if="isAuthed" class="app-header-right">
        <div class="user-meta">
          <span>{{ username }}</span>
          <span v-if="coopStore.sessionId" class="muted">· {{ coopStore.isHost ? 'хост' : 'гость' }}</span>
        </div>
        <button v-if="view === 'game' && coopPhase === 'playing'" class="btn ghost" @click="backToLobby">В лобби</button>
        <button class="btn ghost" @click="logout">Выйти</button>
      </div>
    </header>

    <div class="app-body">
      <LoginForm v-if="!isAuthed" @authed="handleAuthed" />
      <template v-else>
        <CoopLobby v-if="view==='lobby'" @start-game="onStartGame" />
        <Game v-else @back-to-lobby="onBackToLobby" />
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
.btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 600;
}
.btn.ghost {
  background: #f1f5f9;
  color: #0f172a;
  border: 1px solid #e2e8f0;
}
</style>
