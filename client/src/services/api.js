const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

function authHeaders(extra = {}) {
  const usernameRaw = localStorage.getItem('username') || '';
  const tokenRaw = localStorage.getItem('authToken') || localStorage.getItem('apiKey') || '';
  const username = usernameRaw.trim();
  const token = tokenRaw.trim();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(username ? { 'x-username': encodeURIComponent(username) } : {}),
    ...extra
  };
}

export async function register(username) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username })
  });
  if (!res.ok) throw new Error('register_failed');
  return await res.json();
}

export async function login(username, apiKey) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, apiKey })
  });
  if (!res.ok) throw new Error('login_failed');
  return await res.json();
}

export async function getMap() {
  const sessionId = localStorage.getItem('sessionId') || '';
  const res = await fetch(`${BASE}/map`, {
    method: 'GET',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {})
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`map_load_failed:${res.status}:${txt}`);
  }
  return await res.json();
}

export async function saveMap(map) {
  const sessionId = localStorage.getItem('sessionId') || '';
  const res = await fetch(`${BASE}/map`, {
    method: 'POST',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {}),
    body: JSON.stringify(map)
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`map_save_failed:${res.status}:${txt}`);
  }
  return await res.json();
}

export async function createSession() {
  const res = await fetch(`${BASE}/session/session`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({})
  });
  if (!res.ok) throw new Error('session_create_failed');
  return await res.json();
}

export async function joinSession(sessionId, characterName = '') {
  const res = await fetch(`${BASE}/session/join`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId, characterName })
  });
  if (!res.ok) throw new Error('session_join_failed');
  return await res.json();
}

export async function getSession(sessionId) {
  const res = await fetch(`${BASE}/session/session`, {
    method: 'GET',
    headers: authHeaders(sessionId ? { 'x-session-id': sessionId } : {})
  });
  if (!res.ok) throw new Error('session_get_failed');
  return await res.json();
}

export async function resetSession(sessionId) {
  const res = await fetch(`${BASE}/session/session/reset`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId })
  });
  if (!res.ok) throw new Error('session_reset_failed');
  return await res.json();
}

export async function listAssets() {
  const res = await fetch(`${BASE}/assets`, { headers: authHeaders() });
  if (!res.ok) throw new Error('assets_list_failed');
  return await res.json();
}

export async function uploadAsset({ name, dataBase64, mime }) {
  const res = await fetch(`${BASE}/assets/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ name, dataBase64, mime })
  });
  if (!res.ok) throw new Error('asset_upload_failed');
  return await res.json();
}

export async function deleteAsset(id) {
  const res = await fetch(`${BASE}/assets/${id}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  if (!res.ok) throw new Error('asset_delete_failed');
  return await res.json();
}
