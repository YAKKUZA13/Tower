-- Phase 0.7: indexes for TD leaderboards on match_results (table from 001_initial_schema.sql).
-- winner_user_id + created_at DESC: player top results / global leaderboard by recency.
CREATE INDEX IF NOT EXISTS idx_match_results_winner_created_at
  ON match_results(winner_user_id, created_at DESC);

-- session_id: lookup results of a particular run/session.
CREATE INDEX IF NOT EXISTS idx_match_results_session_id
  ON match_results(session_id);