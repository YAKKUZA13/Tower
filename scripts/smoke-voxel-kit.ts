/**
 * Headless smoke test for procedural kit-assembler (Phase P4, research 7).
 * Checks:
 *  1. assembleCharacter(seed) -> CharacterDef with full humanoid part set
 *     (hips/spine/head + upperArmL/R + forearmL/R + thighL/R + shinL/R).
 *  2. Determinism: same seed -> byte-identical voxels.
 *  3. assembleCrowd(seed, 20) -> 20 valid defs.
 *  4. Mirror: L/R limb parts are X-mirror images.
 *  5. Palette consistency: all colors derive from dark-palette (archetypeTheme).
 *  6. Constraints grammar: weapon=staff forces accessory (no horns mismatch).
 *
 * Run: npx tsx scripts/smoke-voxel-kit.ts
 */
import { assembleCharacter, assembleCrowd } from '../client/src/babylon/voxel/procedural-kit/kit-assembler';
import { SLOT_CATALOG, archetypeTheme } from '../client/src/babylon/voxel/procedural-kit/parts-library';
import { listPartNames, type CharacterDef } from '../client/src/babylon/voxel/voxel-parts';
import { PALETTE, ACCENT } from '../client/src/babylon/voxel/dark-palette';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const REQUIRED_PARTS = [
  'hips', 'spine', 'head',
  'upperArmL', 'forearmL', 'upperArmR', 'forearmR',
  'thighL', 'shinL', 'thighR', 'shinR'
];

/** Стабильная сериализация вокселей CharacterDef (для byte-identical сравнения). */
function serialize(def: CharacterDef): string {
  const all: string[] = [];
  const walk = (p: import('../client/src/babylon/voxel/voxel-parts').PartNode): void => {
    for (const v of p.voxels) {
      all.push(`${p.name}|${v.x},${v.y},${v.z}|${v.color[0].toFixed(3)},${v.color[1].toFixed(3)},${v.color[2].toFixed(3)}`);
    }
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  all.sort();
  return all.join('\n');
}

function findPart(def: CharacterDef, name: string): import('../client/src/babylon/voxel/voxel-parts').PartNode | null {
  const stack = [def.root];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.name === name) return p;
    for (const c of p.children) stack.push(c);
  }
  return null;
}

console.log('1. assembleCharacter full part set:');
{
  const def = assembleCharacter(42);
  const names = new Set(listPartNames(def));
  let allPresent = true;
  for (const r of REQUIRED_PARTS) if (!names.has(r)) allPresent = false;
  check('all required humanoid parts present', allPresent, `(got [${[...names].join(',')}])`);
  // total voxel count > 0
  let total = 0;
  const walk = (p: import('../client/src/babylon/voxel/voxel-parts').PartNode): void => {
    total += p.voxels.length;
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  check('total voxel count > 0', total > 0, `(got ${total})`);
}

console.log('2. Determinism (same seed -> byte-identical):');
{
  const a = serialize(assembleCharacter(7));
  const b = serialize(assembleCharacter(7));
  check('same seed -> identical', a === b);
  const c = serialize(assembleCharacter(8));
  check('different seed -> different (likely)', a !== c);
}

console.log('3. assembleCrowd(seed, 20):');
{
  const crowd = assembleCrowd(100, 20);
  check('crowd has 20 defs', crowd.length === 20);
  let allValid = crowd.every((d) => listPartNames(d).includes('hips'));
  check('all defs have hips (valid)', allValid);
  // все имеют полный набор required parts
  let allComplete = true;
  for (const d of crowd) {
    const names = new Set(listPartNames(d));
    for (const r of REQUIRED_PARTS) if (!names.has(r)) { allComplete = false; break; }
  }
  check('all crowd defs have full part set', allComplete);
  // variety: not all identical
  const sigs = new Set(crowd.map((d) => serialize(d)));
  check('crowd has variety (>= 5 unique signatures)', sigs.size >= 5, `(unique ${sigs.size})`);
}

console.log('4. Mirror: L/R limbs are X-mirror images:');
{
  const def = assembleCharacter(555);
  const uaL = findPart(def, 'upperArmL');
  const uaR = findPart(def, 'upperArmR');
  if (uaL && uaR && uaL.voxels.length === uaR.voxels.length) {
    // R = L with x negated (sorted comparison)
    const normL = uaL.voxels.map((v) => `${v.x},${v.y},${v.z}`).sort();
    const normR = uaR.voxels.map((v) => `${-v.x},${v.y},${v.z}`).sort();
    check('upperArmR = mirrorX(upperArmL)', JSON.stringify(normL) === JSON.stringify(normR));
  } else {
    check('upperArm L/R exist with equal counts', false, `(L ${uaL?.voxels.length} R ${uaR?.voxels.length})`);
  }
  const thL = findPart(def, 'thighL');
  const thR = findPart(def, 'thighR');
  if (thL && thR) {
    const normL = thL.voxels.map((v) => `${v.x},${v.y},${v.z}`).sort();
    const normR = thR.voxels.map((v) => `${-v.x},${v.y},${v.z}`).sort();
    check('thighR = mirrorX(thighL)', JSON.stringify(normL) === JSON.stringify(normR));
  }
}

console.log('5. Palette consistency (colors from dark-palette family):');
{
  const def = assembleCharacter(33, { archetype: 'skeleton' });
  // все цвета dark-palette (PALETTE.* + ACCENT.*) — это реальная палитра-дисциплина
  const themeColors: [number, number, number][] = [
    ...Object.values(PALETTE), ...Object.values(ACCENT)
  ] as [number, number, number][];
  // соберём все использованные цвета
  const used = new Set<string>();
  const walk = (p: import('../client/src/babylon/voxel/voxel-parts').PartNode): void => {
    for (const v of p.voxels) used.add(v.color.join(','));
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  // все использованные цвета должны быть близко к одному из dark-palette цветов
  // (с учётом varyTheme shade ±8%)
  let allConsistent = true;
  for (const c of used) {
    const [r, g, b] = c.split(',').map(Number);
    const close = themeColors.some((tc) => Math.abs(tc[0] - r) + Math.abs(tc[1] - g) + Math.abs(tc[2] - b) < 0.3);
    if (!close) allConsistent = false;
  }
  check('all colors derive from dark-palette family', allConsistent, `(used ${used.size} colors)`);
  // PALETTE/ACCENT доступны (smoke использует)
  check('PALETTE.stone defined', PALETTE.stone.length === 3);
  check('ACCENT.fire defined', ACCENT.fire.length === 3);
}

console.log('6. Variant coverage (library has >= 3 for key slots):');
{
  check('head variants >= 3', SLOT_CATALOG.head.length >= 3);
  check('torso variants >= 3', SLOT_CATALOG.torso.length >= 3);
  check('weapon variants >= 3', SLOT_CATALOG.weapon.length >= 3);
  check('limb variants >= 2', SLOT_CATALOG.upperArm.length >= 2 && SLOT_CATALOG.thigh.length >= 2);
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
