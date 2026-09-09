/** Babylon.js rendering adapter for the renderer-agnostic @tower/voxel-core. */
export * from '@tower/voxel-core';
export * from './voxel-stage.js';

import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import type { Scene } from '@babylonjs/core/scene.js';
import {
  AO_FACTORS, COLOR_JITTER, FACE_TINT_BOTTOM, FACE_TINT_SIDE, FACE_TINT_TOP,
  computeGreedyGeometry, hash01, isAccentColor, vertexAO,
  type RGB, type Voxel, type VoxelMeshOptions, type GreedyGeometry
} from '@tower/voxel-core';

/** Normalize to height 1, center on XZ, and place the base at y=-0.5. */
export function normalizeMesh(mesh: Mesh): void {
  mesh.refreshBoundingInfo();
  const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
  const scale = 1 / Math.max(1e-4, max.y - min.y);
  const centerX = (min.x + max.x) * 0.5 * scale;
  const centerZ = (min.z + max.z) * 0.5 * scale;
  const offsetY = -0.5 - min.y * scale;
  mesh.bakeTransformIntoVertices(
    Matrix.Scaling(scale, scale, scale).multiply(Matrix.Translation(-centerX, offsetY, -centerZ))
  );
  mesh.refreshBoundingInfo();
}

function applyVoxelMaterial(mesh: Mesh, scene: Scene, options: VoxelMeshOptions): void {
  const material = new StandardMaterial(`${options.name}-mat`, scene);
  material.diffuseColor = new Color3(1, 1, 1);
  if (options.matte !== false) material.specularColor = new Color3(0.04, 0.04, 0.04);
  const emissive = options.emissive;
  const strength = options.emissiveStrength ?? 0;
  if (emissive && strength > 0) {
    material.emissiveColor = new Color3(emissive[0] * strength, emissive[1] * strength, emissive[2] * strength);
  }
  if (options.alpha !== undefined && options.alpha < 1) material.alpha = options.alpha;
  mesh.material = material;
  mesh.isPickable = false;
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = options.alpha !== undefined && options.alpha < 1;
}

/** Reference mesher: one Babylon box per occupied cell, merged into one mesh. */
export function buildVoxelMesh(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  const cells = new Map<string, RGB>();
  for (const voxel of voxels) {
    cells.set(`${Math.round(voxel.x)},${Math.round(voxel.y)},${Math.round(voxel.z)}`, voxel.color);
  }
  if (cells.size === 0) return MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);

  const flat = Boolean(options.flat);
  const parts: Mesh[] = [];
  for (const [key, color] of cells) {
    const [x = 0, y = 0, z = 0] = key.split(',').map(Number);
    const part = MeshBuilder.CreateBox(`${options.name}-v`, { size: 1 }, scene);
    part.position.set(x, y, z);
    const accent = isAccentColor(color);
    const jitter = accent || flat ? 1 : 1 - COLOR_JITTER * 0.5 + hash01(x, y, z) * COLOR_JITTER;
    const normals = part.getVerticesData(VertexBuffer.NormalKind);
    const positions = part.getVerticesData(VertexBuffer.PositionKind);
    const colors = new Float32Array(24 * 4);
    for (let vertex = 0; vertex < 24; vertex++) {
      const nx = normals?.[vertex * 3] ?? 0;
      const ny = normals?.[vertex * 3 + 1] ?? 0;
      const nz = normals?.[vertex * 3 + 2] ?? 0;
      const px = (positions?.[vertex * 3] ?? 0) + x;
      const py = (positions?.[vertex * 3 + 1] ?? 0) + y;
      const pz = (positions?.[vertex * 3 + 2] ?? 0) + z;
      const tint = accent ? FACE_TINT_TOP : ny > 0.5 ? FACE_TINT_TOP : ny < -0.5 ? FACE_TINT_BOTTOM : FACE_TINT_SIDE;
      const ao = accent || flat ? 1 : AO_FACTORS[vertexAO(cells, x, y, z, nx, ny, nz, px, py, pz)]!;
      const brightness = tint * ao * jitter;
      colors[vertex * 4] = color[0] * brightness;
      colors[vertex * 4 + 1] = color[1] * brightness;
      colors[vertex * 4 + 2] = color[2] * brightness;
      colors[vertex * 4 + 3] = 1;
    }
    part.setVerticesData(VertexBuffer.ColorKind, colors, false);
    part.isPickable = false;
    parts.push(part);
  }

  const merged = Mesh.MergeMeshes(parts, true, false) ?? parts[0]!;
  merged.name = options.name;
  merged.id = options.name;
  if (options.normalize !== false) normalizeMesh(merged);
  applyVoxelMaterial(merged, scene, options);
  return merged;
}

/** Production mesher: upload renderer-agnostic greedy geometry to Babylon. */
export function buildVoxelMeshGreedy(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  const geometry = computeGreedyGeometry(voxels, Boolean(options.flat));
  if (geometry.positions.length === 0) return MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);
  const mesh = new Mesh(options.name, scene);
  applyGreedyGeometry(mesh, geometry);
  if (options.normalize !== false) normalizeMesh(mesh);
  applyVoxelMaterial(mesh, scene, options);
  return mesh;
}

/** Upload outward-cross-product core geometry with Babylon's native triangle winding.
 * Reverses each triangle; leaves the shared core buffers and lighting normals intact.
 * Matching Babylon-built meshes also allows mixed naive/greedy MergeMeshes calls.
 */
export function applyGreedyGeometry(mesh: Mesh, geometry: GreedyGeometry): void {
  const data = new VertexData();
  data.positions = geometry.positions;
  data.indices = geometry.indices.slice();
  for (let i = 0; i < data.indices.length; i += 3) {
    const index = data.indices[i + 1]!;
    data.indices[i + 1] = data.indices[i + 2]!;
    data.indices[i + 2] = index;
  }
  data.colors = geometry.colors;
  data.normals = geometry.normals;
  data.applyToMesh(mesh, false);
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = false;
}
