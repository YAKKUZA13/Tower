/**
 * Co-op WS-сообщения TD (Phase 7, концепция 4). Заменяют D&D-сообщения.
 * См. TD-MVP-PLAN.md §2.8 и §7.
 *
 * Модель: host-authoritative (ADR-2). Хост считает сим и раздаёт снапшоты 10 Гц;
 * гости шлют свой ввод хосту (через сервер) и рендерят авторитетные снапшоты.
 *
 * Сервер — тонкий маршрутизатор по комнатам `Map<sessionId, Room>`:
 *   guest → coop:input  → server → host
 *   host  → coop:state  → server → broadcast всем гостям
 *   guest → coop:request-snapshot → server → host
 */

import type { GameSnapshot, PlayerInput } from './sim.js';
import type { CoopRole } from './sim.js';

/** Игрок в лобби/комнате co-op. */
export interface CoopPlayerInfo {
  userId: string;
  username: string;
  role: CoopRole;
  ready: boolean;
  isHost: boolean;
}

// ── Client → Server ──────────────────────────────────────────────────
export type CoopClientMessage =
  | { type: 'coop:join'; sessionId: string; role: CoopRole }
  | { type: 'coop:set-role'; role: CoopRole }
  | { type: 'coop:set-map'; mapId: string }                  // хост → сервер: выбрана карта (бродкастится гостям)
  | { type: 'coop:ready'; ready: boolean }
  | { type: 'coop:input'; input: PlayerInput }            // гость → хост (через сервер)
  | { type: 'coop:state'; snapshot: GameSnapshot }        // хост → сервер (сервер бродкастит гостям)
  | { type: 'coop:request-snapshot' }                      // гость → хост (через сервер): запрос актуального состояния
  | { type: 'coop:start' }                                 // хост → сервер → гости: старт игры (всем в Game.vue)
  | { type: 'coop:leave-lobby' }                           // выход из лобби (не из игры)
  | { type: 'ping' };

// ── Server → Client ──────────────────────────────────────────────────
export type CoopServerMessage =
  | { type: 'coop:welcome'; sessionId: string; ownerId: string; isHost: boolean; selfUserId: string; players: CoopPlayerInfo[]; mapId?: string }
  | { type: 'coop:map'; mapId: string }                       // обновление выбранной карты (бродкаст комнаты)
  | { type: 'coop:players'; players: CoopPlayerInfo[] }    // обновление списка игроков (роль/ready/join/leave)
  | { type: 'coop:state'; snapshot: GameSnapshot }          // 10 Гц от хоста → гости
  | { type: 'coop:input'; input: PlayerInput }              // ввод гостя → хост
  | { type: 'coop:request-snapshot'; fromUserId: string }   // запрос снапшота → хост
  | { type: 'coop:start'; ownerId: string }                  // сигнал старта игры всем
  | { type: 'coop:host-left' }                               // хост отключился → гости возвращаются в лобби
  | { type: 'coop:peer-left'; userId: string }               // гость отключился → хост/остальные обновляют UI
  | { type: 'coop:error'; code: string; message: string }
  | { type: 'pong'; t: number };

/** Максимальное число игроков в комнате co-op (включая хоста). */
export const COOP_MAX_PLAYERS = 4;

// ── M8.4: PvP (competing, server-authoritative) ──────────────────────────
//
//  Полный протокол для 1v1 / 1v1v1 / 1v1v1v1. Сервер — авторитарный (держит
//  GameSim), фильтрует snapshot per-player по Fog of War, раздаёт ~25 Гц.
//  Клиент: client-prediction + server-rollback (см. client/src/sim/prediction.ts).
//
//  Lobby:
//   - pvp:queue → матчмейкер → pvp:match-found { matchId, mode, slots[] }
//   - pvp:lobby-ready → после всех готов → pvp:match-start { matchId, mapId, slots[] }
//   - pvp:lobby-pick-color / pvp:lobby-pick-start-pos
//  In-game:
//   - pvp:input { tick, action } — клиент → сервер (authoritative apply)
//   - pvp:snapshot { tick, filteredSnapshot, yourProcessedTick } — сервер → конкретный клиент
//   - pvp:reconcile { fromTick, toTick, authoritativeSnapshot } — сервер → клиент при рассинхроне
//   - pvp:defeated { slot } → broadcast комнаты
//   - pvp:match-ended { winnerSlot, stats }
//  Reconnect:
//   - pvp:reconnect { matchId } — short disconnect, сервер держит слот N сек
//   - pvp:catch-up → full snapshot to reconnecting client

export type PvpMatchMode = '1v1' | '1v1v1' | '1v1v1v1';

export interface PvpSlotInfo {
  slot: number;
  userId: string;
  username: string;
  color: string;
  ready: boolean;
  defeated?: boolean;
}

// ── PvP Client → Server ──────────────────────────────────────────────
export type PvpClientMessage =
  // matchmaking / lobby
  | { type: 'pvp:queue'; mode: PvpMatchMode }
  | { type: 'pvp:leave-queue' }
  | { type: 'pvp:lobby-ready'; ready: boolean }
  | { type: 'pvp:lobby-pick-color'; color: string }
  | { type: 'pvp:lobby-pick-start-pos'; startSlot: number }
  | { type: 'pvp:leave-lobby' }
  // in-game
  | { type: 'pvp:input'; tick: number; action: PlayerInput['action'] }
  | { type: 'pvp:request-snapshot' }
  // reconnect
  | { type: 'pvp:reconnect'; matchId: string }
  | { type: 'ping' };

// ── PvP Server → Client ──────────────────────────────────────────────
export type PvpServerMessage =
  // matchmaking / lobby
  | { type: 'pvp:queued'; aheadInQueue: number }
  | { type: 'pvp:match-found'; matchId: string; mode: PvpMatchMode; mapId: string; slots: PvpSlotInfo[]; yourSlot: number; serverSeed: number }
  | { type: 'pvp:lobby-state'; slots: PvpSlotInfo[] }
  | { type: 'pvp:match-start'; matchId: string; mapId: string; slots: PvpSlotInfo[]; startTick: number }
  // in-game
  | { type: 'pvp:snapshot'; tick: number; snapshot: GameSnapshot; yourProcessedTick: number }
  | { type: 'pvp:reconcile'; fromTick: number; snapshot: GameSnapshot }
  | { type: 'pvp:defeated'; slot: number }
  | { type: 'pvp:match-ended'; winnerSlot: number | null; stats: { slots: PvpSlotInfo[]; durationSec: number } }
  | { type: 'pvp:peer-left'; slot: number; reason: 'leave' | 'disconnect' | 'timeout' }
  // reconnect
  | { type: 'pvp:reconnect-ok'; matchId: string; snapshot: GameSnapshot; yourSlot: number }
  | { type: 'pvp:reconnect-failed'; reason: string }
  | { type: 'pvp:paused'; reason: string; untilTick?: number }
  | { type: 'pvp:resumed' }
  | { type: 'pvp:error'; code: string; message: string }
  | { type: 'pong'; t: number };

/** Discriminator helper: is message PvP-namespaced? */
export function isPvpMessage(m: { type: string }): boolean {
  return m.type.startsWith('pvp:');
}

/** Discriminator helper: is message Co-op-namespaced? */
export function isCoopMessage(m: { type: string }): boolean {
  return m.type.startsWith('coop:');
}

/** M8.4: Tick rate сервера (Гц). Фиксированный, 25 Гц (40ms) — канон для RTS. */
export const PVP_TICK_HZ = 25;
export const PVP_TICK_DT = 1 / PVP_TICK_HZ;

/** Reconnect-grace: сколько секунд сервер держит слот при дисконнекте игрока. */
export const PVP_RECONNECT_GRACE_SEC = 30;
/** Long disconnect → defeat. */
export const PVP_DEFEAT_AFTER_SEC = 120;
