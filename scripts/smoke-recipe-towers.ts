/**
 * M3 smoke (voxel-migration-plan): recipe-driven structures.
 *
 * Проверяет, что все 8 recipe-структур (4 башни + 4 здания) компилируются и
 * собираются в Voxel[] через stamp-реестр (включая SDF-stamps horn/crystal — D11).
 *
 * Run: npx tsx scripts/smoke-recipe-towers.ts
 */
import { readFileSync } from 'node:fs';
import { compile, loadRecipe, compileErrorMessage } from '../shared/src/recipe/index';
import { VoxelStampRegistry, assembleRecipe } from '../client/src/babylon/voxel/primitives/voxel-stamps';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const registry = new VoxelStampRegistry();

const recipes: { catalogId: string; path: string }[] = [
  { catalogId: 'tower:arrow', path: 'client/public/recipes/towers/arrow.json' },
  { catalogId: 'tower:cannon', path: 'client/public/recipes/towers/cannon.json' },
  { catalogId: 'tower:arcane', path: 'client/public/recipes/towers/arcane.json' },
  { catalogId: 'tower:ice', path: 'client/public/recipes/towers/ice.json' },
  { catalogId: 'building:sawmill', path: 'client/public/recipes/buildings/sawmill.json' },
  { catalogId: 'building:mine', path: 'client/public/recipes/buildings/mine.json' },
  { catalogId: 'building:smelter', path: 'client/public/recipes/buildings/smelter.json' },
  { catalogId: 'building:barracks', path: 'client/public/recipes/buildings/barracks.json' }
];

console.log('1. All 8 structure recipes compile + assemble:');
let totalVoxels = 0;
const compiled: Record<string, ReturnType<typeof compile>> = {};
for (const r of recipes) {
  const json = readFileSync(r.path, 'utf-8');
  const recipe = loadRecipe(json);
  const result = compile(recipe, registry);
  compiled[r.catalogId] = result;
  if (!result.ok) {
    console.error(`  compile errors for ${r.catalogId}:`, result.errors.map(compileErrorMessage));
    check(`${r.catalogId} compiles`, false);
    continue;
  }
  const parts = result.recipe.parts;
  const voxels = assembleRecipe(parts, registry);
  let hasNaN = false;
  for (const v of voxels) if (Number.isNaN(v.x) || Number.isNaN(v.y) || Number.isNaN(v.z)) hasNaN = true;
  totalVoxels += voxels.length;
  check(`${r.catalogId}: parts=${parts.length} voxels=${voxels.length}`,
    parts.length > 0 && voxels.length > 0 && !hasNaN, hasNaN ? '(NaN!)' : '');
}

console.log('2. SDF stamps (D11: horn/crystal) produce voxels:');
{
  const horn = registry.stamp('horn', { r: { Float: 0.6 }, h: { Float: 4 } });
  check('horn stamp produces voxels', horn.length > 0, `(got ${horn.length})`);
  const crystal = registry.stamp('crystal', { r: { Float: 1 }, h: { Float: 3 } });
  check('crystal stamp produces voxels', crystal.length > 0, `(got ${crystal.length})`);
  const gem = registry.stamp('gem', { r: { Float: 0.6 } });
  check('gem stamp produces voxels', gem.length > 0, `(got ${gem.length})`);

  // arcane/ice towers используют crystal-стамп → в собранных вокселях есть SDF-детали
  const arcane = compiled['tower:arcane'];
  if (arcane?.ok) {
    const hasCrystal = arcane.recipe.parts.some((p) => p.asset === 'crystal');
    check('arcane recipe references crystal SDF stamp', hasCrystal);
  }
  const ice = compiled['tower:ice'];
  if (ice?.ok) {
    const hasCrystal = ice.recipe.parts.some((p) => p.asset === 'crystal');
    check('ice recipe references crystal SDF stamp', hasCrystal);
  }
}

console.log('3. Recipe determinism (two compiles byte-identical):');
{
  const r = recipes[0]!;
  const json = readFileSync(r.path, 'utf-8');
  const recipe = loadRecipe(json);
  const a = compile(recipe, registry);
  const b = compile(loadRecipe(json), registry);
  if (a.ok && b.ok) {
    check(`${r.catalogId} byte-identical twice`, JSON.stringify(a.recipe.parts) === JSON.stringify(b.recipe.parts));
  } else {
    check(`${r.catalogId} both compiles ok`, false);
  }
}

console.log('4. buildMaster recipe integration contract (compile → assemble → greedy-compatible):');
{
  // симулируем что делает AssetCatalog.buildMaster: compile+assemble → voxels готовы для buildVoxelMeshGreedy.
  const arrow = compiled['tower:arrow'];
  if (arrow?.ok) {
    const voxels = assembleRecipe(arrow.recipe.parts, registry);
    // проверяем что воксели в разумном диапазоне (для normalizeMesh)
    let minY = Infinity, maxY = -Infinity;
    for (const v of voxels) { if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
    const height = maxY - minY;
    check(`arrow voxels bounded (height=${height}, voxels=${voxels.length})`, height > 0 && voxels.length > 0);
  }
}

check('total voxels across 8 structures > 0', totalVoxels > 0, `(${totalVoxels})`);

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
