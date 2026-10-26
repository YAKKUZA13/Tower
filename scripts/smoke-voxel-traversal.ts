/** Scientific fixture for bounded Amanatides-Woo voxel traversal. */
import { traverseVoxelGrid } from '@voxkera/voxel-core';

let failures = 0;
function check(name: string, condition: boolean, details = ''): void {
  if (condition) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 ${name} ${details}`); }
}

const keys = (cells: ReturnType<typeof traverseVoxelGrid>): string[] =>
  cells.map((cell) => `${cell.x},${cell.y},${cell.z}`);

console.log('Axis-aligned and bounded traversal:');
const axis = traverseVoxelGrid(
  { origin: [-2, 0, 0], direction: [2, 0, 0] },
  { min: [0, 0, 0], max: [2, 0, 0] },
  { tiePolicy: 'diagonal' }
);
check('visits each crossed cell once', JSON.stringify(keys(axis)) === JSON.stringify(['0,0,0', '1,0,0', '2,0,0']));
check('ray parameter respects non-normalized direction', Math.abs(axis[0]!.t - 0.75) < 1e-9, `(t=${axis[0]!.t})`);

console.log('Tie policies:');
const diagonal = traverseVoxelGrid(
  { origin: [-1, -1, 0], direction: [1, 1, 0] },
  { min: [0, 0, 0], max: [1, 1, 0] },
  { tiePolicy: 'diagonal' }
);
const supercover = traverseVoxelGrid(
  { origin: [-1, -1, 0], direction: [1, 1, 0] },
  { min: [0, 0, 0], max: [1, 1, 0] },
  { tiePolicy: 'supercover' }
);
check('diagonal policy emits positive-interval cells', JSON.stringify(keys(diagonal)) === JSON.stringify(['0,0,0', '1,1,0']));
check('supercover includes edge-touch cells',
  ['0,0,0', '1,0,0', '0,1,0', '1,1,0'].every((key) => keys(supercover).includes(key)),
  `(${keys(supercover).join(' ')})`);

console.log('Boundary and direction cases:');
const negative = traverseVoxelGrid(
  { origin: [2, 0, 0], direction: [-1, 0, 0] },
  { min: [-1, 0, 0], max: [1, 0, 0] },
  { tiePolicy: 'diagonal' }
);
check('negative direction preserves traversal order', JSON.stringify(keys(negative)) === JSON.stringify(['1,0,0', '0,0,0', '-1,0,0']));
const boundary = traverseVoxelGrid(
  { origin: [0.5, 0, 0], direction: [-1, 0, 0] },
  { min: [-1, 0, 0], max: [1, 0, 0] },
  { tiePolicy: 'diagonal' }
);
check('boundary start selects the cell in ray direction', keys(boundary)[0] === '0,0,0');
const miss = traverseVoxelGrid(
  { origin: [0, 4, 0], direction: [1, 0, 0] },
  { min: [0, 0, 0], max: [3, 1, 0] },
  { tiePolicy: 'diagonal' }
);
check('parallel ray outside slab misses', miss.length === 0);

console.log('Validation:');
let rejectedZero = false;
let rejectedPolicy = false;
try {
  traverseVoxelGrid({ origin: [0, 0, 0], direction: [0, 0, 0] }, { min: [0, 0, 0], max: [1, 1, 1] }, { tiePolicy: 'diagonal' });
} catch { rejectedZero = true; }
try {
  traverseVoxelGrid({ origin: [0, 0, 0], direction: [1, 0, 0] }, { min: [0, 0, 0], max: [1, 1, 1] }, { tiePolicy: 'invalid' as 'diagonal' });
} catch { rejectedPolicy = true; }
check('zero direction is rejected', rejectedZero);
check('invalid tie policy is rejected', rejectedPolicy);

if (failures > 0) {
  console.error(`\n${failures} voxel traversal check(s) failed.`);
  process.exit(1);
}
console.log('\nVoxel traversal smoke passed.');
