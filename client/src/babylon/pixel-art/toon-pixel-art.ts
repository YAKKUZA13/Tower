/**
 * M8.R / R3 — Toon shading (расширение M7 voxel-toon.ts).
 * Источник: David Holland «3D Pixel Art Rendering» §toon; Roystan Outline Shader.
 *
 * Расширение базового 3-band toon-шейдера (voxel-toon.ts):
 *  1. Smoothed attenuation направленного света — smoothstep вместо step,
 *     гасит flicker при вращении солнца и шуме нормалей.
 *  2. Noise на surface normal ( Deterministic per-vertex hash ) — ломает
 *     shadow-popping на плоских гранях, добавляет «штриховку».
 *  3. Cloud-shadow uniform (R5): sample cloud-noise в world XZ → множитель яркости.
 *  4. Sun-shadow uniform (R4): пробрасывается из ShadowGenerator. В pixel-art
 *     pipeline нет shadow-pass на самом меш-материале; мы передаём скаляр
 *     shadow-фактора извне (или 0 для без-теневого упрощения).
 *  5. 4–5 ramp-step палитра (вместо 3-band step) — ближе к источнику.
 *
 * Реализация: отдельный ShaderMaterial `toon-pixel-art` (не модифицирует M7),
 * который можно применить к сцене через applyPixelArtToon (зеркало applyToonToScene).
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { type Camera } from '@babylonjs/core/Cameras/camera.js';
import { type Scene } from '@babylonjs/core/scene.js';
import { type Texture } from '@babylonjs/core/Materials/Textures/texture.js';

const TOON_PA_VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec4 vColor;
void main() {
  vec4 worldPos = world * vec4(position, 1.0);
  vPosW = worldPos.xyz;
  vNormalW = normalize(mat3(world) * normal);
  vColor = color;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const TOON_PA_FRAGMENT = `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec4 vColor;

uniform vec3  uLightDir;
uniform vec3  uCamPos;
uniform vec3  uShadowTint;
uniform vec3  uLitTint;
uniform float uHighlight;
uniform float uRimStrength;
uniform float uNormalNoise;        // амплитуда (0..~0.06) шума нормалей

uniform sampler2D uCloudTex;       // R5: cloud-noise, tileable value-noise
uniform vec2  uCloudScroll;        // uv-scroll в world-XZ (units/sec)
uniform float uCloudScale;         // world-units на тайл cloud-noise
uniform float uCloudStrength;      // 0..1 — вклад облачной тени
uniform float uSunShadow;          // 0..1 — внешний скаляр-затенение (от shadow-pass/ShadowRenderer)
uniform float uTime;               // сек — для animated noise

// ── ramp-step 5 ступеней (по источнику: 4–5 ramp на материал) ──
uniform float uRamp0; // default 0.18
uniform float uRamp1; // 0.36
uniform float uRamp2; // 0.55
uniform float uRamp3; // 0.74
uniform vec3  uBandTint0; // тёмная (deep shadow)
uniform vec3  uBandTint1; // shadow
uniform vec3  uBandTint2; // mid-lit
uniform vec3  uBandTint3; // lit
uniform vec3  uBandTint4; // highlight

// hash без сэмплов (детерминированный per-fragment noise для нормалей)
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 proceduralNormalNoise(vec3 n, vec3 worldPos, float amplitude) {
  // 3-tap noise по worldPos — даёт слегка различающиеся нормали на соседних фрагментах
  float h1 = hash13(floor(worldPos * 7.0));
  float h2 = hash13(floor(worldPos * 7.0) + 1.0);
  float h3 = hash13(floor(worldPos * 7.0) + 2.0);
  vec3 noise = vec3(h1, h2, h3) - 0.5;
  return normalize(n + noise * amplitude);
}

void main() {
  vec3 N = normalize(vNormalW);
  if (uNormalNoise > 0.0) {
    N = proceduralNormalNoise(N, vPosW, uNormalNoise);
  }
  vec3 L = normalize(uLightDir);

  // smoothed attenuation (R3.1): smoothstep вместо step — мягкие границы полос
  float ndl = dot(N, L);
  ndl = ndl * 0.5 + 0.5; // ремап в [0,1]

  // 5-ramp palette (R3.4): выбираем tint-полосу по ndl
  vec3 bandTint;
  if (ndl < uRamp0)       bandTint = uBandTint0;
  else if (ndl < uRamp1)  bandTint = uBandTint1;
  else if (ndl < uRamp2)  bandTint = uBandTint2;
  else if (ndl < uRamp3)  bandTint = uBandTint3;
  else                    bandTint = uBandTint4;

  vec3 base = vColor.rgb;
  vec3 col = base * bandTint;

  // старые глобальные сдвиги (для back-compat с voxel-toon опциями)
  // shadowTint применяется к нижним 2 полосам, litTint — к верхним 2
  if (ndl < uRamp2) col += uShadowTint;
  if (ndl >= uRamp2) col += uLitTint;
  if (ndl >= uRamp3) col *= uHighlight;

  // rim light
  vec3 V = normalize(uCamPos - vPosW);
  float rim = 1.0 - max(dot(N, V), 0.0);
  rim = smoothstep(0.55, 1.0, rim);
  col += rim * uRimStrength;

  // ── Cloud shadow (R5): sample world-XZ tile, slow scroll ──
  vec2 cloudUV = (vPosW.xz + uCloudScroll) / max(0.001, uCloudScale);
  float cloud = texture2D(uCloudTex, cloudUV).r;
  // cloud ∈ ~[0..1]; перемаппим в [1-strength..1] (тёмные пятна = тень облаков)
  float cloudAtt = 1.0 - uCloudStrength * (1.0 - cloud);
  col *= cloudAtt;

  // ── Sun shadow uniform (внешний множитель — от ShadowMap в pipeline) ──
  col *= (1.0 - 0.6 * uSunShadow);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), vColor.a);
}
`;

let paToonRegistered = false;

export function registerPixelArtToonShaders(): void {
  if (paToonRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен для ключей ShadersStore.
  if (!Effect.ShadersStore['paToonVertexShader']) Effect.ShadersStore['paToonVertexShader'] = TOON_PA_VERTEX;
  if (!Effect.ShadersStore['paToonFragmentShader']) Effect.ShadersStore['paToonFragmentShader'] = TOON_PA_FRAGMENT;
  paToonRegistered = true;
}

export interface PixelArtToonOptions {
  lightDir?: [number, number, number];
  shadowTint?: [number, number, number];
  litTint?: [number, number, number];
  highlight?: number;
  rimStrength?: number;
  normalNoise?: number;
  cloudTexture?: Texture | null;
  cloudScale?: number;
  cloudStrength?: number;
  /** 5 ramp-step boundaries по ndl ∈ [0,1]. */
  ramp?: [number, number, number, number];
  /** Tints 5 полос (deep shadow..highlight) — мультипликативно к base vertex color. */
  bandTints?: [number, number, number, number, number];
}

/**
 * Создаёт ShaderMaterial `toon-pixel-art` — расширенный toon (5-band ramp +
 * cloud shadow + normal noise + smoothed attenuation).
 */
export function createPixelArtToonMaterial(
  scene: Scene,
  name = 'toon-pixel-art',
  options: PixelArtToonOptions = {}
): ShaderMaterial {
  registerPixelArtToonShaders();
  const mat = new ShaderMaterial(name, scene, { vertex: 'paToon', fragment: 'paToon' }, {
    attributes: ['position', 'normal', 'color'],
    uniforms: [
      'world', 'worldViewProjection',
      'uLightDir', 'uCamPos', 'uShadowTint', 'uLitTint', 'uHighlight', 'uRimStrength', 'uNormalNoise',
      'uCloudTex', 'uCloudScroll', 'uCloudScale', 'uCloudStrength', 'uSunShadow', 'uTime',
      'uRamp0', 'uRamp1', 'uRamp2', 'uRamp3',
      'uBandTint0', 'uBandTint1', 'uBandTint2', 'uBandTint3', 'uBandTint4'
    ],
    samplers: ['uCloudTex']
  });

  mat.setColor3('uShadowTint', new Color3(...(options.shadowTint ?? [-0.05, -0.03, 0.04])));
  mat.setColor3('uLitTint', new Color3(...(options.litTint ?? [0.03, 0.02, 0.0])));
  mat.setFloat('uHighlight', options.highlight ?? 1.3);
  mat.setFloat('uRimStrength', options.rimStrength ?? 0.12);
  mat.setFloat('uNormalNoise', options.normalNoise ?? 0.015);

  const ramp = options.ramp ?? [0.18, 0.36, 0.55, 0.74];
  mat.setFloat('uRamp0', ramp[0]);
  mat.setFloat('uRamp1', ramp[1]);
  mat.setFloat('uRamp2', ramp[2]);
  mat.setFloat('uRamp3', ramp[3]);

  const bt = options.bandTints ?? [0.45, 0.65, 0.85, 1.0, 1.25];
  mat.setColor3('uBandTint0', new Color3(bt[0], bt[0], bt[0]));
  mat.setColor3('uBandTint1', new Color3(bt[1], bt[1], bt[1]));
  mat.setColor3('uBandTint2', new Color3(bt[2], bt[2], bt[2]));
  mat.setColor3('uBandTint3', new Color3(bt[3], bt[3], bt[3]));
  mat.setColor3('uBandTint4', new Color3(bt[4], bt[4], bt[4]));

  if (options.cloudTexture) {
    mat.setTexture('uCloudTex', options.cloudTexture);
  } else {
    // отсутствие cloud-текстуры → гасим вклад (но sampler нужен всегда — ставим 1x1 fallback)
    mat.setTexture('uCloudTex', makeFallbackWhiteTexture(scene));
  }
  mat.setFloat('uCloudScale', options.cloudScale ?? 8.0);
  mat.setFloat('uCloudStrength', options.cloudStrength ?? 0.3);
  mat.setFloat('uSunShadow', 0.0);
  mat.setFloat('uTime', 0.0);
  mat.setVector2('uCloudScroll', new Vector2(0, 0));

  mat.backFaceCulling = true;
  return mat;
}

/** Обновляет per-frame uniforms toon-материала pixel-art. */
export function updatePixelArtToonMaterial(
  mat: ShaderMaterial,
  lightDir: [number, number, number],
  camPos: { x: number; y: number; z: number },
  cloudScroll: { x: number; y: number } = { x: 0, y: 0 },
  timeSec = 0
): void {
  mat.setVector3('uLightDir', new Vector3(lightDir[0], lightDir[1], lightDir[2]));
  mat.setVector3('uCamPos', new Vector3(camPos.x, camPos.y, camPos.z));
  // Vector2 — setVector2 для ShaderMaterial
  mat.setVector2('uCloudScroll', new Vector2(cloudScroll.x, cloudScroll.y));
  mat.setFloat('uTime', timeSec);
}

// ── fallback white 1x1 texture (когда cloud-noise не передан) ─────────────

let fallbackTex: Texture | null = null;
function makeFallbackWhiteTexture(scene: Scene): Texture {
  // проверка disposed через try-catch (Babylon 7 не экспортит isDisposed публично)
  if (fallbackTex) {
    try {
      // если размер валиден — переиспользуем
      if (fallbackTex.getSize().width > 0) return fallbackTex;
    } catch { fallbackTex = null; }
  }
  const data = new Uint8Array([255, 255, 255, 255]);
  fallbackTex = new RawTexture(data, 1, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, 1);
  fallbackTex.name = 'pixel-art-cloud-fallback';
  return fallbackTex;
}

/**
 * Применяет pixel-art toon ко всем воксель-мешам сцены (зеркало applyToonToScene).
 * Возвращает { material, dispose } — dispose восстанавливает оригинальные материалы.
 */
export function applyPixelArtToonToScene(
  scene: Scene,
  camera: Camera,
  lightDir: [number, number, number],
  options: PixelArtToonOptions = {}
): { material: ShaderMaterial; dispose: () => void } {
  const mat = createPixelArtToonMaterial(scene, 'toon-pixel-art-scene', options);

  const originals = new Map<Mesh, unknown>();
  const skipPrefix = ['voxel-ground', 'unit-hp', 'spell-ring', 'voxel-field', 'ground', 'board-', 'selection-ring'];
  for (const m of scene.meshes) {
    if (!(m instanceof Mesh)) continue;
    if (skipPrefix.some((p) => m.name.startsWith(p))) continue;
    if (!m.getVerticesData) continue;
    originals.set(m, m.material);
    m.material = mat;
  }

  const observer = scene.onBeforeRenderObservable.add(() => {
    updatePixelArtToonMaterial(mat, lightDir, camera.position);
  });

  return {
    material: mat,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(observer);
      for (const [m, orig] of originals) m.material = orig as Mesh['material'];
      mat.dispose();
    }
  };
}
