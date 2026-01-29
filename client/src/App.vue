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
  const order = prompt('Введите порядок через запятую', turnOrder.value.join(','));
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
  <div style="height:100vh; display:flex; flex-direction:column;">
    <header style="padding:3px 12px; background:#111; color:#fff; display:flex; align-items:center; justify-content:space-between;">
      <div style="display:flex; align-items:center; gap:12px;">
        <div>D&D Tabletop (LAN)</div>
        <div v-if="isAuthed && sessionId" style="display:flex; gap:6px;">
          <button @click="view='lobby'" :disabled="view==='lobby'">Lobby</button>
          <button @click="view='editor'" :disabled="view==='editor'">GM Hub</button>
          <button @click="view='play'" :disabled="view==='play'">Player</button>
        </div>
      </div>
      <div v-if="isAuthed" style="display:flex; align-items:center; gap:8px;">
        <span style="opacity:0.8;">{{ username }} <span v-if="role">({{ role }})</span></span>
        <span v-if="sessionId" style="opacity:0.7;">Session: {{ sessionId }}</span>
        <span style="opacity:0.7;">{{ wsStatus }}</span>
        <button @click="logout">Logout</button>
      </div>
    </header>
    <div style="flex:1; min-height:0;">
      <LoginForm v-if="!isAuthed" @authed="handleAuthed" />
      <template v-else>
        <div v-if="sessionId" style="display:flex; gap:12px; padding:10px; border-bottom:1px solid #ddd; background:#f7f7f7;">
          <div style="flex:1; min-width:260px;">
            <div style="font-weight:600; margin-bottom:4px;">Chat</div>
            <div style="max-height:120px; overflow:auto; border:1px solid #ddd; padding:6px; background:#fff;">
              <div v-for="(msg, idx) in chatLog" :key="idx" style="font-size:12px; margin-bottom:4px;">
                <span style="font-weight:600;">{{ msg.from || 'system' }}:</span>
                <span>{{ msg.text || (msg.type==='dice' ? msg.text : '') }}</span>
              </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <input v-model="chatInput" placeholder="Сообщение" style="flex:1;" @keyup.enter="sendChat" />
              <button @click="sendChat">Send</button>
            </div>
            <button style="margin-top:6px;" @click="requestState">Resync</button>
          </div>
          <div style="width:200px;">
            <div style="font-weight:600; margin-bottom:4px;">Dice</div>
            <div style="display:flex; gap:4px; align-items:center;">
              <span>d</span>
              <input type="number" min="2" max="1000" v-model.number="diceSides" style="width:70px;" />
              <span>count</span>
              <input type="number" min="1" max="10" v-model.number="diceCount" style="width:50px;" />
            </div>
            <button style="margin-top:6px;" @click="sendDice">Roll</button>
          </div>
          <div style="width:220px;">
            <div style="font-weight:600; margin-bottom:4px;">Turn Order</div>
            <div style="font-size:12px; min-height:60px; border:1px solid #ddd; padding:6px; background:#fff;">
              <div v-if="turnOrder.length === 0" style="color:#777;">No order</div>
              <div v-else>
                <div v-for="(p, idx) in turnOrder" :key="p" :style="{fontWeight: idx===turnCurrent ? '700' : '400'}">
                  {{ idx===turnCurrent ? '→ ' : '' }}{{ p }}
                </div>
              </div>
            </div>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <button @click="nextTurn">Next</button>
              <button @click="setTurnOrder">Set</button>
            </div>
          </div>
        </div>
        <div v-if="view==='lobby'" style="padding:20px; display:flex; gap:20px;">
          <div style="width:300px; padding:12px; border:1px solid #ccc; border-radius:8px; display:flex; flex-direction:column; gap:8px;">
            <div><strong>Host (GM)</strong></div>
            <button @click="hostSession">Create Session</button>
            <div style="font-size:12px; color:#555;">Создаёт сессию, вы — GM.</div>
            <button v-if="sessionId && role==='gm'" @click="resetCurrentSession" style="margin-top:8px;">Reset Session</button>
          </div>
          <div style="width:320px; padding:12px; border:1px solid #ccc; border-radius:8px; display:flex; flex-direction:column; gap:8px;">
            <div><strong>Join</strong></div>
            <label>Session ID</label>
            <input v-model="joiningId" placeholder="enter session id" />
            <label>Character</label>
            <input v-model="characterName" placeholder="optional name" />
            <button @click="joinExisting">Join</button>
          </div>
          <div v-if="sessionId" style="padding:12px; border:1px solid #ccc; border-radius:8px; display:flex; flex-direction:column; gap:8px; min-width:240px;">
            <div><strong>Current Session</strong></div>
            <div>ID: {{ sessionId }}</div>
            <div>Role: {{ role || 'unknown' }}</div>
            <button @click="refreshSession">Refresh</button>
          </div>
        </div>
        <MapEditor v-else-if="view==='editor'" />
        <Play v-else />
      </template>
    </div>
  </div>
</template>

<style>
html, body, #app { height: 100%; margin: 0; }
button { cursor: pointer; }
</style>
