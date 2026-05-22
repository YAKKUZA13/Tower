import { defineStore } from 'pinia';
import type { GameRole, GameSession } from '../domain/game-session';
import { createSession, getSession, joinSession, resetSession } from '../services/api';
import { clearStoredGameRole, clearStoredSessionId, getStoredGameRole, getStoredSessionId, setStoredGameRole, setStoredSessionId } from '../services/token-storage';

interface GameSessionState {
  current: GameSession | null;
  sessionId: string;
  role: GameRole | '';
  isLoading: boolean;
  error: string;
}

export const useGameSessionStore = defineStore('gameSession', {
  state: (): GameSessionState => ({
    current: null,
    sessionId: getStoredSessionId(),
    role: (getStoredGameRole() as GameRole | '') || '',
    isLoading: false,
    error: ''
  }),
  getters: {
    roleLabel: (state): string => {
      if (state.role === 'gm') return 'Ведущий';
      if (state.role === 'player') return 'Игрок';
      if (state.role === 'spectator') return 'Наблюдатель';
      return '';
    },
    isGm: (state): boolean => state.role === 'gm'
  },
  actions: {
    applySession(session: GameSession | null) {
      this.current = session;
      this.sessionId = session?.sessionId || '';
      this.role = session?.role || '';
      if (session?.sessionId) setStoredSessionId(session.sessionId);
      else clearStoredSessionId();
      if (session?.role) setStoredGameRole(session.role);
      else clearStoredGameRole();
    },
    async createGameSession() {
      this.isLoading = true;
      this.error = '';
      try {
        const session = await createSession();
        this.applySession(session);
        return session;
      } catch (e) {
        this.error = 'Не удалось создать сессию';
        throw e;
      } finally {
        this.isLoading = false;
      }
    },
    async joinGameSession(sessionId: string, characterName = '') {
      this.isLoading = true;
      this.error = '';
      try {
        const session = await joinSession(sessionId, characterName);
        this.applySession(session);
        return session;
      } catch (e) {
        this.error = 'Не удалось подключиться к сессии';
        throw e;
      } finally {
        this.isLoading = false;
      }
    },
    async refreshGameSession() {
      if (!this.sessionId) return null;
      this.isLoading = true;
      try {
        const session = await getSession(this.sessionId);
        this.applySession(session);
        return session;
      } finally {
        this.isLoading = false;
      }
    },
    async resetCurrentSession() {
      if (!this.sessionId) return;
      await resetSession(this.sessionId);
      this.clearSession();
    },
    clearSession() {
      this.applySession(null);
    }
  }
});
