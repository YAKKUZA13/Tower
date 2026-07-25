/**
 * M8.1 — RTS camera controls (pan WASD/edge, zoom scroll, rotate Q/E).
 * Источник: AoE/Warcraft/StarCraft RTS-camera conventions.
 *
 * Поведение:
 *  - Pan: WASD + edge-scroll (мышь у границы канваса).
 *  - Zoom: колесо мыши → ortho half-extents (zoom in/out).
 *  - Rotate: Q/E → yaw по 45° шагам (или плавно).
 *  - Camera mode: ORTHOGRAPHIC_CAMERA (из cam-snap.ts applyOrthoDimetric).
 *
 * Реализация: отдельный от ArcRotate-camera input-controller — думает в world-space
 * target + radius + yaw (а не в spherical). attachControl на canvas.
 *
 * Совместим с pixel-snap (cam-snap.ts): после движения, target снапается к
 * view-aligned texel-grid в onBeforeRender.
 */
import { ArcRotateCamera, EventConstants, KeyboardEventTypes, PointerEventTypes, type Engine, type KeyboardInfo, type Observer, type PointerInfo, type Scene, Vector3 } from 'babylonjs';

export interface RtsCameraOptions {
  /** Начальный target (центр карты). */
  target?: { x: number; y: number; z: number };
  /** Скорость панорамирования (world-units/sec) при WASD/edge. */
  panSpeed?: number;
  /** Скорость зума (half-height delta per wheel-tick). */
  zoomSpeed?: number;
  /** Min/max ortho half-height (zoom clamp). */
  minVisibleH?: number;
  maxVisibleH?: number;
  /** Шаг yaw (радиан) при Q/E. По умолчанию π/4 (45°). */
  rotationStep?: number;
  /** Активировать edge-scroll (мышь у границы). */
  enableEdgeScroll?: boolean;
  /** Толщина edge-зоны в пикселях (от края canvas). */
  edgeScrollMargin?: number;
  /** Ограничения pan по world-границам (карта). */
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Pitch (beta) в радианах. Канон iso ~30° = π/6. */
  pitch?: number;
  /** Начальный yaw (alpha). По умолчанию -π/4 (45° iso). */
  initialYaw?: number;
  /** Начальная видимая высота (ortho half-height * 2). */
  initialVisibleH?: number;
}

export interface RtsCameraHandle {
  camera: ArcRotateCamera;
  /** Включить/выключить ввод (например, при модальном UI). */
  setEnabled(enabled: boolean): void;
  /** Сфокусировать камеру на world-точке (миникарта-click). */
  focusOn(x: number, z: number): void;
  /** Получить текущую видимую высоту (для ortho frustum). */
  getVisibleH(): number;
  /** Установить видимую высоту (zoom). */
  setVisibleH(h: number): void;
  /** Обновить bounds (если карта сменилась). */
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }): void;
  dispose(): void;
}

/**
 * Создаёт RTS-camera controller, оверлей над ArcRotateCamera.
 * Подменяет стандартный attachControl на свой, который:
 *  - WASD pan в view-aligned (зависит от yaw)
 *  - mouse-wheel zoom (ortho half-height)
 *  - Q/E rotate (yaw step)
 *  - edge-scroll
 *
 * Pitch (beta) фиксирован (диметрический iso) — игрок не может наклонять камеру.
 */
export function attachRtsCamera(
  scene: Scene,
  camera: ArcRotateCamera,
  engine: Engine,
  options: RtsCameraOptions = {}
): RtsCameraHandle {
  const panSpeed = options.panSpeed ?? 18;
  const zoomSpeed = options.zoomSpeed ?? 1.5;
  const minVisibleH = options.minVisibleH ?? 6;
  const maxVisibleH = options.maxVisibleH ?? 36;
  const rotationStep = options.rotationStep ?? Math.PI / 4;
  const enableEdgeScroll = options.enableEdgeScroll ?? true;
  const edgeScrollMargin = options.edgeScrollMargin ?? 16;

  const pitch = options.pitch ?? Math.PI / 6;
  const initialYaw = options.initialYaw ?? -Math.PI / 4;
  let visibleH = options.initialVisibleH ?? 16;

  const bounds = options.bounds ?? { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };

  // Canvas для pointer-tracking. Edge-scroll должен работать ТОЛЬКО когда курсор
  // реально над канвасом (иначе scene.pointerX/Y хранят последнее положение у
  // края → камера бесконечно «уплывает» в угол, когда мышь покинула окно).
  const canvasEl = engine.getRenderingCanvas() as HTMLCanvasElement | null;

  // переводим camera в ortho
  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  camera.alpha = initialYaw;
  camera.beta = pitch;
  // ortho half-extents
  const updateOrtho = (): void => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const halfH = visibleH / 2;
    const halfW = halfH * aspect;
    camera.orthoLeft = -halfW;
    camera.orthoRight = halfW;
    camera.orthoTop = halfH;
    camera.orthoBottom = -halfH;
  };
  updateOrtho();

  // clamp target в bounds (вызывается каждый кадр).
  const clampTarget = (t: Vector3): Vector3 => new Vector3(
    Math.max(bounds.minX, Math.min(bounds.maxX, t.x)),
    t.y,
    Math.max(bounds.minZ, Math.min(bounds.maxZ, t.z))
  );

  if (options.target) {
    camera.target = clampTarget(new Vector3(options.target.x, options.target.y, options.target.z));
  }
  // disable default arc rotate input — RTS controls ниже (Q/E rotate, WASD pan, wheel zoom)
  // `clear()` снимает все встроенные input-plugins; attachControl не вызываем.
  try { (camera.inputs as { clear?: () => void; removeByType?: (t: string) => void }).clear?.(); }
  catch { /* ok — fallback: ниже всё равно свой handler */ }

  // ── keyboard state ──
  const keysDown = new Set<string>();
  let enabled = true;
  // колбэки очистки (canvas-listeners и т.п.)
  const disposables: Array<() => void> = [];

  const onKey = (info: KeyboardInfo): void => {
    if (!enabled) return;
    const ev = info.event as KeyboardEvent;
    const code = ev.code;
    if (info.type === KeyboardEventTypes.KEYDOWN) {
      keysDown.add(code);
      if (code === 'KeyQ') camera.alpha -= rotationStep;
      else if (code === 'KeyE') camera.alpha += rotationStep;
    } else if (info.type === KeyboardEventTypes.KEYUP) {
      keysDown.delete(code);
    }
  };
  const keyObs = scene.onKeyboardObservable.add(onKey) as Observer<KeyboardInfo>;

  // ── pointer for wheel-zoom ──
  const onPointer = (pi: PointerInfo): void => {
    if (!enabled) return;
    if (pi.type === PointerEventTypes.POINTERWHEEL) {
      const ev = (pi as unknown as { event: WheelEvent }).event;
      const dir = ev && typeof ev.deltaY === 'number' ? Math.sign(ev.deltaY) : 0;
      if (dir !== 0) {
        visibleH = Math.max(minVisibleH, Math.min(maxVisibleH, visibleH + dir * zoomSpeed));
        updateOrtho();
      }
    }
  };
  const ptrObs = scene.onPointerObservable.add(onPointer) as Observer<PointerInfo>;

  // ── per-frame: WASD pan + edge-scroll ──
  const dt0 = (): number => Math.min(0.05, engine.getDeltaTime() / 1000);

  // pointer-over-canvas tracking (гасит edge-scroll, когда мышь вне канваса).
  let pointerInside = false;
  let pointerClientX = 0;
  let pointerClientY = 0;
  if (canvasEl) {
    const onMove = (ev: MouseEvent): void => {
      pointerInside = true;
      pointerClientX = ev.clientX;
      pointerClientY = ev.clientY;
    };
    const onEnter = (): void => { pointerInside = true; };
    const onLeave = (): void => { pointerInside = false; };
    canvasEl.addEventListener('pointermove', onMove as EventListener);
    canvasEl.addEventListener('pointerenter', onEnter);
    canvasEl.addEventListener('pointerleave', onLeave);
    // при dispose снимаем (замыкание на эти 3 listener'а)
    disposables.push(() => {
      canvasEl.removeEventListener('pointermove', onMove as EventListener);
      canvasEl.removeEventListener('pointerenter', onEnter);
      canvasEl.removeEventListener('pointerleave', onLeave);
    });
  }

  // view-aligned forward/right (зависит от yaw)
  const viewAlignedVectors = (yaw: number): { fwdX: number; fwdZ: number; rgtX: number; rgtZ: number } => {
    // forward (camera looks down -Z when yaw=0 in iso)
    return {
      fwdX: Math.sin(yaw),
      fwdZ: Math.cos(yaw),
      rgtX: Math.cos(yaw),
      rgtZ: -Math.sin(yaw)
    };
  };

  const onBeforeRender = scene.onBeforeRenderObservable.add((): void => {
    if (!enabled) return;
    const dt = dt0();
    const v = viewAlignedVectors(camera.alpha);
    let dx = 0;
    let dz = 0;

    // keyboard WASD
    if (keysDown.has('KeyW') || keysDown.has('ArrowUp')) { dx += v.fwdX; dz += v.fwdZ; }
    if (keysDown.has('KeyS') || keysDown.has('ArrowDown')) { dx -= v.fwdX; dz -= v.fwdZ; }
    if (keysDown.has('KeyA') || keysDown.has('ArrowLeft')) { dx -= v.rgtX; dz -= v.rgtZ; }
    if (keysDown.has('KeyD') || keysDown.has('ArrowRight')) { dx += v.rgtX; dz += v.rgtZ; }

    // edge scroll — только когда курсор реально над канвасом.
    if (enableEdgeScroll && pointerInside && canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const localX = pointerClientX - rect.left;
      const localY = pointerClientY - rect.top;
      const W = rect.width;
      const H = rect.height;
      if (localX >= 0 && localX <= W && localY >= 0 && localY <= H) {
        if (localX < edgeScrollMargin) { dx -= v.rgtX; dz -= v.rgtZ; }
        else if (localX > W - edgeScrollMargin) { dx += v.rgtX; dz += v.rgtZ; }
        if (localY < edgeScrollMargin) { dx += v.fwdX; dz += v.fwdZ; }
        else if (localY > H - edgeScrollMargin) { dx -= v.fwdX; dz -= v.fwdZ; }
      }
    }

    if (dx !== 0 || dz !== 0) {
      // normalize для diagonal не быстрее straight
      const len = Math.sqrt(dx * dx + dz * dz);
      const nx = dx / len, nz = dz / len;
      const tgt = camera.target;
      const newX = Math.max(bounds.minX, Math.min(bounds.maxX, tgt.x + nx * panSpeed * dt));
      const newZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, tgt.z + nz * panSpeed * dt));
      camera.target = new Vector3(newX, tgt.y, newZ);
    }
    // Всегда держим target внутри bounds (внешние установки/фокусинг тоже clamp'ятся).
    const t = camera.target;
    if (t.x < bounds.minX || t.x > bounds.maxX || t.z < bounds.minZ || t.z > bounds.maxZ) {
      camera.target = clampTarget(t);
    }
  });

  // ── engine resize → ortho recompute ──
  const onResize = engine.onResizeObservable.add((): void => updateOrtho());

  return {
    camera,
    setEnabled(e: boolean) { enabled = e; if (!e) keysDown.clear(); },
    focusOn(x: number, z: number) {
      const tgt = camera.target;
      camera.target = clampTarget(new Vector3(x, tgt.y, z));
    },
    getVisibleH() { return visibleH; },
    setVisibleH(h: number) { visibleH = Math.max(minVisibleH, Math.min(maxVisibleH, h)); updateOrtho(); },
    setBounds(b) { bounds.minX = b.minX; bounds.maxX = b.maxX; bounds.minZ = b.minZ; bounds.maxZ = b.maxZ; },
    dispose() {
      scene.onKeyboardObservable.remove(keyObs);
      scene.onPointerObservable.remove(ptrObs);
      scene.onBeforeRenderObservable.remove(onBeforeRender);
      engine.onResizeObservable.remove(onResize);
      while (disposables.length) disposables.pop()!();
    }
  };
}

export { ArcRotateCamera, EventConstants };
