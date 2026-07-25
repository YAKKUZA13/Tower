/**
 * Headless smoke-test for greedy meshing (Phase P-Greedy, research 12.2).
 * Checks:
 *  1. Solid cube -> greedy = exactly 6 quads (12 triangles) - provably optimal.
 *  2. skeletonEnemy/arrowTower: greedy triangle count <= naive.
 *  3. AABB greedy ~= AABB naive (same volume - no lost faces).
 *  4. No NaN in greedy vertex data (positions/colors/normals).
 *  5. computeGreedyGeometry (pure) returns consistent array lengths.
 *  6. Greedy is compatible with thin instances.
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
  type Voxel
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

engine.dispose();
console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
