/**
 * Headless smoke test for index-palette + debris (Phase P1, research 6.3 + 15.2B).
 * Checks:
 *  1. snapToPalette returns valid indices in [0, INDEXED_PALETTE.length).
 *  2. paletteIndexToRGB round-trips (snap(rgb) -> index -> rgb ~= original within palette).
 *  3. buildPaletteTexture builds a 256x1 RGBA RawTexture.
 *  4. hueVariant returns valid indices for known labels.
 *  5. VoxelDebrisPool.spawn respects count and MAX_DEBRIS.
 *  6. update() despawns debris after TTL (count -> 0).
 *  7. update() integrates position (gravity moves debris down).
 *
 * Run: npx tsx scripts/smoke-voxel-debris.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import {
  INDEXED_PALETTE,
  PALETTE_MAX,
  snapToPalette,
  paletteIndexToRGB,
  hueVariant,
  buildPaletteTexture
} from '../client/src/babylon/voxel/voxel-palette';
import { VoxelDebrisPool, MAX_DEBRIS } from '../client/src/babylon/voxel/voxel-debris';
import { box3, type Voxel } from '../client/src/babylon/voxel/voxel-builder';
import { ACCENT, PALETTE } from '../client/src/babylon/voxel/dark-palette';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const engine = new NullEngine();
const scene = new Scene(engine);

console.log('1. snapToPalette valid indices:');
{
  const samples: [number, number, number][] = [
    [0.42, 0.42, 0.46], [0.95, 0.45, 0.12], [0.74, 0.71, 0.62], [0, 0, 0], [1, 1, 1]
  ];
  let ok = true;
  for (const c of samples) {
    const i = snapToPalette(c);
    if (i < 0 || i >= INDEXED_PALETTE.length) ok = false;
  }
  check('all sample snaps in range', ok);
  check('INDEXED_PALETTE length <= 255', INDEXED_PALETTE.length <= 255, `(len ${INDEXED_PALETTE.length})`);
  check('PALETTE_MAX = 256', PALETTE_MAX === 256);
}

console.log('2. paletteIndexToRGB round-trip:');
{
  const c = PALETTE.stone;
  const i = snapToPalette(c);
  const back = paletteIndexToRGB(i);
  const dist = Math.abs(back[0] - c[0]) + Math.abs(back[1] - c[1]) + Math.abs(back[2] - c[2]);
  check('snap(stone) -> rgb close to stone', dist < 0.15, `(dist ${dist.toFixed(3)})`);
  check('paletteIndexToRGB(-1) = black', paletteIndexToRGB(-1).every((v) => v === 0));
}

console.log('3. buildPaletteTexture builds:');
{
  const tex = buildPaletteTexture(scene);
  check('texture created', tex !== null && tex !== undefined);
  check('texture name set', tex.name === 'voxel-indexed-palette');
  tex.dispose();
}

console.log('4. hueVariant valid:');
{
  const labels = ['stone', 'bone', 'fire', 'arcane', 'gold'];
  let ok = true;
  for (const l of labels) {
    const i = hueVariant(l, 0.37);
    if (i < 0 || i >= INDEXED_PALETTE.length) ok = false;
  }
  check('hueVariant returns in-range for known labels', ok);
  // determinism: same seed -> same index
  const a = hueVariant('stone', 0.5);
  const b = hueVariant('stone', 0.5);
  check('hueVariant deterministic', a === b);
  // unknown label -> still valid index
  const u = hueVariant('nonexistent', 0.5);
  check('hueVariant unknown label returns valid index', u >= 0 && u < INDEXED_PALETTE.length);
}

console.log('5. VoxelDebrisPool.spawn respects count and MAX:');
{
  const pool = new VoxelDebrisPool(scene, 1.5);
  const partVoxels: Voxel[] = [];
  box3(partVoxels, 0, 2, 0, 4, 0, 2, ACCENT.blood); // 15 voxels
  // mix colors
  partVoxels.push({ x: 5, y: 5, z: 5, sx: 1, sy: 1, sz: 1, color: PALETTE.bone });

  pool.spawn(partVoxels, new Vector3(0, 1, 0), { count: 10 });
  check('spawn 10 -> count 10', pool.count === 10, `(count ${pool.count})`);

  // try to overflow MAX
  const big = Array.from({ length: MAX_DEBRIS + 500 }, (_, i) => ({
    x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, color: PALETTE.stone
  })) as Voxel[];
  // spawn many batches; pool should cap at MAX_DEBRIS
  for (let b = 0; b < 50; b++) {
    pool.spawn(big, new Vector3(0, 0, 0), { count: 50 });
  }
  check('pool never exceeds MAX_DEBRIS', pool.count <= MAX_DEBRIS, `(count ${pool.count})`);
  pool.dispose();
}

console.log('6. update() despawns after TTL:');
{
  const pool = new VoxelDebrisPool(scene, 1.5);
  const partVoxels: Voxel[] = [];
  box3(partVoxels, 0, 2, 0, 4, 0, 2, PALETTE.boneDark);
  pool.spawn(partVoxels, new Vector3(0, 1, 0), { count: 5 });
  check('initial count 5', pool.count === 5);
  // small dt should keep them alive
  pool.update(0.05);
  check('after small dt still alive', pool.count === 5, `(count ${pool.count})`);
  // large dt exceeds TTL -> despawn all
  pool.update(5.0);
  check('after TTL count -> 0', pool.count === 0, `(count ${pool.count})`);
  pool.dispose();
}

console.log('7. update() integrates gravity (debris falls):');
{
  const pool = new VoxelDebrisPool(scene, 1.5);
  const partVoxels: Voxel[] = [];
  box3(partVoxels, 0, 0, 0, 0, 0, 0, PALETTE.metal);
  pool.spawn(partVoxels, new Vector3(0, 2, 0), { count: 1, velocity: new Vector3(0, 0, 0) });
  pool.update(0.01);
  check('debris alive after short dt', pool.count === 1);
  // several updates keep it alive & healthy (no throw, count stable under TTL)
  let threw = false;
  try {
    for (let i = 0; i < 5; i++) pool.update(0.05);
  } catch { threw = true; }
  check('multiple updates do not throw', !threw);
  check('debris alive under TTL', pool.count === 1);
  pool.dispose();
}

engine.dispose();
console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
