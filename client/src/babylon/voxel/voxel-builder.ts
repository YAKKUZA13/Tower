export * from '@tower/voxel-core';

import { Color3, Matrix, Mesh, MeshBuilder, StandardMaterial, VertexBuffer, VertexData, type Scene } from 'babylonjs';
import {
  AO_FACTORS,
  COLOR_JITTER,
  FACE_TINT_BOTTOM,
  FACE_TINT_SIDE,
  FACE_TINT_TOP,
  computeGreedyGeometry,
  hash01,
  isAccentColor,
  vertexAO,
  type RGB,
  type Voxel,
  type VoxelMeshOptions
} from '@tower/voxel-core';

export function normalizeMesh(mesh: Mesh): void {
  mesh.refreshBoundingInfo();
  const bb = mesh.getBoundingInfo().boundingBox;
  const min = bb.minimumWorld;
  const max = bb.maximumWorld;
  const height = Math.max(1e-4, max.y - min.y);
  const s = 1 / height;
  const cx = (min.x + max.x) * 0.5 * s;
  const cz = (min.z + max.z) * 0.5 * s;
  const dy = -0.5 - min.y * s;
  const final = Matrix.Translation(-cx, dy, -cz).multiply(Matrix.Scaling(s, s, s));
  mesh.bakeTransformIntoVertices(final);
  mesh.refreshBoundingInfo();
}

export function buildVoxelMesh(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  const cells = new Map<string, RGB>();
  for (const v of voxels) {
    cells.set(`${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`, v.color);
  }
  if (cells.size === 0) {
    return MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);
  }

  const flat = Boolean(options.flat);

  const parts: Mesh[] = [];
  for (const [key, color] of cells) {
    const p = key.split(',');
    const x = +p[0]!, y = +p[1]!, z = +p[2]!;
    const m = MeshBuilder.CreateBox(`${options.name}-v`, { size: 1 }, scene);
    m.position.set(x, y, z);
    const accent = isAccentColor(color);
    const jitter = (accent || flat) ? 1 : 1 - COLOR_JITTER * 0.5 + hash01(x, y, z) * COLOR_JITTER;
    const normals = m.getVerticesData(VertexBuffer.NormalKind);
    const positions = m.getVerticesData(VertexBuffer.PositionKind);
    const vc = new Float32Array(24 * 4);
    for (let k = 0; k < 24; k++) {
      const ny = normals ? normals[k * 3 + 1] : 0;
      const nx = normals ? normals[k * 3] : 0;
      const nz = normals ? normals[k * 3 + 2] : 0;
      const px = positions ? positions[k * 3] + x : x;
      const py = positions ? positions[k * 3 + 1] + y : y;
      const pz = positions ? positions[k * 3 + 2] + z : z;
      let t = FACE_TINT_TOP;
      if (!accent) {
        if (ny > 0.5) t = FACE_TINT_TOP;
        else if (ny < -0.5) t = FACE_TINT_BOTTOM;
        else t = FACE_TINT_SIDE;
      }
      let ao = 1.0;
      if (!accent && !flat) {
        const level = vertexAO(cells, x, y, z, nx, ny, nz, px, py, pz);
        ao = AO_FACTORS[level]!;
      }
      const b = t * ao * jitter;
      vc[k * 4] = color[0] * b;
      vc[k * 4 + 1] = color[1] * b;
      vc[k * 4 + 2] = color[2] * b;
      vc[k * 4 + 3] = 1;
    }
    m.setVerticesData(VertexBuffer.ColorKind, vc, false);
    m.isPickable = false;
    parts.push(m);
  }

  const merged = Mesh.MergeMeshes(parts, true, false) ?? parts[0];
  merged.name = options.name;
  merged.id = options.name;
  normalizeMesh(merged);

  const mat = new StandardMaterial(`${options.name}-mat`, scene);
  // Phase 2 fix: diffuseColor (1,1,1) — vertex colors pass through unmodified.
  mat.diffuseColor = new Color3(1, 1, 1);
  if (options.matte !== false) {
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
  }
  const em = options.emissive;
  const es = options.emissiveStrength ?? 0;
  if (em && es > 0) {
    mat.emissiveColor = new Color3(em[0] * es, em[1] * es, em[2] * es);
  }
  if (options.alpha !== undefined && options.alpha < 1) {
    mat.alpha = options.alpha;
  }
  merged.material = mat;
  merged.isPickable = false;
  merged.doNotSyncBoundingInfo = true;
  // Phase 2 fix: ensure vertex colors consumed by shader.
  merged.useVertexColors = true;
  merged.hasVertexAlpha = options.alpha !== undefined && options.alpha < 1;
  return merged;
}

export function buildVoxelMeshGreedy(scene: Scene, voxels: Voxel[], options: VoxelMeshOptions): Mesh {
  const geo = computeGreedyGeometry(voxels, Boolean(options.flat));
  const mesh = new Mesh(options.name, scene);
  if (geo.positions.length === 0) {
    const tiny = MeshBuilder.CreateBox(options.name, { size: 0.05 }, scene);
    return tiny;
  }
  const vd = new VertexData();
  vd.positions = geo.positions;
  vd.indices = geo.indices;
  vd.colors = geo.colors;
  vd.normals = geo.normals;
  vd.applyToMesh(mesh, false);
  normalizeMesh(mesh);

  const mat = new StandardMaterial(`${options.name}-mat`, scene);
  // Phase 2 fix: diffuseColor (1,1,1) — vertex colors pass through unmodified.
  mat.diffuseColor = new Color3(1, 1, 1);
  if (options.matte !== false) {
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
  }
  const em = options.emissive;
  const es = options.emissiveStrength ?? 0;
  if (em && es > 0) {
    mat.emissiveColor = new Color3(em[0] * es, em[1] * es, em[2] * es);
  }
  if (options.alpha !== undefined && options.alpha < 1) {
    mat.alpha = options.alpha;
  }
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.doNotSyncBoundingInfo = true;
  // Phase 2 fix: ensure vertex colors consumed by shader.
  mesh.useVertexColors = true;
  mesh.hasVertexAlpha = options.alpha !== undefined && options.alpha < 1;
  return mesh;
}
