import { defineStore } from 'pinia';
import type { AccountRole, AuthUser } from '../domain/auth';
import { getMe, login, logout, register } from '../services/api';
import { clearAuthToken, clearStoredAuthUser, getAuthToken, getStoredAuthUser, setAuthToken, setStoredAuthUser } from '../services/token-storage';

/** Маркер гостевого токена — присутствие означает «офлайн-single без сервера». */
export const GUEST_TOKEN = 'guest';

function isGuestToken(token: string): boolean {
  return token === GUEST_TOKEN;
}

interface AuthState {
  user: AuthUser | null;
  token: string;
  isLoading: boolean;
  error: string;
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: getStoredAuthUser<AuthUser>(),
    token: getAuthToken(),
    isLoading: false,
    error: ''
  }),
  getters: {
    isAuthed: (state) => Boolean(state.user && state.token),
    isGuest: (state) => isGuestToken(state.token),
    defaultRole: (state): AccountRole => state.user?.defaultRole || 'player'
  },
  actions: {
    applyAuth(user: AuthUser, token: string) {
      this.user = user;
      this.token = token;
      setAuthToken(token);
      setStoredAuthUser(user);
      localStorage.setItem('username', user.username || user.login);
    },
    /**
     * Гостевой вход (офлайн-single). Без сервера: создаёт локального AuthUser
     * и token='guest'. Single-player запускается на встроенной карте без БД.
     * Co-op и лидерборд гостю недоступны (нужен аккаунт).
     */
    loginAsGuest(username = 'Гость') {
      const guestUser: AuthUser = {
        userId: 'guest',
        login: 'guest',
        username,
        defaultRole: 'player'
      };
      this.applyAuth(guestUser, GUEST_TOKEN);
    },
    async registerAccount(payload: { login: string; password: string; defaultRole?: AccountRole }) {
      this.isLoading = true;
      this.error = '';
      try {
        const res = await register({ ...payload, defaultRole: payload.defaultRole ?? 'player' });
        this.applyAuth(res.user, res.token || res.authSession.token);
      } catch (e) {
        this.error = 'Не удалось создать аккаунт';
        throw e;
      } finally {
        this.isLoading = false;
      }
    },
    async loginAccount(payload: { login: string; password: string }) {
      this.isLoading = true;
      this.error = '';
      try {
        const res = await login(payload);
        this.applyAuth(res.user, res.token || res.authSession.token);
      } catch (e) {
        this.error = 'Неверный логин или пароль';
        throw e;
      } finally {
        this.isLoading = false;
      }
    },
    async restoreSession() {
      if (!this.token) return;
      // Гостевой токен — не идём в сеть; пользователь уже в localStorage.
      if (isGuestToken(this.token)) return;
      this.isLoading = true;
      try {
        const user = await getMe();
        this.user = user;
        setStoredAuthUser(user);
      } catch {
        this.clearAuth();
      } finally {
        this.isLoading = false;
      }
    },
    async logoutAccount() {
      // Гость не имеет серверной сессии — пропускаем сетевой logout.
      if (this.token && !isGuestToken(this.token)) {
        try {
          await logout();
        } catch {
          // ignore — cleanup локально в finally
        }
      }
      this.clearAuth();
    },
    clearAuth() {
      this.user = null;
      this.token = '';
      clearAuthToken();
      clearStoredAuthUser();
    }
  }
});
