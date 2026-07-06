/**
 * CoopRooms — серверный маршрутизатор co-op комнат (Phase 7 задача 7.1).
 * `Map<sessionId, Room>` с тегом host/guest + coop-роль.
 *
 * Заменяет линейный scan глобального `Set<WsClient>` (ADR). Сервер — тонкий:
 *   guest → coop:input  → host
 *   host  → coop:state  → broadcast всем гостям
 *
 * Хост комнаты = создатель сессии (session.gmUserId). Гости — все, кто присоединился
 * через `/session/join`. Роли co-op (builder/economist/commander/free) — отдельная
 * концепция от host/guest: хост тоже имеет coop-роль (по умолчанию 'free').
 */

import type { WebSocket } from '@fastify/websocket';
import type {
  CoopClientMessage,
  CoopPlayerInfo,
  CoopRole,
  CoopServerMessage
} from '@tower/shared';
import { COOP_MAX_PLAYERS } from '@tower/shared';

export interface CoopClient {
  socket: WebSocket;
  sessionId: string;
  userId: string;
  username: string;
  /** host (создатель сессии) или guest. */
  isHost: boolean;
  /** Co-op роль игрока (builder/economist/commander/free). */
  coopRole: CoopRole;
  ready: boolean;
}

interface Room {
  sessionId: string;
  ownerId: string;
  /** Id встроенной карты, выбранной хостом (см. @tower/shared/maps). */
  mapId: string;
  players: Map<string, CoopClient>;
}

function playerInfo(c: CoopClient): CoopPlayerInfo {
  return {
    userId: c.userId,
    username: c.username,
    role: c.coopRole,
    ready: c.ready,
    isHost: c.isHost
  };
}

function playerList(room: Room): CoopPlayerInfo[] {
  // хост первым в списке
  const list: CoopPlayerInfo[] = [];
  const host = [...room.players.values()].find((c) => c.isHost);
  if (host) list.push(playerInfo(host));
  for (const c of room.players.values()) {
    if (!c.isHost) list.push(playerInfo(c));
  }
  return list;
}

function send(socket: WebSocket, msg: CoopServerMessage): void {
  if (socket.readyState === 1 /* OPEN */) {
    try {
      socket.send(JSON.stringify(msg));
    } catch {
      /* ignore broken pipe — cleanup on close */
    }
  }
}

export class CoopRooms {
  private readonly rooms = new Map<string, Room>();

  /**
   * Регистрирует клиента в комнате. Создаёт комнату, если её нет (хост).
   * `ownerId` — авторитетный владелец сессии (session.gmUserId), чтобы корректно
   * определить хоста даже если гости подключаются раньше хоста по какой-то причине.
   * Возвращает welcome для новичка и бродкастит список игроков всем остальным.
   */
  join(client: CoopClient, ownerId: string): CoopServerMessage {
    let room = this.rooms.get(client.sessionId);
    const wasEmpty = !room;
    if (!room) {
      room = { sessionId: client.sessionId, ownerId, mapId: 'trail', players: new Map() };
      this.rooms.set(client.sessionId, room);
    } else {
      // синхронизируем владельца с авторитетным источником (на случай mismatch)
      room.ownerId = ownerId;
    }
    // host = владелец сессии; обновляем флаг на случай reconnect-а хоста
    client.isHost = room.ownerId === client.userId;
    const existed = room.players.get(client.userId);
    if (existed) {
      // reconnect: заменить сокет, сохранить роль/ready
      existed.socket = client.socket;
      existed.coopRole = client.coopRole;
      existed.ready = client.ready;
      existed.isHost = client.isHost;
    } else {
      if (room.players.size >= COOP_MAX_PLAYERS) {
        return { type: 'coop:error', code: 'room_full', message: 'Комната заполнена (макс. 4 игрока)' };
      }
      room.players.set(client.userId, client);
    }
    const players = playerList(room);
    // уведомить остальных участников (новичок получит полный список в welcome)
    if (!wasEmpty) {
      this.broadcast(room, { type: 'coop:players', players }, client.userId);
    }
    return {
      type: 'coop:welcome',
      sessionId: room.sessionId,
      ownerId: room.ownerId,
      isHost: client.isHost,
      selfUserId: client.userId,
      players,
      mapId: room.mapId
    };
  }

  /**
   * Удаляет клиента из комнаты. Возвращает мета о том, что нужно бродкастить:
   *   hostLeft=true  → комната распущена, гостям послать coop:host-left
   *   peerLeftUserId → гостям/хосту послать coop:peer-left
   */
  leave(client: CoopClient): { hostLeft: boolean; peerLeftUserId: string | null; sessionId: string | null } {
    const room = client.sessionId ? this.rooms.get(client.sessionId) : undefined;
    if (!room) {
      return { hostLeft: false, peerLeftUserId: null, sessionId: null };
    }
    const wasHost = room.players.get(client.userId)?.isHost ?? false;
    room.players.delete(client.userId);
    const remaining = [...room.players.values()];
    if (room.players.size === 0) {
      this.rooms.delete(room.sessionId);
      return { hostLeft: wasHost, peerLeftUserId: null, sessionId: room.sessionId };
    }
    if (wasHost) {
      // хост ушёл → комната распускается (без авторитетного сима игра невозможна)
      this.rooms.delete(room.sessionId);
      return { hostLeft: true, peerLeftUserId: null, sessionId: room.sessionId };
    }
    // гость ушёл — уведомить оставшихся
    this.broadcast(room, { type: 'coop:peer-left', userId: client.userId });
    this.broadcast(room, { type: 'coop:players', players: playerList(room) });
    return { hostLeft: false, peerLeftUserId: null, sessionId: room.sessionId };
  }

  /** Обрабатывает входящее co-op сообщение от клиента. */
  handleMessage(from: CoopClient, msg: CoopClientMessage): void {
    const room = this.rooms.get(from.sessionId);
    if (!room) return;
    switch (msg.type) {
      case 'coop:set-role': {
        const c = room.players.get(from.userId);
        if (c) c.coopRole = msg.role;
        this.broadcast(room, { type: 'coop:players', players: playerList(room) });
        break;
      }
      case 'coop:set-map': {
        // только хост выбирает карту; бродкаст всем (включая хоста для подтверждения)
        if (!from.isHost) break;
        room.mapId = msg.mapId;
        this.broadcast(room, { type: 'coop:map', mapId: room.mapId });
        break;
      }
      case 'coop:ready': {
        const c = room.players.get(from.userId);
        if (c) c.ready = msg.ready;
        this.broadcast(room, { type: 'coop:players', players: playerList(room) });
        break;
      }
      case 'coop:input': {
        // гостевой ввод → только хосту
        this.sendToHost(room, { type: 'coop:input', input: msg.input });
        break;
      }
      case 'coop:state': {
        // только хост может раздавать снапшоты; бродкаст всем гостям
        if (!from.isHost) break;
        this.broadcast(room, { type: 'coop:state', snapshot: msg.snapshot }, from.userId);
        break;
      }
      case 'coop:request-snapshot': {
        // гость просит актуальный статус → хосту
        this.sendToHost(room, { type: 'coop:request-snapshot', fromUserId: from.userId });
        break;
      }
      case 'coop:start': {
        if (!from.isHost) break;
        this.broadcast(room, { type: 'coop:start', ownerId: room.ownerId });
        break;
      }
      case 'coop:leave-lobby': {
        // мягкое покидание лобби (сокет остаётся) — просто обновляем список
        this.broadcast(room, { type: 'coop:players', players: playerList(room) });
        break;
      }
      // ping/pong и coop:join обрабатываются на уровне connection-handler
      default:
        break;
    }
  }

  private sendToHost(room: Room, msg: CoopServerMessage): void {
    const host = [...room.players.values()].find((c) => c.isHost);
    if (host) send(host.socket, msg);
  }

  /** Бродкаст всем в комнате. Опц. исключить userId (отправителя). */
  private broadcast(room: Room, msg: CoopServerMessage, exceptUserId?: string): void {
    for (const c of room.players.values()) {
      if (exceptUserId && c.userId === exceptUserId) continue;
      send(c.socket, msg);
    }
  }
}
