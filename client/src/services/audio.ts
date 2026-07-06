/**
 * AudioManager — процедурные звуки TD через WebAudio (Phase 8 задача 8.4).
 *
 * Ассеты НЕ требуются: все звуки синтезируются из осцилляторов/шума на лету
 * (= CC0-эквивалент, коммерчески безопасно, нулевой weight в бандле). Это
 * плейсхолдер-звук для MVP; чтобы подключить реальные CC0-паки (Kenney),
 * достаточно заменить тела методов на декодинг AudioBuffer'ов.
 *
 * AudioContext создаётся лениво при первом вызове (требует user-gesture в браузерах).
 * mute/volume — глобально. Все вызовы безопасны, если аудио недоступно (no-op).
 */

type SfxName = 'shoot' | 'hit' | 'place' | 'coin' | 'wave' | 'win' | 'lose' | 'spell' | 'error';

class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.35;
  /** Последнее время проигрывания sfx (для троттлинга частых звуков — shoot/hit). */
  private lastPlayed: Record<SfxName, number> = {} as Record<SfxName, number>;

  /** Инициализация (lazy) — вызывать после user-gesture (например, первый клик). */
  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  play(name: SfxName, opts: { throttleMs?: number } = {}): void {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    if (opts.throttleMs) {
      const last = this.lastPlayed[name] || 0;
      if ((now * 1000) - last < opts.throttleMs) return;
      this.lastPlayed[name] = now * 1000;
    }
    try {
      switch (name) {
        case 'shoot': this.tone(420, 0.06, 'square', 0.18, now, 180); break;
        case 'hit':   this.tone(220, 0.05, 'triangle', 0.15, now, 90); break;
        case 'place': this.tone(320, 0.08, 'sine', 0.22, now, 480); break;
        case 'coin':  this.tone(880, 0.05, 'sine', 0.18, now, 1320); break;
        case 'wave':  this.sweep(180, 90, 0.5, 'sawtooth', 0.25, now); break;
        case 'spell': this.sweep(600, 1200, 0.35, 'sine', 0.28, now); break;
        case 'win':   this.chord([523, 659, 784], 0.7, now); break;
        case 'lose':  this.sweep(300, 70, 0.9, 'sawtooth', 0.3, now); break;
        case 'error': this.tone(140, 0.12, 'square', 0.2, now, 100); break;
      }
    } catch {
      /* аудио недоступно — молча игнорируем */
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    startAt: number,
    endFreq?: number
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startAt);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), startAt + dur);
    }
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(gain, startAt + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }

  private sweep(
    fromHz: number,
    toHz: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    startAt: number
  ): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, startAt);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), startAt + dur);
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(gain, startAt + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(startAt);
    osc.stop(startAt + dur + 0.02);
  }

  private chord(freqs: number[], dur: number, startAt: number): void {
    for (let i = 0; i < freqs.length; i++) {
      this.tone(freqs[i], dur, 'sine', 0.16, startAt + i * 0.09);
    }
  }
}

/** Глобальный синглтон (аудио — единый AudioContext на страницу). */
export const audio = new AudioManager();
