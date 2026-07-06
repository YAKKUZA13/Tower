/**
 * CoopClient — типизированный клиент co-op WS-протокола (Phase 7 задача 7.2).
 *
 * Оборачивает `connectWS` типизированными событиями и send-методами.
 * Добавляет авто-реконнект с экспоненциальным бэкоффом (для reconnect-а хоста
 * и кратковременных обрывов сети).
 *
 * Поддерживает несколько подписчиков через `.on(type, cb)`: coopStore слушает
 * lobby-события (welcome/players/start/...), а Game.vue — gameplay (state/input).
 *
 * Модель (ADR-2): host-authoritative. Гость шлёт coop:input → хост считает →
 * раздаёт coop:state 10 Гц → гость рендерит.
 */

import type {
  CoopClientMessage,
  CoopPlayerInfo,
  CoopRole,
  CoopServerMessage,
  GameSnapshot,
  PlayerInput
} from '@tower/shared';
import { connectWS } from './ws';

export interface CoopWelcomePayload {
  sessionId: string;
  ownerId: string;
  isHost: boolean;
  selfUserId: string;
  players: CoopPlayerInfo[];
  mapId?: string;
}

/** События coop-клиента (используются как с `.on(type, cb)`, так и в handlers). */
export type CoopEventType =
  | 'welcome' | 'players' | 'map' | 'state' | 'input' | 'request-snapshot'
  | 'start' | 'host-left' | 'peer-left' | 'error' | 'status';

export type CoopStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

type EventPayload = {
  welcome: CoopWelcomePayload;
  players: CoopPlayerInfo[];
  map: string;
  state: GameSnapshot;
  input: PlayerInput;
  'request-snapshot': string;
  start: string;
  'host-left': void;
  'peer-left': string;
  error: { code: string; message: string };
  status: CoopStatus;
};

type Handler<T extends CoopEventType> = (payload: EventPayload[T]) => void;

export interface CoopHandlers {
  onWelcome?: (msg: CoopWelcomePayload) => void;
  onPlayers?: (players: CoopPlayerInfo[]) => void;
  onMap?: (mapId: string) => void;
  onState?: (snapshot: GameSnapshot) => void;
  onInput?: (input: PlayerInput) => void;
  onRequestSnapshot?: (fromUserId: string) => void;
  onStart?: (ownerId: string) => void;
  onHostLeft?: () => void;
  onPeerLeft?: (userId: string) => void;
  onError?: (code: string, message: string) => void;
  onStatus?: (status: CoopStatus) => void;
}

const MAX_RECONNECT_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 8000;

export interface CoopClientHandle {
  /** Подписка на событие. Возвращает функцию отписки. */
  on: <T extends CoopEventType>(type: T, cb: Handler<T>) => () => void;
  send: (msg: CoopClientMessage) => void;
  setRole: (role: CoopRole) => void;
  setReady: (ready: boolean) => void;
  setMap: (mapId: string) => void;
  sendInput: (input: PlayerInput) => void;
  sendState: (snapshot: GameSnapshot) => void;
  requestSnapshot: () => void;
  sendStart: () => void;
  leave: () => void;
  close: () => void;
  getStatus: () => CoopStatus;
  isHost: () => boolean;
}

export function connectCoop(sessionId: string, handlers: CoopHandlers = {}): CoopClientHandle {
  let status: CoopStatus = 'disconnected';
  let disposed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingRole: CoopRole | null = null;
  let pendingReady: boolean | null = null;
  let pendingMapId: string | null = null;
  let conn: ReturnType<typeof connectWS> | null = null;
  let hostFlag = false;

  // множество подписчиков по типу события
  const subscribers = new Map<CoopEventType, Set<Function>>();
  function subs<T extends CoopEventType>(type: T): Set<Handler<T>> {
    let s = subscribers.get(type);
    if (!s) { s = new Set(); subscribers.set(type, s); }
    return s as unknown as Set<Handler<T>>;
  }
  function emit<T extends CoopEventType>(type: T, payload: EventPayload[T]): void {
    for (const cb of subs(type)) {
      try { (cb as Handler<T>)(payload); } catch { /* ignore subscriber error */ }
    }
  }

  // bridge: handlers-* → emit
  if (handlers.onWelcome) subs('welcome').add(handlers.onWelcome);
  if (handlers.onPlayers) subs('players').add(handlers.onPlayers);
  if (handlers.onMap) subs('map').add(handlers.onMap);
  if (handlers.onState) subs('state').add(handlers.onState);
  if (handlers.onInput) subs('input').add(handlers.onInput);
  if (handlers.onRequestSnapshot) subs('request-snapshot').add(handlers.onRequestSnapshot);
  if (handlers.onStart) subs('start').add(handlers.onStart);
  if (handlers.onHostLeft) subs('host-left').add(handlers.onHostLeft);
  if (handlers.onPeerLeft) subs('peer-left').add(handlers.onPeerLeft);
  if (handlers.onError) subs('error').add((p) => handlers.onError!(p.code, p.message));
  if (handlers.onStatus) subs('status').add(handlers.onStatus);

  function setStatus(s: CoopStatus): void {
    status = s;
    emit('status', s);
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      setStatus('error');
      emit('error', { code: 'reconnect_failed', message: 'Не удалось переподключиться' });
      return;
    }
    attempt += 1;
    setStatus('reconnecting');
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
    reconnectTimer = setTimeout(() => {
      if (disposed) return;
      open();
    }, backoff);
  }

  function dispatch(msg: CoopServerMessage): void {
    switch (msg.type) {
      case 'coop:welcome':
        hostFlag = msg.isHost;
        emit('welcome', {
          sessionId: msg.sessionId,
          ownerId: msg.ownerId,
          isHost: msg.isHost,
          selfUserId: msg.selfUserId,
          players: msg.players,
          mapId: msg.mapId
        });
        // после welcome — повторно заявить роль/ready (сервер сбросил их при новом сокете)
        if (pendingRole) conn?.send({ type: 'coop:set-role', role: pendingRole });
        if (pendingReady !== null) conn?.send({ type: 'coop:ready', ready: pendingReady });
        if (pendingMapId && hostFlag) conn?.send({ type: 'coop:set-map', mapId: pendingMapId });
        break;
      case 'coop:players':
        emit('players', msg.players);
        break;
      case 'coop:map':
        emit('map', msg.mapId);
        break;
      case 'coop:state':
        emit('state', msg.snapshot);
        break;
      case 'coop:input':
        emit('input', msg.input);
        break;
      case 'coop:request-snapshot':
        emit('request-snapshot', msg.fromUserId);
        break;
      case 'coop:start':
        emit('start', msg.ownerId);
        break;
      case 'coop:host-left':
        emit('host-left', undefined);
        break;
      case 'coop:peer-left':
        emit('peer-left', msg.userId);
        break;
      case 'coop:error':
        emit('error', { code: msg.code, message: msg.message });
        break;
      default:
        break;
    }
  }

  function open(): void {
    if (disposed) return;
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    conn = connectWS({ sessionId });

    conn.on('open', () => {
      attempt = 0;
      setStatus('connected');
    });

    // все coop:* сообщения приходят через generic emitter ws.ts по type
    for (const t of [
      'coop:welcome', 'coop:players', 'coop:map', 'coop:state', 'coop:input', 'coop:request-snapshot',
      'coop:start', 'coop:host-left', 'coop:peer-left', 'coop:error'
    ]) {
      conn.on(t, (payload) => dispatch({ type: t, ...(payload as Record<string, unknown>) } as unknown as CoopServerMessage));
    }

    conn.on('close', () => {
      if (disposed) return;
      scheduleReconnect();
    });
    // Note: ws.ts не экспонирует onerror отдельно — close покрывает обрывы.
  }

  open();

  function safeSend(msg: CoopClientMessage): void {
    conn?.send(msg as unknown as Record<string, unknown>);
  }

  return {
    on(type, cb) {
      subs(type).add(cb);
      return () => { subs(type).delete(cb); };
    },
    send: safeSend,
    setRole(role: CoopRole) {
      pendingRole = role;
      safeSend({ type: 'coop:set-role', role });
    },
    setReady(ready: boolean) {
      pendingReady = ready;
      safeSend({ type: 'coop:ready', ready });
    },
    setMap(mapId: string) {
      pendingMapId = mapId;
      safeSend({ type: 'coop:set-map', mapId });
    },
    sendInput(input: PlayerInput) {
      safeSend({ type: 'coop:input', input });
    },
    sendState(snapshot: GameSnapshot) {
      safeSend({ type: 'coop:state', snapshot });
    },
    requestSnapshot() {
      safeSend({ type: 'coop:request-snapshot' });
    },
    sendStart() {
      safeSend({ type: 'coop:start' });
    },
    leave() {
      safeSend({ type: 'coop:leave-lobby' });
    },
    close() {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      conn?.close();
      setStatus('disconnected');
    },
    getStatus() {
      return status;
    },
    isHost() {
      return hostFlag;
    }
  };
}
