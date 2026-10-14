<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAuthStore } from '../stores/auth-store';
import RtsIcon from './RtsIcon.vue';

const emit = defineEmits<{
  (e: 'authed', destination?: 'coop' | 'rts'): void;
}>();

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
  emit('authed', 'rts');
}
</script>

<template>
  <div class="auth-wrap">
    <div class="gate-shadow" aria-hidden="true"><span v-for="n in 7" :key="n" /></div>

    <main class="auth-shell">
      <section class="auth-prologue">
        <div class="prologue-kicker">Tower / первая кампания</div>
        <div class="fortress-sigil"><RtsIcon name="tower" :size="38" /></div>
        <h1>Тёмная<br />крепость</h1>
        <p>Поднимите поселение, отправьте рабочих к залежам и удержите первый налёт.</p>
        <div class="campaign-note"><span>Первый приказ</span><strong>Камень для шахты</strong></div>
        <ul class="feature-list">
          <li><RtsIcon name="worker" :size="15" /> Управление рабочими и отрядами</li>
          <li><RtsIcon name="building" :size="15" /> Процедурные здания Tower</li>
          <li><RtsIcon name="tower" :size="15" /> Одиночная RTS без сервера</li>
        </ul>
      </section>

      <section class="auth-card" aria-labelledby="auth-title">
        <header class="auth-head">
          <div class="auth-eyebrow">Полевой штаб</div>
          <h2 id="auth-title">{{ isRegisterMode ? 'Новая летопись' : 'Вернуться в строй' }}</h2>
          <p>{{ isRegisterMode ? 'Создайте имя командира для co-op и таблицы результатов.' : 'Войдите в аккаунт или начните одиночный поход сразу.' }}</p>
        </header>

        <div class="auth-tabs" role="tablist" aria-label="Режим авторизации">
          <button type="button" role="tab" :aria-selected="mode === 'login'" :class="['tab-btn', mode === 'login' ? 'active' : '']" @click="mode = 'login'">Войти</button>
          <button type="button" role="tab" :aria-selected="mode === 'register'" :class="['tab-btn', mode === 'register' ? 'active' : '']" @click="mode = 'register'">Создать аккаунт</button>
        </div>

        <form class="auth-form" @submit.prevent="submit">
          <label class="auth-label" for="auth-login">Имя командира</label>
          <input id="auth-login" v-model="login" class="auth-input" placeholder="Введите логин" autocomplete="username" />

          <label class="auth-label" for="auth-password">Пароль</label>
          <input id="auth-password" v-model="password" type="password" class="auth-input" placeholder="Минимум 8 символов" :autocomplete="isRegisterMode ? 'new-password' : 'current-password'" />

          <template v-if="isRegisterMode">
            <label class="auth-label" for="auth-password-repeat">Повтор пароля</label>
            <input id="auth-password-repeat" v-model="passwordRepeat" type="password" class="auth-input" placeholder="Повторите пароль" autocomplete="new-password" />
          </template>

          <button class="auth-btn account" type="submit" :disabled="!canSubmit">
            {{ authStore.isLoading ? 'Открываем ворота…' : (isRegisterMode ? 'Создать летопись' : 'Войти в штаб') }}
          </button>
        </form>

        <div class="auth-divider"><span>быстрый старт</span></div>
        <button class="auth-btn guest" type="button" @click="playAsGuest"><RtsIcon name="back" :size="16" /> Начать одиночный поход</button>
        <div class="auth-hint">Аккаунт нужен только для co-op и таблицы результатов. Соло запускается локально.</div>
        <div class="auth-status" role="status">{{ status }}</div>
      </section>
    </main>
    <div class="auth-footer">WASD — камера · ПКМ — приказ · колесо — масштаб</div>
  </div>
</template>

<style scoped>
.auth-wrap {
  --coal: #0d0e13;
  --paper: #d8c6a3;
  --copper: #a55d3f;
  --copper-hi: #d08758;
  --frame: #57453d;
  position: relative;
  isolation: isolate;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  min-height: 100%;
  padding: clamp(24px, 5vw, 72px);
  overflow: hidden auto;
  color: var(--paper);
  background:
    radial-gradient(circle at 22% 52%, rgba(127, 65, 40, .2), transparent 24%),
    linear-gradient(115deg, rgba(19, 29, 31, .7), transparent 42%),
    var(--coal);
}
.auth-wrap::before {
  content: '';
  position: absolute;
  z-index: -2;
  inset: 0;
  opacity: .35;
  background-image: linear-gradient(rgba(129, 104, 88, .08) 1px, transparent 1px), linear-gradient(90deg, rgba(129, 104, 88, .06) 1px, transparent 1px);
  background-size: 54px 54px;
  transform: perspective(520px) rotateX(62deg) scale(1.4) translateY(28%);
  transform-origin: bottom;
}
.gate-shadow {
  position: absolute;
  z-index: -1;
  left: 50%;
  bottom: -2px;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: min(1050px, 96vw);
  height: 32vh;
  transform: translateX(-50%);
  opacity: .42;
  pointer-events: none;
}
.gate-shadow span { flex: 1; height: 56%; background: #08090c; border-top: 1px solid #362922; }
.gate-shadow span:nth-child(1), .gate-shadow span:nth-child(7) { height: 86%; }
.gate-shadow span:nth-child(2), .gate-shadow span:nth-child(6) { height: 68%; }
.gate-shadow span:nth-child(3), .gate-shadow span:nth-child(5) { height: 48%; }
.gate-shadow span:nth-child(4) { height: 28%; border-radius: 90px 90px 0 0; }
.auth-shell {
  display: grid;
  grid-template-columns: minmax(300px, .9fr) minmax(380px, 1.1fr);
  width: min(940px, 100%);
  border: 1px solid var(--frame);
  border-left: 3px solid #7d523f;
  background: rgba(17, 18, 23, .97);
  box-shadow: inset 0 0 0 2px #08090d, 12px 14px 0 rgba(0, 0, 0, .3), 0 30px 90px rgba(0, 0, 0, .38);
}
.auth-prologue {
  position: relative;
  padding: clamp(30px, 4.5vw, 56px);
  overflow: hidden;
  border-right: 1px solid #493a34;
  background: linear-gradient(155deg, rgba(70, 103, 82, .22), transparent 48%), linear-gradient(25deg, rgba(128, 58, 37, .22), transparent 54%), #111318;
}
.auth-prologue::after {
  content: '';
  position: absolute;
  right: -66px;
  bottom: -70px;
  width: 230px;
  height: 230px;
  border: 1px solid rgba(167, 109, 75, .18);
  transform: rotate(45deg);
}
.prologue-kicker, .auth-eyebrow { color: #a68b76; font: 10px 'Lucida Console', Consolas, monospace; text-transform: uppercase; letter-spacing: .14em; }
.fortress-sigil { display: grid; place-items: center; width: 58px; height: 58px; margin: 30px 0 20px; color: #d09a6d; border: 1px solid #795542; box-shadow: inset 0 0 0 3px #0b0d11; background: #19171a; }
.auth-prologue h1 { margin: 0; color: #ead8ba; font: 700 clamp(38px, 4.2vw, 58px)/.88 Georgia, 'Times New Roman', serif; letter-spacing: -.035em; text-shadow: 3px 3px 0 #08090c; }
.auth-prologue > p { max-width: 320px; margin: 22px 0; color: #a99a8a; font-size: 14px; line-height: 1.55; }
.campaign-note { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-left: 2px solid var(--copper); background: rgba(8, 9, 12, .42); }
.campaign-note span { color: #776c64; font: 9px 'Lucida Console', Consolas, monospace; text-transform: uppercase; }
.campaign-note strong { color: #ccb797; font-size: 14px; }
.feature-list { display: grid; gap: 9px; margin: 24px 0 0; padding: 0; list-style: none; color: #8d8177; font: 10px 'Lucida Console', Consolas, monospace; }
.feature-list li { display: flex; align-items: center; gap: 8px; }
.feature-list :deep(.rts-icon) { color: #71957d; }
.auth-card { display: flex; min-width: 0; flex-direction: column; padding: clamp(28px, 4vw, 48px); background: linear-gradient(180deg, #17181d, #121318); }
.auth-head { margin-bottom: 22px; }
.auth-head h2 { margin: 7px 0 8px; color: #ead8ba; font: 700 clamp(24px, 2.5vw, 34px) Georgia, 'Times New Roman', serif; }
.auth-head p { margin: 0; color: #887b70; font-size: 13px; line-height: 1.45; }
.auth-tabs { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 22px; border: 1px solid #493c37; }
.tab-btn { min-height: 42px; border: 0; border-right: 1px solid #493c37; border-radius: 0; background: #111217; color: #796b61; font: 10px 'Lucida Console', Consolas, monospace; text-transform: uppercase; }
.tab-btn:last-child { border-right: 0; }
.tab-btn.active { color: #ead6b8; background: #292326; box-shadow: inset 0 -2px var(--copper-hi); }
.tab-btn:focus-visible, .auth-btn:focus-visible, .auth-input:focus-visible { outline: 2px solid #d08758; outline-offset: 2px; }
.auth-form { display: grid; gap: 8px; }
.auth-label { margin-top: 3px; color: #9f8d7d; font: 10px 'Lucida Console', Consolas, monospace; text-transform: uppercase; letter-spacing: .07em; }
.auth-input { box-sizing: border-box; width: 100%; min-height: 43px; padding: 10px 12px; border: 1px solid #4d413c; border-radius: 0; background: #0f1015; color: #e0ceb2; font: 13px Georgia, 'Times New Roman', serif; box-shadow: inset 0 0 0 2px #0a0b0e; }
.auth-input::placeholder { color: #5f5853; }
.auth-input:focus { border-color: #a26849; }
.auth-btn { display: flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; width: 100%; min-height: 43px; border-radius: 0; font: 700 11px 'Lucida Console', Consolas, monospace; text-transform: uppercase; letter-spacing: .02em; cursor: pointer; }
.auth-btn.account { margin-top: 10px; border: 1px solid #55473f; background: #1c1d22; color: #b9a68f; }
.auth-btn.account:hover:not(:disabled) { border-color: #8d6c59; color: #e2ceb0; background: #242126; }
.auth-btn.guest { border: 1px solid #ba6d48; color: #f1ddbf; background: #7b3d2f; box-shadow: inset 0 0 0 2px #351b19; }
.auth-btn.guest:hover { background: #914831; }
.auth-btn:disabled { opacity: .35; cursor: not-allowed; }
.auth-divider { display: flex; align-items: center; gap: 12px; margin: 15px 0; color: #6f6259; font: 9px 'Lucida Console', Consolas, monospace; text-transform: uppercase; letter-spacing: .1em; }
.auth-divider::before, .auth-divider::after { content: ''; flex: 1; height: 1px; background: #3a302d; }
.auth-hint { margin-top: 10px; color: #766b63; font-size: 11px; line-height: 1.4; }
.auth-status { min-height: 18px; margin-top: 5px; color: #cf7464; font: 10px 'Lucida Console', Consolas, monospace; }
.auth-footer { position: absolute; bottom: 16px; color: #5e5651; font: 9px 'Lucida Console', Consolas, monospace; text-transform: uppercase; letter-spacing: .08em; }

@media (max-width: 760px) {
  .auth-wrap { place-items: start center; padding: 18px; }
  .auth-shell { grid-template-columns: 1fr; }
  .auth-prologue { padding: 24px; border-right: 0; border-bottom: 1px solid #493a34; }
  .fortress-sigil { float: left; width: 48px; height: 48px; margin: 18px 16px 12px 0; }
  .auth-prologue h1 { margin-top: 18px; font-size: 34px; line-height: .95; }
  .auth-prologue > p, .feature-list { display: none; }
  .campaign-note { clear: both; margin-top: 18px; }
  .auth-card { padding: 24px; }
  .auth-footer { display: none; }
}

@media (prefers-reduced-motion: no-preference) {
  .auth-shell { animation: gate-arrival .42s ease-out both; }
  @keyframes gate-arrival { from { transform: translateY(12px); } to { transform: translateY(0); } }
}
</style>
