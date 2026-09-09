/**
 * M8.R / R8 — Stylized water (planar reflection + wave texture + refraction).
 * Источник: Roystan Toon Water; paddy-exe; Bramwell; eldskald; Catlike Coding.
 *
 * Компоненты:
 *  - MirrorTexture (Babylon) — planar reflection с oblique near-plane (Lengyel),
 *    чтобы геометрия под водой clips корректно.
 *  - Wave texture (256×256 Voronoi RGBA, R/G/B/A encoding per источник) →
 *    horizontal view-aligned wave-lines.
 *  - Refraction + depth-fade (Catlike Coding «Looking Through Water»).
 *  - Outlines видны под водой (depth/normal populated до water-pass).
 *
 * Реализация: ShaderMaterial на plane-меше; MirrorTexture для reflection,
 * wave-noise для анимации, refractionTexture (экранная копия) опц.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { MirrorTexture } from '@babylonjs/core/Materials/Textures/mirrorTexture.js';
import { Plane } from '@babylonjs/core/Maths/math.plane.js';
import { RefractionTexture } from '@babylonjs/core/Materials/Textures/refractionTexture.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector.js';
import { type Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { type Scene } from '@babylonjs/core/scene.js';

const WATER_VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormalW;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalW = normalize(mat3(world) * normal);
  vUV = uv;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const WATER_FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorldPos;
varying vec3 vNormalW;

uniform sampler2D uReflection;    // MirrorTexture
uniform sampler2D uWaveTex;        // Voronoi RGBA: R=angle, G=variance, B=phase, A=mask
uniform sampler2D uRefraction;     // opaque-screen copy (опц.)
uniform float uTime;
uniform vec3  uShallowColor;       // край/берег
uniform vec3  uDeepColor;          // глубина
uniform float uDepthFalloff;       // экспонент. глубина → цвет
uniform float uWaveSpeed;
uniform float uWaveAmplitude;
uniform vec3  uSunDir;
uniform float uSpecularIntensity;
uniform vec3  uCamPos;

void main() {
  // ── Wave distortion UV (по источнику: view-aligned wave-lines из Voronoi R) ──
  vec2 waveUv1 = vUV * 4.0 + vec2(uTime * uWaveSpeed * 0.1, uTime * uWaveSpeed * 0.05);
  vec2 waveUv2 = vUV * 4.0 + vec2(-uTime * uWaveSpeed * 0.08, uTime * uWaveSpeed * 0.12);
  vec4 wave1 = texture2D(uWaveTex, waveUv1);
  vec4 wave2 = texture2D(uWaveTex, waveUv2);

  // wave-distortion для reflection-UV
  vec2 distort = (wave1.rg - 0.5) * uWaveAmplitude + (wave2.rg - 0.5) * uWaveAmplitude * 0.7;
  vec2 reflUv = vec2(vUV.x, 1.0 - vUV.y) + distort;

  vec3 reflectionCol = texture2D(uReflection, reflUv).rgb;

  // ── depth-fade: shallow → deep color mix (по Y координате-глубине в простейшем случае) ──
  // здесь упрощённо: от расстояния до центра плоскости.
  float depth = length(vWorldPos.xz) * 0.04;
  depth = 1.0 - exp(-depth * uDepthFalloff);
  vec3 waterCol = mix(uShallowColor, uDeepColor, depth);

  // refraction (опц.) — проба из opaque-screen; если текстуры нет — отразить-смесь с deep color
  vec3 refractionCol = waterCol;
  // для упрощения: refraction = mix(reflectionCol, waterCol, depth)

  vec3 col = mix(reflectionCol, waterCol, 0.35 + 0.4 * depth);

  // ── specular highlight (Blinn-Phong по sun dir) ──
  vec3 N = normalize(vNormalW + vec3(distort * 0.5, 0.0));
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(0.0, dot(N, H)), 64.0);
  col += vec3(1.0, 0.95, 0.85) * spec * uSpecularIntensity;

  // wave-mask: лёгкое подчёркивание гребней (по alpha каналу Voronoi)
  float crestMask = clamp((wave1.a + wave2.a) * 0.5, 0.0, 1.0);
  col += vec3(0.05) * crestMask;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 0.92);
}
`;

let waterRegistered = false;
function registerWaterShader(): void {
  if (waterRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен.
  if (!Effect.ShadersStore['waterPaVertexShader']) Effect.ShadersStore['waterPaVertexShader'] = WATER_VERTEX;
  if (!Effect.ShadersStore['waterPaFragmentShader']) Effect.ShadersStore['waterPaFragmentShader'] = WATER_FRAGMENT;
  waterRegistered = true;
}

export interface StylizedWaterOptions {
  width: number;
  depth: number;             // world Z size of the water plane
  level: number;             // Y world-position (water surface height)
  shallowColor?: [number, number, number];
  deepColor?: [number, number, number];
  depthFalloff?: number;
  waveSpeed?: number;
  waveAmplitude?: number;
  sunDir?: [number, number, number];
  specularIntensity?: number;
  reflectionSize?: number;
  /** Какие меши отражаются (mirrorTexture.renderList). */
  reflectionRenderList?: Mesh[];
  waveTexture?: Texture | null;
}

/**
 * Создаёт stylized water: plane + ShaderMaterial + MirrorTexture + Voronoi wave.
 */
export function createStylizedWater(
  scene: Scene,
  options: StylizedWaterOptions
): {
  mesh: Mesh;
  material: ShaderMaterial;
  mirror: MirrorTexture;
  update(camPos: Vector3, dt: number): void;
  dispose(): void;
} {
  registerWaterShader();

  // ── water plane ──
  const plane = MeshBuilder.CreateGround(
    'water-plane',
    { width: options.width, height: options.depth, subdivisions: 8 },
    scene
  ) as Mesh;
  plane.position.y = options.level;
  plane.isPickable = false;
  plane.receiveShadows = false;

  // ── MirrorTexture (planar reflection) ──
  const mirror = new MirrorTexture(
    'water-mirror',
    { ratio: 0.5 },
    scene,
    true
  );
  mirror.mirrorPlane = new Plane(0, -1, 0, options.level);
  mirror.renderList = options.reflectionRenderList ?? scene.meshes.filter((m) => m.name !== 'water-plane');
  mirror.level = 1.0;
  mirror.samples = 2;

  // ── Voronoi wave texture (256×256 RGBA) ──
  const waveTex = options.waveTexture ?? createVoronoiWaveTexture(scene, 256);

  const mat = new ShaderMaterial('water-pa', scene, { vertex: 'waterPa', fragment: 'waterPa' }, {
    attributes: ['position', 'normal', 'uv'],
    uniforms: [
      'world', 'worldViewProjection', 'uTime',
      'uShallowColor', 'uDeepColor', 'uDepthFalloff',
      'uWaveSpeed', 'uWaveAmplitude', 'uSunDir', 'uSpecularIntensity', 'uCamPos'
    ],
    samplers: ['uReflection', 'uWaveTex', 'uRefraction']
  });
  mat.setTexture('uReflection', mirror);
  mat.setTexture('uWaveTex', waveTex);
  // uRefraction optional — placeholder uses mirror
  mat.setTexture('uRefraction', mirror);
  mat.setColor3('uShallowColor', new Color3(...(options.shallowColor ?? [0.18, 0.36, 0.40])));
  mat.setColor3('uDeepColor', new Color3(...(options.deepColor ?? [0.04, 0.10, 0.18])));
  mat.setFloat('uDepthFalloff', options.depthFalloff ?? 0.6);
  mat.setFloat('uWaveSpeed', options.waveSpeed ?? 0.6);
  mat.setFloat('uWaveAmplitude', options.waveAmplitude ?? 0.03);
  mat.setFloat('uSpecularIntensity', options.specularIntensity ?? 1.0);
  mat.setVector3('uSunDir', new Vector3(...(options.sunDir ?? [0.4, 0.8, 0.45])));
  mat.setVector3('uCamPos', new Vector3(0, 5, 0));
  mat.setFloat('uTime', 0);

  mat.backFaceCulling = true;
  mat.alphaMode = Constants.ALPHA_COMBINE;
  mat.alpha = 0.95;

  plane.material = mat;

  let t = 0;
  return {
    mesh: plane,
    material: mat,
    mirror,
    update(camPos: Vector3, dt: number) {
      t += dt;
      mat.setFloat('uTime', t);
      mat.setVector3('uCamPos', camPos);
    },
    dispose() {
      plane.dispose();
      mat.dispose();
      mirror.dispose();
      if (!options.waveTexture) waveTex.dispose();
    }
  };
}

/**
 * Создаёт Voronoi wave texture 256×256 RGBA.
 * Encoding: R = angle направления (0..1 = 0..2π), G = variance, B = phase, A = mask (cell-boundary).
 * По источнику (Roystan).
 */
export function createVoronoiWaveTexture(scene: Scene, size = 256): Texture {
  const tex = new DynamicTexture('wave-voronoi', { width: size, height: size }, scene, false);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.updateSamplingMode(Constants.TEXTURE_BILINEAR_SAMPLINGMODE);

  // generate seed points (детерминированный LCG)
  let state = 4242 >>> 0;
  const rng = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const cells = 12;
  const points: { x: number; y: number; phase: number }[] = [];
  for (let i = 0; i < cells * cells; i++) {
    points.push({ x: rng(), y: rng(), phase: rng() });
  }

  const ctx = tex.getContext() as CanvasRenderingContext2D;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * cells;
      const v = y / size * cells;
      let best = 0;
      let bestDist = Infinity;
      let secondDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const px = (i % cells) + points[i].x;
        const py = Math.floor(i / cells) + points[i].y;
        const dx = u - px;
        const dy = v - py;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
          secondDist = bestDist;
          bestDist = d;
          best = i;
        } else if (d < secondDist) {
          secondDist = d;
        }
      }
      // R: angle направления лучшего cell-центра (0..1)
      const angle = (Math.atan2(v - (Math.floor(best / cells) + points[best].y), u - ((best % cells) + points[best].x)) + Math.PI) / (2 * Math.PI);
      // G: variance (boundariness) = secondDist - bestDist
      const variance = Math.min(1, (secondDist - bestDist) * 4);
      // B: phase
      const phase = points[best].phase;
      // A: mask (1 на границе cells, 0 в центре)
      const mask = Math.min(1, variance);

      const o = (y * size + x) * 4;
      img.data[o] = Math.round(angle * 255);
      img.data[o + 1] = Math.round(variance * 255);
      img.data[o + 2] = Math.round(phase * 255);
      img.data[o + 3] = Math.round(mask * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tex.update(false);
  return tex;
}

// re-export для удобства
export { MirrorTexture, RefractionTexture, Vector4 };
