import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { generateProceduralSanctum } from '@tower/engine-scene';
import { buildSceneKit, type SceneKitHandle } from '@tower/scene-babylon';
import { createVoxelStage } from '@tower/voxel-babylon';
import type { LabScene } from './greedy-lab';

type RitualView = 'reference' | 'opposite' | 'top';

interface RitualWindow extends Window {
  __ritualReady?: boolean;
  __setRitualView?: (view: RitualView) => void;
}

/** Deterministic visual-review host for the img2threejs ritual fixture. */
export function createRitualLab(
  scene: Scene,
  camera: ArcRotateCamera,
  onStats: (triangles: number, nodes: number, mode: string) => void,
  content: HTMLElement
): LabScene {
  const ritualWindow = window as RitualWindow;
  ritualWindow.__ritualReady = false;
  const savedCamera = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() };
  const savedAmbient = scene.ambientColor.clone();
  const image = scene.imageProcessingConfiguration;
  const savedImage = {
    toneMappingEnabled: image.toneMappingEnabled,
    toneMappingType: image.toneMappingType,
    exposure: image.exposure,
    contrast: image.contrast
  };
  image.toneMappingEnabled = true;
  image.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  image.exposure = 0.94;
  image.contrast = 1.12;
  scene.ambientColor.set(0.15, 0.105, 0.12);

  const stage = createVoxelStage(scene, camera, {
    viewHeight: 8.9,
    pixelHeight: 540,
    glowIntensity: 0.5,
    keyIntensity: 1.08,
    fillIntensity: 0.46,
    shadowMapSize: 2048
  });
  stage.key.position.set(-11, 18, -9);
  stage.key.direction.set(0.48, -1, 0.38);
  stage.key.diffuse.set(1, 0.72, 0.5);
  stage.fill.diffuse.set(0.42, 0.46, 0.62);
  stage.fill.groundColor.set(0.025, 0.018, 0.022);

  content.innerHTML = `
    <h2>Datk ritual diorama</h2>
    <label>Review view</label>
    <select id="ritual-view">
      <option value="reference">Reference isometric</option>
      <option value="opposite">Opposite 3/4</option>
      <option value="top">Top structure</option>
    </select>
    <label>Seed</label><input id="ritual-seed" type="number" value="1337" min="0" max="99999">
    <label>Particles</label><input id="ritual-particles" type="range" min="72" max="192" step="8" value="120">
    <label>Ruin density</label><input id="ritual-density" type="range" min="0.35" max="1" step="0.05" value="0.72">
    <label><input id="ritual-animate" type="checkbox"> Animate vortex</label>
    <p style="max-width:300px;color:#888;margin-top:8px">Deterministic by default for screenshot review. The second stat counts scene nodes, not source voxels.</p>`;

  let seed = 1337;
  let particles = 120;
  let density = 0.72;
  let animate = false;
  let handle: SceneKitHandle | undefined;

  function setView(view: RitualView): void {
    camera.setTarget(new Vector3(0, 1.82, 0));
    camera.radius = 14;
    if (view === 'reference') {
      camera.alpha = -Math.PI / 4;
      camera.beta = 1.02;
      stage.setViewHeight(8.9);
    } else if (view === 'opposite') {
      camera.alpha = Math.PI * 0.72;
      camera.beta = 1.08;
      stage.setViewHeight(8.9);
    } else {
      camera.alpha = -Math.PI / 2;
      camera.beta = 0.16;
      stage.setViewHeight(11.5);
    }
  }

  function rebuild(): void {
    ritualWindow.__ritualReady = false;
    handle?.dispose();
    const spec = generateProceduralSanctum({ seed, particleCount: particles, density });
    handle = buildSceneKit(scene, spec, animate ? {} : { timeSeconds: () => 0 });
    for (const mesh of handle.shadowCasters) {
      mesh.receiveShadows = true;
      stage.shadows.addShadowCaster(mesh, true);
    }
    onStats(handle.metrics.estimatedTriangles, handle.metrics.nodes, 'scene-kit / instanced');
    ritualWindow.__ritualReady = true;
    document.body.dataset.sceneReady = 'ritual';
  }

  ritualWindow.__setRitualView = setView;
  content.querySelector<HTMLSelectElement>('#ritual-view')!.onchange = (event) => {
    setView((event.target as HTMLSelectElement).value as RitualView);
  };
  content.querySelector<HTMLInputElement>('#ritual-seed')!.onchange = (event) => {
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isSafeInteger(value)) { seed = value; rebuild(); }
  };
  content.querySelector<HTMLInputElement>('#ritual-particles')!.oninput = (event) => {
    particles = (event.target as HTMLInputElement).valueAsNumber;
    rebuild();
  };
  content.querySelector<HTMLInputElement>('#ritual-density')!.oninput = (event) => {
    density = (event.target as HTMLInputElement).valueAsNumber;
    rebuild();
  };
  content.querySelector<HTMLInputElement>('#ritual-animate')!.onchange = (event) => {
    animate = (event.target as HTMLInputElement).checked;
    rebuild();
  };

  setView('reference');
  rebuild();

  return {
    dispose(): void {
      ritualWindow.__ritualReady = false;
      ritualWindow.__setRitualView = undefined;
      delete document.body.dataset.sceneReady;
      handle?.dispose();
      stage.dispose();
      image.toneMappingEnabled = savedImage.toneMappingEnabled;
      image.toneMappingType = savedImage.toneMappingType;
      image.exposure = savedImage.exposure;
      image.contrast = savedImage.contrast;
      scene.ambientColor.copyFrom(savedAmbient);
      camera.setTarget(savedCamera.target);
      camera.alpha = savedCamera.alpha;
      camera.beta = savedCamera.beta;
      camera.radius = savedCamera.radius;
    }
  };
}
