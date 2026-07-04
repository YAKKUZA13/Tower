import type { WebSocket } from '@fastify/websocket';
import type { GameRole } from './game-session.js';

export interface WsClient {
  socket: WebSocket;
  sessionId: string | null;
  userId: string;
  role: GameRole;
}

export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}

export interface ClientMessage {
  type?: string;
  [key: string]: unknown;
}
