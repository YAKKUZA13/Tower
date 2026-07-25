/**
 * M4 smoke (voxel-migration-plan): LOD-классификатор для rigged-акторов.
 *
 * Проверяет classifyLod: ближайшие N к фокусу → 'shadowed', следующие M → 'animated',
 * прочие → 'static' (D2/D3/D13). Pure-функция, детерминирована.
 *
 * Run: npx tsx scripts/smoke-lod.ts
 */
import { classifyLod, type LodDist } from '../client/src/babylon/lod';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

console.log('1. Tier assignment by distance:');
{
  // 5 акторов на расстояниях 1,2,3,4,5 от фокуса.
  const dists: LodDist[] = [
    { id: 'a', d2: 1 }, { id: 'b', d2: 4 }, { id: 'c', d2: 9 }, { id: 'd', d2: 16 }, { id: 'e', d2: 25 }
  ];
  const tiers = classifyLod(dists, 2, 4); // 2 shadowed, 4 animated, rest static
  check('5 actors classified', tiers.size === 5);
  check('nearest (a) shadowed', tiers.get('a') === 'shadowed');
  check('2nd (b) shadowed', tiers.get('b') === 'shadowed');
  check('3rd (c) animated', tiers.get('c') === 'animated');
  check('4th (d) animated', tiers.get('d') === 'animated');
  check('5th (e) static', tiers.get('e') === 'static');
}

console.log('2. Caps clamp to population:');
{
  const dists: LodDist[] = [{ id: 'a', d2: 1 }, { id: 'b', d2: 4 }];
  const tiers = classifyLod(dists, 10, 20); // caps exceed population
  check('all shadowed when cap > pop', tiers.get('a') === 'shadowed' && tiers.get('b') === 'shadowed');
}

console.log('3. Empty input:');
{
  const tiers = classifyLod([], 24, 80);
  check('empty → empty map', tiers.size === 0);
}

console.log('4. Determinism (same input → same tiers):');
{
  const dists: LodDist[] = [];
  for (let i = 0; i < 100; i++) dists.push({ id: `e${i}`, d2: Math.random() * 100 });
  const a = classifyLod(dists, 24, 80);
  const b = classifyLod(dists, 24, 80);
  let same = a.size === b.size;
  for (const [k, v] of a) if (b.get(k) !== v) same = false;
  check('two classifications identical', same);
  // подсчёт по тирам
  let shadowed = 0, animated = 0, stat = 0;
  for (const v of a.values()) {
    if (v === 'shadowed') shadowed++;
    else if (v === 'animated') animated++;
    else stat++;
  }
  check(`tier counts shadowed=${shadowed} animated=${animated} static=${stat}`,
    shadowed === 24 && animated === 56 && stat === 20,
    `(s${shadowed} a${animated} st${stat})`);
}

console.log('5. Crowd scaling (200 actors, caps 24/80):');
{
  const dists: LodDist[] = [];
  for (let i = 0; i < 200; i++) dists.push({ id: `e${i}`, d2: i });
  const tiers = classifyLod(dists, 24, 80);
  let shadowed = 0, animated = 0, stat = 0;
  for (const v of tiers.values()) {
    if (v === 'shadowed') shadowed++;
    else if (v === 'animated') animated++;
    else stat++;
  }
  check('200 actors: 24 shadowed / 56 animated / 120 static',
    shadowed === 24 && animated === 56 && stat === 120,
    `(s${shadowed} a${animated} st${stat})`);
}

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
