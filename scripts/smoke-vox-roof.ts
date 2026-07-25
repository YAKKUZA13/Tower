/**
 * M6 smoke (voxel-migration-plan D4/D5): roof geometry + shingledHipRoof.
 *
 * Проверяет:
 *  1. hip_roof stamp: 4-way slope → сужается к апексу (верхний слой меньше нижнего).
 *  2. wedge_roof stamp: односкатная → AABB корректен.
 *  3. shingled_hip_roof (D5): per-shingle hue-jitter (seeded → разные цвета в одном roof).
 *  4. shingled determinism (same seed → byte-identical).
 *
 * Run: npx tsx scripts/smoke-vox-roof.ts
 */
import { VoxelStampRegistry } from '../client/src/babylon/voxel/primitives/voxel-stamps';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const reg = new VoxelStampRegistry();

function footprint(voxels: { x: number; z: number }[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const v of voxels) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, maxX, minZ, maxZ };
}

console.log('1. hip_roof 4-way slope (apex < base):');
{
  const roof = reg.stamp('hip_roof', { w: { Float: 6 }, h: { Float: 3 }, d: { Float: 6 } });
  check('hip_roof produces voxels', roof.length > 0, `(got ${roof.length})`);
  // нижний слой (y=0) vs верхний слой — апекс уже основания
  const base = roof.filter((v) => v.y === 0);
  const top = roof.filter((v) => v.y === Math.max(...roof.map((v) => v.y)));
  const baseFp = footprint(base);
  const topFp = footprint(top);
  const baseW = baseFp.maxX - baseFp.minX;
  const topW = topFp.maxX - topFp.minX;
  check('apex narrower than base', topW <= baseW, `(base ${baseW} top ${topW})`);
}

console.log('2. wedge_roof (single slope):');
{
  const roof = reg.stamp('wedge_roof', { w: { Float: 5 }, h: { Float: 2 }, d: { Float: 5 } });
  check('wedge_roof produces voxels', roof.length > 0, `(got ${roof.length})`);
  const fp = footprint(roof);
  check('wedge within footprint', fp.maxX - fp.minX <= 5 && fp.maxZ - fp.minZ <= 5);
}

console.log('3. shingled_hip_roof per-shingle hue-jitter (D5):');
{
  const roof = reg.stamp('shingled_hip_roof', {
    w: { Float: 6 }, h: { Float: 3 }, d: { Float: 6 }, overhang: { Float: 0.5 },
    course_step: { Float: 1 }, shingle_w: { Float: 1 }, seed: { Uint: 42 }
  });
  check('shingled roof produces voxels', roof.length > 0, `(got ${roof.length})`);
  // per-shingle hue-вариация: в одном roof должны быть разные цвета (shade-factor variation)
  const colors = new Set<string>();
  for (const v of roof) colors.add(`${v.color[0].toFixed(3)},${v.color[1].toFixed(3)},${v.color[2].toFixed(3)}`);
  check('multiple distinct shingle colors (hue-jitter)', colors.size > 1, `(distinct colors: ${colors.size})`);
}

console.log('4. shingled determinism:');
{
  const a = reg.stamp('shingled_hip_roof', { w: { Float: 5 }, h: { Float: 2 }, d: { Float: 5 }, overhang: { Float: 0.4 }, course_step: { Float: 1 }, shingle_w: { Float: 1 }, seed: { Uint: 7 } });
  const b = reg.stamp('shingled_hip_roof', { w: { Float: 5 }, h: { Float: 2 }, d: { Float: 5 }, overhang: { Float: 0.4 }, course_step: { Float: 1 }, shingle_w: { Float: 1 }, seed: { Uint: 7 } });
  const same = a.length === b.length && a.every((v, i) => v.x === b[i]!.x && v.y === b[i]!.y && v.z === b[i]!.z
    && v.color[0] === b[i]!.color[0] && v.color[1] === b[i]!.color[1] && v.color[2] === b[i]!.color[2]);
  check('same seed → byte-identical shingles', same);
  // разный seed → разные цвета
  const c = reg.stamp('shingled_hip_roof', { w: { Float: 5 }, h: { Float: 2 }, d: { Float: 5 }, overhang: { Float: 0.4 }, course_step: { Float: 1 }, shingle_w: { Float: 1 }, seed: { Uint: 99 } });
  const aColors = new Set(a.map((v) => `${v.color[0].toFixed(3)}`));
  const cColors = new Set(c.map((v) => `${v.color[0].toFixed(3)}`));
  check('different seed → different color set', JSON.stringify([...aColors]) !== JSON.stringify([...cColors]));
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
