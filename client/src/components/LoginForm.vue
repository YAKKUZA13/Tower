<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '../stores/auth-store';

const emit = defineEmits(['authed']);

const authStore = useAuthStore();
const mode = ref<'login' | 'register'>('login');
const login = ref('');
const password = ref('');
const passwordRepeat = ref('');
const status = ref('');
const isRegisterMode = computed(() => mode.value === 'register');
const canSubmit = computed(() => {
  if (!login.value.trim() || password.value.length < 8) return false;
  if (isRegisterMode.value && password.value !== passwordRepeat.value) return false;
  return !authStore.isLoading;
});

async function doRegister() {
  status.value = '';
  try {
    await authStore.registerAccount({
      login: login.value.trim(),
      password: password.value
    });
    emit('authed');
    status.value = 'Аккаунт создан';
  } catch (e) {
    status.value = authStore.error || 'Регистрация не удалась';
  }
}

async function doLogin() {
  status.value = '';
  try {
    await authStore.loginAccount({
      login: login.value.trim(),
      password: password.value
    });
    emit('authed');
    status.value = 'Вход выполнен';
  } catch (e) {
    status.value = authStore.error || 'Войти не удалось';
  }
}

function submit() {
  if (!canSubmit.value) return;
  if (isRegisterMode.value) doRegister();
  else doLogin();
}

function playAsGuest() {
  authStore.loginAsGuest();
  emit('authed');
}
</script>

<template>
  <div class="auth-wrap">
    <div class="auth-card">
      <h2>Добро пожаловать</h2>
      <div class="auth-tabs">
        <button type="button" :class="['tab-btn', mode === 'login' ? 'active' : '']" @click="mode = 'login'">Войти</button>
        <button type="button" :class="['tab-btn', mode === 'register' ? 'active' : '']" @click="mode = 'register'">Создать аккаунт</button>
      </div>

      <label class="auth-label">Логин</label>
      <input v-model="login" class="auth-input" placeholder="Введите логин" autocomplete="username" @keyup.enter="submit" />

      <label class="auth-label">Пароль</label>
      <input v-model="password" type="password" class="auth-input" placeholder="Минимум 8 символов" autocomplete="current-password" @keyup.enter="submit" />

      <template v-if="isRegisterMode">
        <label class="auth-label">Повтор пароля</label>
        <input v-model="passwordRepeat" type="password" class="auth-input" placeholder="Повторите пароль" autocomplete="new-password" @keyup.enter="submit" />
      </template>

      <div class="auth-actions">
        <button class="auth-btn primary" :disabled="!canSubmit" @click="submit">
          {{ authStore.isLoading ? 'Подождите...' : (isRegisterMode ? 'Создать аккаунт' : 'Войти') }}
        </button>
      </div>
      <div class="auth-divider"><span>или</span></div>
      <button class="auth-btn guest" @click="playAsGuest">Играть без аккаунта</button>
      <div class="auth-hint">Аккаунт нужен только для co-op и сохранения результатов в лидерборде. Одиночная игра доступна сразу, без сервера.</div>
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
  width: min(440px, 100%);
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  color: #0f172a;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.auth-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 8px;
}
.tab-btn {
  border: 1px solid #dbe3f0;
  border-radius: 10px;
  padding: 9px 10px;
  background: #f8fafc;
  color: #334155;
  font-weight: 700;
}
.tab-btn.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
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
  box-sizing: border-box;
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
  width: 100%;
}
.auth-btn.primary {
  background: #2563eb;
  color: #fff;
}
.auth-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.auth-btn.guest {
  background: #0f172a;
  color: #e2e8f0;
  border: 1px solid #334155;
}
.auth-btn.guest:hover {
  background: #1e293b;
}
.auth-divider {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #94a3b8;
  font-size: 12px;
  margin: 4px 0;
}
.auth-divider::before,
.auth-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
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
