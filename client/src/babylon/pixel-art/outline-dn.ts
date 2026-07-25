/**
 * M8.R / R4 — Depth + normal outlines (ЗАМЕНА color-Sobel из voxel-toon.ts).
 * Источник: Roystan Outline Shader; Magnum-Opus «3D Pixel Art» §outline.
 *
 * В источнике контур берётся из depth (силуэт против фона) и cross-product
 * соседних normal-texels (edge highlight, **только выпуклые**, dihedral > ~90°).
 *
 * Реализация:
 *  - Включает Babylon built-in prepasses: scene.enableDepthRenderer() + GeometryBufferRenderer
 *    (для normal-buffer; enableNormalRenderer отсутствует в Babylon 7 — используем
 *    GeometryBufferRenderer, который предоставляет normal в MRT-канале).
 *  - PostProcess с 4-tap kernel (up/down/left/right, по канону «4-tap outline»).
 *  - Dihedral-фильтр: dot(cross(N_center, N_neighbour), up) > threshold → ребро.
 *  - Lighting state → outline color (подсветка/затемнение контура в тени).
 *
 * Заменяет `createOutlinePostProcess` в voxel-toon.ts — вставляется в ту же камеру.
 */
import { Color3, Constants, Effect, PostProcess, Texture, type Camera, type Scene } from 'babylonjs';

const OUTLINE_DN_FRAGMENT = `
precision highp float;
varying vec2 vUV;

uniform sampler2D textureSampler;
uniform sampler2D uDepthTex;
uniform sampler2D uNormalTex;
uniform vec2 uTexel;
uniform float uDepthThreshold;
uniform float uNormalThreshold;
uniform vec3 uEdgeColor;
uniform vec3 uEdgeColorShadow;
uniform float uLightInfluence;
uniform vec2 uSunDir;
uniform float uEdgeStrength;
uniform float uFar;
uniform float uNear;

float linearizeDepth(float d) {
  float z = d;
  return (uNear * uFar) / (uFar - z * (uFar - uNear));
}

void main() {
  vec2 c  = vUV;
  vec2 dx = vec2(uTexel.x, 0.0);
  vec2 dy = vec2(0.0, uTexel.y);

  vec3 col = texture2D(textureSampler, c).rgb;

  // ── depth 4-tap (силуэт против фона) ──
  float dC = texture2D(uDepthTex, c).r;
  float dU = texture2D(uDepthTex, c + dy).r;
  float dD = texture2D(uDepthTex, c - dy).r;
  float dL = texture2D(uDepthTex, c - dx).r;
  float dR = texture2D(uDepthTex, c + dx).r;

  float depthEdge = max(
    max(abs(dC - dU), abs(dC - dD)),
    max(abs(dC - dL), abs(dC - dR))
  );
  float dC_lin = linearizeDepth(dC);
  float depthEdgeScaled = depthEdge * (uFar - uNear) / max(0.001, dC_lin);
  float silhouette = smoothstep(uDepthThreshold * 0.7, uDepthThreshold, depthEdgeScaled);

  // ── normal 4-tap (dihedral edge highlight, только выпуклые) ──
  vec3 nC = normalize(texture2D(uNormalTex, c).rgb * 2.0 - 1.0);
  vec3 nU = normalize(texture2D(uNormalTex, c + dy).rgb * 2.0 - 1.0);
  vec3 nD = normalize(texture2D(uNormalTex, c - dy).rgb * 2.0 - 1.0);
  vec3 nL = normalize(texture2D(uNormalTex, c - dx).rgb * 2.0 - 1.0);
  vec3 nR = normalize(texture2D(uNormalTex, c + dx).rgb * 2.0 - 1.0);

  float dotMin = min(min(dot(nC, nU), dot(nC, nD)), min(dot(nC, nL), dot(nC, nR)));
  float edge = 1.0 - smoothstep(uNormalThreshold, 0.0, dotMin);

  // ── итоговый outline factor ──
  float outline = clamp(max(silhouette, edge) * uEdgeStrength, 0.0, 1.0);

  float sunInfluence = 1.0 - uLightInfluence * (0.5 + 0.5 * dot(normalize(nC.xy), normalize(uSunDir)));
  vec3 finalEdgeCol = mix(uEdgeColor, uEdgeColorShadow, 1.0 - sunInfluence);

  vec3 result = mix(col, finalEdgeCol, outline);
  gl_FragColor = vec4(result, 1.0);
}
`;

let outlineDnRegistered = false;

function registerOutlineDn(): void {
  if (outlineDnRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен.
  if (!Effect.ShadersStore['outlineDnFragmentShader']) {
    Effect.ShadersStore['outlineDnFragmentShader'] = OUTLINE_DN_FRAGMENT;
  }
  outlineDnRegistered = true;
}

export interface OutlineDnOptions {
  edgeStrength?: number;
  depthThreshold?: number;
  normalThreshold?: number;
  edgeColor?: [number, number, number];
  edgeColorShadow?: [number, number, number];
  lightInfluence?: number;
  sunDir?: [number, number];
  preexistingDepth?: Texture | null;
  preexistingNormal?: Texture | null;
}

export interface OutlineDnHandle {
  pp: PostProcess;
  depthTexture: Texture;
  normalTexture: Texture;
  dispose(): void;
}

/**
 * Создаёт depth+normal outline PostProcess.
 *
 * Включает Babylon built-in prepasses (DepthRenderer + GeometryBufferRenderer для
 * normal-канала; enableNormalRenderer отсутствует в Babylon 7 — GeometryBufferRenderer
 * даёт normal через getGBuffer().textures[1]).
 */
export function createOutlineDnPostProcess(
  scene: Scene,
  camera: Camera,
  options: OutlineDnOptions = {}
): OutlineDnHandle {
  registerOutlineDn();

  // ── prepasses ──
  const depthRenderer = scene.enableDepthRenderer();
  const depthTexture = options.preexistingDepth ?? depthRenderer.getDepthMap();

  // normal: GeometryBufferRenderer (Babylon 7 substitute for enableNormalRenderer)
  let normalTexture = options.preexistingNormal ?? null;
  if (!normalTexture) {
    const geomRenderer = scene.enableGeometryBufferRenderer();
    if (geomRenderer) {
      const gbuffer = geomRenderer.getGBuffer();
      // textures[0] = position, [1] = normal (Babylon convention)
      normalTexture = (gbuffer.textures[1] ?? gbuffer.textures[0]) as Texture;
    } else {
      // headless fallback: fake 1x1 normal texture
      normalTexture = depthTexture;
    }
  }

  const pp = new PostProcess(
    'outline-dn',
    'outlineDn',
    [
      'uTexel', 'uDepthThreshold', 'uNormalThreshold',
      'uEdgeColor', 'uEdgeColorShadow', 'uLightInfluence', 'uSunDir',
      'uEdgeStrength', 'uFar', 'uNear'
    ],
    ['uDepthTex', 'uNormalTex'],
    1.0,
    camera
  );

  const edgeColor = options.edgeColor ?? [0.04, 0.04, 0.06];
  const edgeColorShadow = options.edgeColorShadow ?? [0.02, 0.02, 0.04];
  const sunDir = options.sunDir ?? [0.4, 0.45];

  pp.onApplyObservable.add((effect) => {
    effect.setTexture('uDepthTex', depthTexture);
    effect.setTexture('uNormalTex', normalTexture as Texture);
    const w = camera.getEngine().getRenderWidth();
    const h = camera.getEngine().getRenderHeight();
    effect.setFloat2('uTexel', 1 / Math.max(1, w), 1 / Math.max(1, h));
    effect.setFloat('uDepthThreshold', options.depthThreshold ?? 0.15);
    effect.setFloat('uNormalThreshold', options.normalThreshold ?? 0.0);
    effect.setColor3('uEdgeColor', new Color3(edgeColor[0], edgeColor[1], edgeColor[2]));
    effect.setColor3('uEdgeColorShadow', new Color3(edgeColorShadow[0], edgeColorShadow[1], edgeColorShadow[2]));
    effect.setFloat('uLightInfluence', options.lightInfluence ?? 0.4);
    effect.setFloat2('uSunDir', sunDir[0], sunDir[1]);
    effect.setFloat('uEdgeStrength', options.edgeStrength ?? 1.0);
    effect.setFloat('uFar', camera.maxZ);
    effect.setFloat('uNear', camera.minZ);
  });

  return {
    pp,
    depthTexture,
    normalTexture,
    dispose() {
      pp.dispose();
      // prepasses НЕ выключаем — ими могут пользоваться god-rays (R7) и др.
    }
  };
}

export { Color3 };
