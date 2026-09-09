/**
 * M7 smoke (voxel-migration-plan D9): toon ShaderMaterial + outline post-process.
 *
 * Headless-конструкция: регистрация шейдеров, создание ShaderMaterial (без ошибок),
 * outline PostProcess цепляется на камеру. Визуальная проверка toon vs baked-tint —
 * ручная (нужен WebGL); smoke покрывает, что материалы/шейдеры валидны.
 *
 * Run: npx tsx scripts/smoke-voxel-toon.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { createToonMaterial, updateToonMaterial, createOutlinePostProcess, registerToonShaders, applyToonToScene } from '../client/src/babylon/voxel/voxel-toon';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

console.log('1. Toon shader registration + material creation:');
{
  registerToonShaders();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mat = createToonMaterial(scene, 'test-toon');
  check('ShaderMaterial created', mat !== null && mat.name === 'test-toon');
  check('backFaceCulling enabled', mat.backFaceCulling === true);
  mat.dispose();
  engine.dispose();
}

console.log('2. updateToonMaterial (uniforms without error):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const mat = createToonMaterial(scene);
  let threw = false;
  try {
    updateToonMaterial(mat, [0.3, 1, 0.4], { x: 0, y: 5, z: 0 });
  } catch (e) {
    threw = true;
  }
  check('updateToonMaterial no throw', !threw);
  mat.dispose();
  engine.dispose();
}

console.log('3. Outline post-process on camera:');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);
  const pp = createOutlinePostProcess(camera, { edgeStrength: 0.9 });
  check('PostProcess created', pp !== null && pp.name === 'voxel-outline');
  pp.dispose();
  engine.dispose();
}

console.log('4. applyToonToScene (material swap + restore on dispose):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('cam', 0, 0, 10, Vector3.Zero(), scene);
  // несколько voxel-мешей
  const m1 = MeshBuilder.CreateBox('enemy-mesh', { size: 1 }, scene) as Mesh;
  const m2 = MeshBuilder.CreateBox('tower-inst-1', { size: 1 }, scene) as Mesh;
  const ground = MeshBuilder.CreateGround('ground', { width: 4, height: 4 }, scene) as Mesh;
  const beforeM1 = m1.material;
  const handle = applyToonToScene(scene, camera, [0.3, 1, 0.4]);
  check('voxel mesh material swapped to toon', m1.material === handle.material);
  check('tower mesh material swapped', m2.material === handle.material);
  check('ground skipped (not swapped)', ground.material !== handle.material);
  handle.dispose();
  check('material restored after dispose', m1.material === beforeM1);
  m1.dispose(); m2.dispose(); ground.dispose();
  engine.dispose();
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
