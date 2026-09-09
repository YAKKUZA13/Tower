/**
 * M8.R smoke — pixel-art pipeline (RTT 640×360 + blit + outline-dn + godrays + night).
 *
 * Headless-конструкция: NullEngine + Scene + Camera, конструируем все 10 эффектов
 * по очереди без ошибок. Визуальная проверка против референсов — ручная
 * (нужен WebGL, `docs/M8-PLAN.md` §smoke).
 *
 * Run: npx tsx scripts/smoke-pixel-art.ts
 */
// ── polyfill OffscreenCanvas + ImageData для Node-среды (DynamicTexture) ──
// @ts-expect-error – globals injection для headless Node
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  // minimal stub: Babylon DynamicTexture только getContext().putImageData()/clearRect()
  class OffscreenCanvasStub {
    width: number; height: number;
    constructor(w: number, h: number) { this.width = w; this.height = h; }
    getContext() {
      const self = this;
      return {
        clearRect() {},
        putImageData() {},
        createImageData(w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
        fillRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        quadraticCurveTo() {},
        fill() {},
        // image-data passthrough (smoke не рисует реально)
        canvas: self
      };
    }
  }
  // @ts-expect-error – inject global
  globalThis.OffscreenCanvas = OffscreenCanvasStub;
}
// @ts-expect-error – ImageData часто отсутствует в Node
if (typeof globalThis.ImageData === 'undefined') {
  // @ts-expect-error – inject global
  globalThis.ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
}

import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { createLowresPipeline, computeInternalSize, type LowresHandle } from '../client/src/babylon/pixel-art/lowres';
import {
  applyOrthoDimetric, computePixelSnap, attachDimetricPixelSnap, updateOrthoFrustum
} from '../client/src/babylon/pixel-art/cam-snap';
import {
  createPixelArtToonMaterial, registerPixelArtToonShaders, updatePixelArtToonMaterial,
  applyPixelArtToonToScene
} from '../client/src/babylon/pixel-art/toon-pixel-art';
import { createOutlineDnPostProcess, type OutlineDnHandle } from '../client/src/babylon/pixel-art/outline-dn';
import { createCloudShadow, createTileableCloudNoise } from '../client/src/babylon/pixel-art/cloud-shadow';
import { createGrassField, poissonDiskPlacement } from '../client/src/babylon/pixel-art/grass';
import { createGodRaysPostProcess, type GodRaysHandle } from '../client/src/babylon/pixel-art/godrays';
import { createStylizedWater, createVoronoiWaveTexture } from '../client/src/babylon/pixel-art/water';
import { bakeTreeCanopy } from '../client/src/babylon/pixel-art/poisson-leaves';
import {
  createSparkSpriteSheet, createDustSpriteSheet, createNightOverlay,
  nightAmountFromTimeOfDay
} from '../client/src/babylon/pixel-art/particles-night';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── R1: Lowres RTT + NEAREST blit ────────────────────────────────────────
console.log('1. R1 Lowres RTT 640×360 + NEAREST blit:');
{
  const engine = new NullEngine({ renderWidth: 1280, renderHeight: 720 } as never);
  engine.setHardwareScalingLevel(1);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 10, Vector3.Zero(), scene);

  const size = computeInternalSize(engine, 360);
  check('internal size keeps height=360', size.height === 360);
  check('internal width = round(360 * 16:9)', size.width === 640, `(got ${size.width})`);

  let h: LowresHandle | null = null;
  let threw = false;
  try { h = createLowresPipeline(scene, camera, engine, { internalHeight: 360 }); }
  catch (e) { threw = true; console.error('   ', e); }
  check('lowres pipeline constructs', !threw && h !== null);
  if (h) {
    check('rtt is in scene.customRenderTargets', scene.customRenderTargets.indexOf(h.rtt) >= 0);
    check('blit postprocess created', h.blit.name === 'pixel-art-blit');
    check('setSubpixelOffset no throw', (() => { h!.setSubpixelOffset(0.1, -0.2); return true; })());
    h.dispose();
    check('rtt removed after dispose', scene.customRenderTargets.length === 0);
  }
  engine.dispose();
}

// ── R2: Ortho dimetric camera + pixel-snap ───────────────────────────────
console.log('2. R2 Ortho dimetric camera + pixel-snap:');
{
  const engine = new NullEngine({ renderWidth: 1280, renderHeight: 720 } as never);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3, 10, Vector3.Zero(), scene);

  const restore = applyOrthoDimetric(camera, { visibleWorldHeight: 16 });
  // Babylon: Camera.ORTHOGRAPHIC_CAMERA === 1
  check('camera mode = ORTHOGRAPHIC', camera.mode === 1);
  check('ortho half-extents set', camera.orthoTop === 8 && camera.orthoBottom === -8);

  updateOrthoFrustum(camera, 20);
  check('updateOrthoFrustum updates halfH', camera.orthoTop === 10);

  const r = computePixelSnap(camera, new Vector3(0, 0, 0), 360, 16);
  check('computePixelSnap returns Vector3', r.snappedTarget instanceof Vector3);
  check('subpixel in [-0.5..0.5]', r.subpixelX >= -0.5 && r.subpixelX <= 0.5);

  const snap = attachDimetricPixelSnap(scene, camera, { visibleWorldHeight: 16, internalHeightPx: 360 });
  scene.render();
  check('snap attach + 1 frame render no throw', true);
  snap.dispose();
  restore();
  engine.dispose();
}

// ── R3: Toon pixel-art (5-band ramp + cloud + normal noise) ──────────────
console.log('3. R3 Toon pixel-art (5-band ramp + cloud + normal noise):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);
  registerPixelArtToonShaders();

  let mat = null as ReturnType<typeof createPixelArtToonMaterial> | null;
  let threw = false;
  try {
    mat = createPixelArtToonMaterial(scene, 'test-pa-toon', {
      normalNoise: 0.02,
      ramp: [0.2, 0.4, 0.6, 0.8],
      bandTints: [0.5, 0.7, 0.85, 1.0, 1.3]
    });
  } catch (e) { threw = true; console.error('   ', e); }
  check('createPixelArtToonMaterial no throw', !threw && mat !== null);
  if (mat) {
    let threw2 = false;
    try { updatePixelArtToonMaterial(mat, [0.3, 1, 0.4], { x: 0, y: 5, z: 0 }, { x: 1, y: 2 }, 5); }
    catch (e) { threw2 = true; console.error('   ', e); }
    check('updatePixelArtToonMaterial no throw', !threw2);
  }

  // applyPixelArtToonToScene
  const m1 = MeshBuilder.CreateBox('enemy-mesh', { size: 1 }, scene) as Mesh;
  const m2 = MeshBuilder.CreateBox('tower-inst-1', { size: 1 }, scene) as Mesh;
  const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene) as Mesh;
  const before = m1.material;
  const handle = applyPixelArtToonToScene(scene, camera, [0.3, 1, 0.4]);
  check('toon swaps enemy mesh material', m1.material === handle.material);
  check('toon swaps tower mesh material', m2.material === handle.material);
  check('ground skipped', ground.material !== handle.material);
  handle.dispose();
  check('material restored after dispose', m1.material === before);
  engine.dispose();
}

// ── R4: Depth+normal outlines (replace color-Sobel) ─────────────────────
console.log('4. R4 Depth+normal outlines:');
{
  const engine = new NullEngine({ renderWidth: 256, renderHeight: 256 } as never);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);
  MeshBuilder.CreateBox('test', { size: 1 }, scene);

  let h: OutlineDnHandle | null = null;
  let threw = false;
  try { h = createOutlineDnPostProcess(scene, camera, { edgeStrength: 1.0 }); }
  catch (e) { threw = true; console.error('   ', e); }
  check('outline-dn constructs', !threw && h !== null);
  if (h) {
    check('depthTexture is Texture', !!h.depthTexture);
    check('normalTexture is Texture', !!h.normalTexture);
    h.dispose();
  }
  engine.dispose();
}

// ── R5: Cloud shadows ────────────────────────────────────────────────────
console.log('5. R5 Cloud shadows (tileable noise + uniforms):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tex = createTileableCloudNoise(scene, 128);
  check('tileable cloud noise texture created', !!tex);

  const cloud = createCloudShadow(scene, { windSpeed: 0.5, scale: 8, strength: 0.3 });
  check('cloud-shadow handle created', !!cloud);
  let threw = false;
  try { cloud.update(0.016); }
  catch (e) { threw = true; }
  check('cloud.update no throw', !threw);
  cloud.dispose();
  engine.dispose();
}

// ── R6: Grass (billboards + base-position lighting) ──────────────────────
console.log('6. R6 Grass billboards (base-position lighting):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);

  // poisson placement
  const placement = poissonDiskPlacement(20, 20, 1.5, mulberry32(2024));
  check('poisson placement generates tufts', placement.length > 0, `(got ${placement.length})`);

  let g = null as ReturnType<typeof createGrassField> | null;
  let threw = false;
  try {
    g = createGrassField(scene, camera, placement, 0.8, {
      baseColor: [0.1, 0.22, 0.08],
      tipColor: [0.36, 0.55, 0.18]
    });
  } catch (e) { threw = true; console.error('   ', e); }
  check('grass field constructs', !threw && g !== null);
  if (g) {
    let t2 = false;
    try { g.update(camera.position, [0.3, 1, 0.4], { x: 0.1, y: 0.2 }, 0); }
    catch (e) { t2 = true; console.error('   ', e); }
    check('grass.update no throw', !t2);
    g.dispose();
  }
  engine.dispose();
}

// ── R7: God rays (raymarched post-process) ───────────────────────────────
console.log('7. R7 Volumetric god rays:');
{
  const engine = new NullEngine({ renderWidth: 256, renderHeight: 256 } as never);
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);
  MeshBuilder.CreateBox('test', { size: 1 }, scene);

  let h: GodRaysHandle | null = null;
  let threw = false;
  try { h = createGodRaysPostProcess(scene, camera, { marchSteps: 16 }); }
  catch (e) { threw = true; console.error('   ', e); }
  check('god-rays constructs', !threw && h !== null);
  if (h) {
    let t2 = false;
    try { h.update([0.4, 0.8, 0.45], camera); }
    catch (e) { t2 = true; console.error('   ', e); }
    check('god-rays.update no throw', !t2);
    h.dispose();
  }
  engine.dispose();
}

// ── R8: Stylized water ───────────────────────────────────────────────────
console.log('8. R8 Stylized water (mirror + wave + refraction):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);

  const waveTex = createVoronoiWaveTexture(scene, 64);
  check('voronoi wave texture created', !!waveTex);

  let w = null as ReturnType<typeof createStylizedWater> | null;
  let threw = false;
  try {
    w = createStylizedWater(scene, { width: 20, depth: 20, level: 0, waveTexture: waveTex });
  } catch (e) { threw = true; console.error('   ', e); }
  check('water constructs', !threw && w !== null);
  if (w) {
    let t2 = false;
    try { w.update(camera.position, 0.016); }
    catch (e) { t2 = true; console.error('   ', e); }
    check('water.update no throw', !t2);
    w.dispose();
  }
  waveTex.dispose();
  engine.dispose();
}

// ── R9: Trees (poisson-disk leaves) ──────────────────────────────────────
console.log('9. R9 Trees (poisson-disk leaf billboards):');
{
  const triangles = [
    { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] } as { a: [number, number, number]; b: [number, number, number]; c: [number, number, number] },
    { a: [1, 0, 0], b: [1, 1, 0], c: [0, 1, 0] } as { a: [number, number, number]; b: [number, number, number]; c: [number, number, number] }
  ];
  const baked = bakeTreeCanopy(triangles, 5, mulberry32(1337));
  check('bakeTreeCanopy generates leaves', baked.leaves.length > 0, `(got ${baked.leaves.length})`);
  // determinism
  const b2 = bakeTreeCanopy(triangles, 5, mulberry32(1337));
  check('bakeTreeCanopy deterministic', baked.leaves.length === b2.leaves.length);
}

// ── R10: Particles + Night ───────────────────────────────────────────────
console.log('10. R10 Particles + Night overlay:');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);

  const sparkSheet = createSparkSpriteSheet(scene, 32, 8);
  check('spark sprite-sheet created', !!sparkSheet);
  const dustSheet = createDustSpriteSheet(scene, 32, 8);
  check('dust sprite-sheet created', !!dustSheet);

  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);
  let night = null as ReturnType<typeof createNightOverlay> | null;
  let threw = false;
  try { night = createNightOverlay(scene, camera, { nightAmount: 0.7 }); }
  catch (e) { threw = true; console.error('   ', e); }
  check('night overlay constructs', !threw && night !== null);
  if (night) {
    night.setNightAmount(1);
    night.setTime(2.5);
    night.dispose();
  }

  // nightAmountFromTimeOfDay sanity
  const noon = nightAmountFromTimeOfDay(0.5);
  const midnight = nightAmountFromTimeOfDay(0);
  check('night amount at noon ≈ 0', noon < 0.05, `(got ${noon.toFixed(3)})`);
  check('night amount at midnight ≈ 1', midnight > 0.95, `(got ${midnight.toFixed(3)})`);

  sparkSheet.dispose();
  dustSheet.dispose();
  engine.dispose();
}

console.log('===');
if (failures === 0) console.log('\u2705 ALL PASSED');
else { console.error(`\u2717 ${failures} CHECK(S) FAILED`); process.exit(1); }
void Color3;
