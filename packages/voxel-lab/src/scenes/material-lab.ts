import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import {createMasonryVoxels, isAccentColor, type Voxel, type MasonryOptions} from '@voxkera/voxel-core';
import {VOXEL_BUILDERS} from '../../../../client/src/babylon/voxel/content/index.js';
import { buildVoxelMaterialMesh, createVoxelStage } from '@voxkera/voxel-babylon';
import type { LabScene } from './greedy-lab';

/** Independent consumers of the same masonry generator and rendering stage. */
export function createMaterialLab(scene: Scene, camera: ArcRotateCamera,
  onStats: (tri: number, vox: number, mode: string) => void, content: HTMLElement): LabScene {
  const savedCamera = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() };
  camera.setTarget(new Vector3(0, 1, 0));
  camera.alpha = Math.PI / 3;
  camera.beta = Math.PI / 3;
  camera.radius = 18;
  const stage = createVoxelStage(scene, camera, { viewHeight: 10, pixelHeight: 540, glowIntensity: 0.6 });
  const amber = stage.addPointLight(new Vector3(-2.5, 2, 1), new Color3(1, 0.52, 0.12), 3, 6);
  const violet = stage.addPointLight(new Vector3(2.2, 2.2, -1.5), new Color3(0.65, 0.12, 1), 3, 6);
  let meshes: Mesh[] = [];
  let seed = 17;
  let layout = 'gallery';
  let voxelCount = 0;
  const surfaceMaterials = {
    0: {},
    1: { emissive: [1, 0.32, 0.055] as [number, number, number], emissiveStrength: 0.85 },
    2: { emissive: [0.6, 0.055, 1] as [number, number, number], emissiveStrength: 0.9 },
  };
  content.innerHTML = `
    <h2>Stone & light</h2>
    <label>Assembly</label><select id="material-layout"><option value="gallery">Gallery</option><option value="court">Courtyard</option></select>
    <label>Seed</label><input id="material-seed" type="number" value="17" min="0" max="99999">
    <label>Render height</label><select id="material-pixels"><option value="360">360 px</option><option value="540" selected>540 px</option><option value="0">Native</option></select>
    <label>Lighting</label><select id="material-light"><option value="night">Warm / violet</option><option value="day">Daylight</option></select>
    <label><input id="material-glow" type="checkbox" checked> Emission glow</label>
    <label>View height</label><input id="material-zoom" type="range" min="6" max="16" step="0.5" value="10">
    <p style="max-width:240px;color:#888;margin-top:8px">Drag to orbit. Recessed joints and chipped edges are voxel geometry.</p>`;
  function addMasonry(options: MasonryOptions, position: Vector3, yaw = 0) {
    const voxels = createMasonryVoxels({ ...options, seed });
    // A small repeated inlay is a material-selection fixture, not a scene-specific asset.
    if (options.orientation === 'floor') {
      const tops = new Map<string, number>();
      for (const voxel of voxels) tops.set(`${voxel.x},${voxel.z}`, Math.max(tops.get(`${voxel.x},${voxel.z}`) ?? -1, voxel.y));
      for (const voxel of voxels) {
        const inlay = voxel.x % 20 === 10 && voxel.z % 20 >= 6 && voxel.z % 20 <= 13;
        if (inlay && voxel.y === tops.get(`${voxel.x},${voxel.z}`) && voxel.y > 0) voxel.material = 2;
      }
    }
    const mesh = buildVoxelMaterialMesh(scene, voxels, { name: `masonry-${meshes.length}`, normalize: false, materials: surfaceMaterials });
    mesh.scaling.setAll(0.1);
    mesh.rotation.y = yaw;
    mesh.position.copyFrom(position);
    stage.addMesh(mesh);
    meshes.push(mesh);
    voxelCount += voxels.length;
  }
  function rebuild() {
    for (const mesh of meshes) { stage.removeMesh(mesh); mesh.dispose(false, true); }
    meshes = [];
    voxelCount = 0;
    addMasonry({ width: 80, height: 64, depth: 3, orientation: 'floor', brickWidth: 12, brickHeight: 10,
      chipChance: 0.25, color: [0.37, 0.34, 0.28] }, new Vector3(-4, -0.2, -3.2));
    if (layout === 'gallery') {
      addMasonry({ width: 80, height: 35, depth: 5, brickWidth: 14, brickHeight: 7, relief: 2 }, new Vector3(-4, 0, -3.2));
      addMasonry({ width: 48, height: 27, depth: 5, relief: 2 }, new Vector3(-4, 0, 1.6), Math.PI / 2);
    }
    const positions = layout === 'gallery' ? [[-3, -2.4], [3, -2.4]] : [[-3, -2.4], [3, -2.4], [-3, 2.2], [3, 2.2]];
    for (const [x, z] of positions) {
      addMasonry({ width: 10, height: 36, depth: 10, brickWidth: 10, brickHeight: 6, relief: 1,
        color: [0.45, 0.4, 0.32] }, new Vector3(x!, 0, z!));
    }
    const models = layout === 'gallery' ? ['unit:knight', 'tower:arcane'] : ['building:smelter', 'unit:mage'];
    models.forEach((id, index) => {
      const voxels = VOXEL_BUILDERS[id]!();
      const labelled = voxels.map(voxel => isAccentColor(voxel.color)
        ? { ...voxel, material: voxel.color[2] > voxel.color[0] ? 2 : 1 } : voxel);
      const mesh = buildVoxelMaterialMesh(scene, labelled, { name: id, materials: surfaceMaterials });
      mesh.scaling.setAll(index === 0 ? 2.3 : 1.9);
      mesh.position.set(index === 0 ? -1.2 : 1.5, mesh.scaling.y / 2 + 0.06, 0);
      stage.addMesh(mesh);
      meshes.push(mesh);
      voxelCount += voxels.length;
    });
    for (const light of [amber, violet]) {
      const voxels: Voxel[] = [];
      // Open lantern frame and an inner emissive volume exercise occlusion and labels.
      for (let x = -2; x <= 2; x++) for (let y = -3; y <= 3; y++) for (let z = -2; z <= 2; z++) {
        const frame = Math.abs(y) === 3 || (Math.abs(x) === 2 && Math.abs(z) === 2);
        const core = Math.abs(x) < 2 && Math.abs(y) < 3 && Math.abs(z) < 2;
        if (frame || core) voxels.push({ x, y, z, sx: 1, sy: 1, sz: 1,
          color: frame ? [0.22, 0.18, 0.13] : [0.7, 0.65, 0.5], material: frame ? 0 : light === amber ? 1 : 2 });
      }
      const lamp = buildVoxelMaterialMesh(scene, voxels, { name: 'light-source', normalize: false, materials: surfaceMaterials });
      lamp.scaling.setAll(0.08);
      stage.addMesh(lamp);
      voxelCount += voxels.length;
      lamp.position.copyFrom(light.position);
      meshes.push(lamp);
    }
    onStats(meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices() / 3, 0), voxelCount, 'greedy / world scale');
  }
  content.querySelector<HTMLSelectElement>('#material-layout')!.onchange = e => { layout = (e.target as HTMLSelectElement).value; rebuild(); };
  content.querySelector<HTMLInputElement>('#material-seed')!.onchange = e => {
    const value = (e.target as HTMLInputElement).valueAsNumber;
    if (Number.isSafeInteger(value)) { seed = value; rebuild(); }
  };
  content.querySelector<HTMLSelectElement>('#material-pixels')!.onchange = e => stage.setPixelHeight(Number((e.target as HTMLSelectElement).value));
  content.querySelector<HTMLInputElement>('#material-glow')!.onchange = e => { if (stage.glow) stage.glow.isEnabled = (e.target as HTMLInputElement).checked; };
  content.querySelector<HTMLInputElement>('#material-zoom')!.oninput = e => stage.setViewHeight(Number((e.target as HTMLInputElement).value));
  content.querySelector<HTMLSelectElement>('#material-light')!.onchange = e => {
    const day = (e.target as HTMLSelectElement).value === 'day';
    stage.key.intensity = day ? 1.7 : 1.1;
    stage.fill.intensity = day ? 0.65 : 0.3;
    amber.intensity = violet.intensity = day ? 0 : 3;
  };
  rebuild();
  return { dispose() {
    stage.dispose();
    meshes.forEach(mesh => mesh.dispose(false, true));
    camera.setTarget(savedCamera.target);
    camera.alpha = savedCamera.alpha; camera.beta = savedCamera.beta; camera.radius = savedCamera.radius;
  } };
}
