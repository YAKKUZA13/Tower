import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthSession, PublicUser } from './auth.js';
import type { ServerMessage, WsClient } from './realtime.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: PublicUser;
    authSession?: AuthSession;
  }

  interface FastifyInstance {
    wsClients: Set<WsClient>;
    broadcast(sessionId: string | null, payload: ServerMessage): void;
  }
}
