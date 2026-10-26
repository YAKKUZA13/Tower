import assert from 'node:assert/strict';
import { createLabEngine } from '../packages/voxel-lab/src/create-engine.js';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js';

async function main() {
  const canvas = { id: 'original' } as unknown as HTMLCanvasElement;
  const fresh = { id: 'replacement' } as unknown as HTMLCanvasElement;
  const gl = { name: 'webgl' } as unknown as AbstractEngine;
  const gpu = { name: 'webgpu' } as unknown as AbstractEngine;
  let attempts = 0, replacements = 0;
  const hooks = {
    webgpu: async () => { attempts++; return gpu; },
    webgl: (target: HTMLCanvasElement) => { assert.ok(target === canvas || target === fresh); return gl; },
    freshCanvas: () => { replacements++; return fresh; },
  };
  const baseline = await createLabEngine(canvas, 'webgl', hooks);
  assert.equal(attempts, 0); assert.equal(baseline.engine, gl); assert.equal(replacements, 0);
  const accelerated = await createLabEngine(canvas, 'webgpu', hooks);
  assert.equal(accelerated.engine, gpu); assert.equal(accelerated.report.selected, 'webgpu');
  assert.equal(replacements, 0);
  for (const mode of ['webgpu', 'auto'] as const) {
    const fallback = await createLabEngine(canvas, mode, {
      ...hooks, webgpu: async () => { throw new Error('Injected initialization failure'); },
      webgl: target => { assert.equal(target, fresh); return gl; },
    });
    assert.equal(fallback.report.requested, mode); assert.equal(fallback.report.selected, 'webgl');
    assert.equal(fallback.report.fallbackReason, 'Injected initialization failure');
    assert.equal(fallback.canvas, fresh);
  }
  assert.equal(replacements, 2);
  console.log('PASS lab backend: default WebGL, WebGPU selection, explicit auto/request fallback, fresh canvas after failure');
  console.log('This is a lifecycle test with injected factories, not a hardware WebGPU result.');
}
void main();
