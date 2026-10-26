import { applyGreedyGeometry } from '@voxkera/voxel-babylon';
/**
 * Model Viewer — browse all VOXEL_BUILDERS models
 * Rebuilds on model switch; shows tri/voxel counts.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { type Scene } from '@babylonjs/core/scene.js';
import {computeGreedyGeometry, type Voxel} from '@voxkera/voxel-core';
import {VOXEL_BUILDERS, builderEmissive} from '../../../../client/src/babylon/voxel/content/index.js';
import type { LabScene } from './greedy-lab';

type StatsFn = (tri: number, vox: number, meshing: string) => void;

const CATEGORIES: Record<string, string[]> = {
  'Enemies': ['enemy:skeleton','enemy:goblin','enemy:zombie','enemy:demon','enemy:boss','enemy:slime','enemy:bat','enemy:spider','enemy:ghost'],
  'Towers': ['tower:arrow','tower:cannon','tower:arcane','tower:ice'],
  'Units': ['unit:knight','unit:archer','unit:mage','unit:commander','unit:worker'],
  'Buildings': ['building:sawmill','building:mine','building:smelter','building:barracks','building:town-hall','building:town-hall-l2','building:watch-tower'],
  'Relics': ['relic:totem-fire','relic:totem-arcane','relic:totem-gold','relic:totem-ice','relic:totem-blood'],
  'Walls': ['wall:wood','wall:stone','wall:bone'],
  'Tiles': ['tile:grass','tile:dirt','tile:road','tile:water','tile:rock','tile:sand'],
  'Other': ['base:altar','spawn:portal','projectile:bolt']
};

export async function createModelViewerScene(
  scene: Scene,
  onStats: StatsFn,
  content: HTMLElement
): Promise<LabScene> {
  const meshes: Mesh[] = [];
  let currentModel = 'enemy:skeleton';

  function buildMesh(voxels: Voxel[]): Mesh {
    const geo = computeGreedyGeometry(voxels, false);
    const mesh = new Mesh('model', scene);
    if (geo.positions.length === 0) {
      mesh.dispose();
      const box = MeshBuilder.CreateBox('empty', { size: 0.2 }, scene);
      return box;
    }
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

  function applyMaterial(m: Mesh, name: string) {
    const mat = new StandardMaterial('mat', scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.06, 0.06, 0.06);
    const em = builderEmissive(name);
    if (em) mat.emissiveColor = new Color3(em[0] * 0.25, em[1] * 0.25, em[2] * 0.25);
    m.material = mat;
  }

  function rebuild() {
    meshes.forEach(m => m.dispose(false, true));
    meshes.length = 0;

    const builder = VOXEL_BUILDERS[currentModel];
    if (!builder) return;
    const voxels = builder();
    const mesh = buildMesh(voxels);
    applyMaterial(mesh, currentModel);
    meshes.push(mesh);

    const tri = mesh.getTotalIndices() / 3;
    onStats(Math.floor(tri), voxels.length, 'greedy');
  }

  // build category dropdown
  let html = '<label>Model</label><select id="mv-model">';
  for (const [cat, keys] of Object.entries(CATEGORIES)) {
    html += `<optgroup label="${cat}">`;
    for (const k of keys) {
      if (VOXEL_BUILDERS[k]) {
        html += `<option value="${k}" ${k === currentModel ? 'selected' : ''}>${k}</option>`;
      }
    }
    html += '</optgroup>';
  }
  html += '</select>';
  content.innerHTML = html;

  document.getElementById('mv-model')!.onchange = (e) => {
    currentModel = (e.target as HTMLSelectElement).value;
    rebuild();
  };

  rebuild();

  return {
    dispose() { meshes.forEach(m => m.dispose(false, true)); }
  };
}
