/**
 * Greedy Lab — explore greedy meshing parameters
 * Compare naive vs greedy on a single model, live tri-count.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import { computeGreedyGeometry, VOXEL_BUILDERS, type Voxel } from '@tower/voxel-core';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';

export interface LabScene {
  dispose(): void;
}

type StatsFn = (tri: number, vox: number, meshing: string) => void;

export async function createGreedyScene(
  scene: Scene,
  onStats: StatsFn
): Promise<LabScene> {
  const meshes: Mesh[] = [];
  let currentModel = 'enemy:skeleton';
  let meshingMode: 'naive' | 'greedy' = 'greedy';
  let flatMode = false;

  const modelKeys = Object.keys(VOXEL_BUILDERS).filter(k => k.startsWith('enemy:') || k.startsWith('tower:'));

  function buildNaiveMesh(voxels: Voxel[]): Mesh {
    const root = new Mesh('naive-root', scene);
    for (const v of voxels) {
      const box = MeshBuilder.CreateBox('v', { size: 1 }, scene);
      box.position.set(v.x, v.y, v.z);
      box.parent = root;
    }
    // merge
    if (root.getChildMeshes().length > 1) {
      const merged = Mesh.MergeMeshes(root.getChildMeshes() as Mesh[], true, true);
      if (merged) {
        merged.name = 'naive';
        root.dispose();
        return merged;
      }
    }
    return root;
  }

  function buildGreedyMesh(voxels: Voxel[]): Mesh {
    const geo = computeGreedyGeometry(voxels, flatMode);
    const mesh = new Mesh('greedy', scene);
    if (geo.positions.length === 0) return mesh;
    const vd = new VertexData();
    vd.positions = geo.positions;
    vd.indices = geo.indices;
    vd.colors = geo.colors;
    vd.normals = geo.normals;
    vd.applyToMesh(mesh, false);

    // normalize to height=3
    mesh.refreshBoundingInfo();
    const bb = mesh.getBoundingInfo().boundingBox;
    const h = Math.max(1e-4, bb.maximumWorld.y - bb.minimumWorld.y);
    const s = 3 / h;
    mesh.scaling.setAll(s);
    mesh.position.y = -1.5 - bb.minimumWorld.y * s;

    return mesh;
  }

  function applyMaterial(m: Mesh) {
    const mat = new StandardMaterial('lab-mat', scene);
    mat.diffuseColor = new Color3(0.82, 0.82, 0.82);
    mat.specularColor = new Color3(0.04, 0.04, 0.04);
    m.material = mat;
  }

  function rebuild() {
    meshes.forEach(m => m.dispose());
    meshes.length = 0;

    const builder = VOXEL_BUILDERS[currentModel];
    if (!builder) return;
    const voxels = builder();

    let mesh: Mesh;
    if (meshingMode === 'greedy') {
      mesh = buildGreedyMesh(voxels);
    } else {
      mesh = buildNaiveMesh(voxels);
    }
    applyMaterial(mesh);
    meshes.push(mesh);

    const tri = mesh.getTotalIndices() / 3;
    onStats(Math.floor(tri), voxels.length, meshingMode + (flatMode ? '/flat' : ''));
  }

  // UI
  const panel = document.getElementById('tab-content')!;
  panel.innerHTML = `
    <label>Model</label>
    <select id="greedy-model">${modelKeys.map(k => `<option value="${k}" ${k === currentModel ? 'selected' : ''}>${k}</option>`).join('')}</select>
    <label>Meshing</label>
    <select id="greedy-mode">
      <option value="greedy" selected>Greedy (merged quads)</option>
      <option value="naive">Naive (per-cell boxes)</option>
    </select>
    <label><input type="checkbox" id="greedy-flat"> Flat (no AO/tint)</label>
  `;

  document.getElementById('greedy-model')!.onchange = (e) => {
    currentModel = (e.target as HTMLSelectElement).value;
    rebuild();
  };
  document.getElementById('greedy-mode')!.onchange = (e) => {
    meshingMode = (e.target as HTMLSelectElement).value as 'naive' | 'greedy';
    rebuild();
  };
  document.getElementById('greedy-flat')!.onchange = (e) => {
    flatMode = (e.target as HTMLInputElement).checked;
    rebuild();
  };

  rebuild();

  return {
    dispose() { meshes.forEach(m => m.dispose()); }
  };
}
