import type { AuthResponse, AuthUser, RegisterCredentials } from '../domain/auth';
import type { GameSession } from '../domain/game-session';
import type { MapDocument } from '../domain/map';
import { clearStoredGameRole, clearStoredSessionId, getAuthToken, getStoredSessionId } from './token-storage';

const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

export interface AssetRecord {
  id: string;
  ownerUserId?: string | null;
  name: string;
  mime: string;
  file?: string;
  size: number;
  createdAt?: number;
}

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

function isStaleSessionError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.body.includes('session_not_found');
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

export async function getMap(): Promise<MapDocument> {
  const sessionId = getStoredSessionId();
  const res = await fetch(`${BASE}/map`, {
    method: 'GET',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {})
  });
  return await readJsonOrThrow<MapDocument>(res, 'map_load_failed');
}

export async function saveMap(map: MapDocument): Promise<{ ok: boolean }> {
  const sessionId = getStoredSessionId();
  try {
    return await saveMapForSession(map, sessionId);
  } catch (error) {
    if (!sessionId || !isStaleSessionError(error)) throw error;
    clearStoredSessionId();
    clearStoredGameRole();
    return await saveMapForSession(map, '');
  }
}

async function saveMapForSession(map: MapDocument, sessionId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/map`, {
    method: 'POST',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {}),
    body: JSON.stringify(map)
  });
  return await readJsonOrThrow<{ ok: boolean }>(res, 'map_save_failed');
}

export async function createSession(): Promise<GameSession> {
  const res = await fetch(`${BASE}/session/session`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  return await readJsonOrThrow<GameSession>(res, 'session_create_failed');
}

export async function joinSession(sessionId: string, characterName = ''): Promise<GameSession> {
  const res = await fetch(`${BASE}/session/join`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId, characterName })
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

export async function listAssets(): Promise<AssetRecord[]> {
  const res = await fetch(`${BASE}/assets`, { headers: authHeaders() });
  return await readJsonOrThrow<AssetRecord[]>(res, 'assets_list_failed');
}

export async function uploadAsset({ name, dataBase64, mime }: { name: string; dataBase64: string; mime: string }): Promise<AssetRecord> {
  const res = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, dataBase64, mime })
  });
  return await readJsonOrThrow<AssetRecord>(res, 'asset_upload_failed');
}

export async function deleteAsset(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${BASE}/assets/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  return await readJsonOrThrow<{ ok: boolean }>(res, 'asset_delete_failed');
}

export function getAssetModelUrl(asset: Pick<AssetRecord, 'id' | 'name'>): string {
  return `${BASE}/assets/${asset.id}/${encodeURIComponent(asset.name)}`;
}
