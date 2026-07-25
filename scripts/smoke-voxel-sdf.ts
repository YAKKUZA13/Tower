/**
 * Headless smoke test for SDF voxel forms (Phase P-SDF, research 12.5).
 * Checks:
 *  1. opUnion(sdSphere, sdBox) → Voxel[] with both shapes (center occupied).
 *  2. opRep → domain repetition (multiple sphere instances).
 *  3. opSubtraction → carves out (sphere minus box → hollow).
 *  4. sdfToVoxels respects bounds + threshold (φ≤0).
 *  5. CSG exactness: union ⊇ parts; subtraction ⊆ minuend.
 *
 * Run: npx tsx scripts/smoke-voxel-sdf.ts
 */
import {
  sdSphere, sdBox, sdCapsule, sdRoundCone, sdTorus,
  opUnion, opSubtraction, opIntersection, opSmoothUnion, opRep,
  sdfToVoxels, unionSdf, subtractSdf,
  type SDF
} from '../client/src/babylon/voxel/voxel-sdf';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const STONE = [0.42, 0.42, 0.46] as [number, number, number];
const bounds = { min: [-8, -8, -8] as [number, number, number], max: [8, 8, 8] as [number, number, number] };

function hasVoxelAt(voxels: { x: number; y: number; z: number }[], x: number, y: number, z: number): boolean {
  return voxels.some((v) => v.x === x && v.y === y && v.z === z);
}

console.log('1. opUnion(sdSphere, sdBox):');
{
  // sphere r4 at origin + box half-size 3 offset
  const sphere = (p: [number, number, number]) => sdSphere(p, 4);
  const box = (p: [number, number, number]) => sdBox([p[0] - 4, p[1], p[2]], [3, 3, 3]);
  const union = (p: [number, number, number]) => opUnion(sphere(p), box(p));
  const voxels = sdfToVoxels(union, bounds, STONE);
  check('union voxels > 0', voxels.length > 0, `(got ${voxels.length})`);
  check('sphere center (0,0,0) occupied', hasVoxelAt(voxels, 0, 0, 0));
  check('box center (4,0,0) occupied', hasVoxelAt(voxels, 4, 0, 0));
  // outside both
  check('far point (7,7,7) empty', !hasVoxelAt(voxels, 7, 7, 7));
}

console.log('2. opRep (domain repetition):');
{
  // sphere r1.5 repeated every 5 units → multiple instances
  const base: SDF = (p) => sdSphere(p, 1.5);
  const rep = opRep(base, [5, 5, 5]);
  const voxels = sdfToVoxels(rep, bounds, STONE);
  check('rep voxels > single sphere', voxels.length > 20, `(got ${voxels.length})`);
  // instances at grid centers (0,0,0), (5,0,0) etc — origin occupied
  check('rep center (0,0,0) occupied', hasVoxelAt(voxels, 0, 0, 0));
  // another instance center
  const hasInstance = hasVoxelAt(voxels, 5, 0, 0) || hasVoxelAt(voxels, -5, 0, 0);
  check('repeated instance present', hasInstance);
}

console.log('3. opSubtraction (carve out):');
{
  // sphere r5 minus box (half 4) at origin → box region carved (but box inside sphere)
  const sphere = (p: [number, number, number]) => sdSphere(p, 5);
  const box = (p: [number, number, number]) => sdBox(p, [4, 4, 4]);
  const sub = subtractSdf(sphere, box);
  const voxels = sdfToVoxels(sub, bounds, STONE);
  check('subtraction voxels > 0', voxels.length > 0, `(got ${voxels.length})`);
  // center (inside box → carved out) should be empty
  check('center (0,0,0) carved out (empty)', !hasVoxelAt(voxels, 0, 0, 0));
  // shell of sphere still present (e.g., (0,5,0) on surface inside)
  const shell = voxels.some((v) => v.y >= 4); // top of sphere shell
  check('sphere shell present above carve', shell);
  // subtraction ⊆ sphere: all voxels should be within sphere r5
  const allInsideSphere = voxels.every((v) => v.x * v.x + v.y * v.y + v.z * v.z <= 5 * 5 + 1);
  check('subtraction ⊆ sphere', allInsideSphere);
}

console.log('4. sdfToVoxels bounds + threshold:');
{
  const sphere = (p: [number, number, number]) => sdSphere(p, 3);
  const smallBounds = { min: [-3, -3, -3] as [number, number, number], max: [3, 3, 3] as [number, number, number] };
  const voxels = sdfToVoxels(sphere, smallBounds, STONE);
  // all voxels within bounds
  const inBounds = voxels.every((v) => v.x >= -3 && v.x <= 3 && v.y >= -3 && v.y <= 3 && v.z >= -3 && v.z <= 3);
  check('all voxels within bounds', inBounds);
  // all voxels satisfy φ≤0 (re-sample)
  const allNegative = voxels.every((v) => sphere([v.x, v.y, v.z]) <= 0);
  check('all voxels satisfy φ≤0', allNegative);
}

console.log('5. CSG exactness (union ⊇ parts):');
{
  const sphere = (p: [number, number, number]) => sdSphere(p, 3);
  const box = (p: [number, number, number]) => sdBox([p[0], p[1], p[2]], [2, 2, 2]);
  const union = unionSdf(sphere, box);
  const unionV = sdfToVoxels(union, bounds, STONE);
  const sphereV = sdfToVoxels(sphere, bounds, STONE);
  // каждый воксель sphere должен быть в union
  const sphereInUnion = sphereV.every((sv) => hasVoxelAt(unionV, sv.x, sv.y, sv.z));
  check('union ⊇ sphere voxels', sphereInUnion);
  check('union ≥ sphere count', unionV.length >= sphereV.length, `(union ${unionV.length} sphere ${sphereV.length})`);
}

console.log('6. Other primitives valid (no throw, φ≤0 inside):');
{
  const cap = sdCapsule([0, 0, 0], [0, 0, 0], [0, 3, 0], 1);
  check('sdCapsule φ≤0 on axis', cap <= 0);
  const cone = sdRoundCone([0, 0, 0], 1, 0.5, 3);
  check('sdRoundCone φ≤0 at base', cone <= 0);
  const torus = sdTorus([0, 0, 0], 3, 1);
  check('sdTorus φ>0 at center hole', torus > 0);
  const sm = opSmoothUnion(-2, -1, 1);
  check('opSmoothUnion finite', Number.isFinite(sm));
  const inter = opIntersection(-1, 2);
  check('opIntersection = max = 2', inter === 2);
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
