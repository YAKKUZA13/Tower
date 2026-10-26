import { applyGreedyGeometry } from '@voxkera/voxel-babylon';
/**
 * Kit Lab — procedural character kit assembler
 * Seed → assembleCharacter → greedy mesh preview
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { type Scene } from '@babylonjs/core/scene.js';
import {computeGreedyGeometry, type Voxel, type CharacterDef} from '@voxkera/voxel-core';
import {assembleCharacter, assembleCrowd} from '../../../../client/src/babylon/voxel/content/index.js';
import type { LabScene } from './greedy-lab';

type StatsFn = (tri: number, vox: number, meshing: string) => void;

function flattenDef(def: CharacterDef): Voxel[] {
  const out: Voxel[] = [];
  function walk(n: typeof def.root) {
    out.push(...n.voxels);
    for (const c of n.children) walk(c);
  }
  walk(def.root);
  return out;
}

export async function createKitScene(
  scene: Scene,
  onStats: StatsFn,
  content: HTMLElement
): Promise<LabScene> {
  const meshes: Mesh[] = [];
  let seed = 42;
  let archetype = 'skeleton' as 'skeleton' | 'zombie' | 'demon' | 'generic';

  function buildMesh(voxels: Voxel[]): Mesh {
    const geo = computeGreedyGeometry(voxels, false);
    const mesh = new Mesh('kit', scene);
    if (geo.positions.length === 0) return mesh;
    applyGreedyGeometry(mesh, geo);
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = false;

    mesh.refreshBoundingInfo();
    const bb = mesh.getBoundingInfo().boundingBox;
    const h = Math.max(1e-4, bb.maximumWorld.y - bb.minimumWorld.y);
    const s = 4 / h;
    mesh.scaling.setAll(s);
    mesh.position.y = -2 - bb.minimumWorld.y * s;
    return mesh;
  }

  function rebuild() {
    meshes.forEach(m => m.dispose(false, true));
    meshes.length = 0;

    const def = assembleCharacter(seed, { archetype });
    const voxels = flattenDef(def);
    const mesh = buildMesh(voxels);

    const mat = new StandardMaterial('kit-mat', scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.06, 0.06, 0.06);
    mesh.material = mat;
    meshes.push(mesh);

    const tri = mesh.getTotalIndices() / 3;
    onStats(Math.floor(tri), voxels.length, `kit:${archetype} #${seed}`);
  }

  content.innerHTML = `
    <label>Archetype</label>
    <select id="kit-arch">
      <option value="skeleton" selected>Skeleton</option>
      <option value="zombie">Zombie</option>
      <option value="demon">Demon</option>
      <option value="generic">Generic</option>
    </select>
    <label>Seed <code id="kit-seed-label">42</code></label>
    <input type="range" id="kit-seed" min="1" max="200" value="42" step="1">
    <div style="margin-top:6px">
      <button id="kit-random" style="padding:4px 10px;cursor:pointer">🎲 Random</button>
    </div>
  `;

  document.getElementById('kit-arch')!.onchange = (e) => {
    archetype = (e.target as HTMLSelectElement).value as typeof archetype;
    rebuild();
  };
  document.getElementById('kit-seed')!.oninput = (e) => {
    seed = +(e.target as HTMLInputElement).value;
    document.getElementById('kit-seed-label')!.textContent = String(seed);
    rebuild();
  };
  document.getElementById('kit-random')!.onclick = () => {
    seed = Math.floor(Math.random() * 200) + 1;
    (document.getElementById('kit-seed') as HTMLInputElement).value = String(seed);
    document.getElementById('kit-seed-label')!.textContent = String(seed);
    rebuild();
  };

  rebuild();

  return {
    dispose() { meshes.forEach(m => m.dispose(false, true)); }
  };
}
