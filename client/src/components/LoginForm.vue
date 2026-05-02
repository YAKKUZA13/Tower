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
  <div class="auth-wrap">
    <div class="auth-card">
      <h2>Добро пожаловать</h2>
      <label class="auth-label">Имя</label>
      <input v-model="username" class="auth-input" placeholder="Введите имя" />
      <label class="auth-label">Ключ доступа</label>
      <input v-model="token" class="auth-input" placeholder="Автоматически после регистрации" />
      <div class="auth-actions">
        <button class="auth-btn primary" :disabled="loading || !username" @click="doRegister">Создать пользователя</button>
        <button class="auth-btn ghost" :disabled="loading || !username || !token" @click="doLogin">Войти</button>
      </div>
      <div class="auth-hint">Ключ хранится локально и используется для авторизации.</div>
      <div class="auth-status">{{ status }}</div>
    </div>
  </div>
</template>

<style scoped>
.auth-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
}
.auth-card {
  width: 360px;
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  color: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.auth-label {
  font-size: 12px;
  color: #475569;
}
.auth-input {
  width: 100%;
  border: 1px solid #cbd5f5;
  border-radius: 8px;
  padding: 8px 10px;
}
.auth-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.auth-btn {
  border: none;
  border-radius: 8px;
  padding: 8px 12px;
  font-weight: 600;
}
.auth-btn.primary {
  background: #2563eb;
  color: #fff;
}
.auth-btn.ghost {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #0f172a;
}
.auth-hint {
  font-size: 12px;
  color: #475569;
}
.auth-status {
  color: #b91c1c;
  min-height: 18px;
}
</style>
