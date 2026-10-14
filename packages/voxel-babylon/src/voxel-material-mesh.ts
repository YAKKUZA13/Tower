import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { computeGreedyGeometry, partitionVoxelMaterials, type RGB, type Voxel } from '@tower/voxel-core';
import { applyGreedyGeometry, normalizeMesh } from './voxel-geometry.js';

/** Opaque surface response. Vertex colors carry albedo; emission is independent of AO. */
export interface VoxelSurfaceMaterial {
  emissive?: RGB;
  emissiveStrength?: number;
  specular?: RGB;
}

export interface VoxelMaterialMeshOptions {
  name: string;
  materials: Readonly<Record<number, VoxelSurfaceMaterial>>;
  normalize?: boolean;
  flat?: boolean;
  maxMaterials?: number;
}

/** One occupancy mesh, one submesh per visible material. Owns all generated materials. */
export function buildVoxelMaterialMesh(scene: Scene, voxels: Voxel[], options: VoxelMaterialMeshOptions): Mesh {
  const maxMaterials = options.maxMaterials ?? 16;
  if (!Number.isInteger(maxMaterials) || maxMaterials < 1 || maxMaterials > 256) throw new Error('maxMaterials must be in [1, 256]');
  const ids = new Set(voxels.map(voxel => voxel.material ?? 0));
  if (ids.size > maxMaterials) throw new Error('voxel material budget exceeded');
  // Validate before allocating any Babylon resources, including buried material labels.
  for (const id of ids) {
    const material = options.materials[id];
    if (!material) throw new Error(`missing voxel material ${id}`);
    for (const color of [material.emissive, material.specular]) {
      if (color && (color.length !== 3 || !color.every(c => Number.isFinite(c) && c >= 0 && c <= 1))) {
        throw new Error('material colors must be RGB triples in [0, 1]');
      }
    }
    const strength = material.emissiveStrength ?? 1;
    if (!Number.isFinite(strength) || strength < 0) throw new Error('emissiveStrength must be finite and nonnegative');
  }
  const geometry = computeGreedyGeometry(voxels, Boolean(options.flat));
  const partition = partitionVoxelMaterials(geometry);
  const mesh = new Mesh(options.name, scene);
  if (geometry.positions.length === 0) return mesh;
  applyGreedyGeometry(mesh, { ...geometry, indices: partition.indices });
  if (options.normalize !== false) normalizeMesh(mesh);
  const multi = new MultiMaterial(`${options.name}:materials`, scene);
  mesh.releaseSubMeshes();
  partition.ranges.forEach((range, index) => {
    const definition = options.materials[range.material]!;
    const material = new StandardMaterial(`${options.name}:material-${range.material}`, scene);
    material.diffuseColor = Color3.White();
    material.specularColor = Color3.FromArray(definition.specular ?? [0.04, 0.04, 0.04]);
    material.emissiveColor = Color3.FromArray(definition.emissive ?? [0, 0, 0]).scale(definition.emissiveStrength ?? 1);
    material.useEmissiveAsIllumination = true;
    multi.subMaterials.push(material);
    new SubMesh(index, 0, mesh.getTotalVertices(), range.indexStart, range.indexCount, mesh);
  });
  mesh.material = multi;
  mesh.onDisposeObservable.addOnce(() => multi.dispose(false, false, true));
  return mesh;
}
