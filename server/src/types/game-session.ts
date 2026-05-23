export type GameRole = 'gm' | 'player' | 'spectator';

export interface GameParticipant {
  userId: string;
  username: string;
  characterName: string;
  role: GameRole;
}

export interface GameSession {
  sessionId: string;
  gmUserId: string;
  gmName: string;
  gm: GameParticipant;
  players: GameParticipant[];
  createdAt: number;
  updatedAt: number;
  mapOwnerId: string;
  mapId: string;
  status: 'active' | 'closed' | string;
}
