/**
 * M8.4 — PvpRooms: серверные PvP match-комнаты (1v1 / 1v1v1 / 1v1v1v1).
 * Источник: standard dedicated-server RTS matchmaking.
 *
 * Состоит из:
 *  - Lobby: queue → match-found → ready-check → pick-color / pick-start-pos → match-start.
 *  - Match: ServerSimLoop запускается; per-slot visibility-filtered snapshot-fanout.
 *  - Reconnect: short disconnect → grace period (PVP_RECONNECT_GRACE_SEC) → пауза/догонка;
 *    long disconnect (PVP_DEFEAT_AFTER_SEC) → defeat.
 *
 * Протокол: PvpClientMessage / PvpServerMessage (см. shared/types/realtime.ts).
 *
 * НЕ запускает GameSim напрямую (см. server-sim-loop.ts — dependency injection через
 * simFactory). Coop-комнаты (legacy Phase 7) НЕ трогаем — PvpRooms живёт параллельно.
 */
import type { WebSocket } from '@fastify/websocket';
import type {
  GameSnapshot,
  PvpClientMessage,
  PvpMatchMode,
  PvpServerMessage,
  PvpSlotInfo
} from '@tower/shared';
import { PVP_DEFEAT_AFTER_SEC, PVP_RECONNECT_GRACE_SEC } from '@tower/shared';
import { ServerSimLoop, type AuthoritativeSim } from './server-sim-loop.js';

export interface PvpClient {
  socket: WebSocket;
  userId: string;
  username: string;
  /** MatchId которому принадлежит клиент (null — в очереди/лобби без match). */
  matchId: string | null;
  /** Slot 0..3 в матче (или -1 если не в матче). */
  slot: number;
}

interface PvpSlot {
  slot: number;
  userId: string;
  username: string;
  socket: WebSocket | null;     // null при disconnect (reconnect-grace)
  color: string;
  ready: boolean;
  defeated: boolean;
  startSlot: number;            // выбранная стартовая позиция (или -1)
  disconnectedAt: number | null;
}

interface PvpMatch {
  matchId: string;
  mode: PvpMatchMode;
  mapId: string;
  seed: number;
  slots: PvpSlot[];
  state: 'lobby' | 'playing' | 'ended';
  sim: ServerSimLoop | null;
  startedAt: number | null;
}

const DEFAULT_COLORS: string[] = ['#2E86DE', '#E74C3C', '#F4D03F', '#58D68D'];

function slotCountForMode(mode: PvpMatchMode): number {
  return mode === '1v1' ? 2 : mode === '1v1v1' ? 3 : 4;
}

function makeSlotInfo(s: PvpSlot): PvpSlotInfo {
  return {
    slot: s.slot,
    userId: s.userId,
    username: s.username,
    color: s.color,
    ready: s.ready,
    defeated: s.defeated
  };
}

/**
 * PvpRooms: главный маршрутизатор PvP-сообщений.
 *
 * Создаётся один экземпляр на сервер (см. server/src/index.ts).
 * handleMessage(client, msg) — точка входа; matcher по msg.type.
 */
export class PvpRooms {
  private readonly matches = new Map<string, PvpMatch>();
  /** Очередь матчмейкера: userId → mode (waiting). */
  private readonly queue = new Map<string, PvpMatchMode>();
  /** userId → list of matchIds (reconnect tracking). */
  private readonly userMatches = new Map<string, string[]>();
  private matchIdCounter = 0;

  constructor(
    /** Factory для авторитетного sim (зависит от того, как caller hoist'нул GameSim). */
    private readonly simFactory: (match: { matchId: string; mapId: string; seed: number; slots: PvpSlotInfo[] }) => AuthoritativeSim,
    /** Получить grid для mapId (caller — maps registry). */
    private readonly resolveGrid: (mapId: string) => { cols: number; rows: number; cellSize: number }
  ) {}

  /** Точка входа из WS-handler. Возвращает server-message для отправки клиенту. */
  handleMessage(client: PvpClient, msg: PvpClientMessage): PvpServerMessage | PvpServerMessage[] | null {
    switch (msg.type) {
      case 'pvp:queue': return this.handleQueue(client, msg.mode);
      case 'pvp:leave-queue': return this.handleLeaveQueue(client);
      case 'pvp:lobby-ready': return this.handleLobbyReady(client, msg.ready);
      case 'pvp:lobby-pick-color': return this.handlePickColor(client, msg.color);
      case 'pvp:lobby-pick-start-pos': return this.handlePickStartPos(client, msg.startSlot);
      case 'pvp:leave-lobby': return this.handleLeaveLobby(client);
      case 'pvp:input': return this.handleInput(client, msg.tick, msg.action);
      case 'pvp:request-snapshot': return this.handleRequestSnapshot(client);
      case 'pvp:reconnect': return this.handleReconnect(client, msg.matchId);
      case 'ping': return { type: 'pong', t: Date.now() };
      default: return null;
    }
  }

  /** Called when socket closes (from WS-handler). */
  onDisconnect(client: PvpClient): PvpServerMessage[] {
    const out: PvpServerMessage[] = [];
    this.queue.delete(client.userId);
    const match = client.matchId ? this.matches.get(client.matchId) : null;
    if (!match) return out;
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (slot) {
      slot.socket = null;
      slot.disconnectedAt = Date.now();
      out.push({ type: 'pvp:peer-left', slot: slot.slot, reason: 'disconnect' });
      // schedule defeat-after if not reconnected
      setTimeout(() => {
        const m = this.matches.get(match.matchId);
        if (!m) return;
        const s = m.slots.find((x) => x.userId === client.userId);
        if (s && s.socket === null && s.disconnectedAt) {
          const elapsed = (Date.now() - s.disconnectedAt) / 1000;
          if (elapsed > PVP_DEFEAT_AFTER_SEC) {
            s.defeated = true;
            this.broadcast(m, { type: 'pvp:defeated', slot: s.slot });
            this.checkMatchEnd(m);
          }
        }
      }, PVP_DEFEAT_AFTER_SEC * 1000);
    }
    return out;
  }

  // ── handlers ────────────────────────────────────────────────────────

  private handleQueue(client: PvpClient, mode: PvpMatchMode): PvpServerMessage | null {
    this.queue.set(client.userId, mode);
    // try to form a match
    const sameMode = [...this.queue.entries()].filter(([, m]) => m === mode);
    const needed = slotCountForMode(mode);
    if (sameMode.length >= needed) {
      const chosen = sameMode.slice(0, needed);
      for (const [uid] of chosen) this.queue.delete(uid);
      return this.createMatch(client, mode, chosen.map(([uid]) => uid));
    }
    return { type: 'pvp:queued', aheadInQueue: sameMode.length - 1 };
  }

  private handleLeaveQueue(client: PvpClient): PvpServerMessage | null {
    this.queue.delete(client.userId);
    return null;
  }

  private createMatch(initiator: PvpClient, mode: PvpMatchMode, userIds: string[]): PvpServerMessage | null {
    const matchId = `match-${++this.matchIdCounter}`;
    const slots: PvpSlot[] = userIds.map((uid, i) => ({
      slot: i,
      userId: uid,
      username: uid,
      socket: null,                 // sockets будут присвоены через WS-handler on next msg
      color: DEFAULT_COLORS[i] ?? '#888888',
      ready: false,
      defeated: false,
      startSlot: -1,
      disconnectedAt: null
    }));
    const mapId = this.pickMapForMode(mode);
    const seed = Math.floor(Math.random() * 1_000_000);
    const match: PvpMatch = {
      matchId,
      mode,
      mapId,
      seed,
      slots,
      state: 'lobby',
      sim: null,
      startedAt: null
    };
    this.matches.set(matchId, match);
    for (const s of slots) {
      const arr = this.userMatches.get(s.userId) ?? [];
      arr.push(matchId);
      this.userMatches.set(s.userId, arr);
    }
    // initiator gets immediate match-found; others will get it when they next check
    const initiatorSlot = slots.find((s) => s.userId === initiator.userId)?.slot ?? 0;
    return {
      type: 'pvp:match-found',
      matchId,
      mode,
      mapId,
      slots: slots.map(makeSlotInfo),
      yourSlot: initiatorSlot,
      serverSeed: seed
    };
  }

  private pickMapForMode(mode: PvpMatchMode): string {
    return mode === '1v1' ? 'rts-2p-crossroads' : mode === '1v1v1' ? 'rts-3p-trident' : 'rts-4p-quadrants';
  }

  private handleLobbyReady(client: PvpClient, ready: boolean): PvpServerMessage[] | null {
    const match = this.findMatchOf(client);
    if (!match || match.state !== 'lobby') return null;
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (!slot) return null;
    slot.socket = client.socket;
    slot.ready = ready;
    // если все готовы — старт
    if (match.slots.every((s) => s.ready)) {
      return this.startMatch(match);
    }
    return [{ type: 'pvp:lobby-state', slots: match.slots.map(makeSlotInfo) }];
  }

  private handlePickColor(client: PvpClient, color: string): PvpServerMessage[] | null {
    const match = this.findMatchOf(client);
    if (!match || match.state !== 'lobby') return null;
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (!slot) return null;
    // prevent duplicate colors
    if (match.slots.some((s) => s.userId !== client.userId && s.color === color)) {
      return [{ type: 'pvp:error', code: 'color-taken', message: 'Color is taken by another player' }];
    }
    slot.color = color;
    return [{ type: 'pvp:lobby-state', slots: match.slots.map(makeSlotInfo) }];
  }

  private handlePickStartPos(client: PvpClient, startSlot: number): PvpServerMessage[] | null {
    const match = this.findMatchOf(client);
    if (!match || match.state !== 'lobby') return null;
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (!slot) return null;
    if (match.slots.some((s) => s.userId !== client.userId && s.startSlot === startSlot)) {
      return [{ type: 'pvp:error', code: 'pos-taken', message: 'Start position is taken' }];
    }
    slot.startSlot = startSlot;
    return [{ type: 'pvp:lobby-state', slots: match.slots.map(makeSlotInfo) }];
  }

  private handleLeaveLobby(client: PvpClient): PvpServerMessage[] | null {
    const match = this.findMatchOf(client);
    if (!match) return null;
    const idx = match.slots.findIndex((s) => s.userId === client.userId);
    if (idx < 0) return null;
    match.slots.splice(idx, 1);
    if (match.slots.length < slotCountForMode(match.mode)) {
      // match dissolved — notify remaining
      this.broadcast(match, { type: 'pvp:error', code: 'match-dissolved', message: 'Player left' });
      this.matches.delete(match.matchId);
    }
    client.matchId = null;
    return null;
  }

  private startMatch(match: PvpMatch): PvpServerMessage[] {
    match.state = 'playing';
    match.startedAt = Date.now();
    const grid = this.resolveGrid(match.mapId);
    match.sim = new ServerSimLoop({
      matchId: match.matchId,
      grid,
      slots: match.slots.map((s) => ({ slot: s.slot, userId: s.userId })),
      simFactory: () => this.simFactory({
        matchId: match.matchId,
        mapId: match.mapId,
        seed: match.seed,
        slots: match.slots.map(makeSlotInfo)
      }),
      onSnapshot: (slot, snapshot, confirmedTick) => {
        const s = match.slots.find((x) => x.slot === slot);
        if (!s || !s.socket) return;
        this.send(s.socket, { type: 'pvp:snapshot', tick: snapshot.tick, snapshot, yourProcessedTick: confirmedTick });
      },
      onMatchEnded: (winnerSlot) => {
        this.broadcast(match, {
          type: 'pvp:match-ended',
          winnerSlot,
          stats: { slots: match.slots.map(makeSlotInfo), durationSec: (Date.now() - (match.startedAt ?? Date.now())) / 1000 }
        });
        match.state = 'ended';
        setTimeout(() => this.matches.delete(match.matchId), 60_000); // cleanup after 60s
      }
    });
    match.sim.start();
    return [{
      type: 'pvp:match-start',
      matchId: match.matchId,
      mapId: match.mapId,
      slots: match.slots.map(makeSlotInfo),
      startTick: 0
    }];
  }

  private handleInput(client: PvpClient, tick: number, action: import('@tower/shared').PlayerInput['action']): PvpServerMessage | null {
    const match = this.findMatchOf(client);
    if (!match || !match.sim || match.state !== 'playing') return null;
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (!slot) return null;
    // tag action with slot for per-player routing (rts-slot-action)
    match.sim.enqueueInput(tick, slot.slot, action);
    return null;
  }

  private handleRequestSnapshot(client: PvpClient): PvpServerMessage | null {
    const match = this.findMatchOf(client);
    if (!match || !match.sim) return null;
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (!slot) return null;
    // send immediate full snapshot (без visibility-filter — для reconnect)
    return {
      type: 'pvp:snapshot',
      tick: match.sim.getSim().state.tick,
      snapshot: match.sim.getSim().serialize(),
      yourProcessedTick: match.sim.getSim().state.tick
    };
  }

  private handleReconnect(client: PvpClient, matchId: string): PvpServerMessage | null {
    const match = this.matches.get(matchId);
    if (!match) return { type: 'pvp:reconnect-failed', reason: 'match-not-found' };
    const slot = match.slots.find((s) => s.userId === client.userId);
    if (!slot) return { type: 'pvp:reconnect-failed', reason: 'not-in-match' };
    if (slot.disconnectedAt && (Date.now() - slot.disconnectedAt) / 1000 > PVP_RECONNECT_GRACE_SEC) {
      return { type: 'pvp:reconnect-failed', reason: 'grace-expired' };
    }
    slot.socket = client.socket;
    slot.disconnectedAt = null;
    client.matchId = matchId;
    client.slot = slot.slot;
    const snapshot = match.sim ? match.sim.getSim().serialize() : null;
    if (!snapshot) return { type: 'pvp:reconnect-failed', reason: 'sim-not-running' };
    return { type: 'pvp:reconnect-ok', matchId, snapshot, yourSlot: slot.slot };
  }

  private findMatchOf(client: PvpClient): PvpMatch | null {
    if (client.matchId) {
      const m = this.matches.get(client.matchId);
      if (m) return m;
    }
    // search by userId
    const ids = this.userMatches.get(client.userId) ?? [];
    for (const id of ids) {
      const m = this.matches.get(id);
      if (m && m.state !== 'ended') return m;
    }
    return null;
  }

  private checkMatchEnd(match: PvpMatch): void {
    const alive = match.slots.filter((s) => !s.defeated);
    if (match.slots.length > 1 && alive.length <= 1) {
      const winnerSlot = alive[0]?.slot ?? null;
      this.broadcast(match, {
        type: 'pvp:match-ended',
        winnerSlot,
        stats: { slots: match.slots.map(makeSlotInfo), durationSec: (Date.now() - (match.startedAt ?? Date.now())) / 1000 }
      });
      match.state = 'ended';
      match.sim?.stop();
      setTimeout(() => this.matches.delete(match.matchId), 60_000);
    }
  }

  private broadcast(match: PvpMatch, msg: PvpServerMessage): void {
    for (const s of match.slots) {
      if (s.socket) this.send(s.socket, msg);
    }
  }

  private send(socket: WebSocket, msg: PvpServerMessage): void {
    try { socket.send(JSON.stringify(msg)); } catch { /* socket closed */ }
  }

  /** Called when client WS-connects (from /ws handler). Initializes PvpClient. */
  registerClient(socket: WebSocket, userId: string, username: string): PvpClient {
    return { socket, userId, username, matchId: null, slot: -1 };
  }
}

export type { GameSnapshot };
