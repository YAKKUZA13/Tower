/** Headless contract/backend smoke for the reusable hybrid scene-kit slice. */
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import {
  createSceneRandom,
  createRitualSanctumKit,
  generateProceduralSanctum,
  instantiateSceneFragment,
  rasterizeNavBlockers,
  validateSceneKit
} from '../packages/engine-scene/src/index';
import { buildSceneKit } from '../packages/scene-babylon/src/index';

let failures = 0;
function check(name: string, condition: boolean, details = ''): void {
  if (condition) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 ${name} ${details}`); }
}

console.log('Hybrid scene contract:');
const first = createRitualSanctumKit({ scale: 1.1, particleCount: 64, seed: 17 });
const second = createRitualSanctumKit({ scale: 1.1, particleCount: 64, seed: 17 });
const validation = validateSceneKit(first);
check('fixture is deterministic', JSON.stringify(first) === JSON.stringify(second));
check('fixture satisfies its quality/budget contract', validation.ok,
  validation.ok ? '' : validation.errors.map((error) => `${error.path}: ${error.message}`).join(', '));
if (validation.ok) {
  check('triangle budget retains headroom', validation.metrics.estimatedTriangles < first.budget.maxEstimatedTriangles * 0.5);
  check('particle budget is explicit', validation.metrics.animatedInstances === 64);
}

const invalid = structuredClone(first);
invalid.nodes[0]!.parent = invalid.nodes[0]!.id;
const invalidResult = validateSceneKit(invalid);
check('hierarchy cycles fail validation', !invalidResult.ok && invalidResult.errors.some((error) => error.message.includes('cycle')));

console.log('Generic scene composition:');
const randomA = createSceneRandom(73);
const randomB = createSceneRandom(73);
const sequenceA = Array.from({ length: 8 }, () => randomA.next());
const sequenceB = Array.from({ length: 8 }, () => randomB.next());
check('engine PRNG is reproducible', JSON.stringify(sequenceA) === JSON.stringify(sequenceB));
check('engine PRNG stays in [0,1)', sequenceA.every((value) => value >= 0 && value < 1));
const fragment = {
  nodes: [
    { id: 'body', material: 'stone-dark', primitive: { kind: 'box' as const, size: [1, 2, 1] as [number, number, number] }, socketId: 'top' },
    { id: 'cap', parent: 'body', material: 'stone-worn', primitive: { kind: 'box' as const, size: [1.2, 0.2, 1.2] as [number, number, number] }, destructionGroup: 'cap' }
  ]
};
const fragmentA = instantiateSceneFragment(fragment, { id: 'column-a', position: [1, 0, 0] });
const fragmentB = instantiateSceneFragment(fragment, { id: 'column-b', position: [-1, 0, 0] });
check('fragment instances receive collision-free node ids',
  !fragmentA.nodes.some((node) => fragmentB.nodes.some((other) => other.id === node.id)));
check('fragment sockets and destruction groups are namespaced',
  fragmentA.nodes.some((node) => node.socketId === 'column-a/top') &&
  fragmentA.nodes.some((node) => node.destructionGroup === 'column-a/cap'));
check('fragment source remains immutable', fragment.nodes[0]!.id === 'body' && fragment.nodes[0]!.socketId === 'top');

console.log('Procedural grammar + nav rasterization:');
const generatedA = generateProceduralSanctum({ scale: 1.1, particleCount: 64, seed: 1337, density: 0.8 });
const generatedB = generateProceduralSanctum({ scale: 1.1, particleCount: 64, seed: 1337, density: 0.8 });
const generatedC = generateProceduralSanctum({ scale: 1.1, particleCount: 64, seed: 1338, density: 0.8 });
check('same seed reproduces the full scene', JSON.stringify(generatedA) === JSON.stringify(generatedB));
check('different seed changes structural output', JSON.stringify(generatedA.nodes) !== JSON.stringify(generatedC.nodes));
check('generator adds terrain-conforming structural variation',
  generatedA.nodes.some((node) => node.id.startsWith('outer-wall-') && !!node.terrainAnchor));
const navGrid = { cols: 32, rows: 32, cellSize: 1.5 };
const navA = rasterizeNavBlockers(generatedA, navGrid, { position: [0, 0, 0] });
const navB = rasterizeNavBlockers(generatedB, navGrid, { position: [0, 0, 0] });
check('nav rasterization is deterministic', JSON.stringify(navA) === JSON.stringify(navB));
check('nav blockers are bounded and non-empty', navA.length > 0 && navA.length < 80, `(cells=${navA.length})`);
check('ritual center remains a playable gate', !navA.some((cell) => cell.col === 16 && cell.row === 16));

console.log('Babylon adapter:');
const engine = new NullEngine({ renderWidth: 320, renderHeight: 180 });
const scene = new Scene(engine);
scene.activeCamera = new FreeCamera('smoke-camera', new Vector3(0, 8, -12), scene);
const handle = buildSceneKit(scene, generatedA, {
  position: [2, 0.5, -3],
  timeSeconds: () => 5,
  terrainHeightAt: () => 3
});
check('all logical nodes are preserved', handle.nodes.size === generatedA.nodes.length);
check('render nodes create instances', handle.meshes.size === generatedA.nodes.filter((node) => node.primitive).length);
check('stable ritual socket is exposed', handle.sockets.has('ritual-origin'));
check('collider metadata survives backend build', handle.colliders.length > 5);
check('destruction groups survive backend build', handle.destructionGroups.size > 5);
check('shadow families are batched', handle.shadowCasters.length > 0 && handle.shadowCasters.length < handle.meshes.size);
check('backend mesh count stays within declared nodes plus batched families',
  scene.meshes.length <= generatedA.nodes.length + 16, `(meshes=${scene.meshes.length})`);
const anchoredDefinition = generatedA.nodes.find((node) => node.id.startsWith('outer-wall-'))!;
const anchoredNode = handle.nodes.get(anchoredDefinition.id)!;
anchoredNode.computeWorldMatrix(true);
check('terrain anchor places node on sampled world height',
  Math.abs(anchoredNode.getAbsolutePosition().y - (3 + (anchoredDefinition.terrainAnchor?.offset ?? 0))) < 1e-6);
scene.render();
handle.dispose();
check('dispose releases scene-kit meshes', scene.meshes.length === 0, `(meshes=${scene.meshes.length})`);

const nestedAnchors = structuredClone(generatedA);
nestedAnchors.nodes.unshift(
  { id: 'anchor-child', parent: 'anchor-parent', transform: { position: [0, 2, 0] }, terrainAnchor: { offset: 0.5 } },
  { id: 'anchor-parent', parent: 'sanctum-root', transform: { position: [0, 1, 0] }, terrainAnchor: { offset: 1 } }
);
const nestedHandle = buildSceneKit(scene, nestedAnchors, { terrainHeightAt: () => 3 });
const nestedChild = nestedHandle.nodes.get('anchor-child')!;
nestedChild.computeWorldMatrix(true);
check('nested terrain anchors are independent of declaration order',
  Math.abs(nestedChild.getAbsolutePosition().y - 3.5) < 1e-6,
  `(y=${nestedChild.getAbsolutePosition().y})`);
nestedHandle.dispose();
scene.dispose();
engine.dispose();

if (failures > 0) {
  console.error(`\n${failures} hybrid-scene smoke check(s) failed.`);
  process.exit(1);
}
console.log('\nHybrid scene smoke passed.');
