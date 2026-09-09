/**
 * M8.R / R2 — Ортографическая диметрическая камера + pixel-snap.
 * Источник: `Magnum-Opus/docs/llm/30_pixel_art_render.md` §camera + §pixel-snap.
 *
 * Канонический pixel-art iso:
 *  - OrthographicCamera (Babylon `Camera.ORTHOGRAPHIC_CAMERA`), pitch 30°, yaw 45°.
 *  - Pixel-snap: пози камеры снапается к view-aligned texel-grid (по internal res).
 *  - Sub-pixel остаток → uniform на blit-pass (R1) → финальный blit сдвигается в
 *    screen-space, не давая пикселям «плавать» при скролле.
 *
 * Рефы: t3ssel8r / aarthifical pixel-snap; David Holland «3D Pixel Art Rendering».
 *
 * Реализация: оборачивает существующий ArcRotateCamera (удобно для yaw/pitch
 * controls), форсируя mode=ORTHOGRAPHIC_CAMERA + ortho-полуразмеры из viewport-параметров.
 * Pixel-snap — внешний helper computePixelSnap, который клиент применяет в onBeforeRender.
 */
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { type ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { type Scene } from '@babylonjs/core/scene.js';

export interface OrthoDimetricOptions {
  /** Видимая высота в world-unit (ortho half-height * 2). По умолчанию 16. */
  visibleWorldHeight?: number;
  /** Pitch (beta) в радианах. Канон iso ~30° = π/6. */
  pitch?: number;
  /** Yaw (alpha) в радианах. Канон iso 45° = π/4 (Babylon alpha=-π/4 для ISO-вида). */
  yaw?: number;
}

export interface PixelSnapResult {
  /** Снапнутая world-позиция камеры (target). */
  snappedTarget: Vector3;
  /** Sub-pixel offset в texel-пространстве RTT (для blit uniform). */
  subpixelX: number;
  subpixelY: number;
}

/**
 * Переключает ArcRotateCamera в ортографический режим с диметрическими углами.
 * Возвращает функцию restore для отката на perspective.
 */
export function applyOrthoDimetric(
  camera: ArcRotateCamera,
  options: OrthoDimetricOptions = {}
): () => void {
  const prevMode = camera.mode;
  const prevAlpha = camera.alpha;
  const prevBeta = camera.beta;

  const pitch = options.pitch ?? Math.PI / 6;            // 30°
  const yaw = options.yaw ?? -Math.PI / 4;                // 45° (Babylon alpha)
  camera.alpha = yaw;
  camera.beta = pitch;
  camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  // ortho half-extents вычисляются в updateOrthoFrustum (зависит от canvas-aspect + zoom)
  updateOrthoFrustum(camera, options.visibleWorldHeight ?? 16);

  return () => {
    camera.mode = prevMode;
    camera.alpha = prevAlpha;
    camera.beta = prevBeta;
  };
}

/**
 * Обновляет ortho-полуразмеры камеры под текущий canvas-aspect.
 * Вызывается при resize и при zoom-изменении (visibleWorldHeight).
 */
export function updateOrthoFrustum(
  camera: ArcRotateCamera,
  visibleWorldHeight: number,
  aspectOverride?: number
): void {
  const engine = camera.getScene().getEngine();
  const aspect = aspectOverride ?? engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const halfH = visibleWorldHeight / 2;
  const halfW = halfH * aspect;
  camera.orthoLeft = -halfW;
  camera.orthoRight = halfW;
  camera.orthoTop = halfH;
  camera.orthoBottom = -halfH;
}

/**
 * Pixel-snap для ortho-камеры (t3ssel8r).
 *
 * Алгоритм:
 *  1. Берём таргет камеры в world.
 *  2. Переводим его во view-space (через view-matrix).
 *  3. Снапаем view-space X/Y к сетке пикселей внутреннего разрешения RTT.
 *     World-unit-per-pixel = (ortho height) / RTT_height.
 *  4. Обратно в world-space: это новая snappedTarget камеры.
 *  5. Sub-pixel = разница между оригинальным и снапнутым view-space пикселем.
 *
 * Возвращает snappedTarget + subpixel offset (в texel-пространстве, [-0.5..0.5]).
 * Вызывай в `scene.onBeforeRenderObservable` ПЕРЕД рендером RTT.
 */
export function computePixelSnap(
  camera: ArcRotateCamera,
  target: Vector3,
  internalHeightPx: number,
  visibleWorldHeight: number
): PixelSnapResult {
  const view = camera.getViewMatrix();
  const invView = Matrix.Invert(view);

  const worldPerPixel = visibleWorldHeight / internalHeightPx;

  const tv = Vector3.TransformCoordinates(target, view);

  const snappedX = Math.round(tv.x / worldPerPixel) * worldPerPixel;
  const snappedY = Math.round(tv.y / worldPerPixel) * worldPerPixel;

  const dxPx = (tv.x - snappedX) / worldPerPixel;
  const dyPx = (tv.y - snappedY) / worldPerPixel;

  const snappedWorld = Vector3.TransformCoordinates(
    new Vector3(snappedX, snappedY, tv.z),
    invView
  );

  return {
    snappedTarget: snappedWorld,
    subpixelX: dxPx / internalHeightPx,
    subpixelY: dyPx / internalHeightPx
  };
}

/**
 * Готовая связка: применяет ortho + регистрирует pixel-snap в scene.onBeforeRender,
 * двигая camera.target и возвращая subpixel для blit-uniform.
 *
 * `onSnap(cb)` вызывается каждый кадр с (subpixelX, subpixelY) — клиент передаёт
 * их в lowres.setSubpixelOffset.
 */
export function attachDimetricPixelSnap(
  scene: Scene,
  camera: ArcRotateCamera,
  opts: OrthoDimetricOptions & { internalHeightPx?: number } = {}
): {
  setVisibleHeight(h: number): void;
  dispose(): void;
} {
  const internalHeightPx = opts.internalHeightPx ?? 360;
  let visibleH = opts.visibleWorldHeight ?? 16;
  const restoreOrtho = applyOrthoDimetric(camera, { ...opts, visibleWorldHeight: visibleH });

  const observer = scene.onBeforeRenderObservable.add(() => {
    const tgt = camera.target;
    const r = computePixelSnap(camera, tgt, internalHeightPx, visibleH);
    camera.setTarget(r.snappedTarget, false, false, false);
  });

  return {
    setVisibleHeight(h: number) {
      visibleH = h;
      updateOrthoFrustum(camera, visibleH);
    },
    dispose() {
      scene.onBeforeRenderObservable.remove(observer);
      restoreOrtho();
    }
  };
}
