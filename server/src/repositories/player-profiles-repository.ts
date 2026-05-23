import { query } from '../db/pool.js';
import type { PlayerProfile } from '../types/auth.js';

export async function upsertPlayerProfile(userId: string, profile: PlayerProfile, updatedAt: number): Promise<void> {
  await query(
    `INSERT INTO player_profiles (user_id, wins, losses, rewards, stats, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id)
     DO UPDATE SET wins = EXCLUDED.wins, losses = EXCLUDED.losses, rewards = EXCLUDED.rewards, stats = EXCLUDED.stats, updated_at = EXCLUDED.updated_at`,
    [userId, profile.wins, profile.losses, JSON.stringify(profile.rewards || []), profile.stats || {}, updatedAt]
  );
}
