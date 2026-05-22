const AUTH_TOKEN_KEY = 'authToken';
const AUTH_USER_KEY = 'authUser';
const SESSION_ID_KEY = 'sessionId';
const GAME_ROLE_KEY = 'role';

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.removeItem('apiKey');
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem('apiKey');
}

export function getStoredAuthUser<T>(): T | null {
  const raw = localStorage.getItem(AUTH_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function setStoredAuthUser(user: unknown): void {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

export function clearStoredAuthUser(): void {
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem('username');
}

export function getStoredSessionId(): string {
  return localStorage.getItem(SESSION_ID_KEY) || '';
}

export function setStoredSessionId(sessionId: string): void {
  localStorage.setItem(SESSION_ID_KEY, sessionId);
}

export function clearStoredSessionId(): void {
  localStorage.removeItem(SESSION_ID_KEY);
}

export function getStoredGameRole(): string {
  return localStorage.getItem(GAME_ROLE_KEY) || '';
}

export function setStoredGameRole(role: string): void {
  localStorage.setItem(GAME_ROLE_KEY, role);
}

export function clearStoredGameRole(): void {
  localStorage.removeItem(GAME_ROLE_KEY);
}
