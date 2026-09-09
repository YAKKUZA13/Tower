/**
 * Greedy Lab — explore greedy meshing parameters
 * Compare naive vs greedy on a single model, live tri-count.
 *
 * Uses the public Babylon adapter package; the lab never imports client internals.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { type Scene } from '@babylonjs/core/scene.js';
import { VOXEL_BUILDERS, type Voxel } from '@tower/voxel-core';
import { buildVoxelMesh, buildVoxelMeshGreedy } from '@tower/voxel-babylon';

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

  function rebuild() {
    meshes.forEach(m => m.dispose(false, true));
    meshes.length = 0;

    const builder = VOXEL_BUILDERS[currentModel];
    if (!builder) return;
    const voxels = builder();

    let mesh: Mesh;
    if (meshingMode === 'greedy') {
      mesh = buildVoxelMeshGreedy(scene, voxels, {
        name: `lab-${currentModel}`,
        flat: flatMode,
      });
    } else {
      mesh = buildVoxelMesh(scene, voxels, {
        name: `lab-${currentModel}`,
        flat: flatMode,
      });
    }
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
    dispose() { meshes.forEach(m => m.dispose(false, true)); }
  };
}
