/**
 * Recipe Lab — live recipe editor + 3D preview
 * Edit JSON, compile, see assembled voxels immediately.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';
import {
  compile,
  loadRecipe,
  compileErrorMessage,
  type RecipeV3
} from '@tower/engine-recipe';
import {
  computeGreedyGeometry,
  VoxelStampRegistry,
  assembleRecipe,
  type Voxel
} from '@tower/voxel-core';
import type { LabScene } from './greedy-lab';

type StatsFn = (tri: number, vox: number, meshing: string) => void;

const SAMPLES: Record<string, { name: string; url: string }> = {
  'simple-tower': { name: 'Simple Tower', url: '/recipes/simple-tower.json' },
  'double-shed': { name: 'Double Shed (mirror)', url: '/recipes/double-shed.json' },
  'wall-gate': { name: 'Wall + Gate (row)', url: '/recipes/wall-gate.json' }
};

export async function createRecipeScene(
  scene: Scene,
  onStats: StatsFn,
  content: HTMLElement
): Promise<LabScene> {
  const meshes: Mesh[] = [];
  const registry = new VoxelStampRegistry();

  // panel layout: switch to wider with textarea
  const panel = document.getElementById('panel')!;
  const origWidth = panel.style.minWidth;
  panel.style.minWidth = '420px';

  function buildMesh(voxels: Voxel[]): Mesh {
    const geo = computeGreedyGeometry(voxels, false);
    const mesh = new Mesh('recipe-preview', scene);
    if (geo.positions.length === 0) return mesh;
    const vd = new VertexData();
    vd.positions = geo.positions;
    vd.indices = geo.indices;
    vd.colors = geo.colors;
    vd.normals = geo.normals;
    vd.applyToMesh(mesh, false);

    mesh.refreshBoundingInfo();
    const bb = mesh.getBoundingInfo().boundingBox;
    const h = Math.max(1e-4, bb.maximumWorld.y - bb.minimumWorld.y);
    const s = 4 / h;
    const cx = -(bb.minimumWorld.x + bb.maximumWorld.x) * 0.5 * s;
    const cz = -(bb.minimumWorld.z + bb.maximumWorld.z) * 0.5 * s;
    mesh.scaling.setAll(s);
    mesh.position.set(cx, -2 - bb.minimumWorld.y * s, cz);
    return mesh;
  }

  function rebuildFromJson(json: string) {
    meshes.forEach(m => m.dispose());
    meshes.length = 0;

    const errEl = document.getElementById('rcp-errors')!;
    errEl.textContent = '';
    errEl.style.display = 'none';

    let recipe: RecipeV3;
    try {
      recipe = loadRecipe(json);
    } catch (e: any) {
      errEl.textContent = 'JSON parse error: ' + e.message;
      errEl.style.display = 'block';
      onStats(0, 0, 'parse error');
      return;
    }

    const result = compile(recipe, registry);
    if (!result.ok) {
      errEl.textContent = result.errors.map(compileErrorMessage).join('\n');
      errEl.style.display = 'block';
      onStats(0, 0, 'compile errors');
      return;
    }

    const parts = result.recipe.parts;
    const voxels = assembleRecipe(parts, registry);
    const mesh = buildMesh(voxels);

    const mat = new StandardMaterial('rcp-mat', scene);
    mat.diffuseColor = new Color3(0.82, 0.82, 0.82);
    mat.specularColor = new Color3(0.06, 0.06, 0.06);
    mesh.material = mat;
    meshes.push(mesh);

    const tri = mesh.getTotalIndices() / 3;
    onStats(Math.floor(tri), voxels.length, `recipe: ${recipe.name} (${parts.length} parts)`);
  }

  // UI
  const sampleOpts = Object.entries(SAMPLES).map(([k, v]) =>
    `<option value="${k}">${v.name}</option>`
  ).join('');

  content.innerHTML = `
    <label>Sample</label>
    <select id="rcp-sample">
      <option value="">— custom —</option>
      ${sampleOpts}
    </select>
    <label>Recipe JSON <button id="rcp-compile" style="float:right;font-size:11px;padding:2px 8px">Compile</button></label>
    <textarea id="rcp-json" style="width:100%;height:240px;background:#0a0a14;color:#aaa;border:1px solid #333;border-radius:4px;font-family:Consolas,monospace;font-size:11px;resize:vertical;padding:6px" spellcheck="false"></textarea>
    <div id="rcp-errors" style="display:none;color:#c44;font-size:11px;margin-top:4px;white-space:pre-wrap;max-height:100px;overflow:auto"></div>
    <div style="margin-top:4px;font-size:10px;color:#666">
      IDs: <code>slab,box,hip_roof,wedge_roof,barrel_vault,cylinder,pebble,grass_tuft,moss_patch,ivy_patch,smoke_column</code>
    </div>
  `;

  const textarea = document.getElementById('rcp-json') as HTMLTextAreaElement;
  const compileBtn = document.getElementById('rcp-compile')!;

  // load default sample
  async function loadSample(key: string) {
    const sample = SAMPLES[key];
    if (!sample) return;
    const res = await fetch(sample.url);
    const text = await res.text();
    textarea.value = text;
    rebuildFromJson(text);
  }

  document.getElementById('rcp-sample')!.onchange = (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (val && SAMPLES[val]) loadSample(val);
  };

  compileBtn.onclick = () => rebuildFromJson(textarea.value);

  // load first sample by default
  await loadSample('simple-tower');

  return {
    dispose() {
      panel.style.minWidth = origWidth;
      meshes.forEach(m => m.dispose());
    }
  };
}
