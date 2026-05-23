import 'dotenv/config';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations } from '../src/db/migrate.js';
import { query, closePool } from '../src/db/pool.js';
import { normalizeMapDocument } from '../src/domain/map.js';
import type { AccountRole, PasswordHash, PlayerProfile } from '../src/types/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

interface LegacyUser {
  userId?: string;
  user_id?: string;
  login?: string;
  username?: string;
  defaultRole?: string;
  password?: PasswordHash;
  profile?: Partial<PlayerProfile>;
  createdAt?: number;
  updatedAt?: number;
}

interface NormalizedLegacyUser {
  userId: string;
  login: string;
  username: string;
  defaultRole: AccountRole;
  password: PasswordHash;
  profile: PlayerProfile;
  createdAt: number;
  updatedAt: number;
}

function normalizeLegacyUser(user: LegacyUser): NormalizedLegacyUser | null {
  const login = user.login || user.username;
  if (!login || !user.password) return null;
  return {
    userId: user.userId || user.user_id || login,
    login,
    username: user.username || login,
    defaultRole: user.defaultRole === 'gm' || user.defaultRole === 'player' ? user.defaultRole : 'player',
    password: user.password,
    profile: {
      wins: user.profile?.wins || 0,
      losses: user.profile?.losses || 0,
      rewards: user.profile?.rewards || [],
      stats: user.profile?.stats || {}
    },
    createdAt: user.createdAt || Date.now(),
    updatedAt: user.updatedAt || Date.now()
  };
}

async function migrateUsers() {
  const users = await readJson<LegacyUser[]>(path.join(DATA_DIR, 'users.json'), []);
  let count = 0;
  for (const rawUser of users) {
    const user = normalizeLegacyUser(rawUser);
    if (!user) continue;
    await query(
      `INSERT INTO users (user_id, login, username, default_role, password, profile, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.userId, user.login, user.username, user.defaultRole, user.password, user.profile, user.createdAt, user.updatedAt]
    );
    await query(
      `INSERT INTO player_profiles (user_id, wins, losses, rewards, stats, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.userId, user.profile.wins || 0, user.profile.losses || 0, JSON.stringify(user.profile.rewards || []), user.profile.stats || {}, user.updatedAt]
    );
    count++;
  }
  return count;
}

async function userExists(userId: string | undefined): Promise<boolean> {
  if (!userId) return false;
  const res = await query('SELECT 1 FROM users WHERE user_id = $1', [userId]);
  return Boolean(res.rows[0]);
}

async function migrateSessions() {
  const sessions = await readJson<any[]>(path.join(DATA_DIR, 'sessions.json'), []);
  let count = 0;
  for (const session of sessions) {
    if (!await userExists(session.gmUserId)) continue;
    const gmName = session.gmName || session.gm?.username || 'gm';
    const gm = session.gm || {
      userId: session.gmUserId,
      username: gmName,
      characterName: '',
      role: 'gm'
    };
    await query(
      `INSERT INTO game_sessions (session_id, gm_user_id, gm_name, gm, map_id, map_owner_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (session_id) DO NOTHING`,
      [
        session.sessionId,
        session.gmUserId,
        gmName,
        gm,
        session.mapId || session.sessionId,
        session.mapOwnerId || session.sessionId,
        session.status || 'active',
        session.createdAt || Date.now(),
        session.updatedAt || session.createdAt || Date.now()
      ]
    );
    await query(
      `INSERT INTO game_participants (session_id, user_id, username, character_name, role, joined_at)
       VALUES ($1, $2, $3, '', 'gm', $4)
       ON CONFLICT (session_id, user_id) DO NOTHING`,
      [session.sessionId, session.gmUserId, gmName, session.createdAt || Date.now()]
    );
    for (const player of session.players || []) {
      if (!await userExists(player.userId)) continue;
      await query(
        `INSERT INTO game_participants (session_id, user_id, username, character_name, role, joined_at)
         VALUES ($1, $2, $3, $4, 'player', $5)
         ON CONFLICT (session_id, user_id) DO NOTHING`,
        [session.sessionId, player.userId, player.username, player.characterName || '', session.createdAt || Date.now()]
      );
    }
    count++;
  }
  return count;
}

async function migrateMaps() {
  const mapsDir = path.join(DATA_DIR, 'maps');
  let files = [];
  try {
    files = (await fs.readdir(mapsDir)).filter(file => file.endsWith('.json'));
  } catch {
    return 0;
  }
  let count = 0;
  for (const file of files) {
    const ownerId = path.basename(file, '.json');
    const raw = await readJson(path.join(mapsDir, file), null);
    if (!raw) continue;
    const document = normalizeMapDocument(raw);
    await query(
      `INSERT INTO maps (owner_id, document, version, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'draft', $4, $5)
       ON CONFLICT (owner_id) DO UPDATE SET document = EXCLUDED.document, version = EXCLUDED.version, updated_at = EXCLUDED.updated_at`,
      [ownerId, document, Number(document.version || 1), Date.now(), Date.now()]
    );
    count++;
  }
  return count;
}

async function migrateAssets() {
  const assets = await readJson<any[]>(path.join(DATA_DIR, 'assets', 'assets.json'), []);
  let count = 0;
  for (const asset of assets) {
    await query(
      `INSERT INTO assets (id, owner_user_id, name, mime, file, size, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [asset.id, asset.ownerUserId || null, asset.name, asset.mime || 'application/octet-stream', asset.file, asset.size || 0, asset.createdAt || Date.now()]
    );
    count++;
  }
  return count;
}

async function main() {
  await runMigrations();
  const users = await migrateUsers();
  const sessions = await migrateSessions();
  const maps = await migrateMaps();
  const assets = await migrateAssets();
  console.log(JSON.stringify({ users, sessions, maps, assets }, null, 2));
  await closePool();
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
