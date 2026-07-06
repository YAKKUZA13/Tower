/**
 * CoopStore — co-op сессия: лобби, роли, ready-check, статус WS (Phase 7 задача 7.5).
 *
 * Заменяет D&D-сессионную модель (game-session-store) для co-op. Хост создаёт
 * комнату (= игровую сессию), до 3 гостей присоединяются по sessionId. Каждый
 * выбирает coop-роль (builder/economist/commander/free) и ready. Хост стартует —
 * все переходят в Game.vue (host: authoritative sim; guests: reconcile-рендер).
 */

import { defineStore } from 'pinia';
import type { CoopPlayerInfo, CoopRole } from '@tower/shared';
import { DEFAULT_MAP_ID } from '@tower/shared';
import type { CoopStatus } from '../services/coop-client';
import { connectCoop } from '../services/coop-client';
import type { CoopClientHandle, CoopHandlers } from '../services/coop-client';
import { createSession, joinSession } from '../services/api';
import { clearStoredSessionId, setStoredSessionId } from '../services/token-storage';

export type CoopPhase = 'idle' | 'lobby' | 'playing' | 'closed';

interface CoopState {
  phase: CoopPhase;
  sessionId: string;
  ownerId: string;
  selfUserId: string;
  isHost: boolean;
  role: CoopRole;
  ready: boolean;
  /** Id встроенной карты, выбранной хостом. Пробрасывается гостям через coop:welcome. */
  selectedMapId: string;
  players: CoopPlayerInfo[];
  status: CoopStatus;
  error: string;
  info: string;
}

// module-level handle (не реактивный — вне Pinia state)
let coopClient: CoopClientHandle | null = null;

function roleLabelOf(role: CoopRole): string {
  switch (role) {
    case 'builder': return 'Строитель';
    case 'economist': return 'Экономист';
    case 'commander': return 'Командир';
    default: return 'Свободная';
  }
}

export const useCoopStore = defineStore('coop', {
  state: (): CoopState => ({
    phase: 'idle',
    sessionId: '',
    ownerId: '',
    selfUserId: '',
    isHost: false,
    role: 'free',
    ready: false,
    selectedMapId: DEFAULT_MAP_ID,
    players: [],
    status: 'disconnected',
    error: '',
    info: ''
  }),
  getters: {
    selfUsername(s): string {
      return s.players.find((p) => p.userId === s.selfUserId)?.username ?? '';
    },
    allReady(s): boolean {
      const active = s.players.filter((p) => p.isHost || true);
      return active.length > 0 && active.every((p) => p.ready);
    },
    canStart(s): boolean {
      return s.isHost && s.players.length >= 1 && s.players.every((p) => p.ready);
    },
    roleLabel(): string {
      return roleLabelOf(this.role);
    },
    /** Подсказка: какие действия разрешены этой ролью (soft-restriction). */
    rolePermissions(): { canBuildTowers: boolean; canBuildWalls: boolean; canEconomy: boolean; canCastSpells: boolean } {
      switch (this.role) {
        case 'builder':   return { canBuildTowers: true,  canBuildWalls: true,  canEconomy: false, canCastSpells: false };
        case 'economist': return { canBuildTowers: false, canBuildWalls: false, canEconomy: true,  canCastSpells: false };
        case 'commander': return { canBuildTowers: false, canBuildWalls: false, canEconomy: false, canCastSpells: true  };
        default:          return { canBuildTowers: true,  canBuildWalls: true,  canEconomy: true,  canCastSpells: true  };
      }
    }
  },
  actions: {
    /** Хост: создать новую co-op комнату (= игровую сессию). */
    async createRoom(selfUserId: string, selfUsername: string): Promise<void> {
      this.error = '';
      const session = await createSession();
      this.sessionId = session.sessionId;
      setStoredSessionId(session.sessionId);
      this.ownerId = selfUserId;
      this.selfUserId = selfUserId;
      this.isHost = true;
      this.role = 'free';
      this.ready = false;
      this.phase = 'lobby';
      // локально сразу добавим себя в список (сервер подтвердит в welcome)
      this.players = [{
        userId: selfUserId,
        username: selfUsername,
        role: this.role,
        ready: false,
        isHost: true
      }];
      this.connect();
    },

    /** Гость: присоединиться к комнате по sessionId. */
    async joinRoom(sessionId: string, selfUserId: string, selfUsername: string): Promise<void> {
      this.error = '';
      try {
        await joinSession(sessionId);
      } catch (e) {
        this.error = 'Не удалось подключиться к комнате';
        throw e;
      }
      this.sessionId = sessionId;
      setStoredSessionId(sessionId);
      this.selfUserId = selfUserId;
      this.isHost = false;
      this.role = 'free';
      this.ready = false;
      this.phase = 'lobby';
      this.players = [{
        userId: selfUserId,
        username: selfUsername,
        role: this.role,
        ready: false,
        isHost: false
      }];
      this.connect();
    },

    /** Установить/разорвать WS-соединение с co-op сервером. */
    connect(): void {
      coopClient?.close();
      if (!this.sessionId) return;
      const handlers: CoopHandlers = {
        onWelcome: (msg) => {
          this.ownerId = msg.ownerId;
          this.isHost = msg.isHost;
          this.players = msg.players;
          if (msg.mapId) this.selectedMapId = msg.mapId;
          // роль/ready сервер сбросил на новом сокете — перешлём актуальные
          coopClient?.setRole(this.role);
          coopClient?.setReady(this.ready);
          if (this.isHost) coopClient?.setMap(this.selectedMapId);
        },
        onPlayers: (players) => {
          this.players = players;
        },
        onMap: (mapId) => {
          this.selectedMapId = mapId;
        },
        onStatus: (s) => {
          this.status = s;
        },
        onStart: () => {
          this.phase = 'playing';
        },
        onHostLeft: () => {
          this.phase = 'closed';
          this.error = 'Хост отключился. Игра завершена.';
        },
        onError: (_code, message) => {
          this.error = message;
        }
      };
      coopClient = connectCoop(this.sessionId, handlers);
    },

    disconnect(): void {
      coopClient?.close();
      coopClient = null;
      this.status = 'disconnected';
    },

    setRole(role: CoopRole): void {
      this.role = role;
      coopClient?.setRole(role);
      // обновим локальный список
      const me = this.players.find((p) => p.userId === this.selfUserId);
      if (me) me.role = role;
    },

    setReady(ready: boolean): void {
      this.ready = ready;
      coopClient?.setReady(ready);
      const me = this.players.find((p) => p.userId === this.selfUserId);
      if (me) me.ready = ready;
    },

    /** Хост: выбрать встроенную карту для комнаты. Пробрасывается гостям. */
    setSelectedMap(mapId: string): void {
      this.selectedMapId = mapId;
      coopClient?.setMap(mapId);
    },

    /** Хост: старт игры — все переходят в Game.vue. */
    startGame(): void {
      if (!this.isHost) return;
      coopClient?.sendStart();
      this.phase = 'playing';
    },

    /** Выйти из комнаты в лобби. */
    leaveRoom(): void {
      coopClient?.leave();
      this.disconnect();
      this.$reset();
      clearStoredSessionId();
    },

    /** Гость вернулся в лобби после закрытия комнаты хостом. */
    resetToIdle(): void {
      this.disconnect();
      this.$reset();
      clearStoredSessionId();
    },

    /** Для Game.vue: получить coop-клиент (отправка inputs/snapshots). */
    getClient(): CoopClientHandle | null {
      return coopClient;
    },

    /** Игровая сессия завершилась (win/lose) — вернуться в лобби. */
    endGame(): void {
      this.phase = 'lobby';
    }
  }
});
