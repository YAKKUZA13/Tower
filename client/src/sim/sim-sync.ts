/**
 * GuestSync — буфер снапшотов + интерполяция для гостевого рендера (Phase 7 задача 7.3).
 *
 * Гость НЕ шагает сим (ADR-2): он рендерит авторитетные снапшоты от хоста (10 Гц).
 * Чтобы движение врагов/снарядов/юнитов было плавным между 10 Гц-апдейтами,
 * держим jitter-буфер и интерполируем позиции сущностей между двумя соседними
 * снапшотами на ~120 мс позади реального времени. Это даёт ≤150 мс визуальной
 * задержки (критерий приёмки Фазы 7) и гладкость без локального предсказания.
 *
 * Неинтерполируемые поля (gold/lives/status/waveIndex/...) снапают из старшего
 * снапшота (S0) — экономика/правила меняются дискретно и не нуждаются в lerping.
 */

import type { Enemy, GameSnapshot, Projectile } from '@tower/shared';
import type { DefenderUnit } from '@tower/shared';

interface TimedSnapshot {
  snapshot: GameSnapshot;
  /** Время прибытия (performance.now()), мс — таймлайн для интерполяции. */
  arrivalMs: number;
}

const RENDER_DELAY_MS = 120;
const MAX_BUFFER = 12;
const MIN_BUFFER_FOR_INTERP = 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  t: number,
  out: { x: number; y: number; z: number }
): void {
  out.x = lerp(ax, bx, t);
  out.y = lerp(ay, by, t);
  out.z = lerp(az, bz, t);
}

export class GuestSync {
  private buffer: TimedSnapshot[] = [];
  /** Последний полный снапшот для UI (gold/lives/wave/...) — без интерполяции. */
  private latest: GameSnapshot | null = null;

  /** Принять новый авторитетный снапшот от хоста. */
  push(snapshot: GameSnapshot): void {
    this.latest = snapshot;
    const arrivalMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.buffer.push({ snapshot, arrivalMs });
    if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    // выкинуть слишком старые снапшоты (старше 2 секунд — они уже не нужны для интерполяции)
    const cutoff = arrivalMs - 2000;
    while (this.buffer.length > MIN_BUFFER_FOR_INTERP && this.buffer[0].arrivalMs < cutoff) {
      this.buffer.shift();
    }
  }

  /** Самый свежий снапшот (для game-store/UI — экономика, статусы). */
  getLatest(): GameSnapshot | null {
    return this.latest;
  }

  /** Сбросить буфер (например, при переходе между статусами/рестарте хоста). */
  clear(): void {
    this.buffer = [];
    this.latest = null;
  }

  /**
   * Возвращает снапшот для рендера в момент `nowMs` (performance.now()).
   * Если буфера недостаточно — снапает к последнему; иначе интерполирует
   * позиции сущностей между окружающими снапшотами на RENDER_DELAY_MS позади.
   */
  sample(nowMs: number): GameSnapshot | null {
    if (this.buffer.length === 0) return this.latest;
    if (this.buffer.length < MIN_BUFFER_FOR_INTERP) return this.buffer[this.buffer.length - 1].snapshot;

    const renderTime = nowMs - RENDER_DELAY_MS;

    // найти S0 (<= renderTime) и S1 (> renderTime)
    let s0: TimedSnapshot | null = null;
    let s1: TimedSnapshot | null = null;
    for (let i = 0; i < this.buffer.length; i++) {
      const cur = this.buffer[i];
      if (cur.arrivalMs <= renderTime) {
        s0 = cur;
      } else {
        s1 = cur;
        break;
      }
    }
    // renderTime позади самого старого → snap к старейшему доступному
    if (!s0) return this.buffer[0].snapshot;
    // renderTime впереди самого нового → snap к последнему (без экстраполяции —
    // ждём следующий снапшот, кратковольный «стоп» лучше дрожания)
    if (!s1) return this.buffer[this.buffer.length - 1].snapshot;

    const span = s1.arrivalMs - s0.arrivalMs;
    const alpha = span > 0 ? Math.max(0, Math.min(1, (renderTime - s0.arrivalMs) / span)) : 0;

    return this.interpolate(s0.snapshot, s1.snapshot, alpha);
  }

  /**
   * Строит интерполированный снапшот: основа — S0, позиции сущностей lerping к S1.
   * Сущности, отсутствующие в одном из них, снапают (появление/исчезновение).
   */
  private interpolate(s0: GameSnapshot, s1: GameSnapshot, alpha: number): GameSnapshot {
    const base: GameSnapshot = {
      ...s0,
      // быстро меняющиеся «счётчики» берём из старшего, чтобы UI не дёргался назад
      tick: s0.tick,
      gold: s0.gold,
      lives: s0.lives,
      waveEnemiesRemaining: s0.waveEnemiesRemaining
    };

    // ── enemies ──
    if (s0.enemies.length > 0 || s1.enemies.length > 0) {
      const byIdS1 = new Map<string, Enemy>();
      for (const e of s1.enemies) byIdS1.set(e.id, e);
      const out: Enemy[] = [];
      for (const e0 of s0.enemies) {
        const e1 = byIdS1.get(e0.id);
        if (!e1) {
          out.push(e0);
          continue;
        }
        const pos = { x: 0, y: 0, z: 0 };
        lerp3(e0.position.x, e0.position.y, e0.position.z, e1.position.x, e1.position.y, e1.position.z, alpha, pos);
        out.push({
          ...e0,
          position: pos,
          pathProgress: lerp(e0.pathProgress, e1.pathProgress, alpha),
          hp: e0.hp
        });
      }
      base.enemies = out;
    }

    // ── projectiles ──
    if (s0.projectiles.length > 0 || s1.projectiles.length > 0) {
      const byIdS1 = new Map<string, Projectile>();
      for (const p of s1.projectiles) byIdS1.set(p.id, p);
      const out: Projectile[] = [];
      for (const p0 of s0.projectiles) {
        const p1 = byIdS1.get(p0.id);
        if (!p1) {
          out.push(p0);
          continue;
        }
        out.push({
          ...p0,
          x: lerp(p0.x, p1.x, alpha),
          y: lerp(p0.y, p1.y, alpha),
          z: lerp(p0.z, p1.z, alpha)
        });
      }
      base.projectiles = out;
    }

    // ── defenderUnits (RTS) ──
    if (s0.defenderUnits && s1.defenderUnits && (s0.defenderUnits.length > 0 || s1.defenderUnits.length > 0)) {
      const byIdS1 = new Map<string, DefenderUnit>();
      for (const u of s1.defenderUnits) byIdS1.set(u.id, u);
      const out: DefenderUnit[] = [];
      for (const u0 of s0.defenderUnits) {
        const u1 = byIdS1.get(u0.id);
        if (!u1) {
          out.push(u0);
          continue;
        }
        const pos = { x: 0, y: 0, z: 0 };
        lerp3(u0.position.x, u0.position.y, u0.position.z, u1.position.x, u1.position.y, u1.position.z, alpha, pos);
        out.push({ ...u0, position: pos });
      }
      base.defenderUnits = out;
    }

    return base;
  }
}
