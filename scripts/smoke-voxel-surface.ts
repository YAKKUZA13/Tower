import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { computeGreedyGeometry, partitionVoxelMaterials, box3, type Voxel } from '../packages/voxel-core/src/index';
import { buildVoxelMaterialMesh } from '../packages/voxel-babylon/src/index';

// Reference fixture: slab, raised support and asymmetric overhangs, all the same albedo.
const voxels: Voxel[] = [];
box3(voxels, 0, 6, 0, 0, 0, 6, [0.5, 0.5, 0.5]);
box3(voxels, 2, 3, 1, 3, 2, 3, [0.5, 0.5, 0.5]);
box3(voxels, 1, 4, 4, 4, 1, 2, [0.5, 0.5, 0.5]);
const occupied = new Map(voxels.map(voxel => [`${voxel.x},${voxel.y},${voxel.z}`, voxel]));
const geometry = computeGreedyGeometry(voxels, false);
const faces = new Map<string, number[]>();
let flips = 0;
let shaded = 0;
for (let quad = 0; quad < geometry.indices.length / 6; quad++) {
  const points = Array.from({ length: 4 }, (_, corner) => geometry.positions.slice(quad * 12 + corner * 3, quad * 12 + corner * 3 + 3));
  const normal = geometry.normals.slice(quad * 12, quad * 12 + 3);
  const axis = normal.findIndex(n => n !== 0);
  const sign = normal[axis]!;
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const minU = Math.min(...points.map(p => p[u]!)), maxU = Math.max(...points.map(p => p[u]!));
  const minV = Math.min(...points.map(p => p[v]!)), maxV = Math.max(...points.map(p => p[v]!));
  const brightness = Array.from({ length: 4 }, (_, corner) => geometry.colors[quad * 16 + corner * 4]!);
  if ((maxU - minU) * (maxV - minV) > 1) assert(brightness.every(b => b === brightness[0]), 'merged rectangle preserves a constant field');
  const triangles = geometry.indices.slice(quad * 6, quad * 6 + 6).map(i => i - quad * 4);
  const diagonal = triangles.slice(0, 3).filter(i => triangles.slice(3).includes(i)).sort();
  const flip = brightness[0]! + brightness[2]! > brightness[1]! + brightness[3]!;
  assert.deepEqual(diagonal, flip ? [1, 3] : [0, 2]);
  if (flip) flips++;
  for (let cu = minU + 0.5; cu < maxU; cu++) for (let cv = minV + 0.5; cv < maxV; cv++) {
    const own = [0, 0, 0]; own[axis] = points[0]![axis]! - sign * 0.5; own[u] = cu; own[v] = cv;
    const key = `${own}:${axis}:${sign}`;
    assert(!faces.has(key), 'no face overlap');
    faces.set(key, brightness);
  }
}
// Independent unit-face oracle checks every original corner, including vertices that
// would be hidden in the interior of an incorrectly merged rectangle.
let expectedFaces = 0;
for (const voxel of occupied.values()) for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
  const cell = [voxel.x, voxel.y, voxel.z];
  const outside = [...cell]; outside[axis] += sign;
  if (occupied.has(outside.join(','))) continue;
  expectedFaces++;
  const actual = faces.get(`${cell}:${axis}:${sign}`)!;
  assert(actual, 'every exposed unit face is represented');
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const tint = axis === 1 ? (sign > 0 ? 1 : 0.38) : 0.6;
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([du, dv], corner) => {
    const sideU = [...outside], sideV = [...outside], diagonal = [...outside];
    sideU[u] += du!; sideV[v] += dv!; diagonal[u] += du!; diagonal[v] += dv!;
    const a = Number(occupied.has(sideU.join(','))), b = Number(occupied.has(sideV.join(','))), c = Number(occupied.has(diagonal.join(',')));
    const level = a && b ? 0 : 3 - a - b - c;
    const expected = 0.5 * tint * [0.55, 0.72, 0.88, 1][level]!;
    assert(Math.abs(actual[corner]! - expected) < 1e-10, `AO lost at ${cell}:${axis}:${sign} corner ${corner}`);
    if (level < 3) shaded++;
  });
}
assert.equal(faces.size, expectedFaces);
assert(flips > 0 && shaded > 0, 'fixture exercises anisotropy and contact shadows');
console.log(`PASS AO: ${expectedFaces} unit faces, ${shaded} occluded corners, ${flips} diagonal flips`);

const pair: Voxel[] = [0, 1].map(x => ({ x, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: [0.5, 0.5, 0.5], material: x }));
const pairGeometry = computeGreedyGeometry(pair, true);
assert.equal(pairGeometry.indices.length / 6, 10, 'labels split coplanar external faces');
for (let q = 0; q < 10; q++) {
  assert(!(pairGeometry.normals[q * 12] !== 0 && pairGeometry.positions[q * 12] === 0.5), 'no internal interface between opaque materials');
}
const original = structuredClone(pairGeometry);
const partition = partitionVoxelMaterials(pairGeometry);
assert.deepEqual(partition.ranges.map(r => [r.material, r.indexCount]), [[0, 30], [1, 30]]);
assert.deepEqual([...partition.indices].sort((a,b) => a-b), [...pairGeometry.indices].sort((a,b) => a-b));
assert.deepEqual(pairGeometry, original, 'partition does not mutate core buffers');
assert.throws(() => computeGreedyGeometry([{ ...pair[0]!, material: -1 }], false));
console.log('PASS material partition: shared occupancy, hidden interfaces, label separation, unchanged buffers');

const engine = new NullEngine(); const scene = new Scene(engine);
const baseline = { meshes: scene.meshes.length, materials: scene.materials.length, multis: scene.multiMaterials.length };
assert.throws(() => buildVoxelMaterialMesh(scene, pair, { name: 'bad', materials: { 0: {} } }));
assert.throws(() => buildVoxelMaterialMesh(scene, pair, { name: 'budget', maxMaterials: 1, materials: { 0: {}, 1: {} } }));
for (let i = 0; i < 4; i++) {
  const mesh = buildVoxelMaterialMesh(scene, pair, { name: 'surface', materials: { 0: {}, 1: { emissive: [1, 0.1, 0], emissiveStrength: 0.8 } } });
  assert.equal(mesh.subMeshes.length, 2);
  assert.equal(mesh.getTotalIndices(), 60);
  const multi = mesh.material as MultiMaterial;
  const stone = multi.subMaterials[0] as StandardMaterial, glow = multi.subMaterials[1] as StandardMaterial;
  assert.equal(stone.emissiveColor.r, 0);
  assert.equal(glow.emissiveColor.r, 0.8);
  assert(glow.useEmissiveAsIllumination, 'emission does not inherit albedo/AO darkening');
  mesh.dispose();
  assert.equal(scene.meshes.length, baseline.meshes);
  assert.equal(scene.materials.length, baseline.materials);
  assert.equal(scene.multiMaterials.length, baseline.multis);
}
scene.dispose(); engine.dispose();
console.log('PASS Babylon: emissive regions, submesh batching, preflight validation, owned material disposal');
