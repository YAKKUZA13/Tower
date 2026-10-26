/** Result-level parity gate recorded before extracting the engine. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as models from '../client/src/babylon/voxel/voxel-builder';
import * as palette from '../client/src/babylon/voxel/voxel-palette';
import * as theme from '../client/src/babylon/voxel/dark-palette';
import { assembleCharacter, assembleCrowd, archetypeTheme } from '../client/src/babylon/voxel/procedural-kit/kit-assembler';
import { VoxelStampRegistry, assembleRecipe } from '../client/src/babylon/voxel/primitives/voxel-stamps';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const values: Record<string, string> = {};
for (const [id, builder] of Object.entries(models.VOXEL_BUILDERS)) {
  values[`builder:${id}`] = hash([builder(), models.builderEmissive(id)]);
}
values.palette = hash([palette.INDEXED_PALETTE, [...palette.PALETTE_LABEL_BASE], palette.PALETTE_MAX]);
values.colors = hash([theme.PALETTE, theme.ACCENT, ['boss', 'tank', 'fast', 'unknown'].map(theme.enemyEye),
  ['arrow', 'cannon', 'arcane', 'ice', 'unknown'].map(id => [theme.towerBase(id), theme.towerAccent(id)]),
  ['fire', 'arcane', 'gold', 'ice', 'blood', 'unknown'].map(id => theme.relicAccent(`relic:totem-${id}`))]);
values.paletteQueries = hash(Array.from({length: 128}, (_, i) => {
  const rgb: [number, number, number] = [(i % 17) / 17, (i % 11) / 11, (i % 7) / 7];
  const index = palette.snapToPalette(rgb);
  return [index, palette.paletteIndexToRGB(index), palette.hueVariant('stone', i), palette.hueVariant('unknown', i)];
}));
for (const archetype of ['skeleton', 'zombie', 'demon', 'generic'] as const) {
  values[`theme:${archetype}`] = hash(archetypeTheme(archetype));
  for (const seed of [0, 1, 42, 0xffffffff]) values[`kit:${archetype}:${seed}`] = hash(assembleCharacter(seed, {archetype}));
}
values.crowd = hash(assembleCrowd(42, 8));
const registry = new VoxelStampRegistry();
const stamps = ['box','slab','cylinder','hip_roof','wedge_roof','barrel_vault','horn','crystal','gem','shingled_hip_roof','pebble','grass_tuft','moss_patch','ivy_patch','flower_head','smoke_column'];
for (const id of stamps) {
  values[`stamp:${id}`] = hash([registry.getDef(id), registry.primitiveFor(id)?.boundingBox({}), registry.stamp(id, {}), registry.materialFor(id)]);
  for (const label of [undefined, 'gold_ore', 'fire_core', 'void', 'metal_dark', 'stone_warm', 'oak', 'roof_slate', 'grass', 'moss', 'ivy', 'smoke', 'unknown']) {
    values[`assembly:${id}:${label}`] = hash(assembleRecipe([{ id, asset: id, params: {}, position: [2, 3, 4], rotation: [0, 90, 0], label }], registry));
  }
}
const fixture = new URL('./fixtures/voxkera-content-baseline.json', import.meta.url);
if (process.argv.includes('--record')) {
  mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
  writeFileSync(fixture, JSON.stringify({sourceHead:'26b3a757afb9b3f887c57cb0266c7af29d37b35d', values}, null, 2) + '\n');
  console.log(`Recorded ${Object.keys(values).length} pre-migration content results`);
} else {
  const expected = JSON.parse(readFileSync(fixture, 'utf8')).values;
  assert.deepEqual(values, expected, 'Extraction changed Tower model/palette/stamp output');
  console.log(`PASS ${Object.keys(values).length} pre-migration content results are byte-identical`);
}
