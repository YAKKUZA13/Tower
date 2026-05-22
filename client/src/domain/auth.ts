export const accountRoles = {
  gm: 'gm',
  player: 'player'
} as const;

export type AccountRole = (typeof accountRoles)[keyof typeof accountRoles];

export interface AuthCredentials {
  login: string;
  password: string;
}

export interface RegisterCredentials extends AuthCredentials {
  defaultRole: AccountRole;
}

export interface AuthUser {
  userId: string;
  login: string;
  username: string;
  defaultRole: AccountRole;
}

export interface AuthSession {
  sessionId: string;
  token: string;
  expiresAt: number;
}

export interface AuthResponse {
  user: AuthUser;
  authSession: AuthSession;
  token: string;
}
