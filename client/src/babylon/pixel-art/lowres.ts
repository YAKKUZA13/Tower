/**
 * M8.R / R1 — Low-res render + nearest upscale (САМЫЙ ВЛИЯТЕЛЬНЫЙ эффект).
 * Источник: `Magnum-Opus/docs/llm/30_pixel_art_render.md` (David Holland 3D Pixel Art).
 *
 * Рендер сцены в RTT ~640×360 → NEAREST-blit на экран. Даёт характерную
 * «пиксель-арт» ступенчатость вместо linear-размытия Babylon backbuffer'а.
 *
 * Реализация (канон для Babylon 7):
 *  - Internal RTT (FixedSizeRenderTargetTexture) размером `width×height` (по умолчанию
 *    640×360; высота зафиксирована, ширина = round(360 * aspect)).
 *  - Сцена рендерится в RTT через scene.customRenderTargets.
 *  - Финальный fullscreen-quad blit-PostProcess с NEAREST sampling (Texture.NEAREST_SAMPLINGMODE).
 *  - Sub-pixel offset uniform (см. cam-snap.ts) закрывает pixel-snap loop.
 */
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Effect } from '@babylonjs/core/Materials/effect.js';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess.js';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { type Camera } from '@babylonjs/core/Cameras/camera.js';

export interface LowresOptions {
  /** Внутренняя высота рендера (по умолчанию 360). */
  internalHeight?: number;
  /** Force aspect; иначе — из canvas. */
  aspectOverride?: number;
  /** NEAREST на финальном blit (true по умолчанию — канон пиксель-арта). */
  nearest?: boolean;
}

export interface LowresHandle {
  /** RTT, куда сцена рендерится. */
  readonly rtt: RenderTargetTexture;
  /** Blit post-process (NEAREST upscale). */
  readonly blit: PostProcess;
  /** Текущее внутреннее разрешение. */
  readonly size: { width: number; height: number };
  /** Sub-pixel offset (задаётся из cam-snap). */
  setSubpixelOffset(x: number, y: number): void;
  /** Resize при изменении окна. */
  resize(engine: Engine): void;
  dispose(): void;
}

let blitRegistered = false;
const BLIT_FRAGMENT = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 uSubpixel;
void main() {
  vec2 uv = vUV + uSubpixel;
  gl_FragColor = texture2D(textureSampler, uv);
}
`;

function registerBlitShader(): void {
  if (blitRegistered) return;
  // Babylon 7: суффикс "Shader" обязателен для ключей ShadersStore.
  if (!Effect.ShadersStore['pixelArtBlitFragmentShader']) {
    Effect.ShadersStore['pixelArtBlitFragmentShader'] = BLIT_FRAGMENT;
  }
  blitRegistered = true;
}

/**
 * Рассчитывает внутреннее разрешение, сохраняя aspect (высота фиксирована,
 * ширина = round(height * aspect)). Это сохраняет квадратный пиксель —
 * обязательное условие pixel-art (David Holland §resolution).
 */
export function computeInternalSize(engine: Engine, internalHeight = 360, aspectOverride?: number): { width: number; height: number } {
  const aspect = aspectOverride ?? engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const width = Math.max(64, Math.round(internalHeight * aspect));
  return { width, height: internalHeight };
}

/**
 * Создаёт lowres-конвейер: RTT, в который рендерится сцена, + NEAREST-blit на экран.
 *
 * Для pixel-art на камере ДОЛЖЕН быть отключён FXAA/MSAA/AA (см. R3 + atmosphere).
 */
export function createLowresPipeline(
  scene: Scene,
  camera: Camera,
  engine: Engine,
  options: LowresOptions = {}
): LowresHandle {
  registerBlitShader();

  const internalHeight = options.internalHeight ?? 360;
  let size = computeInternalSize(engine, internalHeight, options.aspectOverride);

  // RTT: explicit fixed-size render target, NEAREST — для избежания shimmer.
  const rtt = new RenderTargetTexture(
    'pixel-art-rtt',
    { width: size.width, height: size.height },
    scene,
    false, // generateMipMaps
    true,  // invertY
    Constants.TEXTURETYPE_UNSIGNED_INT
  );
  rtt.wrapU = Texture.CLAMP_ADDRESSMODE;
  rtt.wrapV = Texture.CLAMP_ADDRESSMODE;
  rtt.anisotropicFilteringLevel = 1;
  rtt.updateSamplingMode(Constants.TEXTURE_NEAREST_SAMPLINGMODE);
  rtt.renderListPredicate = (mesh) => mesh.isEnabled() && mesh.isVisible;
  scene.customRenderTargets.push(rtt);

  // ── Blit PostProcess на ту же камеру: samples RTT, рисует на экран. ──
  // Pattern matches voxel-toon.ts createOutlinePostProcess: 6-arg constructor.
  const blit = new PostProcess(
    'pixel-art-blit',
    'pixelArtBlit',
    ['uSubpixel'],
    null,
    1.0,
    camera
  );

  // subpixel-offset — управляется снаружи (cam-snap)
  const subpixel = { x: 0, y: 0 };

  blit.onApplyObservable.add((effect) => {
    effect.setTexture('textureSampler', rtt);
    effect.setFloat2('uSubpixel', subpixel.x, subpixel.y);
  });

  return {
    rtt,
    blit,
    get size() { return size; },
    setSubpixelOffset(x: number, y: number) {
      subpixel.x = x;
      subpixel.y = y;
    },
    resize(eng: Engine) {
      size = computeInternalSize(eng, internalHeight, options.aspectOverride);
      rtt.resize({ width: size.width, height: size.height });
    },
    dispose() {
      blit.dispose();
      const idx = scene.customRenderTargets.indexOf(rtt);
      if (idx >= 0) scene.customRenderTargets.splice(idx, 1);
      rtt.dispose();
    }
  };
}

/**
 * Альтернативный, более лёгкий путь (для слабых GPU): setHardwareScalingLevel.
 * Не даёт «настоящей» жёсткой ступенчатости (Babylon backbuffer всегда билинейный),
 * но дёшево и приемлемо для prototyping. Возвращает callback для restore.
 */
export function applyHardwareLowres(engine: Engine, targetWidth = 640): () => void {
  const oldLevel = engine.getHardwareScalingLevel();
  const newLevel = Math.max(0.25, engine.getRenderWidth() / targetWidth);
  engine.setHardwareScalingLevel(newLevel);
  return () => engine.setHardwareScalingLevel(oldLevel);
}
