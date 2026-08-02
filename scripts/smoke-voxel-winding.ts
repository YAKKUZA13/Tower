/**
 * Headless winding verification for computeGreedyGeometry (VOXEL_ENGINE_PLAN.md Phase 3.1).
 *
 * Checks that greedy faces have correct winding (outward-facing normals).
 * Creates a 2×2×2 solid cube, verifies each of the 6 quads has the expected
 * normal direction based on triangle winding.
 *
 * Run: npx tsx scripts/smoke-voxel-winding.ts
 */
import { computeGreedyGeometry, box3, validateVertexColors, type Voxel } from '../packages/voxel-core/src/index';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 FAIL: ${name} ${details}`);
  }
}

// Build 2×2×2 solid cube
const voxels: Voxel[] = [];
box3(voxels, 0, 1, 0, 1, 0, 1, [0.5, 0.5, 0.5]);
const geo = computeGreedyGeometry(voxels, false);

console.log('1. Winding verification (Phase 3.1):');

// Basic sanity
const quadCount = geo.positions.length / 12;
const triCount = geo.indices.length / 3;
check('2x2x2 solid cube: 6 quads', quadCount === 6, `(got ${quadCount})`);
check('2x2x2 solid cube: 12 tris', triCount === 12, `(got ${triCount})`);

// Validate vertex colors format
const colorWarnings = validateVertexColors(geo);
check('vertex colors valid', colorWarnings.length === 0, colorWarnings.join('; '));

// Compute face normal from triangle (cross product of edges)
function computeTriNormal(
  positions: number[],
  i0: number, i1: number, i2: number
): [number, number, number] {
  const a = [positions[i0 * 3]!, positions[i0 * 3 + 1]!, positions[i0 * 3 + 2]!];
  const b = [positions[i1 * 3]!, positions[i1 * 3 + 1]!, positions[i1 * 3 + 2]!];
  const c = [positions[i2 * 3]!, positions[i2 * 3 + 1]!, positions[i2 * 3 + 2]!];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  // Cross product u × v
  return [
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  ];
}

// Classify normal direction (±1 on dominant axis, 0 on others)
function classifyNormal(n: [number, number, number]): string {
  const eps = 0.01;
  if (Math.abs(n[0]) > eps && Math.abs(n[1]) < eps && Math.abs(n[2]) < eps)
    return n[0]! > 0 ? '+X' : '-X';
  if (Math.abs(n[1]) > eps && Math.abs(n[0]) < eps && Math.abs(n[2]) < eps)
    return n[1]! > 0 ? '+Y' : '-Y';
  if (Math.abs(n[2]) > eps && Math.abs(n[0]) < eps && Math.abs(n[1]) < eps)
    return n[2]! > 0 ? '+Z' : '-Z';
  return `mixed(${n.map(x => x.toFixed(2)).join(',')})`;
}

// For each quad (2 tris), verify the face normal matches the quad's vertices
// and points outward (away from the cube center).
const cubeCenter: [number, number, number] = [0.5, 0.5, 0.5];
const seenDirections = new Set<string>();

for (let q = 0; q < quadCount; q++) {
  const i0 = geo.indices[q * 6]!;
  const i1 = geo.indices[q * 6 + 1]!;
  const i2 = geo.indices[q * 6 + 2]!;

  const normal = computeTriNormal(geo.positions, i0, i1, i2);
  const dir = classifyNormal(normal);

  // Collect all positions of this quad (4 vertices, 2 triangles)
  const verts = new Set<number>();
  for (let t = 0; t < 6; t++) {
    verts.add(geo.indices[q * 6 + t]!);
  }
  // Find a vertex position from this quad
  const anyIdx = geo.indices[q * 6]!;
  const px = geo.positions[anyIdx * 3]!;
  const py = geo.positions[anyIdx * 3 + 1]!;
  const pz = geo.positions[anyIdx * 3 + 2]!;

  // Vector from cube center to quad vertex
  const toVert: [number, number, number] = [px - cubeCenter[0], py - cubeCenter[1], pz - cubeCenter[2]];

  // Check that the normal points outward (same sign as toVert on the dominant axis)
  let outward = false;
  if (dir === '+X') outward = normal[0]! > 0 && toVert[0] > 0;
  else if (dir === '-X') outward = normal[0]! < 0 && toVert[0] < 0;
  else if (dir === '+Y') outward = normal[1]! > 0 && toVert[1] > 0;
  else if (dir === '-Y') outward = normal[1]! < 0 && toVert[1] < 0;
  else if (dir === '+Z') outward = normal[2]! > 0 && toVert[2] > 0;
  else if (dir === '-Z') outward = normal[2]! < 0 && toVert[2] < 0;

  check(`quad ${q}: outward-facing ${dir}`, outward,
    `normal=(${normal[0]!.toFixed(2)},${normal[1]!.toFixed(2)},${normal[2]!.toFixed(2)}) toVert=(${toVert[0]!.toFixed(2)},${toVert[1]!.toFixed(2)},${toVert[2]!.toFixed(2)})`);

  seenDirections.add(dir);
}

// Verify all 6 face directions are present
check('all 6 face directions present', seenDirections.size === 6,
  `found: ${[...seenDirections].sort().join(', ')}`);

// 2. Also test skeletonEnemy for winding issues
console.log('\n2. Skeleton enemy winding:');
import { skeletonEnemy } from '../client/src/babylon/voxel/voxel-builder';
const skelVoxels = skeletonEnemy();
const skelGeo = computeGreedyGeometry(skelVoxels, false);
check('skeleton: positions is valid', skelGeo.positions.length > 0);
check('skeleton: no NaN in positions', !skelGeo.positions.some(isNaN));
check('skeleton: no NaN in normals', !skelGeo.normals.some(isNaN));

// Check that no normals are zero-length (degenerate faces)
let zeroNormals = 0;
for (let i = 0; i < skelGeo.normals.length; i += 3) {
  const nx = skelGeo.normals[i]!, ny = skelGeo.normals[i + 1]!, nz = skelGeo.normals[i + 2]!;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len < 1e-6) zeroNormals++;
}
check('skeleton: no zero-length normals', zeroNormals === 0, `(found ${zeroNormals})`);

// Verify skeleton quads are outward-facing
const skelQuadCount = skelGeo.indices.length / 6;
let badWinding = 0;
for (let q = 0; q < skelQuadCount; q++) {
  const i0 = skelGeo.indices[q * 6]!;
  const i1 = skelGeo.indices[q * 6 + 1]!;
  const i2 = skelGeo.indices[q * 6 + 2]!;
  const triN = computeTriNormal(skelGeo.positions, i0, i1, i2);
  const storedN0 = [skelGeo.normals[i0 * 3]!, skelGeo.normals[i0 * 3 + 1]!, skelGeo.normals[i0 * 3 + 2]!];
  // Dot product should be positive (computed normal roughly matches stored normal)
  const dot = triN[0] * storedN0[0] + triN[1] * storedN0[1] + triN[2] * storedN0[2];
  if (dot < 0) badWinding++;
}
check('skeleton: all face normals match winding direction',
  badWinding === 0, `(${badWinding}/${skelQuadCount} mismatched)`);

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL WINDING CHECKS PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
