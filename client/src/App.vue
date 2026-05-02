<script setup>
import { ref, computed, watch } from 'vue';
import LoginForm from './components/LoginForm.vue';
import MapEditor from './components/MapEditor.vue';
import Play from './components/Play.vue';
import { createSession, joinSession, getSession, resetSession } from './services/api.js';
import { connectWS } from './services/ws.js';

const username = ref(localStorage.getItem('username') || '');
const authToken = ref(localStorage.getItem('authToken') || localStorage.getItem('apiKey') || '');
const sessionId = ref(localStorage.getItem('sessionId') || '');
const role = ref(localStorage.getItem('role') || '');
const view = ref('lobby'); // lobby | editor | play
const wsStatus = ref('');
const joiningId = ref('');
const characterName = ref('');
const isAuthed = computed(() => !!username.value && !!authToken.value);
const roleLabel = computed(() => {
  if (role.value === 'gm') return 'Ведущий';
  if (role.value === 'player') return 'Игрок';
  return role.value;
});
let wsConn = null;
const chatInput = ref('');
const chatLog = ref([]);
const diceSides = ref(20);
const diceCount = ref(1);
const turnOrder = ref([]);
const turnCurrent = ref(0);

function handleAuthed({ username: u, token: k }) {
  username.value = u;
  authToken.value = k;
  localStorage.setItem('username', u);
  if (k) {
    localStorage.setItem('authToken', k);
    localStorage.setItem('apiKey', k);
  }
}

function logout() {
  localStorage.removeItem('username');
  localStorage.removeItem('authToken');
  localStorage.removeItem('apiKey');
  localStorage.removeItem('sessionId');
  localStorage.removeItem('role');
  username.value = '';
  authToken.value = '';
  sessionId.value = '';
  role.value = '';
  view.value = 'lobby';
  wsStatus.value = '';
  if (wsConn) { wsConn.close(); wsConn = null; }
}

async function hostSession() {
  const res = await createSession();
  sessionId.value = res.sessionId;
  role.value = res.role || 'gm';
  localStorage.setItem('sessionId', sessionId.value);
  localStorage.setItem('role', role.value);
  view.value = 'editor';
  connectSocket();
}

async function joinExisting() {
  const sid = joiningId.value.trim();
  if (!sid) return;
  const res = await joinSession(sid, characterName.value.trim());
  sessionId.value = res.sessionId;
  role.value = res.role || 'player';
  localStorage.setItem('sessionId', sessionId.value);
  localStorage.setItem('role', role.value);
  view.value = role.value === 'gm' ? 'editor' : 'play';
  connectSocket();
}

async function refreshSession() {
  if (!sessionId.value) return;
  try {
    const res = await getSession(sessionId.value);
    if (res && res.sessionId) {
      role.value = res.role || role.value;
      localStorage.setItem('role', role.value);
    }
  } catch (e) {
    console.warn('session refresh failed', e);
  }
}

async function resetCurrentSession() {
  if (!sessionId.value) return;
  await resetSession(sessionId.value);
  sessionId.value = '';
  role.value = '';
  localStorage.removeItem('sessionId');
  localStorage.removeItem('role');
  view.value = 'lobby';
  if (wsConn) { wsConn.close(); wsConn = null; }
}

function connectSocket() {
  if (!sessionId.value || !isAuthed.value) return;
  if (wsConn) { wsConn.close(); wsConn = null; }
  wsStatus.value = 'connecting...';
  wsConn = connectWS({ sessionId: sessionId.value });
  wsConn.on('open', () => {
    wsConn.send({ type: 'request_state' });
  });
  wsConn.on('welcome', (msg) => {
    wsStatus.value = `ws: ${msg.role || ''}`;
  });
  wsConn.on('map_updated', () => {
    wsStatus.value = 'map updated (ws)';
    setTimeout(() => { wsStatus.value = ''; }, 1500);
  });
  wsConn.on('pong', () => { wsStatus.value = 'ws pong'; });
  wsConn.on('chat', (msg) => {
    chatLog.value = [...chatLog.value.slice(-30), msg];
  });
  wsConn.on('dice_roll', (msg) => {
    chatLog.value = [...chatLog.value.slice(-30), { type: 'dice', from: msg.from, text: `d${msg.sides} x${msg.count}: ${msg.results.join(',')}` }];
  });
  wsConn.on('turn_update', (msg) => {
    turnOrder.value = msg?.turn?.order || [];
    turnCurrent.value = msg?.turn?.current || 0;
  });
  wsConn.on('state', (msg) => {
    turnOrder.value = msg?.turn?.order || [];
    turnCurrent.value = msg?.turn?.current || 0;
  });
}

watch(sessionId, () => connectSocket());
watch(isAuthed, (val) => { if (val && sessionId.value) connectSocket(); });

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  wsConn?.send({ type: 'chat_send', text });
  chatInput.value = '';
}

function sendDice() {
  wsConn?.send({ type: 'dice_roll', sides: diceSides.value, count: diceCount.value });
}

function nextTurn() {
  wsConn?.send({ type: 'turn_next' });
}

function setTurnOrder() {
  const order = prompt('Введите порядок ходов через запятую', turnOrder.value.join(','));
  if (order !== null) {
    const arr = order.split(',').map(x => x.trim()).filter(Boolean);
    wsConn?.send({ type: 'turn_set', order: arr });
  }
}

function requestState() {
  wsConn?.send({ type: 'request_state' });
}
</script>


<template>
  <div class="app">
    <header class="app-header">
      <div class="app-header-left">
        <div class="app-brand">D&D Tabletop (LAN)</div>
        <div v-if="isAuthed && sessionId" class="app-nav">
          <button class="nav-button" :class="{ active: view === 'lobby' }" @click="view='lobby'">Лобби</button>
          <button class="nav-button" :class="{ active: view === 'editor' }" @click="view='editor'">Редактор карты</button>
          <button class="nav-button" :class="{ active: view === 'play' }" @click="view='play'">Игровой экран</button>
        </div>
      </div>
      <div v-if="isAuthed" class="app-header-right">
        <div class="user-meta">
          <span>{{ username }}</span>
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
        <section v-if="sessionId" class="session-tools">
          <div class="tool-card">
            <div class="tool-title">Чат</div>
            <div class="chat-log">
              <div v-for="(msg, idx) in chatLog" :key="idx" class="chat-line">
                <span class="chat-author">{{ msg.from || 'system' }}:</span>
                <span>{{ msg.text || (msg.type==='dice' ? msg.text : '') }}</span>
              </div>
            </div>
            <div class="tool-row">
              <input v-model="chatInput" placeholder="Сообщение" class="input" @keyup.enter="sendChat" />
              <button class="btn primary" @click="sendChat">Отправить</button>
            </div>
            <button class="btn ghost" @click="requestState">Синхронизировать</button>
          </div>

          <div class="tool-card">
            <div class="tool-title">Кости</div>
            <div class="tool-row compact">
              <span>d</span>
              <input type="number" min="2" max="1000" v-model.number="diceSides" class="input small" />
              <span>кол-во</span>
              <input type="number" min="1" max="10" v-model.number="diceCount" class="input tiny" />
            </div>
            <button class="btn primary" @click="sendDice">Бросить</button>
          </div>

          <div class="tool-card">
            <div class="tool-title">Порядок ходов</div>
            <div class="turn-list">
              <div v-if="turnOrder.length === 0" class="muted">Пока не задан</div>
              <div v-else>
                <div v-for="(p, idx) in turnOrder" :key="p" :class="['turn-item', idx===turnCurrent ? 'active' : '']">
                  {{ idx===turnCurrent ? '→ ' : '' }}{{ p }}
                </div>
              </div>
            </div>
            <div class="tool-row">
              <button class="btn ghost" @click="nextTurn">Следующий</button>
              <button class="btn ghost" @click="setTurnOrder">Установить</button>
            </div>
          </div>
        </section>

        <div v-if="view==='lobby'" class="lobby">
          <div class="lobby-card">
            <div class="card-title">Создать сессию (ведущий)</div>
            <div class="card-help">Создаёт новую игру, вы — ведущий.</div>
            <button class="btn primary" @click="hostSession">Создать сессию</button>
            <button v-if="sessionId && role==='gm'" class="btn danger" @click="resetCurrentSession">Сбросить сессию</button>
          </div>

          <div class="lobby-card">
            <div class="card-title">Присоединиться к сессии</div>
            <label class="field-label">ID сессии</label>
            <input v-model="joiningId" class="input" placeholder="введите ID сессии" />
            <label class="field-label">Имя персонажа</label>
            <input v-model="characterName" class="input" placeholder="необязательно" />
            <button class="btn primary" @click="joinExisting">Подключиться</button>
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
.session-tools {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  padding: 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.tool-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 160px;
}
.tool-title {
  font-weight: 600;
  color: #0f172a;
}
.chat-log {
  flex: 1;
  max-height: 140px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 6px;
  border-radius: 8px;
  font-size: 12px;
}
.chat-line {
  margin-bottom: 4px;
}
.chat-author {
  font-weight: 600;
  margin-right: 4px;
}
.tool-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.tool-row.compact {
  font-size: 13px;
}
.turn-list {
  flex: 1;
  min-height: 80px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  padding: 6px;
  border-radius: 8px;
  font-size: 12px;
}
.turn-item.active {
  font-weight: 700;
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
