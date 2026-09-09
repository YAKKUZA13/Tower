import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { PointLight } from '@babylonjs/core/Lights/pointLight.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';
import '@babylonjs/core/Shaders/pass.fragment.js';
import { PassPostProcess } from '@babylonjs/core/PostProcesses/passPostProcess.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { Scene } from '@babylonjs/core/scene.js';

export interface VoxelStageOptions {
  /** Orthographic world-space height. */
  viewHeight?: number;
  /** Scene render height before nearest upscale; 0 uses native resolution. */
  pixelHeight?: number;
  shadowMapSize?: number;
  keyIntensity?: number;
  fillIntensity?: number;
}

const activeStages = new WeakSet<Scene>();

function positive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
}

/**
 * Reusable orthographic lighting stage. One camera pass renders at reduced resolution.
 * Owns only its lights, shadow map and postprocess; dispose restores camera/clear state.
 * Local lights provide direct illumination, not voxel GI. Use one stage per scene.
 */
export function createVoxelStage(scene: Scene, camera: Camera, options: VoxelStageOptions = {}) {
  if (camera.getScene() !== scene) throw new Error('camera belongs to a different scene');
  if (activeStages.has(scene)) throw new Error('a voxel stage already owns this scene');
  let viewHeight = options.viewHeight ?? 12;
  let pixelHeight = options.pixelHeight ?? 360;
  const shadowSize = options.shadowMapSize ?? 1024;
  positive(viewHeight, 'viewHeight');
  const validatePixelHeight = (value: number) => {
    if (!Number.isInteger(value) || value < 0 || value > 4096) throw new Error('pixelHeight must be an integer in [0, 4096]');
  };
  validatePixelHeight(pixelHeight);
  if (!Number.isInteger(shadowSize) || shadowSize < 128 || shadowSize > 4096) throw new Error('shadowMapSize must be in [128, 4096]');
  for (const value of [options.keyIntensity ?? 1.1, options.fillIntensity ?? 0.3]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('light intensity must be nonnegative and finite');
  }
  activeStages.add(scene);
  const previous = { mode: camera.mode, left: camera.orthoLeft, right: camera.orthoRight,
    top: camera.orthoTop, bottom: camera.orthoBottom, clear: scene.clearColor.clone() };
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  scene.clearColor = new Color4(0.018, 0.021, 0.025, 1);
  const key = new DirectionalLight('voxel-stage:key', new Vector3(0.5, -1, 0.4), scene);
  key.position.set(-12, 24, -10);
  key.diffuse = new Color3(1, 0.84, 0.65);
  key.intensity = options.keyIntensity ?? 1.1;
  const fill = new HemisphericLight('voxel-stage:fill', Vector3.Up(), scene);
  fill.diffuse = new Color3(0.65, 0.73, 0.9);
  fill.groundColor = new Color3(0.08, 0.07, 0.06);
  fill.intensity = options.fillIntensity ?? 0.3;
  const shadows = new ShadowGenerator(shadowSize, key);
  shadows.usePoissonSampling = true;
  shadows.bias = 0.0005;
  shadows.normalBias = 0.015;
  const receivers = new Map<AbstractMesh, { receive: boolean; observer: Observer<import('@babylonjs/core/node.js').Node> }>();
  const points: PointLight[] = [];
  let pass: PassPostProcess | undefined;
  let disposed = false;
  let renderWidth = -1;
  let renderHeight = -1;
  function removeMesh(mesh: AbstractMesh) {
    const previous = receivers.get(mesh);
    if (!previous) return;
    mesh.onDisposeObservable.remove(previous.observer);
    shadows.removeShadowCaster(mesh, false);
    if (!mesh.isDisposed()) mesh.receiveShadows = previous.receive;
    receivers.delete(mesh);
  }
  function resize() {
    if (disposed) return;
    const engine = scene.getEngine();
    const aspect = engine.getRenderWidth(true) / Math.max(1, engine.getRenderHeight(true));
    camera.orthoTop = viewHeight / 2;
    camera.orthoBottom = -viewHeight / 2;
    camera.orthoLeft = -viewHeight * aspect / 2;
    camera.orthoRight = viewHeight * aspect / 2;
    const width = Math.max(1, Math.round(pixelHeight * aspect));
    if (renderWidth === width && renderHeight === pixelHeight) return;
    renderWidth = width; renderHeight = pixelHeight;
    pass?.dispose(camera);
    pass = pixelHeight === 0 ? undefined : new PassPostProcess('voxel-stage:pixels',
      { size: { width, height: pixelHeight } }, camera, Texture.NEAREST_SAMPLINGMODE);
  }
  const resizeObserver = scene.getEngine().onResizeObservable.add(resize);
  resize();
  return {
    key, fill, shadows,
    addMesh(mesh: AbstractMesh, castShadow = true) {
      if (disposed) throw new Error('voxel stage is disposed');
      if (mesh.isDisposed() || mesh.getScene() !== scene) throw new Error('mesh must be live and belong to this scene');
      if (!receivers.has(mesh)) {
        const receive = mesh.receiveShadows;
        const observer = mesh.onDisposeObservable.addOnce(() => removeMesh(mesh));
        receivers.set(mesh, { receive, observer });
      }
      mesh.receiveShadows = true;
      if (castShadow) shadows.addShadowCaster(mesh, false);
    },
    removeMesh,
    /** Two local lights plus key/fill fit StandardMaterial's default four-light budget. */
    addPointLight(position: Vector3, color: Color3, intensity = 1, range = 8) {
      if (disposed) throw new Error('voxel stage is disposed');
      if (points.length >= 2) throw new Error('voxel stage supports at most two local lights');
      positive(range, 'range');
      if (!Number.isFinite(intensity) || intensity < 0 || ![...position.asArray(), ...color.asArray()].every(Number.isFinite)) throw new Error('invalid local light');
      const light = new PointLight(`voxel-stage:local-${points.length}`, position.clone(), scene);
      light.diffuse = color.clone();
      light.intensity = intensity;
      light.range = range;
      points.push(light);
      return light;
    },
    setPixelHeight(value: number) { validatePixelHeight(value); pixelHeight = value; resize(); },
    setViewHeight(value: number) { positive(value, 'viewHeight'); viewHeight = value; resize(); },
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.getEngine().onResizeObservable.remove(resizeObserver);
      pass?.dispose(camera);
      for (const mesh of receivers.keys()) removeMesh(mesh);
      shadows.dispose();
      points.forEach(light => light.dispose());
      key.dispose();
      fill.dispose();
      activeStages.delete(scene);
      camera.mode = previous.mode;
      camera.orthoLeft = previous.left; camera.orthoRight = previous.right;
      camera.orthoTop = previous.top; camera.orthoBottom = previous.bottom;
      scene.clearColor = previous.clear;
    }
  };
}
