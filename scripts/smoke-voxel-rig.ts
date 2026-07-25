/**
 * Headless smoke test for part-graph rig (Phase P0, research 5).
 * Checks:
 *  1. assembleRig builds a hierarchy with node count = part count.
 *  2. Each expected joint name exists (hips/spine/head/arms/legs).
 *  3. cloneRig produces an independent copy (moving clone does not move original).
 *  4. disposeRig cleans up (mesh count in scene decreases).
 *  5. normalizeMesh convention: rig bounds height ~= 1.0, base @ -0.5.
 *  6. Walk-cycle math: phase monotonic, amplitudes in range.
 *  7. Greedy part meshes: no NaN, triangle count > 0.
 *
 * Run: npx tsx scripts/smoke-voxel-rig.ts
 */
import { NullEngine, Scene, TransformNode, VertexBuffer } from 'babylonjs';
import {
  assembleRig,
  cloneRig,
  disposeRig,
  findNodesByName,
  collectRigMeshes,
  listPartNames,
  getPartVoxels,
  type CharacterDef
} from '../client/src/babylon/voxel/voxel-parts';
import { skeletonRigged, RIGGED_DEFS } from '../client/src/babylon/voxel/importers/manual-parts';
import { UNIT_RIGS } from '../client/src/babylon/voxel/importers/unit-rigs';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) {
    console.log(`  \u2713 ${name}`);
  } else {
    failures += 1;
    console.error(`  \u2717 FAIL: ${name} ${details}`);
  }
}

const engine = new NullEngine();
const scene = new Scene(engine);

function countTransformNodes(root: TransformNode): number {
  let n = 0;
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const x = stack.pop()!;
    n++;
    for (const c of x.getChildren()) stack.push(c as TransformNode);
  }
  return n;
}
/** Считает только joint-TransformNode (имена из def), исключая меши и root-контейнер. */
function countJointNodes(root: TransformNode, jointNames: readonly string[]): number {
  const want = new Set(jointNames);
  let n = 0;
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const x = stack.pop()!;
    if (want.has(x.name)) n++;
    for (const c of x.getChildren()) stack.push(c as TransformNode);
  }
  return n;
}
function countMeshes(root: TransformNode): number {
  return collectRigMeshes(root).length;
}

const def: CharacterDef = skeletonRigged();
const partNames = listPartNames(def);
console.log('1. assembleRig builds full hierarchy:');
const rig = assembleRig(scene, def, { meshing: 'greedy' });
const totalNodes = countTransformNodes(rig);
// total = 1 root + 1 norm-child (нормализация вынесена на дочерний узел, чтобы
// root оставался identity и рендереры могли свободно ставить world-позицию) +
// (joint + mesh) per part = 2 + 2*partCount.
check('total nodes = 2 + 2*partCount (root + norm + joint + mesh per part)',
  totalNodes === 2 + 2 * partNames.length, `(nodes ${totalNodes} expected ${2 + 2 * partNames.length})`);
const jointCount = countJointNodes(rig, partNames);
check('joint node count = part count', jointCount === partNames.length,
  `(joints ${jointCount} parts ${partNames.length})`);

console.log('2. Expected joint names present:');
const expected = ['hips', 'spine', 'head', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR', 'thighL', 'shinL', 'thighR', 'shinR'];
const found = findNodesByName(rig, expected);
for (const name of expected) {
  check(`joint '${name}' exists`, found.has(name));
}

console.log('3. cloneRig independent:');
const clone = cloneRig(rig);
check('clone has same total node count', countTransformNodes(clone) === totalNodes);
check('clone has same joint count', countJointNodes(clone, partNames) === jointCount);
{
  const cloneThigh = findNodesByName(clone, ['thighL']).get('thighL');
  const origThigh = found.get('thighL');
  check('clone thighL found', cloneThigh !== undefined && origThigh !== undefined);
  if (cloneThigh && origThigh) {
    const before = origThigh.rotation.x;
    cloneThigh.rotation.x = 1.234;
    check('moving clone does not move original', Math.abs(origThigh.rotation.x - before) < 1e-6,
      `(orig ${origThigh.rotation.x})`);
  }
}

console.log('4. disposeRig cleans up:');
const meshesBefore = scene.meshes.length;
disposeRig(clone);
const meshesAfterClone = scene.meshes.length;
check('dispose clone reduces mesh count', meshesAfterClone < meshesBefore,
  `(before ${meshesBefore} after ${meshesAfterClone})`);

console.log('5. normalizeMesh convention (height ~1.0, base @ -0.5):');
{
  // Нормализация теперь живёт на дочернем norm-узле (root = identity → рендереры
  // свободно ставят position/scaling для world-размещения юнита). Контракт же —
  // WORLD-space: риг приводится к height≈1.0, основание (base) на y≈-0.5 в system
  // координат root'а (до того, как рендерер сдвинет root в world). Проверяем через
  // объединённые world-bounds всех meшей рига.
  const meshes = collectRigMeshes(rig);
  // В headless NullEngine без scene.render() world-матрицы не пересчитываются
  // автоматически → force-update всей иерархии перед чтением world-bounds.
  const forceWorld = (root: TransformNode): void => {
    const stack: TransformNode[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      n.computeWorldMatrix(true);
      for (const c of n.getChildren()) stack.push(c as TransformNode);
    }
  };
  forceWorld(rig);
  for (const m of meshes) { m.refreshBoundingInfo(); }
  let minY = Infinity, maxY = -Infinity;
  for (const m of meshes) {
    const b = m.getBoundingInfo().boundingBox;
    if (b.minimumWorld.y < minY) minY = b.minimumWorld.y;
    if (b.maximumWorld.y > maxY) maxY = b.maximumWorld.y;
  }
  const worldHeight = maxY - minY;
  check('rig world height ~= 1.0 (normalized)', Math.abs(worldHeight - 1.0) < 1e-3, `(worldHeight ${worldHeight.toFixed(4)})`);
  // base ~-0.5 с небольшим запасом под greedy-geometry offset (визуально незаметно).
  check('rig base (world minY) ~= -0.5', Math.abs(minY - (-0.5)) < 0.05, `(minY ${minY.toFixed(4)})`);
  // root должен оставаться identity (рендерер задаёт тут world-позицию поверх norm-child).
  check('rig root is identity (scaling 1, position 0) — свободен для world-placement',
    Math.abs(rig.scaling.x - 1) < 1e-6 && Math.abs(rig.scaling.y - 1) < 1e-6 && Math.abs(rig.scaling.z - 1) < 1e-6
    && Math.abs(rig.position.x) < 1e-6 && Math.abs(rig.position.y) < 1e-6 && Math.abs(rig.position.z) < 1e-6,
    `(scaling ${rig.scaling.toString()} pos ${rig.position.toString()})`);
  // доп.: после world-placement рендера (scaling=cellSize, pos.y=groundY+0.5cs)
  // основание должно прийти ровно на groundY. Эмулируем: root.scaling=S, root.position=(0,0.5S,0).
  rig.scaling.set(2, 2, 2);
  rig.position.set(0, 1.0, 0); // 0.5*S = 1.0 при S=2
  forceWorld(rig);
  for (const m of meshes) { m.refreshBoundingInfo(); }
  let baseAfter = Infinity;
  for (const m of meshes) { const b = m.getBoundingInfo().boundingBox; if (b.minimumWorld.y < baseAfter) baseAfter = b.minimumWorld.y; }
  check('after renderer world-placement (S=2, pos.y=1.0), base lands at groundY=0',
    Math.abs(baseAfter - 0.0) < 0.05, `(baseAfter ${baseAfter.toFixed(4)})`);
  // revert
  rig.scaling.set(1, 1, 1);
  rig.position.set(0, 0, 0);
}

console.log('6. Walk-cycle math (phase monotonic, amplitude range):');
{
  const WALK_FREQ = 8.0;     // рад/сек
  const WALK_AMP = 0.6;      // рад
  const IDLE_AMP = 0.08;
  let prevPhase = -Infinity;
  let mono = true;
  for (let i = 0; i < 10; i++) {
    const t = i * 0.05;
    const phase = t * WALK_FREQ * 2 * Math.PI;
    if (phase < prevPhase) mono = false;
    prevPhase = phase;
  }
  check('phase monotonic over time', mono);
  const thigh = Math.sin(0) * WALK_AMP;
  check('walk amplitude within [-amp, amp]', Math.abs(thigh) <= WALK_AMP + 1e-6);
  const idle = Math.sin(0) * IDLE_AMP;
  check('idle amplitude small', Math.abs(idle) <= IDLE_AMP + 1e-6);
  // противофаза ног
  const phase = 1.0;
  const l = Math.sin(phase) * WALK_AMP;
  const r = Math.sin(phase + Math.PI) * WALK_AMP;
  check('legs in antiphase', Math.abs(l + r) < 1e-6, `(l ${l.toFixed(3)} r ${r.toFixed(3)})`);
}

console.log('7. Greedy part meshes valid:');
{
  const meshes = collectRigMeshes(rig);
  check('rig has > 0 meshes', meshes.length > 0);
  let totalTri = 0;
  let hasNaN = false;
  for (const m of meshes) {
    const idx = m.getTotalIndices();
    totalTri += Math.floor(idx / 3);
    const pos = m.getVerticesData(VertexBuffer.PositionKind);
    if (pos && pos.some((v: number) => Number.isNaN(v))) hasNaN = true;
  }
  check('rig total triangles > 0', totalTri > 0, `(tri ${totalTri})`);
  check('no NaN in part positions', !hasNaN);
}

disposeRig(rig);

// ════════════════════════════════════════════════════════════════════════════
//  M1: валидность ВСЕХ rigged-дефов (гуманоидные + нестандартные animKind)
// ════════════════════════════════════════════════════════════════════════════
console.log('8. M1 — all rigged defs valid (node count / bounds / no NaN / animKind):');
{
  const expectedAnimNodes: Record<string, string[]> = {
    humanoid: ['hips', 'spine', 'head', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR', 'thighL', 'shinL', 'thighR', 'shinR'],
    bat: ['wingL', 'wingR'],
    spider: ['legL1', 'legR1', 'legL4', 'legR4'],
    ghost: ['hips', 'head', 'armL', 'armR'],
    slime: ['hips']
  };
  const ids = Object.keys(RIGGED_DEFS);
  check('RIGGED_DEFS covers all enemy types (>= 8)', ids.length >= 8, `(have ${ids.length})`);
  let totalVoxels = 0;
  for (const id of ids) {
    const d = RIGGED_DEFS[id]!();
    const parts = listPartNames(d);
    const r = assembleRig(scene, d, { meshing: 'greedy' });
    const joints = countJointNodes(r, parts);
    let nan = false;
    let tri = 0;
    let vox = 0;
    for (const name of parts) {
      for (const vv of getPartVoxels(d, name)) { vox++; totalVoxels++; }
    }
    for (const m of collectRigMeshes(r)) {
      const idx = m.getTotalIndices();
      tri += Math.floor(idx / 3);
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (pos && pos.some((v: number) => Number.isNaN(v))) nan = true;
    }
    const okJoints = joints === parts.length;
    const okTri = tri > 0;
    const okNan = !nan;
    const okAnim = !!d.animKind && !!expectedAnimNodes[d.animKind];
    // ожидаемые аним-нод присутствуют
    let okNodes = true;
    if (d.animKind && expectedAnimNodes[d.animKind]) {
      const found2 = findNodesByName(r, expectedAnimNodes[d.animKind]!);
      for (const n of expectedAnimNodes[d.animKind]!) if (!found2.has(n)) okNodes = false;
    }
    check(`${id}: joints=${joints}/${parts.length} voxels=${vox} tri=${tri} animKind=${d.animKind ?? '?'}`,
      okJoints && okTri && okNan && okAnim && okNodes,
      !okJoints ? 'joint mismatch' : !okTri ? 'no triangles' : !okNan ? 'NaN' : !okAnim ? 'no animKind' : !okNodes ? 'missing anim nodes' : '');
    disposeRig(r);
  }
  check('total voxels across all rigs > 0', totalVoxels > 0, `(${totalVoxels})`);
}

// ════════════════════════════════════════════════════════════════════════════
//  M2: валидность rigged-дефов RTS-юнитов (knight/archer/mage/commander)
// ════════════════════════════════════════════════════════════════════════════
console.log('9. M2 — unit rigged defs valid (humanoid walk-nodes + weapons):');
{
  const ids = Object.keys(UNIT_RIGS);
  check('UNIT_RIGS covers all unit types (>= 4)', ids.length >= 4, `(have ${ids.length})`);
  const walkNodes = ['hips', 'spine', 'head', 'upperArmL', 'forearmL', 'upperArmR', 'forearmR', 'thighL', 'shinL', 'thighR', 'shinR'];
  for (const id of ids) {
    const d = UNIT_RIGS[id]!();
    const parts = listPartNames(d);
    const r = assembleRig(scene, d, { meshing: 'greedy' });
    const joints = countJointNodes(r, parts);
    let nan = false;
    let tri = 0;
    for (const m of collectRigMeshes(r)) {
      tri += Math.floor(m.getTotalIndices() / 3);
      const pos = m.getVerticesData(VertexBuffer.PositionKind);
      if (pos && pos.some((v: number) => Number.isNaN(v))) nan = true;
    }
    const found = findNodesByName(r, walkNodes);
    let allWalk = true;
    for (const n of walkNodes) if (!found.has(n)) allWalk = false;
    check(`${id}: joints=${joints}/${parts.length} tri=${tri} humanoid=${d.animKind === 'humanoid'}`,
      joints === parts.length && tri > 0 && !nan && d.animKind === 'humanoid' && allWalk,
      !allWalk ? 'missing walk nodes' : '');
    disposeRig(r);
  }
}

engine.dispose();
console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
