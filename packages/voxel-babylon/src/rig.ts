import { applyGreedyGeometry } from './voxel-geometry.js';
export * from '@tower/voxel-core';

import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { type Scene } from '@babylonjs/core/scene.js';
import {
  computeGreedyGeometry,
  type Voxel,
  type VoxelMeshOptions
} from '@tower/voxel-core';
import type { AssembleRigOptions, CharacterDef, PartNode } from '@tower/voxel-core';

const RIG_META = '__characterRig';

interface RigMeta {
  def: CharacterDef;
  scene: Scene;
  options: AssembleRigOptions;
  material: StandardMaterial;
}

export function assembleRig(
  scene: Scene,
  def: CharacterDef,
  options: AssembleRigOptions = {}
): TransformNode {
  const meshing = options.meshing ?? 'greedy';
  const mat = new StandardMaterial(`${def.name}-rig-mat`, scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  if (options.matte !== false) mat.specularColor = new Color3(0.04, 0.04, 0.04);
  const em = options.emissive;
  const es = options.emissiveStrength ?? 0.18;
  if (em && es > 0) mat.emissiveColor = new Color3(em[0] * es, em[1] * es, em[2] * es);
  if (options.alpha !== undefined && options.alpha < 1) mat.alpha = options.alpha;

  const rigRoot = new TransformNode(`${def.name}-rig`, scene);
  const normNode = new TransformNode(`${def.name}-norm`, scene);
  normNode.parent = rigRoot;
  buildPartNode(scene, def.root, normNode, [0, 0, 0], meshing, mat);

  const bounds = computeDefBounds(def);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const s = 1 / height;
  normNode.scaling.set(s, s, s);
  normNode.position.set(
    -((bounds.minX + bounds.maxX) * 0.5) * s,
    -0.5 - bounds.minY * s,
    -((bounds.minZ + bounds.maxZ) * 0.5) * s
  );

  (rigRoot as TransformNode & { metadata: unknown }).metadata = {
    [RIG_META]: { def, scene, options, material: mat } satisfies RigMeta
  };
  return rigRoot;
}

function buildPartNode(
  scene: Scene,
  part: PartNode,
  parent: TransformNode,
  parentPivot: [number, number, number],
  meshing: 'naive' | 'greedy',
  material: StandardMaterial
): TransformNode {
  const node = new TransformNode(part.name, scene);
  node.parent = parent;
  node.position.set(
    part.pivot[0] - parentPivot[0],
    part.pivot[1] - parentPivot[1],
    part.pivot[2] - parentPivot[2]
  );

  if (part.voxels.length > 0) {
    const mesh = buildPartMesh(scene, part.voxels, part.name, meshing);
    mesh.parent = node;
    mesh.position.set(-part.pivot[0], -part.pivot[1], -part.pivot[2]);
    mesh.material = material;
    mesh.isPickable = false;
    // Animated parts need current bounds in both color and depth/shadow passes.
    mesh.doNotSyncBoundingInfo = false;
  }

  for (const child of part.children) {
    buildPartNode(scene, child, node, part.pivot, meshing, material);
  }
  return node;
}

function buildPartMesh(
  scene: Scene,
  voxels: Voxel[],
  name: string,
  meshing: 'naive' | 'greedy'
): Mesh {
  if (meshing === 'greedy') {
    const geo = computeGreedyGeometry(voxels, false);
    const mesh = new Mesh(`${name}-part`, scene);
    if (geo.positions.length > 0) {
      applyGreedyGeometry(mesh, geo);
      mesh.useVertexColors = true;
      mesh.hasVertexAlpha = false;
    }
    return mesh;
  }
  return buildPartMesh(scene, voxels, name, 'greedy');
}

function computeDefBounds(def: CharacterDef): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const walk = (p: PartNode): void => {
    for (const v of p.voxels) {
      if (v.x < minX) minX = v.x; if (v.x + 1 > maxX) maxX = v.x + 1;
      if (v.y < minY) minY = v.y; if (v.y + 1 > maxY) maxY = v.y + 1;
      if (v.z < minZ) minZ = v.z; if (v.z + 1 > maxZ) maxZ = v.z + 1;
    }
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

export function cloneRig(root: TransformNode): TransformNode {
  const meta = (root as TransformNode & { metadata?: Record<string, unknown> }).metadata;
  const rigMeta = meta?.[RIG_META] as RigMeta | undefined;
  if (!rigMeta) {
    return root.clone(`${root.name}-c`, null) as TransformNode;
  }
  return assembleRig(rigMeta.scene, rigMeta.def, rigMeta.options);
}

export function disposeRig(root: TransformNode): void {
  const meta = (root as TransformNode & { metadata?: Record<string, unknown> }).metadata;
  const rigMeta = meta?.[RIG_META] as RigMeta | undefined;
  // Dispose the hierarchy exactly once. Auxiliary pick volumes can share their
  // material with other rigs; only the material owned by this rig is released.
  root.dispose(false, false);
  rigMeta?.material.dispose();
}

export function findNodesByName(root: TransformNode, names: readonly string[]): Map<string, TransformNode> {
  const want = new Set(names);
  const out = new Map<string, TransformNode>();
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (want.has(n.name)) out.set(n.name, n);
    for (const child of n.getChildren()) stack.push(child as TransformNode);
  }
  return out;
}

export function collectRigMeshes(root: TransformNode): Mesh[] {
  const out: Mesh[] = [];
  const stack: TransformNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n instanceof Mesh) out.push(n);
    for (const child of n.getChildren()) stack.push(child as TransformNode);
  }
  return out;
}

export function getPartVoxels(def: CharacterDef, partName: string): Voxel[] {
  const stack: PartNode[] = [def.root];
  while (stack.length) {
    const p = stack.pop()!;
    if (p.name === partName) return p.voxels;
    for (const c of p.children) stack.push(c);
  }
  return [];
}

export function listPartNames(def: CharacterDef): string[] {
  const out: string[] = [];
  const walk = (p: PartNode): void => {
    out.push(p.name);
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return out;
}

export type { VoxelMeshOptions };
