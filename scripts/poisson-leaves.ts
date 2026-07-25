/**
 * M8.R / R9 (CLI) — poisson-leaves bake.
 * Источник: David Holland «3D Pixel Art» §trees (Fast Adaptive Blue Noise on Polygonal Surfaces).
 *
 * Консольный bake-скрипт: читает canopy-mesh (тестовый procedural или .vox/.glb в будущем),
 * генерирует poisson-disk leaf placement (детерминированно), пишет в ассет-JSON.
 *
 * Run: npx tsx scripts/poisson-leaves.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bakeTreeCanopy } from '../client/src/babylon/pixel-art/poisson-leaves';
import type { Triangle } from '../client/src/babylon/pixel-art/types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Procedural canopy: UV-sphere triangulated (используется как тестовый источник).
function makeSphereCanopy(cx: number, cy: number, cz: number, r: number, segments: number): Triangle[] {
  const tris: Triangle[] = [];
  // UV-sphere
  const stacks = Math.max(3, Math.floor(segments / 2));
  const slices = segments;
  const grid: [number, number, number][][] = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = Math.PI * (i / stacks);
    const row: [number, number, number][] = [];
    for (let j = 0; j <= slices; j++) {
      const theta = 2 * Math.PI * (j / slices);
      const x = cx + r * Math.sin(phi) * Math.cos(theta);
      const y = cy + r * Math.cos(phi);
      const z = cz + r * Math.sin(phi) * Math.sin(theta);
      row.push([x, y, z]);
    }
    grid.push(row);
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = grid[i][j];
      const b = grid[i][j + 1];
      const c = grid[i + 1][j + 1];
      const d = grid[i + 1][j];
      tris.push({ a, b, c });
      tris.push({ a, c, b: d });
    }
  }
  return tris;
}

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

console.log('1. Procedural sphere canopy bake:');
{
  const canopy = makeSphereCanopy(0, 4, 0, 2.5, 12);
  const rng = mulberry32(1337);
  const baked = bakeTreeCanopy(canopy, 4.0, rng);  // 4 leaves per unit-area
  check('canopy has triangles', canopy.length > 0);
  check('leaves generated', baked.leaves.length > 0, `(got ${baked.leaves.length})`);
  check('leaves respect density (~proportional)', baked.leaves.length > 20 && baked.leaves.length < 400, `(got ${baked.leaves.length})`);
  // все leaves внутри canopy-bounding-sphere
  let allInside = true;
  for (const l of baked.leaves) {
    const dx = l.pos[0], dy = l.pos[1] - 4, dz = l.pos[2];
    if (dx * dx + dy * dy + dz * dz > 4 * 2.5 * 2.5 + 0.1) { allInside = false; break; }
  }
  check('all leaves inside canopy bounds', allInside);
}

console.log('2. Determinism: same seed → same leaves:');
{
  const canopy = makeSphereCanopy(0, 4, 0, 2.5, 10);
  const r1 = mulberry32(99);
  const r2 = mulberry32(99);
  const a = bakeTreeCanopy(canopy, 5.0, r1);
  const b = bakeTreeCanopy(canopy, 5.0, r2);
  check('same leaf count', a.leaves.length === b.leaves.length);
  check('same first leaf position', a.leaves[0].pos[0] === b.leaves[0].pos[0]);
}

console.log('3. Write JSON asset:');
{
  const canopy = makeSphereCanopy(0, 4, 0, 2.5, 12);
  const baked = bakeTreeCanopy(canopy, 4.0, mulberry32(2024));
  const outPath = resolve(process.cwd(), 'client/public/assets/tree-canopy-oak.json');
  try {
    writeFileSync(outPath, JSON.stringify(baked, null, 2));
    check('asset written', true, `(path: ${outPath})`);
  } catch (e) {
    check('asset written', false, String(e));
  }
}

console.log('===');
if (failures === 0) console.log('\u2705 ALL PASSED');
else { console.error(`\u2717 ${failures} CHECK(S) FAILED`); process.exit(1); }
