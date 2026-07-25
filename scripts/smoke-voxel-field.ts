/**
 * M5 smoke (voxel-migration-plan): destructible voxel field + heightmap→voxel (D10).
 *
 * Проверяет:
 *  1. tilesToField → field data (cols×rows×layers, материалы).
 *  2. fieldToVoxels → Voxel[] (greedy-compatible).
 *  3. damageField: очищает клетки в радиусе, возвращает count.
 *  4. generateHeightmap (D10): детерминирован, высоты в диапазоне.
 *  5. heightmapToField: холмы + вода (layers по maxH).
 *
 * Run: npx tsx scripts/smoke-voxel-field.ts
 */
import { NullEngine, Scene } from 'babylonjs';
import {
  makeFieldData,
  tilesToField,
  fieldToVoxels,
  damageField,
  getCell,
  generateHeightmap,
  heightmapToField,
  setCell,
  FIELD_GRASS,
  FIELD_STONE,
  FIELD_WATER,
  FIELD_SAND,
  VoxelField
} from '../client/src/babylon/voxel/voxel-field';
import type { TileType } from '@tower/shared';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

console.log('1. tilesToField → field data:');
{
  const tiles: TileType[][] = [
    ['grass', 'dirt', 'water'],
    ['rock', 'grass', 'sand']
  ];
  const data = tilesToField(tiles, 2);
  check('cols=3 rows=2 layers=2', data.cols === 3 && data.rows === 2 && data.layers === 2);
  check('top grass at (0,0)', getCell(data, 0, 0, 1) === FIELD_GRASS);
  check('top water at (2,0)', getCell(data, 2, 0, 1) === FIELD_WATER);
  check('bottom stone at (0,0)', getCell(data, 0, 0, 0) === FIELD_STONE);
}

console.log('2. fieldToVoxels → Voxel[]:');
{
  const data = makeFieldData(3, 3, 1);
  setCell(data, 0, 0, 0, FIELD_GRASS);
  setCell(data, 1, 1, 0, FIELD_STONE);
  const voxels = fieldToVoxels(data);
  check('2 filled cells → 2 voxels', voxels.length === 2, `(got ${voxels.length})`);
  let hasNaN = false;
  for (const v of voxels) if (Number.isNaN(v.x) || Number.isNaN(v.y) || Number.isNaN(v.z)) hasNaN = true;
  check('no NaN', !hasNaN);
  check('voxels colored', voxels.every((v) => v.color && v.color.length === 3));
}

console.log('3. damageField (destructible, render-local):');
{
  const data = makeFieldData(5, 5, 2);
  // заполнить всё камнем
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { setCell(data, c, r, 0, FIELD_STONE); setCell(data, c, r, 1, FIELD_GRASS); }
  // 50 клеток всего (25×2)
  const before = countFilled(data);
  const cleared = damageField(data, 2, 2, 1.5); // радиус 1.5 вокруг (2,2)
  const after = countFilled(data);
  check('damage cleared cells > 0', cleared > 0, `(cleared ${cleared})`);
  check('after < before', after < before, `(before ${before} after ${after})`);
  check('center cleared', getCell(data, 2, 2, 1) === 0 && getCell(data, 2, 2, 0) === 0);
  check('corner untouched', getCell(data, 0, 0, 0) === FIELD_STONE);
  // повторный damage уже очищенной области → 0
  const cleared2 = damageField(data, 2, 2, 1.5);
  check('re-damage cleared area → 0', cleared2 === 0);
}

console.log('4. generateHeightmap (D10 value-noise):');
{
  const h1 = generateHeightmap(6, 6, 42, { amplitude: 4, base: 3 });
  const h2 = generateHeightmap(6, 6, 42, { amplitude: 4, base: 3 });
  check('deterministic (same seed → identical)', JSON.stringify(h1) === JSON.stringify(h2));
  let allInRange = true;
  for (const row of h1) for (const h of row) if (h < 0 || h > 20) allInRange = false;
  check('heights in [0,20]', allInRange);
  // разный сид → разный
  const h3 = generateHeightmap(6, 6, 99, { amplitude: 4, base: 3 });
  check('different seed → different', JSON.stringify(h1) !== JSON.stringify(h3));
}

console.log('5. heightmapToField (hills + water, D10):');
{
  const heights = [
    [1, 2, 3, 5],
    [2, 3, 4, 6],
    [1, 2, 2, 4]
  ];
  const data = heightmapToField(heights, 2); // waterLevel=2
  check('layers = maxH+1 = 7', data.layers === 7, `(got ${data.layers})`);
  // клетка (0,0) h=1 < waterLevel=2 → вода на l=2
  check('water fills low cell', getCell(data, 0, 0, 2) === FIELD_WATER);
  // клетка (3,1) h=6 > waterLevel → трава на вершине
  check('grass on hilltop', getCell(data, 3, 1, 6) === FIELD_GRASS);
  // песок у воды (h == waterLevel → верхний слой SAND)
  check('sand at waterline', getCell(data, 2, 2, 2) === FIELD_SAND, `(got ${getCell(data, 2, 2, 2)})`);
  const voxels = fieldToVoxels(data);
  check('heightmap field has voxels', voxels.length > 0, `(got ${voxels.length})`);
}

console.log('6. VoxelField class (mesh + rebuild on damage):');
{
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const tiles: TileType[][] = [['grass', 'dirt'], ['rock', 'water']];
  const data = tilesToField(tiles, 2);
  const field = new VoxelField(scene, data, 1.0);
  const meshesBefore = scene.meshes.length;
  check('field creates a mesh', meshesBefore === 1, `(meshes ${meshesBefore})`);
  const cleared = field.damage(0, 0, 0.5);
  check('damage returns cleared > 0', cleared > 0);
  check('mesh still present after rebuild', scene.meshes.length === 1);
  field.dispose();
  check('dispose removes mesh', scene.meshes.length === 0);
  engine.dispose();
}

function countFilled(data: { grid: Uint8Array }): number {
  let n = 0;
  for (let i = 0; i < data.grid.length; i++) if (data.grid[i] !== 0) n++;
  return n;
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
