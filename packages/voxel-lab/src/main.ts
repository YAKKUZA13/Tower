/**
 * Voxel Lab — main entry
 * Babylon playground for pure voxel-core engine demos.
 */
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { createGreedyScene, type LabScene } from './scenes/greedy-lab';
import { createModelViewerScene } from './scenes/model-viewer';
import { createKitScene } from './scenes/kit-lab';
import { createTerrainScene } from './scenes/terrain-lab';
import { createMaterialLab } from './scenes/material-lab';
import { createRecipeScene } from './scenes/recipe-lab';
import { createRitualLab } from './scenes/ritual-lab';
import { createCharacterLab } from './scenes/character-lab';
import { createLabEngine, type LabBackend } from './create-engine';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation.js';
import '@babylonjs/core/Engines/Extensions/engine.query.js';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.query.js';

async function bootstrap() {
const startedAt = performance.now();
let firstFrameMs: number | null = null;
const cpuSamples: number[] = [];
const requested = new URLSearchParams(location.search).get('backend');
const backend: LabBackend = requested === 'webgpu' || requested === 'auto' ? requested : 'webgl';
const { engine, canvas, report } = await createLabEngine(document.getElementById('canvas') as HTMLCanvasElement, backend);
Object.assign(window, { __labBackend: report });
document.getElementById('backend-status')!.textContent = `Backend: ${report.selected} (requested ${report.requested})` +
  (report.fallbackReason ? ` — fallback: ${report.fallbackReason}` : '') +
  (report.selected === 'webgpu' ? ' — experimental; fixture parity not certified' : '');
const scene = new Scene(engine);
type Samples = { cpu: number[]; frame: number[]; gpu: number[] };
let measurement: { warmup: number; remaining: number; state: string; samples: Samples; last: number;
  resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined;
const configuration = () => JSON.stringify({
  tab: document.querySelector('#tabs .active')?.id, fixture: document.body.dataset.characterReady,
  scene: document.body.dataset.sceneReady, width: engine.getRenderWidth(), height: engine.getRenderHeight(),
  settings: [...document.querySelectorAll<HTMLSelectElement | HTMLInputElement>('#tab-content select, #tab-content input:not(#character-time)')]
    .map(input => [input.id, input.value, input instanceof HTMLInputElement ? input.checked : null]),
});
const summarize = (values: number[]) => {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] };
};
function benchmark(warmup = 60, samples = 180): Promise<unknown> {
  if (measurement) return Promise.reject(new Error('Measurement already running'));
  if (![warmup, samples].every(value => Number.isInteger(value) && value >= 1 && value <= 600)) return Promise.reject(new Error('Frame counts must be in [1, 600]'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { measurement = undefined; reject(new Error('Measurement timed out; keep the tab visible')); }, 60_000);
    measurement = { warmup, remaining: samples, state: configuration(), samples: { cpu: [], frame: [], gpu: [] }, last: performance.now(), resolve, reject, timer };
  });
}
Object.assign(window, { __labBenchmark: benchmark });
let savedMeasurement: unknown;
document.getElementById('benchmark-run')!.onclick = async () => {
  const status = document.getElementById('benchmark-result')!;
  status.textContent = 'Measuring; do not switch fixture, resize or hide the tab.';
  const save = document.getElementById('benchmark-save') as HTMLButtonElement; save.disabled = true;
  try { savedMeasurement = await benchmark(); status.textContent = JSON.stringify(savedMeasurement, null, 2); save.disabled = false; }
  catch (error) { status.textContent = String(error); }
};
document.getElementById('benchmark-save')!.onclick = () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(savedMeasurement, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `voxkera-${report.selected}-device.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const instrumentation = new EngineInstrumentation(engine);
instrumentation.captureGPUFrameTime = Boolean(engine.getCaps().timerQuery);
scene.clearColor = new Color4(0.08, 0.08, 0.14, 1);
Object.assign(window, { __labDiagnostics: () => ({
  frames: scene.getFrameId(), meshes: scene.meshes.length,
  nodes: scene.transformNodes.length, materials: scene.materials.length,
  ready: scene.isReady(), activeMeshes: scene.getActiveMeshes().length, clearColor: scene.clearColor.asArray(),
  drawCalls: engine._drawCalls.current,
  cameraMode: scene.activeCamera?.mode,
  postProcesses: scene.postProcesses.map(pass => ({ name: pass.name, ready: pass.isReady(), width: pass.width, height: pass.height, error: pass.getEffect()?.getCompilationError() })),
  canvasRect: canvas.getBoundingClientRect().toJSON(), scrollY: window.scrollY,
  projection: [scene.activeCamera?.orthoLeft, scene.activeCamera?.orthoRight, scene.activeCamera?.orthoBottom, scene.activeCamera?.orthoTop],
  isWebGPU: engine.isWebGPU, engineDescription: engine.description,
  adapterInfo: 'getInfo' in engine && typeof engine.getInfo === 'function' ? engine.getInfo()
    : 'getGlInfo' in engine && typeof engine.getGlInfo === 'function' ? engine.getGlInfo() : null,
  renderWidth: engine.getRenderWidth(), renderHeight: engine.getRenderHeight(), firstFrameMs,
  cpuRenderMs: cpuSamples.length ? cpuSamples.reduce((a, b) => a + b, 0) / cpuSamples.length : null,
  gpuFrameMs: instrumentation.gpuFrameTimeCounter?.count ? instrumentation.gpuFrameTimeCounter.average / 1e6 : null,
  timingNote: 'CPU is render submission only; null GPU means no timing samples. Not a mobile benchmark.',
}) });

// camera
const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 4, 12, Vector3.Zero(), scene);
camera.lowerRadiusLimit = 2;
camera.upperRadiusLimit = 40;
camera.wheelPrecision = 60;
camera.attachControl(canvas, true);

// lights
const hemi = new HemisphericLight('hemi', new Vector3(0.3, 0.8, -0.4), scene);
hemi.intensity = 0.7;
hemi.diffuse.set(0.88, 0.82, 0.72);
const sun = new DirectionalLight('sun', new Vector3(-0.6, -0.9, 0.5), scene);
sun.intensity = 0.8;
sun.diffuse.set(1.0, 0.96, 0.88);

// ground grid
const grid = MeshBuilder.CreateGround('grid', { width: 20, height: 20, subdivisions: 20 }, scene);
const gridMat = new StandardMaterial('gridMat', scene);
gridMat.diffuseColor = new Color3(0.12, 0.12, 0.16);
gridMat.wireframe = true;
gridMat.alpha = 0.3;
grid.material = gridMat;
grid.position.y = -3;

// stats elements
const statTri = document.getElementById('stat-tri')!;
const statVox = document.getElementById('stat-vox')!;
const statMesh = document.getElementById('stat-mesh')!;

function updateStats(tri: number, vox: number, meshing: string) {
  statTri.textContent = String(tri);
  statVox.textContent = String(vox);
  statMesh.textContent = meshing;
}

// scene management
let current: LabScene | null = null;

async function switchTab(tab: string) {
  current?.dispose();
  const content = document.getElementById('tab-content')!;
  content.innerHTML = '';

  const ownsEnvironment = tab === 'material' || tab === 'ritual' || tab === 'character';
  hemi.setEnabled(!ownsEnvironment); sun.setEnabled(!ownsEnvironment); grid.setEnabled(!ownsEnvironment);
  const tabs = ['ritual', 'material', 'greedy', 'models', 'kit', 'terrain', 'recipe', 'character'];
  for (const t of tabs) document.getElementById(`tab-${t}`)!.className = '';

  switch (tab) {
    case 'character': {
      document.getElementById('tab-character')!.className = 'active';
      current = createCharacterLab(scene, camera, updateStats, content);
      break;
    }
    case 'ritual': {
      document.getElementById('tab-ritual')!.className = 'active';
      current = createRitualLab(scene, camera, updateStats, content);
      break;
    }
    case 'material': {
      document.getElementById('tab-material')!.className = 'active';
      current = createMaterialLab(scene, camera, updateStats, content);
      break;
    }
    case 'greedy': {
      document.getElementById('tab-greedy')!.className = 'active';
      current = await createGreedyScene(scene, updateStats);
      break;
    }
    case 'models': {
      document.getElementById('tab-models')!.className = 'active';
      current = await createModelViewerScene(scene, updateStats, content);
      break;
    }
    case 'kit': {
      document.getElementById('tab-kit')!.className = 'active';
      current = await createKitScene(scene, updateStats, content);
      break;
    }
    case 'terrain': {
      document.getElementById('tab-terrain')!.className = 'active';
      current = await createTerrainScene(scene, updateStats, content);
      break;
    }
    case 'recipe': {
      document.getElementById('tab-recipe')!.className = 'active';
      current = createRecipeScene(scene, updateStats, content);
      break;
    }
  }
}

document.getElementById('tab-greedy')!.onclick = () => switchTab('greedy');
document.getElementById('tab-models')!.onclick = () => switchTab('models');
document.getElementById('tab-kit')!.onclick = () => switchTab('kit');
document.getElementById('tab-terrain')!.onclick = () => switchTab('terrain');
document.getElementById('tab-recipe')!.onclick = () => switchTab('recipe');

document.getElementById('tab-material')!.onclick = () => switchTab('material');
document.getElementById('tab-ritual')!.onclick = () => switchTab('ritual');
document.getElementById('tab-character')!.onclick = () => switchTab('character');

// Direct links make visual fixtures repeatable.
switchTab(location.hash === '#character' ? 'character' : location.hash === '#ritual' ? 'ritual' : location.hash === '#material' ? 'material' : 'greedy');

engine.runRenderLoop(() => {
  const before = performance.now(); scene.render();
  const cpu = performance.now() - before;
  cpuSamples.push(cpu); if (cpuSamples.length > 120) cpuSamples.shift();
  const run = measurement;
  if (run) {
    if (document.hidden || run.state !== configuration()) {
      clearTimeout(run.timer); measurement = undefined; run.reject(new Error('Configuration/visibility changed; restart measurement'));
    } else if (run.warmup-- > 0) run.last = before;
    else {
      run.samples.cpu.push(cpu); run.samples.frame.push(before - run.last); run.last = before;
      const gpu = instrumentation.gpuFrameTimeCounter;
      if (gpu?.count) run.samples.gpu.push(gpu.current / 1e6);
      if (--run.remaining === 0) {
        clearTimeout(run.timer); measurement = undefined;
        run.resolve({ backend: report, configuration: JSON.parse(run.state), userAgent: navigator.userAgent,
          secureContext: isSecureContext, samples: run.samples.cpu.length, measuredAt: new Date().toISOString(),
          cpuSubmissionMs: summarize(run.samples.cpu), frameIntervalMs: summarize(run.samples.frame),
          gpuFrameMs: summarize(run.samples.gpu),
          note: 'CPU submission is not GPU time. Null GPU means unavailable. Device model/OS and visual evidence must be recorded separately.' });
      }
    }
  }
  firstFrameMs ??= performance.now() - startedAt;
});
const onResize = () => engine.resize();
window.addEventListener('resize', onResize);
engine.onDisposeObservable.addOnce(() => { window.removeEventListener('resize', onResize); instrumentation.dispose(); });
}
void bootstrap().catch(error => {
  document.getElementById('backend-status')!.textContent = `Lab startup failed: ${String(error)}`;
  console.error(error);
});
