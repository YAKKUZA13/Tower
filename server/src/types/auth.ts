export type AccountRole = 'gm' | 'player';

export interface PlayerProfile {
  wins: number;
  losses: number;
  rewards: unknown[];
  stats: Record<string, unknown>;
}

export interface PasswordHash {
  algorithm: 'scrypt';
  salt: string;
  hash: string;
  keyLength: number;
  params: {
    N: number;
    r: number;
    p: number;
  };
}

export interface UserAccount {
  userId: string;
  login: string;
  username: string;
  defaultRole: AccountRole;
  password: PasswordHash;
  profile: PlayerProfile;
  createdAt: number;
  updatedAt: number;
}

export type PublicUser = Omit<UserAccount, 'password'>;

export interface AuthSession {
  sessionId: string;
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  revokedAt: number | null;
}

export interface AuthSessionLookup {
  authSession: AuthSession;
  user: PublicUser;
}
