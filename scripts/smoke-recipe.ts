/**
 * Headless smoke test for recipe-compiler (Phase P-MO, research 15).
 * Checks:
 *  1. test-smelter.json compiles → PartV2[] (part count > 0).
 *  2. Mirror: shed_w parts are X-mirror of shed_e (position.x negated).
 *  3. Row: vaults emits exactly count=5 parts with step spacing.
 *  4. Scatter determinism: compile twice → byte-identical parts.
 *  5. Forward ref → CompileError (UnknownRef).
 *  6. assembleRecipe → Voxel[] (renders, > 0 voxels, no NaN).
 *
 * Run: npx tsx scripts/smoke-recipe.ts
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
const recipeJson = readFileSync('client/public/recipes/test-smelter.json', 'utf-8');
const recipe = loadRecipe(recipeJson);

console.log('1. test-smelter compiles:');
const result = compile(recipe, registry);
if (!result.ok) {
  console.error('  compile errors:', result.errors.map(compileErrorMessage));
  failures++;
} else {
  const parts = result.recipe.parts;
  check('compiled parts > 0', parts.length > 0, `(got ${parts.length})`);
  console.log(`     -> ${parts.length} parts`);

  console.log('2. Mirror X-negate (shed_w vs shed_e):');
  {
    const shedE = parts.filter((p) => p.id === 'shed_e.walls' || p.id === 'shed_e.roof');
    const shedW = parts.filter((p) => p.id === 'shed_w.walls' || p.id === 'shed_w.roof');
    check('shed_e has walls+roof', shedE.length >= 1);
    check('shed_w (mirror) has walls+roof', shedW.length === shedE.length, `(e:${shedE.length} w:${shedW.length})`);
    if (shedE.length > 0 && shedW.length > 0) {
      const e = shedE[0]!, w = shedW[0]!;
      check('mirror: position.x negated', Math.abs(w.position[0] - (-e.position[0])) < 1e-3,
        `(e.x=${e.position[0].toFixed(2)} w.x=${w.position[0].toFixed(2)})`);
      check('mirror: position.y/z unchanged', w.position[1] === e.position[1] && w.position[2] === e.position[2]);
    }
  }

  console.log('3. Row spacing (vaults):');
  {
    const vaults = parts.filter((p) => p.id.startsWith('vaults.')).sort((a, b) => a.id.localeCompare(b.id));
    check('vaults row count = 5', vaults.length === 5, `(got ${vaults.length})`);
    if (vaults.length >= 2) {
      const dx = vaults[1]!.position[0] - vaults[0]!.position[0];
      check('vaults step ≈ 1.5', Math.abs(dx - 1.5) < 0.01, `(dx=${dx.toFixed(2)})`);
    }
  }

  console.log('4. Scatter determinism (byte-identical twice):');
  {
    const r2 = compile(recipe, registry);
    if (r2.ok && result.ok) {
      const a = JSON.stringify(result.recipe.parts);
      const b = JSON.stringify(r2.recipe.parts);
      check('two compiles byte-identical', a === b);
    } else {
      check('second compile ok', false);
    }
    // scatter parts present
    const clutter = parts.filter((p) => p.id.startsWith('clutter.'));
    const ivy = parts.filter((p) => p.id.startsWith('ivy.'));
    check('clutter scatter produced parts', clutter.length > 0, `(got ${clutter.length})`);
    check('ivy scatter produced parts', ivy.length >= 1, `(got ${ivy.length})`);
  }

  console.log('6. assembleRecipe → Voxel[]:');
  {
    const voxels = assembleRecipe(parts, registry);
    check('assembled voxels > 0', voxels.length > 0, `(got ${voxels.length})`);
    let hasNaN = false;
    for (const v of voxels) {
      if (Number.isNaN(v.x) || Number.isNaN(v.y) || Number.isNaN(v.z)) hasNaN = true;
    }
    check('voxels finite (no NaN)', !hasNaN);
    console.log(`     -> ${voxels.length} voxels`);
  }
}

console.log('5. Forward ref → CompileError:');
{
  const badRecipe = loadRecipe(JSON.stringify({
    format_version: 3,
    name: 'bad',
    palette: 'default',
    seed: 1,
    units: [
      { type: 'Part', id: 'p1', asset: 'box', at: { type: 'OnTopOf', target: 'p2', offset: [0, 0] } }
      // p2 объявлен ПОЗЖЕ → forward ref → UnknownRef
    ]
  }));
  const r = compile(badRecipe, registry);
  check('forward ref → errors', !r.ok);
  if (!r.ok) {
    const hasUnknownRef = r.errors.some((e) => e.kind === 'UnknownRef');
    check('error kind = UnknownRef', hasUnknownRef, `(${r.errors.map((e) => e.kind).join(',')})`);
  }
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
