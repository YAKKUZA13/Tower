/**
 * Headless smoke-test for greedy meshing (Phase P-Greedy, research 12.2).
 * Checks:
 *  1. Solid cube -> greedy = exactly 6 quads (12 triangles) - provably optimal.
 *  2. skeletonEnemy/arrowTower: greedy triangle count <= naive.
 *  3. AABB greedy ~= AABB naive (same volume - no lost faces).
 *  4. No NaN in greedy vertex data (positions/colors/normals).
 *  5. computeGreedyGeometry (pure) returns consistent array lengths.
 *  6. Greedy is compatible with thin instances.
 *  7. Per-quad color verification (Phase 5.1): red+blue 2x2x2 cube.
 *  8. Winding verification (Phase 3.2): all faces outward-facing.
 *  9. Vertex color format validation (Phase 4.3).
 *
 * Run: npx tsx scripts/smoke-voxel-mesh.ts
 */
import { NullEngine, Scene } from 'babylonjs';
import {
  buildVoxelMesh,
  buildVoxelMeshGreedy,
  computeGreedyGeometry,
  box3,
  skeletonEnemy,
  arrowTower,
  validateVertexColors,
  getQuadVertexColor,
  type Voxel,
  type RGB,
} from '../client/src/babylon/voxel/voxel-builder';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 FAIL: ${name} ${details}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

function triCount(mesh: { getTotalIndices: () => number }): number {
  return Math.floor(mesh.getTotalIndices() / 3);
}

function hasNaN(arr: number[] | Float32Array | undefined): boolean {
  if (!arr) return false;
  for (let i = 0; i < arr.length; i++) if (Number.isNaN(arr[i]!)) return true;
  return false;
}

// 1. Solid cube: greedy optimal (6 quads -> 12 tris)
console.log('1. Solid cube - greedy optimal (research 12.2):');
{
  const cube: Voxel[] = [];
  box3(cube, 0, 3, 0, 3, 0, 3, [0.5, 0.5, 0.5]); // 4x4x4 solid
  const geo = computeGreedyGeometry(cube, false);
  const quads = geo.positions.length / 12; // 4 verts x 3 coord = 12 floats per quad
  const tris = geo.indices.length / 3;
  check('solid cube greedy: exactly 6 quads', quads === 6, `(got ${quads})`);
  check('solid cube greedy: exactly 12 tris', tris === 12, `(got ${tris})`);
  const cubeNaive = buildVoxelMesh(scene, cube, { name: 'cube-naive' });
  const cubeGreedy = buildVoxelMeshGreedy(scene, cube, { name: 'cube-greedy' });
  check('solid cube: greedy tris <= naive', triCount(cubeGreedy) <= triCount(cubeNaive),
    `(greedy ${triCount(cubeGreedy)} vs naive ${triCount(cubeNaive)})`);
  cubeNaive.dispose();
  cubeGreedy.dispose();
}

// 2-4. Real models: tri reduction + AABB + NaN
function testModel(label: string, fn: () => Voxel[]): void {
  console.log(`2-4. ${label} (naive vs greedy):`);
  const voxels = fn();
  const geo = computeGreedyGeometry(voxels, false);
  check(`${label}: positions multiple of 12 (quads)`, geo.positions.length % 12 === 0,
    `(len ${geo.positions.length})`);
  check(`${label}: colors multiple of 16 (RGBA x 4 vert)`, geo.colors.length % 16 === 0,
    `(len ${geo.colors.length})`);
  check(`${label}: normals multiple of 12`, geo.normals.length % 12 === 0);
  check(`${label}: indices multiple of 3`, geo.indices.length % 3 === 0);
  check(`${label}: no NaN positions`, !hasNaN(geo.positions));
  check(`${label}: no NaN colors`, !hasNaN(geo.colors));
  check(`${label}: no NaN normals`, !hasNaN(geo.normals));

  // Phase 4.3: vertex color format validation
  const colorWarnings = validateVertexColors(geo);
  check(`${label}: vertex colors format valid`, colorWarnings.length === 0,
    colorWarnings.join('; '));

  const naive = buildVoxelMesh(scene, voxels, { name: `${label}-naive` });
  const greedy = buildVoxelMeshGreedy(scene, voxels, { name: `${label}-greedy` });
  const tNaive = triCount(naive);
  const tGreedy = triCount(greedy);
  check(`${label}: greedy tris <= naive`, tGreedy <= tNaive,
    `(greedy ${tGreedy} vs naive ${tNaive}, reduction ${((1 - tGreedy / tNaive) * 100).toFixed(1)}%)`);

  naive.refreshBoundingInfo();
  greedy.refreshBoundingInfo();
  const nb = naive.getBoundingInfo().boundingBox;
  const gb = greedy.getBoundingInfo().boundingBox;
  const yExtNaive = nb.maximumWorld.y - nb.minimumWorld.y;
  const yExtGreedy = gb.maximumWorld.y - gb.minimumWorld.y;
  check(`${label}: AABB Y-extent ~1.0 both`,
    Math.abs(yExtGreedy - 1.0) < 0.02 && Math.abs(yExtNaive - 1.0) < 0.02,
    `(naive ${yExtNaive.toFixed(3)} greedy ${yExtGreedy.toFixed(3)})`);
  const xzNaive = (nb.maximumWorld.x - nb.minimumWorld.x) * (nb.maximumWorld.z - nb.minimumWorld.z);
  const xzGreedy = (gb.maximumWorld.x - gb.minimumWorld.x) * (gb.maximumWorld.z - gb.minimumWorld.z);
  check(`${label}: greedy XZ-area >= 0.9x naive`, xzGreedy >= 0.9 * xzNaive,
    `(naive ${xzNaive.toFixed(3)} greedy ${xzGreedy.toFixed(3)})`);

  console.log(`     -> naive ${tNaive} tri / greedy ${tGreedy} tri (voxels ${voxels.length})`);
  naive.dispose();
  greedy.dispose();
}
testModel('skeletonEnemy', skeletonEnemy);
testModel('arrowTower', arrowTower);

// 6. Greedy compatible with thin instances
console.log('6. Greedy mesh compatible with thin instances:');
{
  const greedy = buildVoxelMeshGreedy(scene, skeletonEnemy(), { name: 'thin-test' });
  const matrixBuf = new Float32Array(8 * 16);
  const colorBuf = new Float32Array(8 * 4);
  let ok = true;
  try {
    greedy.thinInstanceSetBuffer('matrix', matrixBuf, 16, false);
    greedy.thinInstanceSetBuffer('color', colorBuf, 4, false);
    greedy.thinInstanceCount = 0;
  } catch {
    ok = false;
  }
  check('thinInstanceSetBuffer on greedy mesh does not throw', ok);
  greedy.dispose();
}

// ── Phase 5.1: Per-quad color verification ──
console.log('\n7. Per-quad color verification (Phase 5.1):');
{
  // Build a 2×2×2 cube with brown on top (+Y), gray-blue on bottom (-Y).
  // Use non-accent colors so face tint is applied (accent colors skip tint).
  const brown: RGB = [0.50, 0.35, 0.20];    // max=0.50, sat=0.30 → NOT accent
  const grayBlue: RGB = [0.25, 0.28, 0.45]; // max=0.45, sat=0.20 → NOT accent

  const testVoxels: Voxel[] = [];
  for (let x = 0; x < 2; x++) {
    for (let z = 0; z < 2; z++) {
      testVoxels.push({ x, y: 0, z, sx: 1, sy: 1, sz: 1, color: grayBlue });
      testVoxels.push({ x, y: 1, z, sx: 1, sy: 1, sz: 1, color: brown });
    }
  }
  const smallGeo = computeGreedyGeometry(testVoxels, false);
  const smallQuads = smallGeo.positions.length / 12;
  // Dual-color cube: top+bottom are merged (same color per layer = 2 quads),
  // 4 side faces split into top/bottom by color = 8 side quads → total 10.
  check('2x2x2 dual-color cube: 10 quads', smallQuads === 10, `(got ${smallQuads})`);

  // Verify that top-facing quads have brown-ish color and bottom-facing have gray-blue-ish
  let topQuadCount = 0, bottomQuadCount = 0, sideQuadCount = 0;
  for (let q = 0; q < smallQuads; q++) {
    const i0 = smallGeo.indices[q * 6]!;
    const ny = smallGeo.normals[i0 * 3 + 1]!;
    const color = getQuadVertexColor(smallGeo, q, 0);

    if (ny > 0.5) {
      topQuadCount++;
      check(`top quad ${q}: brown-ish`,
        color[0] > color[2] && color[0] > 0.15,
        `color=(${color[0]!.toFixed(3)},${color[1]!.toFixed(3)},${color[2]!.toFixed(3)})`);
    } else if (ny < -0.5) {
      bottomQuadCount++;
      check(`bottom quad ${q}: blue-ish`,
        color[2] > color[0] && color[2] > 0.1,
        `color=(${color[0]!.toFixed(3)},${color[1]!.toFixed(3)},${color[2]!.toFixed(3)})`);
    } else {
      sideQuadCount++;
    }
  }
  check('found top quads', topQuadCount === 1, `(got ${topQuadCount})`);
  check('found bottom quads', bottomQuadCount === 1, `(got ${bottomQuadCount})`);
  check('found side quads', sideQuadCount === 8, `(got ${sideQuadCount})`);

  // Verify face tint: top faces (TINT=1.0) brighter than side faces (TINT=0.6).
  // Use same raw color on both top and a side face for fair comparison.
  // Top quad is brown [0.50, 0.35, 0.20] × TOP_TINT 1.0 = [0.50, 0.35, 0.20]
  // Brown side quad: [0.50, 0.35, 0.20] × SIDE_TINT 0.6 = [0.30, 0.21, 0.12]
  let topLum = 0, sideLum = 0;
  for (let q = 0; q < smallQuads; q++) {
    const i0 = smallGeo.indices[q * 6]!;
    const ny = smallGeo.normals[i0 * 3 + 1]!;
    const color = getQuadVertexColor(smallGeo, q, 0);
    // Only compare brown (top-layer color) quads
    const lum = color[0] + color[1] + color[2];
    if (ny > 0.5) topLum = lum;                  // top face: brown × 1.0
    if (Math.abs(ny) < 0.5 && color[0] > color[2]) sideLum = lum; // brown side face
  }
  check('top faces brighter than side faces (face tint)', topLum > sideLum * 1.3,
    `(top lum ${topLum.toFixed(3)}, side lum ${sideLum.toFixed(3)}, ratio ${(topLum / Math.max(0.001, sideLum)).toFixed(2)})`);

  // Flat mode: no AO, but face tint still applies. Same dual-color cube.
  const flatGeo = computeGreedyGeometry(testVoxels, true);
  const flatQuads = flatGeo.positions.length / 12;
  check('2x2x2 flat mode: 10 quads', flatQuads === 10, `(got ${flatQuads})`);
}

// ── Phase 3.2: Winding verification ──
console.log('\n8. Winding verification (Phase 3.2):');
{
  function computeTriNormal(positions: number[], i0: number, i1: number, i2: number): [number, number, number] {
    const a = [positions[i0 * 3]!, positions[i0 * 3 + 1]!, positions[i0 * 3 + 2]!];
    const b = [positions[i1 * 3]!, positions[i1 * 3 + 1]!, positions[i1 * 3 + 2]!];
    const c = [positions[i2 * 3]!, positions[i2 * 3 + 1]!, positions[i2 * 3 + 2]!];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  }

  function classifyNormal(n: [number, number, number]): string {
    const eps = 0.01;
    if (Math.abs(n[0]) > eps && Math.abs(n[1]) < eps && Math.abs(n[2]) < eps) return n[0]! > 0 ? '+X' : '-X';
    if (Math.abs(n[1]) > eps && Math.abs(n[0]) < eps && Math.abs(n[2]) < eps) return n[1]! > 0 ? '+Y' : '-Y';
    if (Math.abs(n[2]) > eps && Math.abs(n[0]) < eps && Math.abs(n[1]) < eps) return n[2]! > 0 ? '+Z' : '-Z';
    return `mixed(${n.map(x => x.toFixed(2)).join(',')})`;
  }

  const windVoxels: Voxel[] = [];
  box3(windVoxels, 0, 1, 0, 1, 0, 1, [0.5, 0.5, 0.5]);
  const windGeo = computeGreedyGeometry(windVoxels, false);
  const windQuads = windGeo.positions.length / 12;
  const cubeCenter: [number, number, number] = [0.5, 0.5, 0.5];
  const seenDirections = new Set<string>();
  let allOutward = true;

  for (let q = 0; q < windQuads; q++) {
    const i0 = windGeo.indices[q * 6]!;
    const i1 = windGeo.indices[q * 6 + 1]!;
    const i2 = windGeo.indices[q * 6 + 2]!;
    const triN = computeTriNormal(windGeo.positions, i0, i1, i2);
    const dir = classifyNormal(triN);
    seenDirections.add(dir);

    // Check outward: the face normal should point away from cube center
    const px = windGeo.positions[i0 * 3]!;
    const py = windGeo.positions[i0 * 3 + 1]!;
    const pz = windGeo.positions[i0 * 3 + 2]!;
    const toVert: [number, number, number] = [px - cubeCenter[0], py - cubeCenter[1], pz - cubeCenter[2]];

    let outward = false;
    if (dir === '+X') outward = triN[0]! > 0 && toVert[0] > 0;
    else if (dir === '-X') outward = triN[0]! < 0 && toVert[0] < 0;
    else if (dir === '+Y') outward = triN[1]! > 0 && toVert[1] > 0;
    else if (dir === '-Y') outward = triN[1]! < 0 && toVert[1] < 0;
    else if (dir === '+Z') outward = triN[2]! > 0 && toVert[2] > 0;
    else if (dir === '-Z') outward = triN[2]! < 0 && toVert[2] < 0;
    if (!outward) allOutward = false;
  }

  check('all 6 face directions found', seenDirections.size === 6,
    `found: ${[...seenDirections].sort().join(', ')}`);
  check('all faces are outward-facing', allOutward);
}

// ── Phase 4.1: Non-unit voxel rejection ──
console.log('\n9. Non-unit voxel rejection (Phase 4.1):');
{
  const nonUnit: Voxel[] = [{ x: 0, y: 0, z: 0, sx: 2, sy: 1, sz: 1, color: [0.5, 0.5, 0.5] }];
  let threw = false;
  try {
    computeGreedyGeometry(nonUnit, false);
  } catch {
    threw = true;
  }
  check('rejects non-unit voxels (sx=2)', threw);

  const largeUnit: Voxel[] = [{ x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: [0.5, 0.5, 0.5] }];
  let ok = true;
  try {
    computeGreedyGeometry(largeUnit, false);
  } catch {
    ok = false;
  }
  check('accepts unit voxels (sx=sy=sz=1)', ok);
}

engine.dispose();
console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
