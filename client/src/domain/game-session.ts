export type GameRole = 'gm' | 'player' | 'spectator';

export interface GameParticipant {
  userId: string;
  username: string;
  role?: GameRole;
}

export interface GameSession {
  sessionId: string;
  role: GameRole;
  gmName: string;
  gm?: GameParticipant;
  players: GameParticipant[];
  mapId?: string;
  createdAt?: number;
  status?: 'active' | 'closed';
}
