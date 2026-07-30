/**
 * Demo: recipe-compiler (engine-recipe + voxel-core)
 * Компилирует test-smelter.json и выводит структуру частей.
 *
 * Run: npx tsx packages/engine-recipe/demo/compile-demo.ts
 */
import { readFileSync } from 'node:fs';
import { compile, loadRecipe, compileErrorMessage } from '../src/index.js';
import { VoxelStampRegistry, assembleRecipe } from '../../voxel-core/src/index.js';

const registry = new VoxelStampRegistry();
const json = readFileSync('client/public/recipes/test-smelter.json', 'utf-8');
const recipe = loadRecipe(json);

const start = performance.now();
const result = compile(recipe, registry);
const elapsed = (performance.now() - start).toFixed(1);

console.log('═══════════════════════════════════════');
console.log('  Engine Recipe — Compile Demo');
console.log('═══════════════════════════════════════\n');

if (!result.ok) {
  console.error('COMPILE ERRORS:');
  for (const e of result.errors) console.error('  ✗', compileErrorMessage(e));
  process.exit(1);
}

const parts = result.recipe.parts;
console.log(`Recipe: ${recipe.name}`);
console.log(`Seed:   ${recipe.seed}`);
console.log(`Parts:  ${parts.length}`);
console.log(`Units:  ${recipe.units.length}`);
console.log(`Time:   ${elapsed}ms\n`);

// group parts by id prefix
const groups: Record<string, typeof parts> = {};
for (const p of parts) {
  const prefix = p.id.split('.')[0] ?? p.id;
  (groups[prefix] ??= []).push(p);
}

console.log('── Parts by group ──');
for (const [group, items] of Object.entries(groups).sort()) {
  const assets = [...new Set(items.map(p => p.asset))].join(', ');
  console.log(`  ${group}: ${items.length} parts  [${assets}]`);
}

console.log('\n── All parts ──');
for (const p of parts) {
  const [x, y, z] = p.position;
  const [rx, ry, rz] = p.rotation;
  console.log(`  ${p.id.padEnd(30)} pos=(${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}) rot=(${rx}°,${ry}°,${rz}°) asset=${p.asset}`);
}

// assemble into voxels
console.log('\n── Voxel assembly ──');
const voxels = assembleRecipe(parts, registry);
console.log(`  Total voxels: ${voxels.length}`);

// voxel bounds
let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const v of voxels) {
  if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
  if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
  if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
}
console.log(`  Bounds: X[${minX}..${maxX}] Y[${minY}..${maxY}] Z[${minZ}..${maxZ}]`);
console.log(`  Size:   ${maxX - minX + 1} × ${maxY - minY + 1} × ${maxZ - minZ + 1}`);

// color distribution (top 5)
const colorCount = new Map<string, number>();
for (const v of voxels) {
  const key = v.color.map(c => c.toFixed(2)).join(',');
  colorCount.set(key, (colorCount.get(key) ?? 0) + 1);
}
const topColors = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
console.log('\n  Top colors:');
for (const [rgb, count] of topColors) {
  console.log(`    RGB(${rgb}) → ${count} voxels`);
}

console.log('\n═══════════════════════════════════════');
console.log('  OK');
