/**
 * Voxel Lab — main entry
 * Babylon playground for pure voxel-core engine demos.
 */
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, MeshBuilder, Scene, StandardMaterial, Vector3 } from 'babylonjs';
import { createGreedyScene, type LabScene } from './scenes/greedy-lab';
import { createModelViewerScene } from './scenes/model-viewer';
import { createKitScene } from './scenes/kit-lab';
import { createTerrainScene } from './scenes/terrain-lab';
import { createRecipeScene } from './scenes/recipe-lab';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.08, 0.08, 0.14, 1);

// camera
const camera = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 4, 12, Vector3.Zero(), scene);
camera.lowerRadiusLimit = 2;
camera.upperRadiusLimit = 40;
camera.wheelPrecision = 60;
camera.attachControl(canvas, true);

// lights
const hemi = new HemisphericLight('hemi', new Vector3(0.3, 0.8, -0.4), scene);
hemi.intensity = 0.7;
hemi.diffuse.set(0.88, 0.82, 0.72);
const sun = new DirectionalLight('sun', new Vector3(-0.6, -0.9, 0.5), scene);
sun.intensity = 0.8;
sun.diffuse.set(1.0, 0.96, 0.88);

// ground grid
const grid = MeshBuilder.CreateGround('grid', { width: 20, height: 20, subdivisions: 20 }, scene);
const gridMat = new StandardMaterial('gridMat', scene);
gridMat.diffuseColor = new Color3(0.12, 0.12, 0.16);
gridMat.wireframe = true;
gridMat.alpha = 0.3;
grid.material = gridMat;
grid.position.y = -3;

// stats elements
const statTri = document.getElementById('stat-tri')!;
const statVox = document.getElementById('stat-vox')!;
const statMesh = document.getElementById('stat-mesh')!;

export function updateStats(tri: number, vox: number, meshing: string) {
  statTri.textContent = String(tri);
  statVox.textContent = String(vox);
  statMesh.textContent = meshing;
}

// scene management
let current: LabScene | null = null;

async function switchTab(tab: string) {
  current?.dispose();
  const content = document.getElementById('tab-content')!;
  content.innerHTML = '';

  const tabs = ['greedy', 'models', 'kit', 'terrain', 'recipe'];
  for (const t of tabs) document.getElementById(`tab-${t}`)!.className = '';

  switch (tab) {
    case 'greedy': {
      document.getElementById('tab-greedy')!.className = 'active';
      current = await createGreedyScene(scene, updateStats);
      break;
    }
    case 'models': {
      document.getElementById('tab-models')!.className = 'active';
      current = await createModelViewerScene(scene, updateStats, content);
      break;
    }
    case 'kit': {
      document.getElementById('tab-kit')!.className = 'active';
      current = await createKitScene(scene, updateStats, content);
      break;
    }
    case 'terrain': {
      document.getElementById('tab-terrain')!.className = 'active';
      current = await createTerrainScene(scene, updateStats, content);
      break;
    }
    case 'recipe': {
      document.getElementById('tab-recipe')!.className = 'active';
      current = await createRecipeScene(scene, updateStats, content);
      break;
    }
  }
}

document.getElementById('tab-greedy')!.onclick = () => switchTab('greedy');
document.getElementById('tab-models')!.onclick = () => switchTab('models');
document.getElementById('tab-kit')!.onclick = () => switchTab('kit');
document.getElementById('tab-terrain')!.onclick = () => switchTab('terrain');
document.getElementById('tab-recipe')!.onclick = () => switchTab('recipe');

// start
switchTab('greedy');

engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());
