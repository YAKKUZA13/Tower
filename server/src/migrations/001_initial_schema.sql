CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  login text NOT NULL UNIQUE,
  username text NOT NULL,
  default_role text NOT NULL CHECK (default_role IN ('gm', 'player')),
  password jsonb NOT NULL,
  profile jsonb NOT NULL DEFAULT '{"wins":0,"losses":0,"rewards":[],"stats":{}}'::jsonb,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  revoked_at bigint
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS player_profiles (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  rewards jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
  owner_id text PRIMARY KEY,
  document jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS game_sessions (
  session_id text PRIMARY KEY,
  gm_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  gm_name text NOT NULL,
  gm jsonb NOT NULL,
  map_id text,
  map_owner_id text,
  status text NOT NULL DEFAULT 'active',
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS game_participants (
  session_id text NOT NULL REFERENCES game_sessions(session_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  username text NOT NULL,
  character_name text NOT NULL DEFAULT '',
  role text NOT NULL CHECK (role IN ('gm', 'player', 'spectator')),
  joined_at bigint NOT NULL,
  PRIMARY KEY (session_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_participants_user_id ON game_participants(user_id);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  owner_user_id text REFERENCES users(user_id) ON DELETE SET NULL,
  name text NOT NULL,
  mime text NOT NULL,
  file text NOT NULL,
  size bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_owner_user_id ON assets(owner_user_id);

CREATE TABLE IF NOT EXISTS match_results (
  id text PRIMARY KEY,
  session_id text REFERENCES game_sessions(session_id) ON DELETE SET NULL,
  winner_user_id text REFERENCES users(user_id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at bigint NOT NULL
);
