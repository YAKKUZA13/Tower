/**
 * M8.R / R10 — Particles (offline sprite-sheets) + Night (recolour + vignette + grain).
 * Источник: Magnum-Opus «3D Pixel Art» §particles + §night.
 *
 * Компоненты:
 *  - Offline sprite-sheets (rain/splash/dust/leaves/sparkles) — НЕ генерить в 3D-движке;
 *    bake в 2D-туле. В рантайм — SpriteManager.
 *  - Night: recolour directional light (cool blue) + screen vignette + film grain
 *    (анимированный noise overlay).
 *
 * Реализация:
 *  - `createSpriteSheet(name, frames[], cellSize)` — helper bake a sprite-sheet из
 *    массива 32×32 (cellSize) RGBA frames (DynamicTexture). Используется для процедурных
 *    splash/dust/sparkles (rain — VerticalTrapezoid как в atmosphere.ts).
 *  - `NightOverlay` — PostProcess: vignette (darken edges) + animated film grain
 *    (dithered noise). Recolour света делается вызывающим (передать warm→cool lerp).
 *  - `ParticleSpawner` — обёртка над SpriteManager + sprite-pulse для effects.
 */
import {
  Color3,
  Constants,
  DynamicTexture,
  Effect,
  PostProcess,
  RawTexture,
  Scene,
  SpriteManager,
  Texture,
  type Camera
} from 'babylonjs';

// ── Sprite-sheet helpers (bake-time, runtime просто используют SpriteManager) ──

/**
 * Bake a sprite-sheet из N кадров (по `cellSize` пикселей каждый).
 * frames[i] = ImageData-like Uint8ClampedArray RGBA, length = cellSize*cellSize*4.
 * Возвращает DynamicTexture размера (cellSize*N) × cellSize.
 */
export function bakeSpriteSheet(
  scene: Scene,
  name: string,
  frames: Uint8ClampedArray[],
  cellSize: number
): DynamicTexture {
  const n = frames.length;
  const sheet = new DynamicTexture(name, { width: cellSize * n, height: cellSize }, scene, false);
  sheet.updateSamplingMode(Constants.TEXTURE_NEAREST_SAMPLINGMODE);
  sheet.wrapU = Texture.WRAP_ADDRESSMODE;
  sheet.wrapV = Texture.CLAMP_ADDRESSMODE;

  const ctx = sheet.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, cellSize * n, cellSize);
  for (let i = 0; i < n; i++) {
    // ImageData ctor expects regular Uint8ClampedArray; new ImageData(data, w, h) is browser-only.
    // ctx.createImageData gives a typed-array ImageData we can mutate.
    const img = ctx.createImageData(cellSize, cellSize);
    img.data.set(frames[i]);
    ctx.putImageData(img, i * cellSize, 0);
  }
  sheet.update(false);
  return sheet;
}

/**
 * Procedural "spark" sprite-sheet (16 frames × 32px).
 * Используется как fallback если внешний ассет не загружен. Кадр = горящий пиксель
 * разной яркости/радиуса по sin(t).
 */
export function createSparkSpriteSheet(scene: Scene, cellSize = 32, frames = 16): DynamicTexture {
  const arr: Uint8ClampedArray[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const px = new Uint8ClampedArray(cellSize * cellSize * 4);
    const cx = cellSize / 2;
    const cy = cellSize / 2;
    const radius = (Math.sin(t * Math.PI * 2) + 1) / 2 * (cellSize * 0.4) + 2;
    const intensity = (Math.cos(t * Math.PI * 2) + 1) / 2 * 0.5 + 0.5;
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const o = (y * cellSize + x) * 4;
        if (d < radius) {
          const falloff = 1 - d / radius;
          const r = Math.round(255 * falloff * intensity);
          const g = Math.round(200 * falloff * falloff * intensity);
          const b = Math.round(80 * falloff * falloff * falloff * intensity);
          px[o] = r; px[o + 1] = g; px[o + 2] = b;
          px[o + 3] = Math.round(255 * falloff);
        } else {
          px[o + 3] = 0;
        }
      }
    }
    arr.push(px);
  }
  return bakeSpriteSheet(scene, 'spark-sheet', arr, cellSize);
}

/**
 * Procedural "dust" sprite-sheet (16 frames × 32px).
 * Mottled grey-brown puffs (soft noise-driven discs).
 */
export function createDustSpriteSheet(scene: Scene, cellSize = 32, frames = 16): DynamicTexture {
  // детерминированный LCG (без Math.random)
  let s = 70123 >>> 0;
  const rng = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const arr: Uint8ClampedArray[] = [];
  for (let f = 0; f < frames; f++) {
    const t = f / frames;
    const px = new Uint8ClampedArray(cellSize * cellSize * 4);
    const cx = cellSize / 2, cy = cellSize / 2;
    const radius = cellSize * 0.35 + Math.sin(t * Math.PI) * cellSize * 0.1;
    for (let y = 0; y < cellSize; y++) {
      for (let x = 0; x < cellSize; x++) {
        const dx = x - cx, dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < radius) {
          const falloff = 1 - d / radius;
          const noise = rng() * 0.4 + 0.6;
          const o = (y * cellSize + x) * 4;
          px[o] = Math.round(160 * falloff * noise);
          px[o + 1] = Math.round(140 * falloff * noise);
          px[o + 2] = Math.round(110 * falloff * noise);
          px[o + 3] = Math.round(180 * falloff);
        } else {
          px[(y * cellSize + x) * 4 + 3] = 0;
        }
      }
    }
    arr.push(px);
  }
  return bakeSpriteSheet(scene, 'dust-sheet', arr, cellSize);
}

/**
 * SpriteManager для частиц (rain splash / dust / sparkles) — рантайм.
 * В Babylon 7 SpriteManager принимает url-or-dataurl + cellSize.
 */
export function createParticleSpriteManager(scene: Scene, name: string, sheetUrl: string, cellSize: number, capacity = 256): SpriteManager {
  const mgr = new SpriteManager(name, sheetUrl, capacity, cellSize, scene);
  return mgr;
}

// ── Night overlay (vignette + film grain) ──

const NIGHT_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform float uNightAmount;        // 0..1 — 0=day, 1=full night
uniform float uTime;
uniform vec3  uNightTint;          // cool blue (0.3, 0.4, 0.6 типично)
uniform float uVignetteWeight;
uniform float uGrainIntensity;

// hash для film grain
float hash12(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec3 col = texture2D(textureSampler, vUV).rgb;

  // ── night recolour: lerp к cool-blue tint (multiplicative) ──
  vec3 nightCol = col * uNightTint;
  col = mix(col, nightCol, uNightAmount * 0.7);

  // ── vignette ──
  vec2 d = vUV - vec2(0.5);
  float vig = 1.0 - dot(d, d) * uVignetteWeight;
  col *= mix(1.0, vig, 0.5 + uNightAmount * 0.5);

  // ── film grain (animated noise overlay) ──
  float grain = hash12(vUV * vec2(1920.0, 1080.0) + uTime);
  col += (grain - 0.5) * uGrainIntensity * (0.3 + 0.7 * uNightAmount);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

let nightRegistered = false;
function registerNight(): void {
  if (nightRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен.
  if (!Effect.ShadersStore['nightFragmentShader']) Effect.ShadersStore['nightFragmentShader'] = NIGHT_FRAGMENT;
  nightRegistered = true;
}

export interface NightOverlayOptions {
  nightAmount?: number;
  nightTint?: [number, number, number];
  vignetteWeight?: number;
  grainIntensity?: number;
}

export interface NightOverlayHandle {
  pp: PostProcess;
  setNightAmount(t: number): void;
  setTime(t: number): void;
  dispose(): void;
}

/**
 * Создаёт night overlay post-process (vignette + grain + cool tint).
 * Recolour directional light выполняет вызывающий (передать warm→cool lerp в
 * DirectionalLight.diffuse в зависимости от timeOfDay).
 */
export function createNightOverlay(
  scene: Scene,
  camera: Camera,
  options: NightOverlayOptions = {}
): NightOverlayHandle {
  registerNight();
  const pp = new PostProcess(
    'night-overlay',
    'night',
    ['uNightAmount', 'uNightTint', 'uVignetteWeight', 'uGrainIntensity', 'uTime'],
    null,
    1.0,
    camera
  );
  let nightAmount = options.nightAmount ?? 0;
  let time = 0;
  const tint = options.nightTint ?? [0.3, 0.4, 0.6];
  pp.onApplyObservable.add((effect) => {
    effect.setFloat('uNightAmount', nightAmount);
    effect.setColor3('uNightTint', new Color3(tint[0], tint[1], tint[2]));
    effect.setFloat('uVignetteWeight', options.vignetteWeight ?? 2.4);
    effect.setFloat('uGrainIntensity', options.grainIntensity ?? 0.08);
    effect.setFloat('uTime', time);
  });
  return {
    pp,
    setNightAmount(t: number) { nightAmount = Math.max(0, Math.min(1, t)); },
    setTime(t: number) { time = t; },
    dispose() { pp.dispose(); }
  };
}

/**
 * Helper: smooth day→night curve по timeOfDay ∈ [0,1).
 * Возвращает nightAmount ∈ [0,1]: 0 в полдень (0.5), 1 в полночь (0/1).
 */
export function nightAmountFromTimeOfDay(timeOfDay: number): number {
  // 0.5 = noon → 0 night; 0/1 = midnight → 1 night; smooth cosine
  const x = (timeOfDay - 0.5) * Math.PI * 2;   // [-π..π], 0 at noon
  const val = (Math.cos(x) + 1) / 2;            // 1 at noon, 0 at midnight
  return Math.pow(1 - val, 2);                  // invert + sharpen
}

export { RawTexture };
