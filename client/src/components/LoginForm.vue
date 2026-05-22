<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '../stores/auth-store';
import type { AccountRole } from '../domain/auth';

const emit = defineEmits(['authed']);

const authStore = useAuthStore();
const mode = ref<'login' | 'register'>('login');
const login = ref('');
const password = ref('');
const passwordRepeat = ref('');
const defaultRole = ref<AccountRole>('player');
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
      password: password.value,
      defaultRole: defaultRole.value
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

        <div class="role-select">
          <label :class="['role-card', defaultRole === 'gm' ? 'active' : '']">
            <input v-model="defaultRole" type="radio" value="gm" />
            <span class="role-title">Мастер</span>
            <span class="role-help">Создание сессий, редактор, управление миром.</span>
          </label>
          <label :class="['role-card', defaultRole === 'player' ? 'active' : '']">
            <input v-model="defaultRole" type="radio" value="player" />
            <span class="role-title">Игрок</span>
            <span class="role-help">Подключение к игре, персонаж, прогрессия.</span>
          </label>
        </div>
      </template>

      <div class="auth-actions">
        <button class="auth-btn primary" :disabled="!canSubmit" @click="submit">
          {{ authStore.isLoading ? 'Подождите...' : (isRegisterMode ? 'Создать аккаунт' : 'Войти') }}
        </button>
      </div>
      <div class="auth-hint">Пароль хранится на сервере только как salted hash. Токен входа можно отозвать.</div>
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
.role-select {
  display: grid;
  gap: 8px;
}
.role-card {
  border: 1px solid #dbe3f0;
  border-radius: 12px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}
.role-card input {
  display: none;
}
.role-card.active {
  border-color: #2563eb;
  background: #eff6ff;
}
.role-title {
  font-weight: 800;
}
.role-help {
  color: #64748b;
  font-size: 12px;
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
