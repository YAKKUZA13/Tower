/**
 * PerfMonitor (M0 — baseline & visual verify).
 *
 * Лёгкий DOM-overlay для фиксации perf-базовой линии (FPS / draw calls /
 * активные треугольники / число мешей) поверх Babylon-сцены. Не вмешивается
 * в рендер: читает engine.getFps() + scene-метрики каждый интервал апдейта.
 *
 * Назначение (voxel-migration-plan M0): сравнить 50 rigged врагов vs thin
 * instance baseline, зафиксировать потолок FPS для LOD-порогов (M1/M4).
 *
 * Включение: `const hud = new PerfMonitor(engine, scene); hud.setEnabled(true)`.
 * В production отключён (no-op overhead, если setEnabled(false)).
 */
import type { Engine, Scene } from 'babylonjs';

export interface PerfSample {
  fps: number;
  drawCalls: number;
  totalVertices: number;
  totalTriangles: number;
  activeMeshes: number;
  frameMs: number;
}

export interface PerfSnapshot {
  /** Текущий сэмпл. */
  current: PerfSample;
  /** Скользящее среднее FPS (последние N сэмплов). */
  avgFps: number;
  /** Минимальный FPS за период сбора (1% low approximation). */
  minFps: number;
  /** Максимальный FPS за период сбора. */
  maxFps: number;
  /** Число собранных сэмплов. */
  samples: number;
}

const UPDATE_INTERVAL_MS = 250;
const ROLLING_WINDOW = 60;

export class PerfMonitor {
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly container: HTMLDivElement;
  private readonly textEl: HTMLDivElement;
  private enabled = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly fpsHistory: number[] = [];
  private minFps = Infinity;
  private maxFps = 0;

  /** Подписчик на сэмплы — для внешнего сбора baseline (e.g. console log / store). */
  private listener: ((snap: PerfSnapshot) => void) | null = null;

  constructor(engine: Engine, scene: Scene) {
    this.engine = engine;
    this.scene = scene;

    this.container = document.createElement('div');
    this.container.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px', 'z-index:50',
      'padding:6px 10px', 'border-radius:6px',
      'background:rgba(8,10,14,0.78)', 'color:#9fe3b8',
      'font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
      'pointer-events:none', 'white-space:pre',
      'border:1px solid rgba(120,200,160,0.25)',
      'display:none'
    ].join(';');

    this.textEl = document.createElement('div');
    this.container.appendChild(this.textEl);
  }

  /** Прикрепляет overlay к родителю канваса. Безопасно вызывать многократно. */
  attach(parent: HTMLElement = document.body): void {
    if (!this.container.parentElement) parent.appendChild(this.container);
  }

  detach(): void {
    this.container.parentElement?.removeChild(this.container);
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.container.style.display = enabled ? 'block' : 'none';
    if (enabled) {
      this.attach();
      // Включаем Babylon performance monitor для frame-time метрик.
      this.engine.performanceMonitor?.enable();
      this.reset();
      this.timer = setInterval(() => this.sample(), UPDATE_INTERVAL_MS);
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.engine.performanceMonitor?.disable();
    }
  }

  isEnabled(): boolean { return this.enabled; }

  /** Регистрирует колбэк, вызываемый на каждый сэмпл (для baseline-сбора). */
  onSample(listener: ((snap: PerfSnapshot) => void) | null): void {
    this.listener = listener;
  }

  /** Сбрасывает скользящую статистику (перед новым замером). */
  reset(): void {
    this.fpsHistory.length = 0;
    this.minFps = Infinity;
    this.maxFps = 0;
  }

  /** Текущий снимок (без ожидания таймера). */
  snapshot(): PerfSnapshot {
    return this.buildSnapshot(this.readMetrics());
  }

  private readMetrics(): PerfSample {
    const fps = this.engine.getFps();
    const pm = this.engine.performanceMonitor;
    const frameMs = pm ? pm.instantaneousFrameTime : 0;
    // drawCalls — приватный счётчик Babylon; доступ через cast (только чтение).
    const drawCalls = (this.engine as unknown as { _drawCalls?: number })._drawCalls ?? 0;
    // triangles = Σ mesh.getTotalIndices() / 3 по активным мешам.
    // SmartArray не итерируется Symbol.iterator — обращаемся к .data[0..length).
    const active = this.scene.getActiveMeshes();
    let tri = 0;
    for (let i = 0; i < active.length; i++) {
      const m = active.data[i]!;
      const g = (m as { getTotalIndices?: () => number }).getTotalIndices;
      if (typeof g === 'function') tri += g.call(m);
    }
    return {
      fps,
      drawCalls,
      totalVertices: this.scene.getTotalVertices(),
      totalTriangles: Math.round(tri / 3),
      activeMeshes: active.length,
      frameMs
    };
  }

  private buildSnapshot(s: PerfSample): PerfSnapshot {
    this.fpsHistory.push(s.fps);
    if (this.fpsHistory.length > ROLLING_WINDOW) this.fpsHistory.shift();
    if (s.fps < this.minFps) this.minFps = s.fps;
    if (s.fps > this.maxFps) this.maxFps = s.fps;
    const sum = this.fpsHistory.reduce((a, b) => a + b, 0);
    const avg = sum / Math.max(1, this.fpsHistory.length);
    return {
      current: s,
      avgFps: avg,
      minFps: this.fpsHistory.length ? this.minFps : 0,
      maxFps: this.maxFps,
      samples: this.fpsHistory.length
    };
  }

  private sample(): void {
    const snap = this.buildSnapshot(this.readMetrics());
    const c = snap.current;
    this.textEl.textContent = [
      `FPS  ${c.fps.toFixed(0).padStart(3)}  (avg ${snap.avgFps.toFixed(0)}  min ${snap.minFps.toFixed(0)})`,
      `draw ${c.drawCalls}`,
      `tri  ${formatBig(c.totalTriangles)}`,
      `vert ${formatBig(c.totalVertices)}`,
      `mesh ${c.activeMeshes}`,
      c.frameMs ? `frame ${c.frameMs.toFixed(2)}ms` : ''
    ].filter(Boolean).join('\n');
    if (this.listener) this.listener(snap);
  }

  dispose(): void {
    this.setEnabled(false);
    this.detach();
    this.listener = null;
  }
}

function formatBig(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}
