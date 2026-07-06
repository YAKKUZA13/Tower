/**
 * Run routes — запись результата забега и лидерборд (Phase 8 задачи 8.1–8.3).
 *   POST /run               — записать результат (инкремент wins/losses + награды)
 *   GET  /run/leaderboard   — топ результатов (опц. ?map=&limit=)
 *
 * Аутентификация обязательна. session_id (для FK match_results) берётся из
 * x-session-id, если валиден и принадлежит пользователю; иначе null (single-player).
 */
import { recordRunResult, getLeaderboard } from '../repositories/runs-repository.js';
import type { RunPayload } from '../repositories/runs-repository.js';
import { getActiveSession } from '../services/store.js';
import { authenticateRequest } from '../services/auth.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

interface RunBody {
  outcome: 'won' | 'lost';
  wavesCleared: number;
  gold: number;
  lives: number;
  mapId?: string;
  mode?: 'single' | 'coop';
  durationSec?: number;
}

interface LeaderboardQuery {
  map?: string;
  limit?: number;
}

async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ok = await authenticateRequest(req, reply);
  if (!ok) return;
}

const runRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth);

  app.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['outcome', 'wavesCleared', 'gold', 'lives'],
        properties: {
          outcome: { type: 'string', enum: ['won', 'lost'] },
          wavesCleared: { type: 'integer', minimum: 0, maximum: 1000 },
          gold: { type: 'integer', minimum: 0 },
          lives: { type: 'integer', minimum: 0 },
          mapId: { type: 'string' },
          mode: { type: 'string', enum: ['single', 'coop'] },
          durationSec: { type: 'number', minimum: 0 }
        }
      }
    }
  }, async (req: FastifyRequest<{ Body: RunBody }>, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'missing_auth' });
    const user = req.user;
    const b = req.body;

    // минимальный anti-spam: не записывать «пустые» забеги (0 волн и 0 врагов)
    if (b.wavesCleared === 0 && b.outcome === 'won') {
      return reply.code(400).send({ error: 'invalid_run' });
    }

    // определить session_id (если coop-сессия валидна и принадлежит пользователю)
    let sessionId: string | null = null;
    const headerSid = req.headers['x-session-id'] ? String(req.headers['x-session-id']) : null;
    if (headerSid) {
      const session = await getActiveSession(headerSid);
      if (session) {
        const belongs = session.gmUserId === user.userId ||
          session.players.some((p) => p.userId === user.userId);
        if (belongs) sessionId = session.sessionId;
      }
    }

    const payload: RunPayload = {
      outcome: b.outcome,
      wavesCleared: b.wavesCleared,
      gold: b.gold,
      lives: b.lives,
      mapId: b.mapId || user.userId,
      mode: b.mode || 'single',
      ...(b.durationSec !== undefined ? { durationSec: b.durationSec } : {})
    };

    const result = await recordRunResult(user.userId, payload, sessionId);
    return reply.send({
      ok: true,
      wins: result.wins,
      losses: result.losses,
      newRewards: result.newRewards
    });
  });

  app.get('/leaderboard', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          map: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (req: FastifyRequest<{ Querystring: LeaderboardQuery }>, reply) => {
    const limit = req.query.limit ?? 20;
    const mapId = req.query.map || undefined;
    const entries = await getLeaderboard(limit, mapId);
    return reply.send({ entries });
  });
};

export default runRoutes;
