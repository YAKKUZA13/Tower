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
