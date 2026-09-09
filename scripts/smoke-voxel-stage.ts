import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { createMasonryVoxels, computeGreedyGeometry } from '../packages/voxel-core/src/index';
import { applyGreedyGeometry, buildVoxelMesh, buildVoxelMeshGreedy, createVoxelStage } from '../packages/voxel-babylon/src/index';

const options = { width: 24, height: 18, depth: 4, seed: 17 };
const wall = createMasonryVoxels(options);
assert.deepEqual(wall, createMasonryVoxels(options));
assert.notDeepEqual(wall, createMasonryVoxels({ ...options, seed: 18 }));
assert.equal(new Set(wall.map(v => `${v.x},${v.y},${v.z}`)).size, wall.length);
assert(wall.every(v => v.x >= 0 && v.x < 24 && v.y >= 0 && v.y < 18 && v.z >= 0 && v.z < 4));
assert.deepEqual(createMasonryVoxels({ ...options, orientation: 'floor' }), wall.map(v => ({ ...v, y: v.z, z: v.y })));
assert.equal(wall.filter(v => v.z === 0).length, 24 * 18, 'backing closes every joint');
const clean = createMasonryVoxels({ ...options, relief: 0, chipChance: 0 });
const chipped = createMasonryVoxels({ ...options, relief: 0, chipChance: 1 });
assert(chipped.length < clean.length, 'chips remove volume');
assert(chipped.every(v => clean.some(c => c.x === v.x && c.y === v.y && c.z === v.z)));
assert.equal(createMasonryVoxels({ width: 1, height: 1, depth: 1 }).length, 1);
for (const invalid of [{ width: NaN }, { depth: 0 }, { joint: 6 }, { relief: 4 }, { chipChance: -1 }, { maxCells: 10 }]) {
  assert.throws(() => createMasonryVoxels({ ...options, ...invalid }));
}
console.log('PASS masonry: deterministic, bounded, oriented, closed backing, real chips, input budgets');

const engine = new NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 512, deterministicLockstep: true, lockstepMaxSteps: 4 });
const scene = new Scene(engine);
const camera = new FreeCamera('test', new Vector3(0, 2, -8), scene);
camera.setTarget(Vector3.Zero());
const offsetVoxels = wall.map(v => ({ ...v, x: v.x + 30, y: v.y + 20, z: v.z - 40 }));
for (const builder of [buildVoxelMesh, buildVoxelMeshGreedy]) {
  const raw = builder(scene, offsetVoxels, { name: 'raw', normalize: false });
  assert(Math.abs(raw.getBoundingInfo().boundingBox.minimum.x - 29.5) < 1e-5);
  const normalized = builder(scene, offsetVoxels, { name: 'normalized' });
  const bounds = normalized.getBoundingInfo().boundingBox;
  assert(Math.abs(bounds.minimum.y + 0.5) < 1e-5, 'base at -0.5');
  assert(Math.abs(bounds.maximum.y - 0.5) < 1e-5, 'height is 1');
  assert(Math.abs(bounds.maximum.x + bounds.minimum.x) < 1e-5, 'centered X');
  normalized.position.x = 10;
  normalized.scaling.setAll(2);
  normalized.computeWorldMatrix(true);
  assert(Math.abs(normalized.getBoundingInfo().boundingBox.centerWorld.x - 10) < 1e-5, 'world bounds follow transforms');
  raw.dispose(false, true); normalized.dispose(false, true);
}
console.log('PASS adapters: world coordinates, normalized bounds, transformed bounds');

const geometry = computeGreedyGeometry([{ x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: [0.5, 0.5, 0.5] }], true);
const original = geometry.indices.slice();
function windingSigns(mesh: Mesh) {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
  const indices = mesh.getIndices()!;
  return Array.from({ length: indices.length / 3 }, (_, triangle) => {
    const [a, b, c] = [0, 1, 2].map(i => Vector3.FromArray(positions, indices[triangle * 3 + i]! * 3));
    return Math.sign(Vector3.Dot(Vector3.Cross(b!.subtract(a!), c!.subtract(a!)), Vector3.FromArray(normals, indices[triangle * 3]! * 3)));
  });
}
for (const rightHanded of [false, true]) {
  scene.useRightHandedSystem = rightHanded;
  const reference = MeshBuilder.CreateBox('native', {}, scene);
  const mesh = new Mesh('greedy', scene);
  applyGreedyGeometry(mesh, geometry);
  assert.deepEqual(windingSigns(mesh), windingSigns(reference), 'matches native Babylon triangles on all six sides');
  assert.equal(mesh.sideOrientation, reference.sideOrientation);
  assert.deepEqual(geometry.indices, original, 'shared core buffers remain unchanged');
  reference.dispose(); mesh.dispose();
}
scene.useRightHandedSystem = false;
console.log('PASS winding: both scene handedness modes match native Babylon box');

const baseline = { lights: scene.lights.length, textures: scene.textures.length, mode: camera.mode, clear: scene.clearColor.clone() };
const receiver = MeshBuilder.CreateBox('receiver', {}, scene);
for (let iteration = 0; iteration < 4; iteration++) {
  const stage = createVoxelStage(scene, camera, { pixelHeight: 360, viewHeight: 12 });
  assert.throws(() => createVoxelStage(scene, camera));
  camera._postProcesses.filter(Boolean)[0]!.activate(camera);
  assert.equal(camera._postProcesses.filter(Boolean)[0]!.height, 360);
  assert.equal(camera._postProcesses.filter(Boolean)[0]!.width, 480);
  const temporary = MeshBuilder.CreateBox('temporary', {}, scene);
  stage.addMesh(temporary);
  temporary.dispose();
  assert.equal(stage.shadows.getShadowMap()!.renderList!.length, 0, 'disposed meshes unregister automatically');
  assert.equal(camera.orthoTop, 6);
  assert.equal(camera.orthoRight, 8);
  stage.addMesh(receiver);
  assert(receiver.receiveShadows);
  assert.equal(stage.shadows.getShadowMap()!.renderList!.length, 1);
  stage.removeMesh(receiver);
  assert(!receiver.receiveShadows);
  assert.equal(stage.shadows.getShadowMap()!.renderList!.length, 0);
  stage.addMesh(receiver);
  stage.addPointLight(Vector3.Zero(), Color3.White());
  stage.addPointLight(Vector3.One(), Color3.Red());
  assert.throws(() => stage.addPointLight(Vector3.One(), Color3.Red()));
  stage.setPixelHeight(0); stage.setPixelHeight(540); stage.setViewHeight(8);
  assert.equal(camera.orthoTop, 4);
  assert.equal(camera._postProcesses.filter(Boolean).length, 1);
  assert.throws(() => stage.setPixelHeight(NaN));
  stage.dispose(); stage.dispose();
  assert.equal(scene.lights.length, baseline.lights);
  assert.equal(scene.textures.length, baseline.textures);
  assert.equal(camera._postProcesses.filter(Boolean).length, 0);
  assert.equal(camera.mode, baseline.mode);
  assert.deepEqual(scene.clearColor, baseline.clear);
  assert(!receiver.receiveShadows);
}
receiver.dispose();
scene.dispose(); engine.dispose();
console.log('PASS stage: light budget, shadow registration, resize, repeated disposal and state restoration');
