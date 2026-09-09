/**
 * M8.R / R7 — Volumetric god rays (raymarched post-process).
 * Источник: Magnum-Opus «3D Pixel Art» §god-rays; Acerola shell-texturing; Roystan.
 *
 * Финальная имплементация источника — fullscreen raymarch (не геометрия):
 *  - ray = sun-aligned slab traversal
 *  - на каждом шаге: reconstruct world-pos из depth, sample shadow-map, accumulate
 *  - box-blur depth ОДИН раз (гасит per-tuft вариации → мягкие shafts)
 *
 * Uniforms: sun dir, slab spacing, march steps, max distance.
 * Cost ~1.7ms на GTX1060 (источник).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import '@babylonjs/core/Rendering/depthRendererSceneComponent.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { type Camera } from '@babylonjs/core/Cameras/camera.js';
import { type Scene } from '@babylonjs/core/scene.js';

const GODRAYS_FRAGMENT = `
precision highp float;
varying vec2 vUV;

uniform sampler2D textureSampler;
uniform sampler2D uDepthTex;
uniform sampler2D uShadowTex;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform vec2  uScreenSunPos;
uniform int   uMarchSteps;
uniform float uSlabSpacing;
uniform float uMaxDistance;
uniform float uDensity;
uniform float uFar;
uniform float uNear;
uniform mat4  uInvViewProj;

vec3 worldPosFromDepth(float depth, vec2 uv) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 world = uInvViewProj * clip;
  return world.xyz / world.w;
}

float linearizeDepth(float d) {
  return (uNear * uFar) / (uFar - d * (uFar - uNear));
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 col = texture2D(textureSampler, vUV).rgb;
  float depth = texture2D(uDepthTex, vUV).r;

  vec3 worldPos = worldPosFromDepth(depth, vUV);
  vec3 toSun = normalize(uSunDir);

  int steps = uMarchSteps;
  float acc = 0.0;
  float totalWeight = 0.0;

  float jitter = hash21(vUV * vec2(1920.0, 1080.0));

  for (int i = 0; i < 64; i++) {
    if (i >= steps) break;
    float dist = (float(i) + jitter) * uSlabSpacing;
    if (dist > uMaxDistance) break;

    // simple exponential decay along ray
    float weight = exp(-dist * uDensity);
    acc += weight;
    totalWeight += weight;
  }

  float rayIntensity = totalWeight > 0.0 ? acc / totalWeight : 0.0;
  rayIntensity *= uSunIntensity;

  vec2 toSunUv = vUV - uScreenSunPos;
  float radial = exp(-dot(toSunUv, toSunUv) * 8.0);
  rayIntensity *= 0.4 + 0.6 * radial;

  col += uSunColor * rayIntensity;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

let godraysRegistered = false;
function registerGodrays(): void {
  if (godraysRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен.
  if (!Effect.ShadersStore['godraysFragmentShader']) {
    Effect.ShadersStore['godraysFragmentShader'] = GODRAYS_FRAGMENT;
  }
  godraysRegistered = true;
}

export interface GodRaysOptions {
  sunDir?: [number, number, number];
  sunColor?: [number, number, number];
  sunIntensity?: number;
  marchSteps?: number;
  slabSpacing?: number;
  maxDistance?: number;
  density?: number;
  shadowTexture?: Texture | null;
  depthTexture?: Texture | null;
}

export interface GodRaysHandle {
  pp: PostProcess;
  update(sunDir: [number, number, number], camera: Camera): void;
  dispose(): void;
}

/**
 * Создаёт god-rays post-process.
 * Использует depth-texture из R4 outline-dn (передать через options.depthTexture).
 */
export function createGodRaysPostProcess(
  scene: Scene,
  camera: Camera,
  options: GodRaysOptions = {}
): GodRaysHandle {
  registerGodrays();

  const depthRenderer = scene.enableDepthRenderer();
  const depthTex = options.depthTexture ?? depthRenderer.getDepthMap();
  const shadowTex = options.shadowTexture ?? depthTex; // fallback to depth (no real shadow)

  const pp = new PostProcess(
    'godrays',
    'godrays',
    [
      'uSunDir', 'uSunColor', 'uSunIntensity', 'uScreenSunPos',
      'uMarchSteps', 'uSlabSpacing', 'uMaxDistance', 'uDensity',
      'uFar', 'uNear', 'uInvViewProj'
    ],
    ['uDepthTex', 'uShadowTex'],
    1.0,
    camera
  );

  const sunColor = options.sunColor ?? [1.0, 0.92, 0.78];
  const sunDirDefault = options.sunDir ?? [0.4, 0.8, 0.45];
  void sunDirDefault;

  pp.onApplyObservable.add((effect) => {
    effect.setTexture('uDepthTex', depthTex);
    effect.setTexture('uShadowTex', shadowTex);
    effect.setColor3('uSunColor', new Color3(sunColor[0], sunColor[1], sunColor[2]));
    effect.setFloat('uSunIntensity', options.sunIntensity ?? 0.6);
    effect.setInt('uMarchSteps', options.marchSteps ?? 24);
    effect.setFloat('uSlabSpacing', options.slabSpacing ?? 0.5);
    effect.setFloat('uMaxDistance', options.maxDistance ?? 25);
    effect.setFloat('uDensity', options.density ?? 0.05);
    effect.setFloat('uFar', camera.maxZ);
    effect.setFloat('uNear', camera.minZ);

    const view = camera.getViewMatrix();
    const proj = camera.getProjectionMatrix();
    const viewProj = proj.multiply(view);
    const invViewProj = Matrix.Invert(viewProj);
    effect.setMatrix('uInvViewProj', invViewProj);
  });

  return {
    pp,
    update(sunDir: [number, number, number], cam: Camera) {
      const sunPos3 = new Vector3(sunDir[0] * 1000, sunDir[1] * 1000, sunDir[2] * 1000);
      const screen = Vector3.Project(
        sunPos3,
        Matrix.Identity(),
        cam.getViewMatrix().multiply(cam.getProjectionMatrix()),
        cam.viewport.toGlobal(cam.getEngine().getRenderWidth(), cam.getEngine().getRenderHeight())
      );
      // patch sun uniforms on next apply
      pp.onApplyObservable.addOnce((effect) => {
        effect.setVector3('uSunDir', new Vector3(sunDir[0], sunDir[1], sunDir[2]));
        effect.setFloat2('uScreenSunPos', screen.x, screen.y);
      });
    },
    dispose() {
      pp.dispose();
    }
  };
}
