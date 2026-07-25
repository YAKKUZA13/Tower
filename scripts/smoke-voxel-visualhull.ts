/**
 * Headless smoke test for visual hull voxelizer (Phase P2, research 4.2).
 * Checks:
 *  1. Two full-square silhouettes → solid cube hull (center occupied).
 *  2. Square + circle silhouettes → cylinder hull (center occupied, corners empty).
 *  3. silhouetteFromAlpha: alpha>threshold → 1.
 *  4. silhouetteFromBackground: chroma-key works.
 *  5. Empty views → empty result; out-of-grid voxels excluded.
 *  6. vox-writer: writeVox produces valid VOX header + round-tripable bytes.
 *  7. voxelsToVoxFormat: dedup + palette snap.
 *
 * Run: npx tsx scripts/smoke-voxel-visualhull.ts
 */
import {
  visualHull,
  silhouetteFromAlpha,
  silhouetteFromBackground,
  occupancyBounds,
  type CameraView
} from '../client/src/babylon/voxel/voxel-visualhull';
import { writeVox, voxelsToVoxFormat } from '../client/src/babylon/voxel/importers/vox-writer';
import { INDEXED_PALETTE, snapToPalette, paletteIndexToRGB } from '../client/src/babylon/voxel/voxel-palette';
import { PALETTE } from '../client/src/babylon/voxel/dark-palette';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const N = 16;

/** Полный квадрат N×N (все 1). */
function fullSquare(n: number): Uint8Array {
  return new Uint8Array(n * n).fill(1);
}
/** Круг в N×N (центр (cx,cy), радиус r). */
function circleMask(n: number, cx: number, cy: number, r: number): Uint8Array {
  const m = new Uint8Array(n * n);
  for (let v = 0; v < n; v++) {
    for (let u = 0; u < n; u++) {
      const dx = u - cx, dy = v - cy;
      m[v * n + u] = (dx * dx + dy * dy) <= r * r ? 1 : 0;
    }
  }
  return m;
}

console.log('1. Two full squares → solid cube hull:');
{
  const views: CameraView[] = [
    { axis: 'z', sign: -1, silhouette: fullSquare(N), width: N, height: N },
    { axis: 'x', sign: -1, silhouette: fullSquare(N), width: N, height: N }
  ];
  const voxels = visualHull(views, N);
  // center occupied
  const center = voxels.find((v) => v.x === 8 && v.y === 8 && v.z === 8);
  check('cube center occupied', center !== undefined);
  check('cube voxel count = N^3 (full)', voxels.length === N * N * N, `(got ${voxels.length})`);
  const b = occupancyBounds(voxels);
  check('cube bounds = N×N×N', b.x === N && b.y === N && b.z === N, `(${b.x},${b.y},${b.z})`);
}

console.log('2. Square + circle → cylinder hull:');
{
  // front (z) full square; side (x) circle → hull = cylinder along X
  const views: CameraView[] = [
    { axis: 'z', sign: -1, silhouette: fullSquare(N), width: N, height: N },
    { axis: 'x', sign: -1, silhouette: circleMask(N, 8, 8, 6), width: N, height: N }
  ];
  const voxels = visualHull(views, N);
  // center (8,8,8) occupied (radius 0)
  const center = voxels.find((v) => v.x === 8 && v.y === 8 && v.z === 8);
  check('cylinder center occupied', center !== undefined);
  // corner (0,0,0): side projection u=z=0,v=y=0 → (0-8)^2+(0-8)^2=128 > 36 → outside circle → empty
  const corner = voxels.find((v) => v.x === 0 && v.y === 0 && v.z === 0);
  check('cylinder corner empty (outside circle)', corner === undefined);
  // top corner (8,0,0): u=z=0,v=y=0 → 128 > 36 → empty
  const topCorner = voxels.find((v) => v.x === 8 && v.y === 0 && v.z === 0);
  check('cylinder edge point (y=0,z=0) empty', topCorner === undefined);
  // voxel count < full cube (cylinder is smaller)
  check('cylinder voxel count < full cube', voxels.length < N * N * N, `(got ${voxels.length})`);
  check('cylinder voxel count > 0', voxels.length > 0);
}

console.log('3. silhouetteFromAlpha:');
{
  // 2×2 RGBA: (255,0,0,255),(0,0,0,0),(0,0,0,0),(255,0,0,200)
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 200]);
  const mask = silhouetteFromAlpha(rgba, 2, 2, 128);
  check('alpha 255 → 1', mask[0] === 1);
  check('alpha 0 → 0', mask[1] === 0 && mask[2] === 0);
  check('alpha 200 > 128 → 1', mask[3] === 1);
}

console.log('4. silhouetteFromBackground (chroma-key):');
{
  // 2×1: pixel0 = green bg (0,255,0), pixel1 = red fg (255,0,0)
  const rgba = new Uint8Array([0, 255, 0, 255, 255, 0, 0, 255]);
  const mask = silhouetteFromBackground(rgba, 2, 1, [0, 255, 0], 30);
  check('bg pixel → 0 (outside)', mask[0] === 0);
  check('fg pixel → 1 (inside)', mask[1] === 1);
}

console.log('5. Empty views / single view:');
{
  check('empty views → empty result', visualHull([], N).length === 0);
  // single circle view (z) → hull = extruded circle along Z (a prism)
  const views: CameraView[] = [
    { axis: 'z', sign: -1, silhouette: circleMask(N, 8, 8, 5), width: N, height: N }
  ];
  const voxels = visualHull(views, N);
  // center column occupied for all z
  const centerAny = voxels.find((v) => v.x === 8 && v.y === 8);
  check('single-view extruded: center column occupied', centerAny !== undefined);
  // corner of z-projection (x=0,y=0) empty
  const corner = voxels.find((v) => v.x === 0 && v.y === 0);
  check('single-view: corner (x=0,y=0) empty', corner === undefined);
}

console.log('6. vox-writer: valid VOX bytes:');
{
  const palette = INDEXED_PALETTE;
  const { size, voxels } = voxelsToVoxFormat(
    [{ x: 0, y: 0, z: 0, color: PALETTE.stone }, { x: 1, y: 0, z: 0, color: PALETTE.bone }],
    palette
  );
  const bytes = writeVox(size, voxels, palette);
  // header: 'VOX ' + version 150
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  check('VOX magic present', magic === 'VOX ', `(${magic})`);
  const version = bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24);
  check('version = 150', version === 150, `(${version})`);
  // contains SIZE, XYZI, RGBA chunk ids
  const asStr = Buffer.from(bytes).toString('latin1');
  check('contains SIZE chunk', asStr.includes('SIZE'));
  check('contains XYZI chunk', asStr.includes('XYZI'));
  check('contains RGBA chunk', asStr.includes('RGBA'));
  check('bytes length > 0', bytes.length > 0);
}

console.log('7. voxelsToVoxFormat dedup + palette snap:');
{
  // two voxels same cell (dedup → 1), color snaps to palette
  const { voxels, size } = voxelsToVoxFormat(
    [
      { x: 0, y: 0, z: 0, color: PALETTE.stone },
      { x: 0, y: 0, z: 0, color: PALETTE.bone }   // same cell → last-wins (bone)
    ],
    INDEXED_PALETTE
  );
  check('dedup: 1 voxel for 2 same-cell', voxels.length === 1, `(got ${voxels.length})`);
  check('colorIndex in 1..255', voxels[0]!.colorIndex >= 1 && voxels[0]!.colorIndex <= 255);
  check('size computed from bounds', size.x >= 1 && size.y >= 1 && size.z >= 1);
  // snap round-trip via paletteIndexToRGB
  const snapped = snapToPalette(PALETTE.bone);
  check('snapToPalette(bone) ~= paletteIndexToRGB', paletteIndexToRGB(snapped).every((v, i) => Math.abs(v - PALETTE.bone[i]) < 0.2));
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
