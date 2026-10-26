import { Engine } from '@babylonjs/core/Engines/engine.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';

export type LabBackend = 'webgl' | 'webgpu' | 'auto';
export interface LabBackendReport {
  requested: LabBackend;
  selected: 'webgl' | 'webgpu';
  fallbackReason?: string;
}
interface EngineFactories {
  webgpu(canvas: HTMLCanvasElement): Promise<AbstractEngine>;
  webgl(canvas: HTMLCanvasElement): AbstractEngine;
  freshCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement;
}

const defaults: EngineFactories = {
  async webgpu(canvas) {
    const { WebGPUEngine } = await import('@babylonjs/core/Engines/webgpuEngine.js');
    if (!await WebGPUEngine.IsSupportedAsync) throw new Error('No supported WebGPU adapter');
    const engine = new WebGPUEngine(canvas, { stencil: true });
    try { await engine.initAsync(); return engine; }
    catch (error) { engine.dispose(); throw error; }
  },
  webgl: canvas => new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true }),
  freshCanvas(canvas) {
    // A canvas may already own a WebGPU context after failed initialization.
    // WebGL fallback must not reuse that context-locked canvas.
    const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
    canvas.replaceWith(replacement);
    return replacement;
  },
};

/** Lab-only experiment. Default stays WebGL; no change to Tower startup. */
export async function createLabEngine(canvas: HTMLCanvasElement, requested: LabBackend = 'webgl',
  overrides: Partial<EngineFactories> = {}) {
  const factory = { ...defaults, ...overrides };
  let fallbackReason: string | undefined;
  if (requested !== 'webgl') {
    try {
      const engine = await factory.webgpu(canvas);
      return { engine, canvas, report: { requested, selected: 'webgpu' } satisfies LabBackendReport };
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error);
      canvas = factory.freshCanvas(canvas);
    }
  }
  const engine = factory.webgl(canvas);
  return { engine, canvas, report: { requested, selected: 'webgl', fallbackReason } satisfies LabBackendReport };
}
