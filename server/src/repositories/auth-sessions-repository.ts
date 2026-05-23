import type { QueryResultRow } from 'pg';
import { query } from '../db/pool.js';
import { toUser, type UserRow } from './users-repository.js';
import type { AuthSession, AuthSessionLookup } from '../types/auth.js';

interface AuthSessionRow extends QueryResultRow, Partial<UserRow> {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: number | string;
  expires_at: number | string;
  last_seen_at: number | string;
  revoked_at: number | string | null;
}

export function toAuthSession(row?: AuthSessionRow): AuthSession | null {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: Number(row.created_at || 0),
    expiresAt: Number(row.expires_at || 0),
    lastSeenAt: Number(row.last_seen_at || 0),
    revokedAt: row.revoked_at ? Number(row.revoked_at) : null
  };
}

export async function insertAuthSession(authSession: AuthSession): Promise<void> {
  await query(
    `INSERT INTO auth_sessions (session_id, user_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      authSession.sessionId,
      authSession.userId,
      authSession.tokenHash,
      authSession.createdAt,
      authSession.expiresAt,
      authSession.lastSeenAt
    ]
  );
}

export async function findActiveAuthSessionWithUser(tokenHash: string, now: number): Promise<AuthSessionLookup | null> {
  const res = await query<AuthSessionRow>(
    `SELECT a.*, u.*
     FROM auth_sessions a
     JOIN users u ON u.user_id = a.user_id
     WHERE a.token_hash = $1 AND a.revoked_at IS NULL AND a.expires_at > $2`,
    [tokenHash, now]
  );
  const row = res.rows[0];
  if (!row) return null;
  await query('UPDATE auth_sessions SET last_seen_at = $1 WHERE session_id = $2', [now, row.session_id]);
  const authSession = toAuthSession(row);
  const user = toUser(row as UserRow);
  return authSession && user ? { authSession, user } : null;
}

export async function revokeAuthSession(tokenHash: string, revokedAt: number): Promise<boolean> {
  const res = await query(
    `UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL`,
    [revokedAt, tokenHash]
  );
  return (res.rowCount || 0) > 0;
}
