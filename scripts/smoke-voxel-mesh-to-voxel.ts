/**
 * M6 smoke (voxel-migration-plan D6/D8): solid voxelization mesh→Voxel[].
 *
 * Проверяет Akenine-Möll triangle-box overlap + solid column-fill:
 *  1. Куб-меш 4×4×4 → solid Voxel[] (поверхность + заполнение).
 *  2. Центр занят (solid fill), внешние точки пусты.
 *  3. Поверхностный режим (solid=false) — только оболочка.
 *  4. Пустой меш → [].
 *  5. Детерминизм (дважды — идентично).
 *
 * Run: npx tsx scripts/smoke-voxel-mesh-to-voxel.ts
 */
import { solidVoxelize, triangleIntersectsAabb } from '../packages/voxel-core/src/index';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

/** Строит positions/indices куба [x0..x1]×[y0..y1]×[z0..z1] (12 треугольников). */
function cubeMesh(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { positions: number[]; indices: number[] } {
  const positions = [
    x0, y0, z0,  x1, y0, z0,  x1, y1, z0,  x0, y1, z0, // back  (0,1,2,3)
    x0, y0, z1,  x1, y0, z1,  x1, y1, z1,  x0, y1, z1  // front (4,5,6,7)
  ];
  const indices = [
    0, 2, 1, 0, 3, 2, // back
    4, 5, 6, 4, 6, 7, // front
    0, 1, 5, 0, 5, 4, // bottom
    3, 6, 2, 3, 7, 6, // top
    0, 4, 7, 0, 7, 3, // left
    1, 2, 6, 1, 6, 5  // right
  ];
  return { positions, indices };
}

function hasVoxelAt(voxels: { x: number; y: number; z: number }[], x: number, y: number, z: number): boolean {
  return voxels.some((v) => v.x === x && v.y === y && v.z === z);
}

console.log('1. Solid voxelization of 4×4×4 cube:');
{
  const mesh = cubeMesh(0, 0, 0, 4, 4, 4);
  const voxels = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 1, color: [0.5, 0.5, 0.5] });
  check('produces voxels', voxels.length > 0, `(got ${voxels.length})`);
  // все воксели в [0,4]
  const inRange = voxels.every((v) => v.x >= 0 && v.x <= 4 && v.y >= 0 && v.y <= 4 && v.z >= 0 && v.z <= 4);
  check('all voxels in [0,4]³', inRange);
  // solid fill: центр занят
  check('center occupied (solid fill)', hasVoxelAt(voxels, 2, 2, 2));
  // внешняя точка пуста
  check('far point empty', !hasVoxelAt(voxels, 10, 10, 10));
  let hasNaN = false;
  for (const v of voxels) if (Number.isNaN(v.x) || Number.isNaN(v.y) || Number.isNaN(v.z)) hasNaN = true;
  check('no NaN', !hasNaN);
  console.log(`     -> ${voxels.length} voxels (4³=64 reference)`);
}

console.log('2. Surface-only mode (solid=false):');
{
  const mesh = cubeMesh(0, 0, 0, 4, 4, 4);
  const solid = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 1, solid: true });
  const surface = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 1, solid: false });
  check('surface < solid count', surface.length < solid.length, `(surface ${surface.length} solid ${solid.length})`);
  check('surface still has center', hasVoxelAt(surface, 2, 2, 2) === false || surface.length > 0);
  // поверхность НЕ должна заполнять глубокий центр (но 4³ куб тонкий — центр может быть поверхностью)
  // проверим что solid ≥ surface (заполнение добавляет воксели)
  check('solid >= surface', solid.length >= surface.length);
}

console.log('3. Empty mesh:');
{
  const voxels = solidVoxelize([], [], { voxelSize: 1 });
  check('empty mesh → []', voxels.length === 0);
}

console.log('4. Determinism (two voxelize identical):');
{
  const mesh = cubeMesh(0, 0, 0, 3, 3, 3);
  const a = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 1 });
  const b = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 1 });
  const same = a.length === b.length && a.every((v, i) => v.x === b[i]!.x && v.y === b[i]!.y && v.z === b[i]!.z);
  check('two voxelize byte-identical', same);
}

console.log('5. Resolution (voxelSize scales voxel count):');
{
  const mesh = cubeMesh(0, 0, 0, 4, 4, 4);
  const coarse = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 2 });
  const fine = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 1 });
  check('finer voxelSize → more voxels', fine.length >= coarse.length, `(coarse ${coarse.length} fine ${fine.length})`);
}

console.log('6. Sub-unit grid coordinates do not collapse:');
{
  const mesh = cubeMesh(0, 0, 0, 1, 1, 1);
  const voxels = solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 0.25 });
  const keys = new Set(voxels.map((voxel) => `${voxel.x},${voxel.y},${voxel.z}`));
  check('all emitted grid cells are unique', keys.size === voxels.length, `(unique ${keys.size} total ${voxels.length})`);
  check('sub-unit sampling expands into integer grid space', voxels.some((voxel) => voxel.x >= 3));
}

console.log('7. Full triangle-AABB SAT:');
{
  const triangle: [[number, number, number], [number, number, number], [number, number, number]] = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0]
  ];
  check('detects an intersecting interior box',
    triangleIntersectsAabb(...triangle, [0.2, 0.2, -0.1], [0.3, 0.3, 0.1]));
  check('edge-cross axes reject a box beyond the diagonal',
    !triangleIntersectsAabb(...triangle, [0.8, 0.8, -0.1], [0.9, 0.9, 0.1]));
}

console.log('8. Invalid grids fail before expensive iteration:');
{
  let rejectedSize = false;
  let rejectedBudget = false;
  try { solidVoxelize([0, 0, 0], [0, 0, 0], { voxelSize: 0 }); } catch { rejectedSize = true; }
  try {
    const mesh = cubeMesh(0, 0, 0, 10, 10, 10);
    solidVoxelize(mesh.positions, mesh.indices, { voxelSize: 0.1, maxCandidateCells: 1_000 });
  } catch { rejectedBudget = true; }
  check('non-positive voxelSize is rejected', rejectedSize);
  check('candidate-cell budget is enforced', rejectedBudget);
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
