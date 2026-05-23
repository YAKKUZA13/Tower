import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import type { GameParticipant, GameSession } from '../types/game-session.js';

interface GameSessionRow extends QueryResultRow {
  session_id: string;
  gm_user_id: string;
  gm_name: string;
  gm: GameParticipant;
  map_owner_id: string | null;
  map_id: string | null;
  status: string | null;
  created_at: number | string;
  updated_at: number | string;
}

interface ParticipantRow extends QueryResultRow {
  user_id: string;
  username: string;
  character_name: string | null;
  role: 'gm' | 'player' | 'spectator';
}

function toGameSession(row?: GameSessionRow, players: GameParticipant[] = []): GameSession | null {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    gmUserId: row.gm_user_id,
    gmName: row.gm_name,
    gm: row.gm,
    players,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    mapOwnerId: row.map_owner_id || row.session_id,
    mapId: row.map_id || row.session_id,
    status: row.status || 'active'
  };
}

export async function readParticipants(sessionId: string): Promise<GameParticipant[]> {
  const res = await query<ParticipantRow>(
    `SELECT user_id, username, character_name, role
     FROM game_participants
     WHERE session_id = $1
     ORDER BY joined_at ASC`,
    [sessionId]
  );
  return res.rows.map(row => ({
    userId: row.user_id,
    username: row.username,
    characterName: row.character_name || '',
    role: row.role
  }));
}

export async function findActiveSession(sessionId: string | null): Promise<GameSession | null> {
  const res = sessionId
    ? await query<GameSessionRow>('SELECT * FROM game_sessions WHERE session_id = $1', [sessionId])
    : await query<GameSessionRow>(`SELECT * FROM game_sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`);
  const row = res.rows[0];
  if (!row) return null;
  const participants = await readParticipants(row.session_id);
  const players = participants.filter(p => p.role === 'player');
  return toGameSession(row, players);
}

export async function insertSessionWithGm(client: PoolClient, session: GameSession): Promise<void> {
  await client.query(
    `INSERT INTO game_sessions (session_id, gm_user_id, gm_name, gm, map_id, map_owner_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
    [
      session.sessionId,
      session.gmUserId,
      session.gmName,
      session.gm,
      session.mapId,
      session.mapOwnerId,
      session.createdAt,
      session.updatedAt
    ]
  );
  await client.query(
    `INSERT INTO game_participants (session_id, user_id, username, character_name, role, joined_at)
     VALUES ($1, $2, $3, '', 'gm', $4)
     ON CONFLICT (session_id, user_id) DO NOTHING`,
    [session.sessionId, session.gmUserId, session.gmName, session.createdAt]
  );
}

export async function upsertPlayerParticipant(
  sessionId: string,
  userId: string,
  username: string,
  characterName: string,
  joinedAt: number
): Promise<void> {
  await query(
    `INSERT INTO game_participants (session_id, user_id, username, character_name, role, joined_at)
     VALUES ($1, $2, $3, $4, 'player', $5)
     ON CONFLICT (session_id, user_id)
     DO UPDATE SET character_name = EXCLUDED.character_name, username = EXCLUDED.username`,
    [sessionId, userId, username, characterName, joinedAt]
  );
}

export async function closeSession(sessionId: string, updatedAt: number): Promise<void> {
  await query(`UPDATE game_sessions SET status = 'closed', updated_at = $1 WHERE session_id = $2`, [updatedAt, sessionId]);
}
