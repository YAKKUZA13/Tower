<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import LoginForm from './components/LoginForm.vue';
import CoopLobby from './components/CoopLobby.vue';
import RtsLobby from './components/RtsLobby.vue';
// Игровой 3D-компонент грузится лениво (Babylon.js выносится в отдельный чанк).
const Game = defineAsyncComponent(() => import('./components/Game.vue'));
const RtsGame = defineAsyncComponent(() => import('./components/RtsGame.vue'));
import { useAuthStore } from './stores/auth-store';
import { useCoopStore } from './stores/coop-store';

const authStore = useAuthStore();
const coopStore = useCoopStore();
const { user, isAuthed } = storeToRefs(authStore);
const { phase: coopPhase } = storeToRefs(coopStore);

type View = 'lobby' | 'game' | 'rts-lobby' | 'rts-game';
const view = ref<View>('lobby');
const username = computed(() => user.value?.username || user.value?.login || '');
const rtsMapId = ref<string | undefined>(undefined);
const staticRtsBuild = import.meta.env.MODE === 'pages';

function handleAuthed(destination: 'coop' | 'rts' = 'coop'): void {
  view.value = destination === 'rts' ? 'rts-lobby' : 'lobby';
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

/** RtsLobby: игрок выбрал карту и нажал «Начать». */
function onStartRts(mapId: string): void {
  rtsMapId.value = mapId;
  view.value = 'rts-game';
}

/** RtsGame.vue: выход обратно в RTS-лобби. */
function onRtsBack(): void {
  view.value = 'rts-lobby';
}

// Если co-op фаза стала 'playing' (хост стартовал) — автоматически в Game.
watch(coopPhase, (p) => {
  if (p === 'playing' && view.value !== 'game') view.value = 'game';
  if (p === 'closed' && view.value === 'game') view.value = 'lobby';
});

onMounted(async () => {
  if (staticRtsBuild) {
    // GitHub Pages hosts an offline RTS showcase, without account/API restore.
    authStore.loginAsGuest('Demo commander');
    rtsMapId.value = new URLSearchParams(window.location.search).get('map') || 'rts-2p-crossroads';
    view.value = 'rts-game';
    return;
  }
  await authStore.restoreSession();
  const demo = new URLSearchParams(window.location.search).get('demo');
  if (demo === 'rts') {
    if (!authStore.isAuthed) authStore.loginAsGuest('Demo commander');
    rtsMapId.value = new URLSearchParams(window.location.search).get('map') || 'rts-2p-crossroads';
    view.value = 'rts-game';
  }
});
onBeforeUnmount(() => {
  coopStore.disconnect();
});
</script>


<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-left">
        <div class="app-brand">TOWER <span>/ ПЕРВЫЙ СПУСК</span></div>
      <div v-if="isAuthed" class="app-nav">
        <button v-if="!staticRtsBuild" class="nav-button" :class="{ active: view === 'lobby' }" @click="view='lobby'">Co-op лобби</button>
        <!-- TD-режим (Game.vue) скрыт: проект перешёл на RTS. Co-op сейчас использует
             тот же TD-рендер, но как отдельный multiplayer-трек; прямой «TD-игра» вход убран. -->
        <button class="nav-button" :class="{ active: view === 'rts-lobby' || view === 'rts-game' }" @click="view='rts-lobby'">RTS соло</button>
      </div>
      </div>
      <div v-if="isAuthed" class="app-header-right">
        <div class="user-meta">
          <span>{{ username }}</span>
          <span v-if="coopStore.sessionId" class="muted">· {{ coopStore.isHost ? 'хост' : 'гость' }}</span>
        </div>
        <button v-if="view === 'game' && coopPhase === 'playing'" class="btn ghost" @click="backToLobby">В лобби</button>
        <button v-if="!staticRtsBuild" class="btn ghost" @click="logout">Выйти</button>
      </div>
    </header>

    <div class="app-body">
      <LoginForm v-if="!isAuthed" @authed="handleAuthed" />
      <template v-else>
        <CoopLobby v-if="view==='lobby'" @start-game="onStartGame" />
        <Game v-else-if="view==='game'" @back-to-lobby="onBackToLobby" />
        <RtsLobby v-else-if="view==='rts-lobby'" @start="onStartRts" @back="view=staticRtsBuild ? 'rts-game' : 'lobby'" />
        <RtsGame v-else-if="view==='rts-game'" :map-id="rtsMapId" @back="onRtsBack" />
      </template>
    </div>
  </div>
</template>

<style>
html, body, #app {
  height: 100%;
  margin: 0;
  font-family: Georgia, 'Times New Roman', serif;
  background: #0d0e13;
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
  min-height: 46px;
  padding: 7px clamp(10px, 1.4vw, 20px);
  background: #111217;
  color: #cbb99f;
  border-bottom: 1px solid #54433c;
}
.app-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
.app-brand {
  color: #ddc9ad;
  font: 700 clamp(12px, 1vw, 15px) 'Lucida Console', Consolas, monospace;
  letter-spacing: .09em;
  text-shadow: 2px 2px 0 #07080b;
}
.app-brand span { color: #7f6c60; font-size: clamp(9px, .68vw, 11px); }
.app-nav {
  display: flex;
  gap: 3px;
  flex-wrap: wrap;
}
.nav-button {
  border: 1px solid #3f3532;
  background: #17181d;
  color: #83756b;
  padding: 8px 11px;
  border-radius: 0;
  font: 10px 'Lucida Console', Consolas, monospace;
  text-transform: uppercase;
}
.nav-button.active {
  background: #252026;
  color: #d5bfa3;
  border-color: #806757;
  box-shadow: inset 0 -2px #b45441;
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
  border-radius: 0;
  padding: 8px 12px;
  font-weight: 600;
}
.btn.ghost {
  background: #17181d;
  color: #b7a48e;
  border: 1px solid #4e403a;
}

@media (max-width: 760px) {
  .app-header { align-items: flex-start; }
  .app-header-right .user-meta { display: none; }
  .app-brand span { display: none; }
}
</style>
