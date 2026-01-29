import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const MAPS_DIR = path.join(DATA_DIR, 'maps');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ASSETS_DIR = path.join(DATA_DIR, 'assets');
const ASSETS_INDEX = path.join(ASSETS_DIR, 'assets.json');

// Larger default playfield with higher tile density
const DEFAULT_GRID = { cols: 32, rows: 18, cellSize: 1.5 };

function valueNoise(x, y, seed = 1) {
  const h = Math.sin(seed + x * 127.1 + y * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

function fbmNoise(x, y, seed = 1, octaves = 4, persistence = 0.5, lacunarity = 2) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    // Bilinear blend of value noise
    const xf = x * freq;
    const yf = y * freq;
    const x0 = Math.floor(xf);
    const y0 = Math.floor(yf);
    const tx = xf - x0;
    const ty = yf - y0;
    const v00 = valueNoise(x0, y0, seed);
    const v10 = valueNoise(x0 + 1, y0, seed);
    const v01 = valueNoise(x0, y0 + 1, seed);
    const v11 = valueNoise(x0 + 1, y0 + 1, seed);
    const vx0 = v00 * (1 - tx) + v10 * tx;
    const vx1 = v01 * (1 - tx) + v11 * tx;
    const blended = vx0 * (1 - ty) + vx1 * ty;

    sum += blended * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function generateDefaultHeightmap(rows, cols, seed = 7) {
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeCols = Math.max(1, Number(cols) || 1);
  const hm = [];
  // Scale controls hill size; amplitude controls height variation.
  const scale = 0.08;
  const amplitude = 8;
  for (let r = 0; r < safeRows; r++) {
    const row = [];
    for (let c = 0; c < safeCols; c++) {
      const nx = c * scale;
      const ny = r * scale;
      const h = fbmNoise(nx, ny, seed, 4, 0.55, 2.1) * amplitude;
      row.push(h);
    }
    hm.push(row);
  }
  return hm;
}

function makeZeroHeightmap(rows, cols, fill = 0) {
  const safeRows = Math.max(1, Number(rows) || 1);
  const safeCols = Math.max(1, Number(cols) || 1);
  return Array.from({ length: safeRows }, () => Array.from({ length: safeCols }, () => fill));
}

function buildDefaultMap() {
  return {
    version: 1,
    grid: { ...DEFAULT_GRID },
    heightmap: generateDefaultHeightmap(DEFAULT_GRID.rows, DEFAULT_GRID.cols, 11),
    path: { waypoints: [] },
    base: { hp: 20 },
    waves: [],
    towers: []
  };
}

const DEFAULT_MAP = buildDefaultMap();

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDataDirs() {
  await fs.mkdir(MAPS_DIR, { recursive: true });
  if (!(await fileExists(USERS_FILE))) {
    await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  if (!(await fileExists(SESSIONS_FILE))) {
    await fs.writeFile(SESSIONS_FILE, JSON.stringify([], null, 2), 'utf-8');
  }
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  if (!(await fileExists(ASSETS_INDEX))) {
    await fs.writeFile(ASSETS_INDEX, JSON.stringify([], null, 2), 'utf-8');
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

function getMapFilePath(userId) {
  return path.join(MAPS_DIR, `${userId}.json`);
}

export async function readUsers() {
  return await readJson(USERS_FILE, []);
}

export async function writeUsers(users) {
  await writeJson(USERS_FILE, users);
}

export async function findUserByUsername(username) {
  const users = await readUsers();
  return users.find(u => u.username === username) || null;
}

export async function findUserByApiKey(apiKey) {
  const users = await readUsers();
  return users.find(u => u.apiKey === apiKey) || null;
}

export async function createOrGetUser(username) {
  const users = await readUsers();
  let user = users.find(u => u.username === username);
  if (!user) {
    user = {
      userId: crypto.randomUUID(),
      username,
      apiKey: crypto.randomBytes(24).toString('hex')
    };
    users.push(user);
    await writeUsers(users);
  }
  return user;
}

export async function verifyUser(username, apiKey) {
  const users = await readUsers();
  const user = users.find(u => u.username === username && u.apiKey === apiKey);
  return user || null;
}

export async function readSessions() {
  return await readJson(SESSIONS_FILE, []);
}

export async function writeSessions(sessions) {
  await writeJson(SESSIONS_FILE, sessions);
}

export async function getActiveSession(sessionId) {
  const sessions = await readSessions();
  if (sessionId) {
    return sessions.find(s => s.sessionId === sessionId) || null;
  }
  return sessions[0] || null;
}

export async function createSession(gmUser) {
  const sessions = await readSessions();
  const session = {
    sessionId: crypto.randomUUID(),
    gmUserId: gmUser.userId,
    gmName: gmUser.username,
    players: [],
    createdAt: Date.now(),
    mapOwnerId: gmUser.userId
  };
  // overwrite existing active session for simplicity
  const updated = [session, ...sessions.filter(s => s.sessionId === session.sessionId ? false : true)];
  await writeSessions(updated);
  return session;
}

export async function joinSession(sessionId, user, characterName = '') {
  const sessions = await readSessions();
  const idx = sessions.findIndex(s => s.sessionId === sessionId);
  if (idx === -1) return null;
  const session = sessions[idx];
  const exists = session.players.find(p => p.userId === user.userId);
  if (!exists) {
    session.players.push({ userId: user.userId, username: user.username, characterName });
    sessions[idx] = session;
    await writeSessions(sessions);
  }
  return session;
}

export async function resetSession(sessionId) {
  const sessions = await readSessions();
  const filtered = sessions.filter(s => s.sessionId !== sessionId);
  await writeSessions(filtered);
}

export async function readMap(ownerId) {
  const filePath = getMapFilePath(ownerId);
  if (!(await fileExists(filePath))) {
    return getDefaultMap();
  }
  return await readJson(filePath, getDefaultMap());
}

export async function writeMap(ownerId, map) {
  const filePath = getMapFilePath(ownerId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJson(filePath, map);
}

export function getDefaultMap() {
  return JSON.parse(JSON.stringify(DEFAULT_MAP));
}

export async function readAssets() {
  return await readJson(ASSETS_INDEX, []);
}

export async function writeAssets(assets) {
  await writeJson(ASSETS_INDEX, assets);
}

export function buildAssetPath(filename) {
  return path.join(ASSETS_DIR, filename);
}

export async function addAsset({ name, mime, dataBuffer }) {
  const safeName = name.replace(/[^\w.\-]+/g, '_');
  const id = crypto.randomUUID();
  const storedName = `${id}_${safeName}`;
  const filePath = buildAssetPath(storedName);
  await fs.writeFile(filePath, dataBuffer);
  const stats = await fs.stat(filePath);
  const record = {
    id,
    name: safeName,
    mime: mime || 'application/octet-stream',
    file: storedName,
    size: stats.size,
    createdAt: Date.now()
  };
  const assets = await readAssets();
  assets.push(record);
  await writeAssets(assets);
  return record;
}

export async function getAssetById(id) {
  const assets = await readAssets();
  return assets.find(a => a.id === id) || null;
}

export async function deleteAsset(id) {
  const assets = await readAssets();
  const idx = assets.findIndex(a => a.id === id);
  if (idx === -1) return false;
  const asset = assets[idx];
  const filePath = buildAssetPath(asset.file);
  try { await fs.unlink(filePath); } catch {}
  assets.splice(idx, 1);
  await writeAssets(assets);
  return true;
}
