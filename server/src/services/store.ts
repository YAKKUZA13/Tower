import crypto from 'crypto';
import { transaction } from '../db/pool.js';
import { createDefaultMap, normalizeMapDocument } from '../domain/map.js';
import { getRedisOrNull } from '../redis/client.js';
import {
  findActiveAuthSessionWithUser,
  insertAuthSession,
  revokeAuthSession
} from '../repositories/auth-sessions-repository.js';
import {
  closeSession,
  findActiveSession,
  insertSessionWithGm,
  upsertPlayerParticipant
} from '../repositories/game-sessions-repository.js';
import { findUserByLogin, insertUserWithProfile, normalizeAccountRole, normalizeLogin, createEmptyProfile } from '../repositories/users-repository.js';
import { deleteAssetById, findAssetById, findAssetWithDataById, insertAsset, listAssets } from '../repositories/assets-repository.js';
import { readMapDocument, writeMapDocument } from '../repositories/maps-repository.js';
import type { AssetRecord, AssetWithData } from '../types/assets.js';
import type { AccountRole, AuthSession, AuthSessionLookup, PasswordHash, PublicUser, UserAccount } from '../types/auth.js';
import type { GameSession } from '../types/game-session.js';
import type { MapDocument } from '../types/map.js';

const AUTH_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const AUTH_CACHE_TTL_SECONDS = 60;

export async function ensureDataDirs(): Promise<void> {
  // Runtime data is stored in PostgreSQL/Redis. Kept only as a startup compatibility hook.
}

export function toPublicUser(user: UserAccount | PublicUser | null | undefined): PublicUser | null {
  if (!user) return null;
  const login = user.login || user.username;
  return {
    userId: user.userId,
    login,
    username: login,
    defaultRole: normalizeAccountRole(user.defaultRole),
    profile: user.profile || createEmptyProfile(),
    createdAt: user.createdAt || 0,
    updatedAt: user.updatedAt || 0
  };
}

async function hashPassword(password: unknown): Promise<PasswordHash> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, PASSWORD_KEY_LENGTH, PASSWORD_PARAMS);
  return {
    algorithm: 'scrypt',
    salt,
    hash: Buffer.from(derived).toString('hex'),
    keyLength: PASSWORD_KEY_LENGTH,
    params: { ...PASSWORD_PARAMS }
  };
}

async function verifyPassword(password: unknown, stored: PasswordHash): Promise<boolean> {
  if (!stored || stored.algorithm !== 'scrypt' || !stored.salt || !stored.hash) return false;
  const keyLength = Number(stored.keyLength) || PASSWORD_KEY_LENGTH;
  const params = stored.params || PASSWORD_PARAMS;
  const derived = crypto.scryptSync(String(password), stored.salt, keyLength, params);
  const storedBuffer = Buffer.from(String(stored.hash), 'hex');
  const derivedBuffer = Buffer.from(derived);
  if (storedBuffer.length !== derivedBuffer.length) return false;
  return crypto.timingSafeEqual(storedBuffer, derivedBuffer);
}

function hashToken(token: unknown): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function authCacheKey(tokenHash: string): string {
  return `auth:session:${tokenHash}`;
}

function revokedTokenKey(tokenHash: string): string {
  return `auth:revoked:${tokenHash}`;
}

export async function findUserByUsername(username: unknown): Promise<UserAccount | null> {
  return findUserByLogin(username);
}

export async function createUserWithPassword(
  loginRaw: unknown,
  passwordRaw: unknown,
  defaultRoleRaw: unknown = 'player'
): Promise<UserAccount | null> {
  const login = normalizeLogin(loginRaw);
  const exists = await findUserByUsername(login);
  if (exists) return null;
  const now = Date.now();
  const user: UserAccount = {
    userId: crypto.randomUUID(),
    login,
    username: login,
    defaultRole: normalizeAccountRole(defaultRoleRaw) as AccountRole,
    password: await hashPassword(passwordRaw),
    profile: createEmptyProfile(),
    createdAt: now,
    updatedAt: now
  };
  await transaction(async (client) => insertUserWithProfile(client, user));
  return user;
}

export async function verifyPasswordLogin(loginRaw: unknown, passwordRaw: unknown): Promise<UserAccount | null> {
  const user = await findUserByUsername(loginRaw);
  if (!user) return null;
  const isValid = await verifyPassword(passwordRaw, user.password);
  return isValid ? user : null;
}

export async function createAuthSession(user: UserAccount): Promise<{ authSession: AuthSession; token: string }> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const now = Date.now();
  const authSession: AuthSession = {
    sessionId: crypto.randomUUID(),
    userId: user.userId,
    tokenHash,
    createdAt: now,
    expiresAt: now + AUTH_SESSION_TTL_MS,
    lastSeenAt: now,
    revokedAt: null
  };
  await insertAuthSession(authSession);
  const redis = await getRedisOrNull();
  if (redis) {
    await redis.setEx(authCacheKey(tokenHash), AUTH_CACHE_TTL_SECONDS, JSON.stringify({
      authSession,
      user: toPublicUser(user)
    }));
  }
  return { authSession, token };
}

export async function findAuthSessionByToken(token: unknown): Promise<AuthSessionLookup | null> {
  const tokenHash = hashToken(token);
  const now = Date.now();
  const redis = await getRedisOrNull();
  if (redis && await redis.exists(revokedTokenKey(tokenHash))) return null;
  if (redis) {
    const cached = await redis.get(authCacheKey(tokenHash));
    if (cached) {
      const parsed = JSON.parse(cached) as AuthSessionLookup;
      if (!parsed.authSession.expiresAt || parsed.authSession.expiresAt > now) {
        return parsed;
      }
    }
  }

  const result = await findActiveAuthSessionWithUser(tokenHash, now);
  if (redis && result) {
    await redis.setEx(authCacheKey(tokenHash), AUTH_CACHE_TTL_SECONDS, JSON.stringify(result));
  }
  return result;
}

export async function deleteAuthSession(token: unknown): Promise<boolean> {
  const tokenHash = hashToken(token);
  const ok = await revokeAuthSession(tokenHash, Date.now());
  const redis = await getRedisOrNull();
  if (redis) {
    await redis.del(authCacheKey(tokenHash));
    await redis.setEx(revokedTokenKey(tokenHash), Math.ceil(AUTH_SESSION_TTL_MS / 1000), '1');
  }
  return ok;
}

export async function getActiveSession(sessionId: string | null): Promise<GameSession | null> {
  return findActiveSession(sessionId);
}

export async function createSession(gmUser: PublicUser): Promise<GameSession> {
  const now = Date.now();
  const gmName = gmUser.login || gmUser.username;
  const session: GameSession = {
    sessionId: crypto.randomUUID(),
    gmUserId: gmUser.userId,
    gmName,
    gm: {
      userId: gmUser.userId,
      username: gmName,
      characterName: '',
      role: 'gm'
    },
    players: [],
    createdAt: now,
    updatedAt: now,
    mapOwnerId: '',
    mapId: '',
    status: 'active'
  };
  session.mapOwnerId = session.sessionId;
  session.mapId = session.sessionId;
  await transaction(async (client) => insertSessionWithGm(client, session));
  return session;
}

export async function joinSession(
  sessionId: string,
  user: PublicUser,
  characterName = ''
): Promise<GameSession | null> {
  const session = await getActiveSession(sessionId);
  if (!session) return null;
  const username = user.login || user.username;
  await upsertPlayerParticipant(sessionId, user.userId, username, characterName, Date.now());
  return await getActiveSession(sessionId);
}

export async function resetSession(sessionId: string): Promise<void> {
  await closeSession(sessionId, Date.now());
}

export async function readMap(ownerId: string): Promise<MapDocument> {
  const document = await readMapDocument(ownerId);
  return document ? normalizeMapDocument(document) : getDefaultMap();
}

export async function writeMap(ownerId: string, map: MapDocument): Promise<void> {
  const normalized = normalizeMapDocument(map);
  await writeMapDocument(ownerId, normalized);
}

export function getDefaultMap(): MapDocument {
  return normalizeMapDocument(createDefaultMap());
}

export async function readAssets(): Promise<AssetRecord[]> {
  return listAssets();
}

export async function addAsset({
  name,
  mime,
  dataBuffer,
  ownerUserId = null
}: {
  name: string;
  mime?: string;
  dataBuffer: Buffer;
  ownerUserId?: string | null;
}): Promise<AssetRecord> {
  const safeName = name.replace(/[^\w.-]+/g, '_');
  const id = crypto.randomUUID();
  const storedName = `${id}_${safeName}`;
  const record: AssetWithData = {
    id,
    ownerUserId,
    name: safeName,
    mime: mime || 'application/octet-stream',
    file: storedName,
    size: dataBuffer.byteLength,
    createdAt: Date.now(),
    data: dataBuffer
  };
  await insertAsset(record);
  const { data: _data, ...asset } = record;
  return asset;
}

export async function getAssetById(id: string): Promise<AssetRecord | null> {
  return findAssetById(id);
}

export async function getAssetWithDataById(id: string): Promise<AssetWithData | null> {
  return findAssetWithDataById(id);
}

export async function deleteAsset(id: string): Promise<boolean> {
  const asset = await getAssetById(id);
  if (!asset) return false;
  await deleteAssetById(id);
  return true;
}
