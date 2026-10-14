import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { GreedyGeometry } from '@tower/voxel-core';

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
