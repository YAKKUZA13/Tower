/**
 * RunsRepository — запись результатов забегов TD (Phase 8 задачи 8.1–8.3).
 *
 * Таблица `match_results` (миграция 001) + индексы (миграция 003):
 *   id, session_id (nullable), winner_user_id (nullable), payload jsonb, created_at.
 *
 * При записи:
 *   - winner_user_id = userId при outcome='won', иначе null;
 *   - инкрементируются wins/losses в `player_profiles` и `users.profile` (denormalized
 *     для быстрого возврата в /auth/me);
 *   - минимальный мета-прогресс: при достижении порогов wins в profile.rewards
 *     добавляются «награды» (id/label), которые UI может показывать как «разблокировано».
 */

import { transaction, query } from '../db/pool.js';
import type { QueryResultRow } from 'pg';
import type { PlayerProfile } from '../types/auth.js';
import { findUserByLogin } from './users-repository.js';

/** Типизированная полезная нагрузка результата забега. */
export interface RunPayload {
  outcome: 'won' | 'lost';
  wavesCleared: number;
  gold: number;
  lives: number;
  mapId: string;
  mode: 'single' | 'coop';
  durationSec?: number;
}

/** DTO строки лидерборда. */
export interface LeaderboardEntry {
  id: string;
  userId: string;
  username: string;
  outcome: 'won' | 'lost';
  wavesCleared: number;
  gold: number;
  lives: number;
  mode: string;
  createdAt: number;
}

interface MatchResultRow extends QueryResultRow {
  id: string;
  winner_user_id: string | null;
  payload: RunPayload;
  created_at: number | string;
}

/** Награды мета-прогресса: выдаются при достижении порога wins. */
const WIN_REWARDS: Array<{ at: number; id: string; label: string }> = [
  { at: 1, id: 'first-victory', label: 'Первая победа' },
  { at: 3, id: 'tactician', label: 'Тактик (3 победы)' },
  { at: 5, id: 'warlord', label: 'Военачальник (5 побед)' },
  { at: 10, id: 'dark-lord', label: 'Тёмный владыка (10 побед)' }
];

/**
 * Записывает результат забега, обновляет wins/losses и мета-прогресс.
 * Возвращает обновлённый публичный профиль (для клиента) и список новых наград.
 */
export async function recordRunResult(
  userId: string,
  payload: RunPayload,
  sessionId: string | null
): Promise<{ newRewards: Array<{ id: string; label: string }>; wins: number; losses: number }> {
  const now = Date.now();
  const won = payload.outcome === 'won';
  const runId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  return await transaction(async (client) => {
    // 1. записать match_results
    await client.query(
      `INSERT INTO match_results (id, session_id, winner_user_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, sessionId, won ? userId : null, payload, now]
    );

    // 2. атомарно инкрементировать wins/losses в player_profiles и вернуть новое значение
    const profileRes = await client.query<{ wins: number; losses: number; rewards: unknown[] }>(
      `UPDATE player_profiles
       SET wins = wins + ${won ? 1 : 0},
           losses = losses + ${won ? 0 : 1},
           updated_at = $2
       WHERE user_id = $1
       RETURNING wins, losses, rewards`,
      [userId, now]
    );
    const wins: number = profileRes.rows[0]?.wins ?? (won ? 1 : 0);
    const losses: number = profileRes.rows[0]?.losses ?? (won ? 0 : 1);
    const existingRewards = normalizeRewards(profileRes.rows[0]?.rewards);

    // 3. мета-прогресс: добавить награды, чей порог достигнут/превышён wins
    const newRewards: Array<{ id: string; label: string }> = [];
    const merged: Array<{ id: string; type: string; label: string; earnedAt: number }> = [...existingRewards];
    for (const r of WIN_REWARDS) {
      if (wins >= r.at && !merged.some((m) => m.id === r.id)) {
        const reward = { id: r.id, type: 'win-milestone', label: r.label, earnedAt: now };
        merged.push(reward);
        newRewards.push({ id: r.id, label: r.label });
      }
    }

    if (newRewards.length > 0 || won || !won) {
      await client.query(
        `UPDATE player_profiles SET rewards = $2, updated_at = $3 WHERE user_id = $1`,
        [userId, JSON.stringify(merged), now]
      );
    }

    // 4. синхронизировать denormalized users.profile (источник для /auth/me)
    const userRes = await client.query<{ profile: PlayerProfile | null }>(
      'SELECT profile FROM users WHERE user_id = $1',
      [userId]
    );
    const currentProfile = userRes.rows[0]?.profile || { wins: 0, losses: 0, rewards: [], stats: {} };
    const updatedProfile: PlayerProfile = {
      wins,
      losses,
      rewards: merged,
      stats: currentProfile.stats || {}
    };
    await client.query(
      `UPDATE users SET profile = $2, updated_at = $3 WHERE user_id = $1`,
      [userId, updatedProfile, now]
    );

    return { newRewards, wins, losses };
  });
}

/** Топ результатов для лидерборда. Опц. фильтр по mapId. */
export async function getLeaderboard(limit: number, mapId?: string): Promise<LeaderboardEntry[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
  const params: unknown[] = [safeLimit];
  let where = '';
  if (mapId) {
    params.unshift(mapId);
    where = 'WHERE m.payload->>\'mapId\' = $1';
  }
  const res = await query<QueryResultRow>(
    `SELECT m.id, m.winner_user_id, m.payload, m.created_at, u.username
     FROM match_results m
     LEFT JOIN users u ON u.user_id = m.winner_user_id
     ${where}
     ORDER BY (m.payload->>'wavesCleared')::int DESC,
              (m.payload->>'lives')::int DESC,
              (m.payload->>'gold')::int DESC,
              m.created_at DESC
     LIMIT $${mapId ? 2 : 1}`,
    params
  );
  return res.rows.map((row) => toLeaderboardEntry(row));
}

function toLeaderboardEntry(row: QueryResultRow): LeaderboardEntry {
  const p = (row.payload || {}) as Partial<RunPayload>;
  return {
    id: row.id,
    userId: row.winner_user_id || '',
    username: row.username || '(без игрока)',
    outcome: (p.outcome === 'won' ? 'won' : 'lost'),
    wavesCleared: Number(p.wavesCleared || 0),
    gold: Number(p.gold || 0),
    lives: Number(p.lives || 0),
    mode: p.mode || 'single',
    createdAt: Number(row.created_at || 0)
  };
}

function normalizeRewards(raw: unknown): Array<{ id: string; type: string; label: string; earnedAt: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; type: string; label: string; earnedAt: number }> = [];
  for (const r of raw) {
    if (r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') {
      const rr = r as { id: string; type?: string; label?: string; earnedAt?: number };
      out.push({
        id: rr.id,
        type: rr.type || 'unknown',
        label: rr.label || rr.id,
        earnedAt: Number(rr.earnedAt || 0)
      });
    }
  }
  return out;
}

// re-export для удобства (used by services/store.ts если понадобится)
export { findUserByLogin };
