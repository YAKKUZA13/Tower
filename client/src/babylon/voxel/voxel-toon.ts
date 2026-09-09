/**
 * Toon-shader + outline post-process (M7 D9 — voxel-migration-plan, research §15.2E).
 *
 * Порт forge/assets/shaders/toon.wgsl → Babylon ShaderMaterial (GLSL): 3-band
 * step(ndl, 0.25/0.55) lighting (shadow cool / lit warm / highlight brighter) +
 * rim-light. Читает vertex colors (baked tint+AO) + normals — общий материал для
 * всех voxel-мешей (переключаемый с baked StandardMaterial через USE_TOON).
 *
 * Outline: post-process Sobel edge-detection по color buffer (cartoon-контур без
 * отдельного normal-prepass — дёшево, читается как ink-outline).
 *
 * ACES/bloom (atmosphere DefaultRenderingPipeline) совместимы — toon-цвет
 * пост-обрабатывается тем же pipeline.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { type Camera } from '@babylonjs/core/Cameras/camera.js';
import { type Scene } from '@babylonjs/core/scene.js';

// ── Toon shaders (GLSL, research §15.2E / forge toon.wgsl порт) ──────────────

const TOON_VERTEX = `
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

const TOON_FRAGMENT = `
precision highp float;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec4 vColor;
uniform vec3 uLightDir;
uniform vec3 uCamPos;
uniform vec3 uShadowTint;   // cool shift для shadow-полосы
uniform vec3 uLitTint;      // warm shift для lit-полосы
uniform float uHighlight;   // множитель highlight-полосы
uniform float uRimStrength;
void main() {
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(uLightDir);
  float ndl = dot(N, L);
  ndl = ndl * 0.5 + 0.5; // ремап в [0,1] (двустороннее освещение — мягче на гранях)
  vec3 base = vColor.rgb;
  // 3-band step (forge: step(0.25), step(0.55))
  vec3 shadowCol = base * 0.55 + uShadowTint;
  vec3 litCol = base + uLitTint;
  vec3 hiCol = base * uHighlight;
  float b = step(0.30, ndl);
  float h = step(0.62, ndl);
  vec3 col = mix(shadowCol, litCol, b);
  col = mix(col, hiCol, h);
  // rim light (край/силуэт)
  vec3 V = normalize(uCamPos - vPosW);
  float rim = 1.0 - max(dot(N, V), 0.0);
  rim = smoothstep(0.55, 1.0, rim);
  col += rim * uRimStrength;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), vColor.a);
}
`;

let toonRegistered = false;

/**
 * Регистрирует toon-шейдеры в Babylon Effect.ShadersStore (идемпотентно).
 *
 * ВАЖНО: Babylon 7.54+ требует суффикс "Shader" в ключе (toonVertexShader),
 * не "Vertex" (как было в 6.x). См. _loadShader в @babylonjs/core/Engines:
 *   shaderStore[shader + key + "Shader"]
 */
export function registerToonShaders(): void {
  if (toonRegistered) return;
  if (!Effect.ShadersStore['toonVertexShader']) Effect.ShadersStore['toonVertexShader'] = TOON_VERTEX;
  if (!Effect.ShadersStore['toonFragmentShader']) Effect.ShadersStore['toonFragmentShader'] = TOON_FRAGMENT;
  toonRegistered = true;
}

export interface ToonOptions {
  lightDir?: [number, number, number];
  shadowTint?: [number, number, number];
  litTint?: [number, number, number];
  highlight?: number;
  rimStrength?: number;
}

/**
 * Создаёт ShaderMaterial для toon-shading. Атрибуты: position, normal, color.
 * Uniforms обновляются каждый кадр (lightDir/camPos) через updateToonMaterial.
 */
export function createToonMaterial(scene: Scene, name = 'voxel-toon', options: ToonOptions = {}): ShaderMaterial {
  registerToonShaders();
  const mat = new ShaderMaterial(name, scene, { vertex: 'toon', fragment: 'toon' }, {
    attributes: ['position', 'normal', 'color'],
    uniforms: ['world', 'worldViewProjection', 'uLightDir', 'uCamPos', 'uShadowTint', 'uLitTint', 'uHighlight', 'uRimStrength']
  });
  mat.setColor3('uShadowTint', new Color3(...(options.shadowTint ?? [-0.05, -0.03, 0.04])));
  mat.setColor3('uLitTint', new Color3(...(options.litTint ?? [0.03, 0.02, 0.0])));
  mat.setFloat('uHighlight', options.highlight ?? 1.3);
  mat.setFloat('uRimStrength', options.rimStrength ?? 0.12);
  mat.backFaceCulling = true;
  return mat;
}

/** Обновляет per-frame uniforms toon-материала (light dir + camera pos). */
export function updateToonMaterial(mat: ShaderMaterial, lightDir: [number, number, number], camPos: { x: number; y: number; z: number }): void {
  mat.setVector3('uLightDir', new Vector3(lightDir[0], lightDir[1], lightDir[2]));
  mat.setVector3('uCamPos', new Vector3(camPos.x, camPos.y, camPos.z));
}

// ── Outline post-process (Sobel edge на color buffer) ────────────────────────

const OUTLINE_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 uTexel;
uniform float uEdgeStrength;
uniform vec3 uEdgeColor;
void main() {
  // 3x3 Sobel на luminance
  float l = length(texture2D(textureSampler, vUV).rgb);
  float l00 = length(texture2D(textureSampler, vUV + vec2(-uTexel.x, -uTexel.y)).rgb);
  float l10 = length(texture2D(textureSampler, vUV + vec2( 0.0,      -uTexel.y)).rgb);
  float l20 = length(texture2D(textureSampler, vUV + vec2( uTexel.x, -uTexel.y)).rgb);
  float l01 = length(texture2D(textureSampler, vUV + vec2(-uTexel.x,  0.0)).rgb);
  float l21 = length(texture2D(textureSampler, vUV + vec2( uTexel.x,  0.0)).rgb);
  float l02 = length(texture2D(textureSampler, vUV + vec2(-uTexel.x,  uTexel.y)).rgb);
  float l12 = length(texture2D(textureSampler, vUV + vec2( 0.0,       uTexel.y)).rgb);
  float l22 = length(texture2D(textureSampler, vUV + vec2( uTexel.x,  uTexel.y)).rgb);
  float gx = (l00 + 2.0*l01 + l02) - (l20 + 2.0*l21 + l22);
  float gy = (l00 + 2.0*l10 + l20) - (l02 + 2.0*l12 + l22);
  float g = sqrt(gx*gx + gy*gy);
  float edge = smoothstep(0.4, 0.9, g) * uEdgeStrength;
  vec3 col = texture2D(textureSampler, vUV).rgb;
  col = mix(col, uEdgeColor, clamp(edge, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

let outlineRegistered = false;

/** Создаёт outline post-process (Sobel edge) и цепляет на камеру. */
export function createOutlinePostProcess(camera: Camera, options: { edgeStrength?: number; edgeColor?: [number, number, number] } = {}): PostProcess {
  if (!outlineRegistered) {
    // Babylon 7: суффикс "Shader" обязателен (см. _loadShader в @babylonjs/core).
    Effect.ShadersStore['outlineFragmentShader'] = OUTLINE_FRAGMENT;
    outlineRegistered = true;
  }
  const pp = new PostProcess('voxel-outline', 'outline', ['uTexel', 'uEdgeStrength', 'uEdgeColor'], null, 1.0, camera);
  const edgeColor = options.edgeColor ?? [0.04, 0.04, 0.06];
  pp.onApplyObservable.add((effect) => {
    effect.setFloat2('uTexel', 1.0 / camera.getEngine().getRenderWidth(), 1.0 / camera.getEngine().getRenderHeight());
    effect.setFloat('uEdgeStrength', options.edgeStrength ?? 0.8);
    effect.setColor3('uEdgeColor', new Color3(edgeColor[0], edgeColor[1], edgeColor[2]));
  });
  return pp;
}

// ── Применение toon к сцене (замена материалов voxel-мешей + outline) ─────────

/**
 * Применяет house-style toon: заменяет материал всех мешей сцены (кроме специальных:
 * terrain/hp-bar/spell) на общий toon ShaderMaterial + добавляет outline post-process.
 * Возвращает { material, observer } для per-frame обновления light/cam uniforms и dispose.
 */
export function applyToonToScene(
  scene: Scene,
  camera: Camera,
  lightDir: [number, number, number],
  options: ToonOptions & { edgeStrength?: number } = {}
): { material: ShaderMaterial; dispose: () => void } {
  const mat = createToonMaterial(scene, 'voxel-toon-scene', options);
  const outline = createOutlinePostProcess(camera, { edgeStrength: options.edgeStrength });

  // сохраняем оригинальные материалы для restore
  const originals = new Map<Mesh, unknown>();
  const skipPrefix = ['voxel-ground', 'unit-hp', 'spell-ring', 'voxel-field', 'ground', 'board-'];
  for (const m of scene.meshes) {
    if (!(m instanceof Mesh)) continue;
    if (skipPrefix.some((p) => m.name.startsWith(p))) continue;
    if (!m.getVerticesData) continue;
    originals.set(m, m.material);
    m.material = mat;
  }

  // per-frame обновление light/cam
  const observer = scene.onBeforeRenderObservable.add(() => {
    updateToonMaterial(mat, lightDir, camera.position);
  });

  return {
    material: mat,
    dispose: () => {
      scene.onBeforeRenderObservable.remove(observer);
      for (const [m, orig] of originals) m.material = orig as Mesh['material'];
      mat.dispose();
      outline.dispose();
    }
  };
}
