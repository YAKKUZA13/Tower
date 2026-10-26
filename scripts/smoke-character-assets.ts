import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHARACTER_LIMITS, characterRecipeJsonSchema, loadCharacterRecipe, validateCharacterRecipe,
  type CharacterRecipeV1,
} from '@voxkera/engine-recipe';
import { compileCharacterAsset, sampleCharacterClip } from '@voxkera/voxel-core';
import { createCharacterAssetRig } from '@voxkera/voxel-babylon';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';

const json = readFileSync('packages/voxel-lab/public/characters/warden.json', 'utf8');
const parsed = loadCharacterRecipe(json);
assert.ok(parsed.ok, JSON.stringify(parsed));
const recipe = parsed.recipe;
const invalid = (change: (copy: CharacterRecipeV1) => void, code?: string) => {
  const copy = structuredClone(recipe); change(copy);
  const result = validateCharacterRecipe(copy);
  assert.equal(result.ok, false, 'Invalid recipe must not pass');
  if (!result.ok && code) assert.ok(result.errors.some(issue => issue.code === code), JSON.stringify(result));
};
invalid(copy => { (copy as unknown as { kind: string }).kind = 'building'; });
invalid(copy => { (copy as unknown as { formatVersion: number }).formatVersion = 2; });
invalid(copy => { Object.assign(copy, { executable: 'ignored JS is not allowed' }); });
invalid(copy => { Object.assign(copy.parts[0]!, { rotation: [90, 0, 0] }); });
invalid(copy => { Object.assign(copy.parts[0]!.shapes[0]!, { kind: 'unknown' }); });
invalid(copy => { copy.parts[1]!.id = copy.parts[0]!.id; }, 'DuplicateId');
invalid(copy => { delete copy.parts[1]!.parent; }, 'RootCount');
invalid(copy => { copy.parts[0]!.parent = 'forearmR'; }, 'HierarchyCycle');
invalid(copy => { copy.parts[2]!.parent = 'missing'; }, 'UnknownPart');
invalid(copy => { copy.parts[0]!.shapes[0]!.color = 'missing'; }, 'UnknownColor');
invalid(copy => { copy.palette[1]!.id = copy.palette[0]!.id; }, 'DuplicateId');
invalid(copy => { copy.sockets[0]!.part = 'missing'; }, 'UnknownPart');
invalid(copy => { copy.sockets[1]!.id = copy.sockets[0]!.id; }, 'DuplicateId');
invalid(copy => { copy.clips[0]!.tracks[0]!.part = 'missing'; }, 'UnknownPart');
invalid(copy => { copy.clips[0]!.tracks.push(structuredClone(copy.clips[0]!.tracks[0]!)); }, 'DuplicateTrack');
invalid(copy => { copy.clips[0]!.tracks[0]!.keys[1]!.time = 0; }, 'InvalidKeyTime');
invalid(copy => { copy.clips[0]!.tracks[0]!.keys[1]!.time = 2; }, 'InvalidKeyTime');
invalid(copy => { copy.parts[0]!.pivot[0] = Infinity; });
invalid(copy => { copy.palette[0]!.color[0] = NaN; });
invalid(copy => { copy.parts[0]!.shapes = [{ kind: 'box', min: [2, 0, 0], max: [1, 0, 0], color: 'steel' }]; }, 'InvalidBounds');
invalid(copy => { copy.parts[0]!.shapes = [{ kind: 'box', min: [-100, -100, -100], max: [100, 100, 100], color: 'steel' }]; }, 'CandidateBudget');
invalid(copy => { copy.budget.maxCandidateCells = CHARACTER_LIMITS.candidateCells + 1; });
invalid(copy => { copy.parts[0]!.shapes = [
  { kind: 'box', min: [-256, -256, -256], max: [-256, -256, -256], color: 'steel' },
  { kind: 'box', min: [256, 256, 256], max: [256, 256, 256], color: 'steel' },
]; }, 'MeshingBudget');
invalid(copy => { copy.parts = Array(CHARACTER_LIMITS.parts + 1).fill(copy.parts[0]); }, 'CollectionLimit');
invalid(copy => { copy.quality.requiredViews.push(copy.quality.requiredViews[0]!); });
assert.equal(loadCharacterRecipe('{').ok, false);
assert.equal(loadCharacterRecipe(' '.repeat(CHARACTER_LIMITS.jsonChars + 1)).ok, false);
assert.equal(validateCharacterRecipe(null).ok, false);
assert.equal(validateCharacterRecipe({ formatVersion: 1, parts: [] }).ok, false);
console.log('PASS strict input: versions, unknown fields/shapes, bounds, references, cycles, keys and host ceilings');

const compiled = compileCharacterAsset(recipe);
assert.ok(compiled.ok, JSON.stringify(compiled));
const again = compileCharacterAsset(JSON.parse(JSON.stringify(recipe)));
assert.deepEqual(compiled, again);
const snapshot = JSON.stringify(recipe);
compileCharacterAsset(recipe);
assert.equal(JSON.stringify(recipe), snapshot);
const reversed = structuredClone(recipe); reversed.parts.reverse();
assert.ok(compileCharacterAsset(reversed).ok, 'Forward parent references must work');
const tiny = structuredClone(recipe); tiny.budget.maxVoxels = 1;
const budget = compileCharacterAsset(tiny);
assert.ok(!budget.ok && budget.errors[0]?.code === 'VoxelBudget');
const empty = structuredClone(recipe);
empty.parts[0]!.shapes = [{ kind: 'ellipsoid', center: [.5, .5, .5], radii: [.1, .1, .1], color: 'steel' }];
assert.equal(compileCharacterAsset(empty).ok, false);
const asset = compiled.asset;
assert.equal(asset.metrics.parts, 11);
const allParts = (node: typeof asset.character.root): typeof asset.character.root[] => [node, ...node.children.flatMap(allParts)];
assert.equal(asset.metrics.voxels, allParts(asset.character.root).reduce((n, part) => n + part.voxels.length, 0));
assert.ok(asset.metrics.voxels > 0 && asset.metrics.voxels < asset.metrics.candidateCells);
assert.equal(allParts(asset.character.root).length, 11, 'Never flatten articulated parts');
console.log('PASS compile: deterministic round trip, immutable input, forward refs, voxel budgets, articulated geometry');

const clip = recipe.clips[0]!;
assert.equal(sampleCharacterClip(clip, .2)[0]!.rotation[0], 0);
assert.deepEqual(sampleCharacterClip(clip, .8), sampleCharacterClip(clip, 0));
assert.deepEqual(sampleCharacterClip(clip, -1), sampleCharacterClip(clip, 0));
const step = structuredClone(clip); step.tracks[0]!.interpolation = 'step';
assert.equal(sampleCharacterClip(step, .2)[0]!.rotation[0], -.5);
assert.equal(sampleCharacterClip(step, .4)[0]!.rotation[0], .5);
const once = recipe.clips[1]!;
assert.deepEqual(sampleCharacterClip(once, 100), sampleCharacterClip(once, once.duration));
const endpoints = structuredClone(once);
endpoints.tracks[0]!.keys = [
  { time: .25, rotation: [0, 0, 0], translation: [0, 0, 0] },
  { time: .75, rotation: [1, 2, 3], translation: [2, 4, 6] },
];
assert.deepEqual(sampleCharacterClip(endpoints, 0)[0]!.translation, [0, 0, 0]);
assert.deepEqual(sampleCharacterClip(endpoints, .5)[0]!.translation, [1, 2, 3]);
assert.deepEqual(sampleCharacterClip(endpoints, 1)[0]!.translation, [2, 4, 6]);
assert.throws(() => sampleCharacterClip(clip, NaN));
const schema = characterRecipeJsonSchema();
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties?.formatVersion?.const, 1);
assert.doesNotThrow(() => JSON.stringify(schema));
console.log('PASS clips/schema: seconds, linear/step, loop/clamp, invalid clock, JSON Schema from same structural definition');

const engine = new NullEngine();
const scene = new Scene(engine);
try {
  const before = { meshes: scene.meshes.length, nodes: scene.transformNodes.length, materials: scene.materials.length };
  for (let repeat = 0; repeat < 3; repeat++) {
    const a = createCharacterAssetRig(scene, asset), b = createCharacterAssetRig(scene, asset);
    assert.equal(a.parts.size, 11); assert.equal(a.sockets.size, 2);
    const socket = a.sockets.get('weapon')!;
    assert.equal(socket.parent, a.parts.get('forearmR'));
    a.root.computeWorldMatrix(true); socket.computeWorldMatrix(true);
    const restSocket = socket.getAbsolutePosition().clone();
    a.sampleClip('salute', .5); socket.computeWorldMatrix(true);
    assert.ok(socket.getAbsolutePosition().subtract(restSocket).length() > .01, 'Socket must follow animated joint');
    assert.equal(b.parts.get('forearmR')!.rotation.x, 0, 'Other instance pose is independent');
    const mixed = structuredClone(asset);
    mixed.recipe.clips.push({ id: 'mixed', duration: 1, loop: false, tracks: [{
      part: 'head', interpolation: 'linear', keys: [{ time: 0, rotation: [.3, .4, .5], translation: [0, 0, 0] }],
    }] });
    const c = createCharacterAssetRig(scene, mixed);
    c.sampleClip('mixed', 0);
    const actualDirection = c.parts.get('head')!.getDirection(Vector3.Forward()).normalize();
    const expectedDirection = Vector3.TransformNormal(Vector3.Forward(), Matrix.RotationYawPitchRoll(.4, .3, .5)).normalize();
    assert.ok(actualDirection.subtract(expectedDirection).length() < 1e-6, 'Mixed axes follow the documented YXZ composition');
    c.dispose();
    a.sampleClip('stride', .1);
    assert.equal(a.parts.get('forearmR')!.rotation.x, 0, 'Untracked part returns to rest');
    assert.throws(() => a.sampleClip('unknown', 0));
    a.resetPose(); assert.equal(a.parts.get('thighL')!.rotation.x, 0);
    a.dispose(); a.dispose(); b.dispose();
    assert.throws(() => a.sampleClip('stride', 0));
    assert.deepEqual({ meshes: scene.meshes.length, nodes: scene.transformNodes.length, materials: scene.materials.length }, before);
  }
} finally { scene.dispose(); engine.dispose(); }
console.log('PASS Babylon: separate poses, animated sockets, rest reset, explicit errors, repeated idempotent disposal');
