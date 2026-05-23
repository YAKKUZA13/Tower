import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import type { AccountRole, PasswordHash, PlayerProfile, UserAccount } from '../types/auth.js';

export interface UserRow extends QueryResultRow {
  user_id: string;
  login: string;
  username: string;
  default_role: AccountRole;
  password: PasswordHash;
  profile: PlayerProfile | null;
  created_at: number | string;
  updated_at: number | string;
}

function createEmptyProfile(): PlayerProfile {
  return {
    wins: 0,
    losses: 0,
    rewards: [],
    stats: {}
  };
}

export function normalizeAccountRole(role: unknown): AccountRole {
  return role === 'gm' || role === 'player' ? role : 'player';
}

export function normalizeLogin(login: unknown): string {
  return String(login || '').trim();
}

export function toUser(row?: UserRow): UserAccount | null {
  if (!row) return null;
  return {
    userId: row.user_id,
    login: row.login,
    username: row.username || row.login,
    defaultRole: normalizeAccountRole(row.default_role),
    password: row.password,
    profile: row.profile || createEmptyProfile(),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0)
  };
}

export async function findUserByLogin(loginRaw: unknown): Promise<UserAccount | null> {
  const login = normalizeLogin(loginRaw);
  const res = await query<UserRow>('SELECT * FROM users WHERE login = $1', [login]);
  return toUser(res.rows[0]);
}

export async function insertUserWithProfile(client: PoolClient, user: UserAccount): Promise<void> {
  await client.query(
    `INSERT INTO users (user_id, login, username, default_role, password, profile, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [user.userId, user.login, user.username, user.defaultRole, user.password, user.profile, user.createdAt, user.updatedAt]
  );
  await client.query(
    `INSERT INTO player_profiles (user_id, wins, losses, rewards, stats, updated_at)
     VALUES ($1, 0, 0, '[]'::jsonb, '{}'::jsonb, $2)`,
    [user.userId, user.createdAt]
  );
}

export { createEmptyProfile };
