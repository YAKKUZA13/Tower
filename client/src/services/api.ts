import type { AuthResponse, AuthUser, RegisterCredentials } from '../domain/auth';
import type { GameSession } from '../domain/game-session';
import { getAuthToken, getStoredSessionId } from './token-storage';

const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message);
  }
}

function authHeaders(extra: Record<string, string> = {}): HeadersInit {
  const token = getAuthToken().trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function readJsonOrThrow<T>(res: Response, errorPrefix: string): Promise<T> {
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new ApiError(`${errorPrefix}:${res.status}:${txt}`, res.status, txt);
  }
  return await res.json() as T;
}

export async function register(payload: RegisterCredentials): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await readJsonOrThrow<AuthResponse>(res, 'register_failed');
}

export async function login(payload: { login: string; password: string }): Promise<AuthResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await readJsonOrThrow<AuthResponse>(res, 'login_failed');
}

export async function logout(): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/auth/logout`, {
    method: 'POST',
    headers: authHeaders()
  });
  return await readJsonOrThrow<{ ok: boolean }>(res, 'logout_failed');
}

export async function getMe(): Promise<AuthUser> {
  const res = await fetch(`${BASE}/auth/me`, {
    method: 'GET',
    headers: authHeaders()
  });
  return await readJsonOrThrow<AuthUser>(res, 'me_failed');
}

// ── Co-op session endpoints (rooms) ──────────────────────────────────────

export async function createSession(): Promise<GameSession> {
  const res = await fetch(`${BASE}/session/session`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return await readJsonOrThrow<GameSession>(res, 'session_create_failed');
}

export async function joinSession(sessionId: string): Promise<GameSession> {
  const res = await fetch(`${BASE}/session/join`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId })
  });
  return await readJsonOrThrow<GameSession>(res, 'session_join_failed');
}

export async function getSession(sessionId: string): Promise<GameSession | null> {
  const res = await fetch(`${BASE}/session/session`, {
    method: 'GET',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {})
  });
  return await readJsonOrThrow<GameSession | null>(res, 'session_get_failed');
}

export async function resetSession(sessionId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/session/session/reset`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId })
  });
  return await readJsonOrThrow<{ ok: boolean }>(res, 'session_reset_failed');
}

// ── Phase 8: результаты забегов + лидерборды ──────────────────────────────

export interface RunPayload {
  outcome: 'won' | 'lost';
  wavesCleared: number;
  gold: number;
  lives: number;
  mapId?: string;
  mode?: 'single' | 'coop';
  durationSec?: number;
}

export interface RunResultResponse {
  ok: boolean;
  wins: number;
  losses: number;
  newRewards: Array<{ id: string; label: string }>;
}

export interface LeaderboardEntry {
  id: string;
  userId: string;
  username: string;
  outcome: 'won' | 'lost';
  wavesCleared: number;
  gold: number;
  lives: number;
  mode: string;
  createdAt: number;
}

export async function submitRun(payload: RunPayload): Promise<RunResultResponse> {
  const sessionId = getStoredSessionId();
  const res = await fetch(`${BASE}/run`, {
    method: 'POST',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {}),
    body: JSON.stringify(payload)
  });
  return await readJsonOrThrow<RunResultResponse>(res, 'run_submit_failed');
}

export async function getLeaderboard(mapId?: string, limit = 20): Promise<LeaderboardEntry[]> {
  const params = new URLSearchParams();
  if (mapId) params.set('map', mapId);
  params.set('limit', String(limit));
  const res = await fetch(`${BASE}/run/leaderboard?${params.toString()}`, {
    headers: authHeaders()
  });
  const data = await readJsonOrThrow<{ entries: LeaderboardEntry[] }>(res, 'leaderboard_failed');
  return data.entries;
}
