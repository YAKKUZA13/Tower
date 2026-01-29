<script setup>
import { ref } from 'vue';
import { register as apiRegister, login as apiLogin } from '../services/api.js';

const emit = defineEmits(['authed']);

const username = ref(localStorage.getItem('username') || '');
const token = ref(localStorage.getItem('authToken') || localStorage.getItem('apiKey') || '');
const status = ref('');
const loading = ref(false);

async function doRegister() {
  loading.value = true;
  status.value = '';
  try {
    const uname = username.value.trim();
    const res = await apiRegister(uname);
    const key = String(res.token || res.apiKey || '').trim();
    token.value = key;
    localStorage.setItem('username', uname);
    if (key) {
      localStorage.setItem('authToken', key);
      localStorage.setItem('apiKey', key);
    }
    emit('authed', { username: uname, token: key });
    status.value = 'Registered — token saved';
  } catch (e) {
    status.value = 'Register failed';
  } finally {
    loading.value = false;
  }
}

async function doLogin() {
  loading.value = true;
  status.value = '';
  try {
    const uname = username.value.trim();
    const keyInput = String(token.value).trim() || localStorage.getItem('authToken') || localStorage.getItem('apiKey') || '';
    const res = await apiLogin(uname, keyInput);
    const key = String(res.token || res.apiKey || keyInput).trim();
    token.value = key;
    localStorage.setItem('username', uname);
    if (key) {
      localStorage.setItem('authToken', key);
      localStorage.setItem('apiKey', key);
    }
    emit('authed', { username: uname, token: key });
    status.value = 'Logged in';
  } catch (e) {
    status.value = 'Login failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div style="display:flex; align-items:center; justify-content:center; height:100%;">
    <div style="width:360px; padding:20px; border:1px solid #ccc; border-radius:8px;">
      <h2>Welcome</h2>
      <label>Username</label>
      <input v-model="username" placeholder="Enter username" style="width:100%; margin:6px 0;" />
      <label>Token</label>
      <input v-model="token" placeholder="Auto-filled after register" style="width:100%; margin:6px 0;" />
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button :disabled="loading || !username" @click="doRegister">Register & get token</button>
        <button :disabled="loading || !username || !token" @click="doLogin">Login</button>
      </div>
      <div style="margin-top:8px; color:#333; font-size:12px;">Token хранится локально и уходит в Authorization.</div>
      <div style="color:#b00; margin-top:8px;">{{ status }}</div>
    </div>
  </div>
</template>
