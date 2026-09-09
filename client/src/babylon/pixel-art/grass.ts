/**
 * M8.R / R6 — Grass (billboards + base-position lighting).
 * Источник: Magnum-Opus «3D Pixel Art» §grass (Bramwell hack).
 *
 * Для RTS-террейна (большая карта). Billboard-quads с tuft-текстурой;
 * **хак** (Bramwell): fragment-shader использует world-position ОСНОВАНИЯ куа
 * (не самого фрагмента) → весь tuft берёт одно значение тени → трава не «мерцает»
 * по высоте.
 *
 * Реализация:
 *  - InstancedMesh / ThinInstances: один quad-master, N transforms (poisson-disk на terain).
 *  - ShaderMaterial с base-position lighting: атрибут aBasePos (world-position основания)
 *    → shadow/light/cloud attenuation сэмплятся ОДИН раз для всего куа.
 *
 * Зависимости: M8.1 (большая карта + VoxelField terrain). На плоской TD-доске
 * трава выглядит чужеродно → активируется ТОЛЬКО при наличии terrainHeightSampler.
 */
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Matrix, Quaternion, Vector2, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { type Camera } from '@babylonjs/core/Cameras/camera.js';
import { type Scene } from '@babylonjs/core/scene.js';

const GRASS_VERTEX = `
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec3 aBasePos;       // world-position основания куа (одинаков для всех вершин инстанса)
attribute mat4 world;           // thin instance matrix

uniform mat4 viewProjection;

varying vec2 vUV;
varying vec3 vBaseWorld;
varying vec3 vWorldPos;

void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vBaseWorld = (world * vec4(aBasePos, 1.0)).xyz;
  vUV = uv;
  gl_Position = viewProjection * wp;
}
`;

const GRASS_FRAGMENT = `
precision highp float;
varying vec2 vUV;
varying vec3 vBaseWorld;
varying vec3 vWorldPos;

uniform sampler2D uTuftTex;
uniform vec3 uCamPos;
uniform vec3 uLightDir;
uniform vec3 uBaseColor;        // цвет тёмной части (bottom травы)
uniform vec3 uTipColor;         // цвет кончика
uniform float uCloudStrength;
uniform sampler2D uCloudTex;
uniform float uCloudScale;
uniform vec2 uCloudScroll;
uniform float uSunShadow;       // внешний shadow-фактор у основания (от ShadowMap или R4 depth)

void main() {
  // alpha-mask из tuft texture (soft disc или blade shape)
  vec4 tuft = texture2D(uTuftTex, vUV);
  if (tuft.a < 0.15) discard;

  // gradient bottom→top по uv.y (bottom=0, top=1)
  vec3 col = mix(uBaseColor, uTipColor, vUV.y);

  // ── BRAMWELL HACK: тень/свет/cloud от baseWorld (не от текущего фрагмента) ──
  // лёгкий ambient от самой точки + directional от нормали куа (~up),
  // но скаляр тени/облака — один на tuft.
  vec3 N = vec3(0.0, 1.0, 0.0);
  float ndl = max(0.0, dot(N, normalize(uLightDir)));
  col *= 0.6 + 0.4 * ndl;

  // cloud shadow from base
  vec2 cUV = (vBaseWorld.xz + uCloudScroll) / max(0.001, uCloudScale);
  float cloud = texture2D(uCloudTex, cUV).r;
  col *= 1.0 - uCloudStrength * (1.0 - cloud);

  col *= (1.0 - 0.6 * uSunShadow);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), tuft.a);
}
`;

let grassRegistered = false;
function registerGrassShader(): void {
  if (grassRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен.
  if (!Effect.ShadersStore['grassPaVertexShader']) Effect.ShadersStore['grassPaVertexShader'] = GRASS_VERTEX;
  if (!Effect.ShadersStore['grassPaFragmentShader']) Effect.ShadersStore['grassPaFragmentShader'] = GRASS_FRAGMENT;
  grassRegistered = true;
}

export interface GrassPlacement {
  /** Позиция основания куа в world. */
  x: number; z: number;
  /** Z-rotation (вокруг Y), рандомизированный для разнообразия. */
  rotY: number;
  /** Scale multiplier (0.8..1.2 типично). */
  scale: number;
}

/**
 * Poisson-disk placement на сетке (Brian Curless "Fast Adaptive Blue Noise on Polygonal Surfaces",
 * упрощённо: rejection-based poisson на 2D-grid). Детерминированный.
 */
export function poissonDiskPlacement(
  areaWidth: number,
  areaHeight: number,
  density: number,
  rng: () => number,
  excluded?: (x: number, z: number) => boolean
): GrassPlacement[] {
  const out: GrassPlacement[] = [];
  // grid-accelerated poisson
  const minDist = Math.sqrt(1 / density);
  const cellSize = minDist / Math.SQRT2;
  const cols = Math.ceil(areaWidth / cellSize);
  const rows = Math.ceil(areaHeight / cellSize);
  const grid: (GrassPlacement | null)[] = new Array(cols * rows).fill(null);

  const halfW = areaWidth / 2;
  const halfH = areaHeight / 2;
  const tries = 30;
  const attempt = (p: GrassPlacement): boolean => {
    const cx = Math.floor((p.x + halfW) / cellSize);
    const cz = Math.floor((p.z + halfH) / cellSize);
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const other = grid[nz * cols + nx];
        if (!other) continue;
        const ddx = other.x - p.x;
        const ddz = other.z - p.z;
        if (ddx * ddx + ddz * ddz < minDist * minDist) return false;
      }
    }
    grid[cz * cols + cx] = p;
    out.push(p);
    return true;
  };

  // seed initial points on jittered grid
  const target = Math.round(density * areaWidth * areaHeight);
  let guard = 0;
  while (out.length < target && guard++ < target * 4) {
    const x = (rng() * 2 - 1) * halfW;
    const z = (rng() * 2 - 1) * halfH;
    if (excluded && excluded(x, z)) continue;
    const p: GrassPlacement = {
      x, z,
      rotY: rng() * Math.PI * 2,
      scale: 0.85 + rng() * 0.4
    };
    attempt(p);
  }
  return out;
}

/**
 * Создаёт grass-billboard систему: thin-instance quad-master с custom shader.
 *  - tuftTexture: 64×64 RGBA (alpha-mask), procedural если не задан.
 *  - Высота куа — quad-height; ширина — half-height.
 */
export function createGrassField(
  scene: Scene,
  camera: Camera,
  placement: GrassPlacement[],
  tuftHeight: number,
  options: {
    tuftTexture?: Texture | null;
    baseColor?: [number, number, number];
    tipColor?: [number, number, number];
    cloudTexture?: Texture | null;
    cloudScale?: number;
    cloudStrength?: number;
    lightDir?: [number, number, number];
  } = {}
): {
  mesh: Mesh;
  material: ShaderMaterial;
  update(camPos: Vector3, lightDir: [number, number, number], cloudScroll: { x: number; y: number }, sunShadow: number): void;
  dispose(): void;
} {
  registerGrassShader();

  // ── quad master (2 треугольника) ──
  const halfW = tuftHeight * 0.35;
  const master = MeshBuilder.CreatePlane('grass-master', { width: halfW * 2, height: tuftHeight, sideOrientation: Mesh.DOUBLESIDE }, scene);
  // origin quad at bottom (для billboard billboarding вверх)
  master.bakeTransformIntoVertices(Matrix.Translation(0, tuftHeight / 2, 0));

  // thin instances: per-instance matrix + aBasePos
  const count = placement.length;
  const matrixData = new Float32Array(count * 16);
  const basePosData = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const p = placement[i];
    const m = ComposeBillboardMatrix(p.x, 0, p.z, p.rotY, p.scale);
    matrixData.set(m, i * 16);
    basePosData[i * 3 + 0] = 0; // basePos в local — mat4 world его переведёт
    basePosData[i * 3 + 1] = 0;
    basePosData[i * 3 + 2] = 0;
  }
  master.thinInstanceSetBuffer('matrix', matrixData, 16);
  master.thinInstanceSetBuffer('aBasePos', basePosData, 3);

  // material
  const tuftTex = options.tuftTexture ?? createDefaultTuftTexture(scene);
  const mat = new ShaderMaterial('grass-pa', scene, { vertex: 'grassPa', fragment: 'grassPa' }, {
    attributes: ['position', 'normal', 'uv', 'world', 'aBasePos'],
    uniforms: ['viewProjection', 'uCamPos', 'uLightDir', 'uBaseColor', 'uTipColor', 'uCloudStrength', 'uCloudScale', 'uCloudScroll', 'uSunShadow'],
    samplers: ['uTuftTex', 'uCloudTex']
  });
  mat.setTexture('uTuftTex', tuftTex);
  if (options.cloudTexture) mat.setTexture('uCloudTex', options.cloudTexture);
  mat.setColor3('uBaseColor', new Color3(...(options.baseColor ?? [0.10, 0.22, 0.08])));
  mat.setColor3('uTipColor', new Color3(...(options.tipColor ?? [0.36, 0.55, 0.18])));
  mat.setFloat('uCloudStrength', options.cloudStrength ?? 0.3);
  mat.setFloat('uCloudScale', options.cloudScale ?? 4);
  mat.setFloat('uSunShadow', 0);
  mat.setVector3('uLightDir', new Vector3(...(options.lightDir ?? [0.3, 1, 0.4])));
  mat.backFaceCulling = false;
  mat.alphaMode = Constants.ALPHA_COMBINE;
  master.material = mat;
  master.isPickable = false;
  master.alwaysSelectAsActiveMesh = true;
  master.doNotSyncBoundingInfo = true;

  return {
    mesh: master,
    material: mat,
    update(_camPos: Vector3, lightDir: [number, number, number], cloudScroll: { x: number; y: number }, sunShadow: number) {
      mat.setVector3('uCamPos', camera.position);
      mat.setVector3('uLightDir', new Vector3(...lightDir));
      mat.setVector2('uCloudScroll', new Vector2(cloudScroll.x, cloudScroll.y));
      mat.setFloat('uSunShadow', sunShadow);
    },
    dispose() {
      master.dispose();
      mat.dispose();
      if (!options.tuftTexture) tuftTex.dispose();
    }
  };
}

// ── helpers ─────────────────────────────────────────────────────────────

function ComposeBillboardMatrix(x: number, _y: number, z: number, rotY: number, scale: number): number[] {
  const q = Quaternion.RotationAxis(new Vector3(0, 1, 0), rotY);
  const s = new Vector3(scale, scale, scale);
  const t = new Vector3(x, 0, z);
  return Matrix.Compose(s, q, t).m as number[];
}

function createDefaultTuftTexture(scene: Scene): Texture {
  // 64×64 alpha-mask: blade shape (две пересекающиеся под углом полоски)
  const size = 64;
  const tex = new DynamicTexture('grass-tuft', { width: size, height: size }, scene, false);
  tex.updateSamplingMode(Constants.TEXTURE_NEAREST_SAMPLINGMODE);
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(150, 200, 90, 0.95)';
  // central blade
  ctx.beginPath();
  ctx.moveTo(size * 0.5, 4);
  ctx.quadraticCurveTo(size * 0.52, size * 0.5, size * 0.5, size - 4);
  ctx.quadraticCurveTo(size * 0.48, size * 0.5, size * 0.5, 4);
  ctx.fill();
  // side blades
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size - 4);
  ctx.quadraticCurveTo(size * 0.45, size * 0.55, size * 0.5, size * 0.5);
  ctx.quadraticCurveTo(size * 0.35, size * 0.6, size * 0.3, size - 4);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(size * 0.7, size - 4);
  ctx.quadraticCurveTo(size * 0.55, size * 0.55, size * 0.5, size * 0.5);
  ctx.quadraticCurveTo(size * 0.65, size * 0.6, size * 0.7, size - 4);
  ctx.fill();
  tex.update(false);
  tex.hasAlpha = true;
  return tex;
}
