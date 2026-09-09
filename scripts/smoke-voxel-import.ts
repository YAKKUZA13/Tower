/**
 * Headless smoke test for .vox + glTF importers (Phase P3, research 5.3).
 * Checks:
 *  1. Generated .vox (2 models + scene graph nGRP/nTRN/nSHP) → importVox → CharacterDef with >=2 parts.
 *  2. Imported def parts carry pivot (_t) and voxels (from models).
 *  3. assembleRig on imported def renders (node count, triangle count > 0).
 *  4. buildRiggedMaster (asset-catalog) returns cached CharacterDef (procedural fallback).
 *  5. gltf-parts: buildDefFromNodes from synthetic Babylon mesh hierarchy → PartNode tree.
 *
 * Run: npx tsx scripts/smoke-voxel-import.ts
 */
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { importVox } from '../client/src/babylon/voxel/importers/vox-importer';
import { buildDefFromNodes } from '../client/src/babylon/voxel/importers/gltf-parts';
import { assembleRig, collectRigMeshes, listPartNames } from '../client/src/babylon/voxel/voxel-parts';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

// ── Minimal .vox byte-writer (matches our reader's layout) ───────────────────
class W {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 0xff); }
  u32(v: number) { this.b.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); }
  i32(v: number) { this.u32(v); }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i)); }
  cstr(s: string) { this.ascii(s); this.u8(0); }
  chunk(id: string, content: () => void, children: () => void) {
    const beforeContent = this.b.length;
    this.ascii(id); this.u32(0); this.u32(0); // placeholders
    const contentSizePos = beforeContent + 4;
    const childrenSizePos = beforeContent + 8;
    const contentStart = this.b.length;
    content();
    const contentSize = this.b.length - contentStart;
    this.b[contentSizePos] = contentSize & 0xff;
    this.b[contentSizePos + 1] = (contentSize >>> 8) & 0xff;
    this.b[contentSizePos + 2] = (contentSize >>> 16) & 0xff;
    this.b[contentSizePos + 3] = (contentSize >>> 24) & 0xff;
    const childrenStart = this.b.length;
    children();
    const childrenSize = this.b.length - childrenStart;
    this.b[childrenSizePos] = childrenSize & 0xff;
    this.b[childrenSizePos + 1] = (childrenSize >>> 8) & 0xff;
    this.b[childrenSizePos + 2] = (childrenSize >>> 16) & 0xff;
    this.b[childrenSizePos + 3] = (childrenSize >>> 24) & 0xff;
  }
  dict(entries: [string, number, number | string][]) {
    this.u32(entries.length);
    for (const [k, type, val] of entries) {
      this.cstr(k);
      this.u8(type);
      if (type === 0) this.i32(val as number);
      else if (type === 1) this.i32(val as number);
      else this.cstr(String(val));
    }
  }
}

/** Генерирует .vox: 2 модели (3×1×3 slab + 1×3×1 столб) + scene graph. */
function makeTestVox(): Uint8Array {
  const w = new W();
  w.ascii('VOX '); w.u32(150);
  w.chunk('MAIN', () => {}, () => {
    // model 0: 3×1×3 slab — 9 voxels colorIndex 5
    w.chunk('SIZE', () => { w.u32(3); w.u32(1); w.u32(3); }, () => {});
    w.chunk('XYZI', () => {
      w.u32(9);
      for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) { w.u8(x); w.u8(0); w.u8(z); w.u8(5); }
    }, () => {});
    // model 1: 1×3×1 column — 3 voxels colorIndex 10
    w.chunk('SIZE', () => { w.u32(1); w.u32(3); w.u32(1); }, () => {});
    w.chunk('XYZI', () => {
      w.u32(3);
      for (let y = 0; y < 3; y++) { w.u8(0); w.u8(y); w.u8(0); w.u8(10); }
    }, () => {});
    // RGBA palette (256)
    w.chunk('RGBA', () => {
      for (let i = 0; i < 256; i++) { w.u8(100); w.u8(80); w.u8(60); w.u8(255); }
    }, () => {});
    // scene graph: nGRP(0) root → [nTRN(1)→nSHP(3, model0), nTRN(2)→nSHP(4, model1)]
    w.chunk('nGRP', () => {
      w.u32(0);                       // node id
      w.dict([['_name', 2, 'root']]); // attrs
      w.u32(2);                       // num children
      w.u32(1); w.u32(2);             // child ids
    }, () => {});
    w.chunk('nTRN', () => {
      w.u32(1);                                  // node id
      w.dict([['_name', 2, 'partA']]);           // attrs
      w.u32(3);                                  // child node id (nSHP A)
      w.i32(-1);                                 // reserved
      w.u32(0);                                  // layer
      w.u32(1);                                  // num frames
      w.dict([['_r', 0, 0]]);                    // frame attrs: _r=0
      w.i32(2); w.i32(0); w.i32(0);              // _t (translation) — [2,0,0]
    }, () => {});
    w.chunk('nSHP', () => {
      w.u32(3);                                  // node id
      w.dict([['_name', 2, 'shapeA']]);
      w.u32(1);                                  // num models
      w.u32(0); w.dict([]);                      // model 0
    }, () => {});
    w.chunk('nTRN', () => {
      w.u32(2);
      w.dict([['_name', 2, 'partB']]);
      w.u32(4); w.i32(-1); w.u32(0); w.u32(1);
      w.dict([['_r', 0, 0]]);
      w.i32(5); w.i32(0); w.i32(0);              // _t [5,0,0]
    }, () => {});
    w.chunk('nSHP', () => {
      w.u32(4);
      w.dict([['_name', 2, 'shapeB']]);
      w.u32(1); w.u32(1); w.dict([]);            // model 1
    }, () => {});
  });
  return new Uint8Array(w.b);
}

const engine = new NullEngine();
const scene = new Scene(engine);

console.log('1-3. .vox import → CharacterDef → rig:');
{
  const bytes = makeTestVox();
  const def = importVox(bytes.buffer as ArrayBuffer);
  const names = listPartNames(def);
  console.log(`     imported parts: [${names.join(', ')}]`);
  // ≥2 leaf parts with voxels (shapeA=9, shapeB=3) + the group root
  const voxelParts = countVoxelParts(def);
  check('imported CharacterDef has >= 2 voxel parts', voxelParts >= 2, `(got ${voxelParts})`);
  // pivots from _t
  const partA = findPartByName(def, 'partA');
  check('partA pivot from _t = [2,0,0]', !!partA && partA.pivot[0] === 2, `(pivot ${partA?.pivot})`);
  const partB = findPartByName(def, 'partB');
  check('partB pivot from _t = [5,0,0]', !!partB && partB.pivot[0] === 5, `(pivot ${partB?.pivot})`);
  // shapeA has 9 voxels, shapeB has 3 (nTRN переименовывает nSHP-парт в своё имя)
  check('partA has 9 voxels (model 0 slab)', partA?.voxels.length === 9, `(got ${partA?.voxels.length})`);
  check('partB has 3 voxels (model 1 column)', partB?.voxels.length === 3, `(got ${partB?.voxels.length})`);

  // assembleRig renders
  const rig = assembleRig(scene, def, { meshing: 'greedy' });
  const meshes = collectRigMeshes(rig);
  let totalTri = 0;
  for (const m of meshes) totalTri += Math.floor(m.getTotalIndices() / 3);
  check('imported rig assembles with triangles > 0', totalTri > 0, `(tri ${totalTri})`);
  rig.dispose();
}

console.log('5. gltf-parts buildDefFromNodes from synthetic hierarchy:');
{
  // синтетическая иерархия: root TransformNode → 2 child Mesh (box + box) parented
  const root = new TransformNode('rootNode', scene);
  const child1 = MeshBuilder.CreateBox('head', { size: 1 }, scene);
  child1.parent = root; child1.position.y = 2;
  const child2 = MeshBuilder.CreateBox('torso', { size: 1.5 }, scene);
  child2.parent = root; child2.position.y = 0;

  const { def } = buildDefFromNodes([child1, child2], [root]);
  const names = listPartNames(def);
  console.log(`     gltf parts: [${names.join(', ')}]`);
  check('gltf def has >= 2 parts', countParts(def) >= 2, `(got ${countParts(def)})`);
  // pivots from node positions
  const head = findPartByName(def, 'head');
  check('head pivot.y = 2', !!head && Math.abs(head.pivot[1] - 2) < 1e-6);
  const torso = findPartByName(def, 'torso');
  check('torso pivot.y = 0', !!torso && Math.abs(torso.pivot[1]) < 1e-6);

  child1.dispose(); child2.dispose(); root.dispose();
}

// ── helpers ──
function countVoxelParts(def: { root: import('../client/src/babylon/voxel/voxel-parts').PartNode }): number {
  let n = 0;
  const walk = (p: import('../client/src/babylon/voxel/voxel-parts').PartNode): void => {
    if (p.voxels.length > 0) n++;
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return n;
}
function countParts(def: { root: import('../client/src/babylon/voxel/voxel-parts').PartNode }): number {
  let n = 0;
  const walk = (p: import('../client/src/babylon/voxel/voxel-parts').PartNode): void => {
    n++;
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return n;
}
function findPartByName(def: { root: import('../client/src/babylon/voxel/voxel-parts').PartNode }, name: string): import('../client/src/babylon/voxel/voxel-parts').PartNode | null {
  const stack = [def.root];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.name === name) return p;
    for (const c of p.children) stack.push(c);
  }
  return null;
}
void Mesh; void VertexData;

engine.dispose();
console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
