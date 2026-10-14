/**
 * Purpose-built RTS camera controller.
 *
 * Keyboard, edge, drag, minimap and zoom input all update one desired state.
 * Babylon's camera eases towards it, so inputs never fight over `target`.
 */
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { KeyboardEventTypes, type KeyboardInfo } from '@babylonjs/core/Events/keyboardEvents.js';
import { type Engine } from '@babylonjs/core/Engines/engine.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { type Observer } from '@babylonjs/core/Misc/observable.js';
import { type Scene } from '@babylonjs/core/scene.js';

export interface RtsCameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface RtsCameraOptions {
  target?: { x: number; y: number; z: number };
  panSpeed?: number;
  zoomSpeed?: number;
  minVisibleH?: number;
  maxVisibleH?: number;
  rotationStep?: number;
  enableEdgeScroll?: boolean;
  edgeScrollMargin?: number;
  bounds?: RtsCameraBounds;
  pitch?: number;
  initialYaw?: number;
  initialVisibleH?: number;
  /** Higher values settle faster. */
  motionSharpness?: number;
}

export interface RtsCameraHandle {
  camera: ArcRotateCamera;
  setEnabled(enabled: boolean): void;
  focusOn(x: number, z: number): void;
  getVisibleH(): number;
  setVisibleH(h: number): void;
  setBounds(bounds: RtsCameraBounds): void;
  reset(): void;
  dispose(): void;
}

interface PlanarBasis {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

export function rtsCameraBasis(yaw: number): PlanarBasis {
  return {
    forwardX: Math.sin(yaw),
    forwardZ: Math.cos(yaw),
    rightX: Math.cos(yaw),
    rightZ: -Math.sin(yaw)
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function damp(current: number, target: number, sharpness: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-sharpness * dt));
}

function shortestAngle(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function attachRtsCamera(
  scene: Scene,
  camera: ArcRotateCamera,
  engine: Engine,
  options: RtsCameraOptions = {}
): RtsCameraHandle {
  const canvas = engine.getRenderingCanvas() as HTMLCanvasElement | null;
  const panSpeed = options.panSpeed ?? 20;
  const zoomSpeed = options.zoomSpeed ?? 0.12;
  const minVisibleH = options.minVisibleH ?? 8;
  const maxVisibleH = options.maxVisibleH ?? 72;
  const rotationStep = options.rotationStep ?? Math.PI / 4;
  const edgeScroll = options.enableEdgeScroll ?? true;
  const edgeMargin = options.edgeScrollMargin ?? 28;
  const sharpness = options.motionSharpness ?? 13;
  const pitch = options.pitch ?? Math.PI / 4.4;
  let bounds: RtsCameraBounds = { ...(options.bounds ?? { minX: -50, maxX: 50, minZ: -50, maxZ: 50 }) };
  let enabled = true;
  let pointerInside = false;
  let pointerX = 0;
  let pointerY = 0;
  let dragging = false;
  let dragPointerId = -1;
  let dragLastX = 0;
  let dragLastY = 0;

  const initial = options.target ?? { x: 0, y: 0, z: 0 };
  const initialTarget = new Vector3(initial.x, initial.y, initial.z);
  const desiredTarget = new Vector3(initial.x, initial.y, initial.z);
  let desiredVisibleH = clamp(options.initialVisibleH ?? 20, minVisibleH, maxVisibleH);
  let visibleH = desiredVisibleH;
  let desiredYaw = options.initialYaw ?? -Math.PI / 4;

  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  camera.alpha = desiredYaw;
  camera.beta = pitch;
  camera.target.copyFrom(desiredTarget);
  camera.inertia = 0;
  try { camera.inputs.clear(); } catch { /* custom listeners below own all input */ }

  const keys = new Set<string>();
  const disposers: Array<() => void> = [];

  const clampTarget = (): void => {
    desiredTarget.x = clamp(desiredTarget.x, bounds.minX, bounds.maxX);
    desiredTarget.z = clamp(desiredTarget.z, bounds.minZ, bounds.maxZ);
  };

  const updateOrtho = (): void => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const halfH = visibleH * 0.5;
    const halfW = halfH * aspect;
    camera.orthoLeft = -halfW;
    camera.orthoRight = halfW;
    camera.orthoTop = halfH;
    camera.orthoBottom = -halfH;
  };
  updateOrtho();

  const onKeyboard = (info: KeyboardInfo): void => {
    const event = info.event as KeyboardEvent;
    if (!enabled) return;
    if (info.type === KeyboardEventTypes.KEYDOWN) {
      keys.add(event.code);
      if (!event.repeat && event.code === 'KeyQ') desiredYaw -= rotationStep;
      if (!event.repeat && event.code === 'KeyE') desiredYaw += rotationStep;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
        event.preventDefault();
      }
    } else if (info.type === KeyboardEventTypes.KEYUP) {
      keys.delete(event.code);
    }
  };
  const keyboardObserver = scene.onKeyboardObservable.add(onKeyboard) as Observer<KeyboardInfo>;

  const cursorNdc = (): { x: number; y: number } => {
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: clamp(((pointerX - rect.left) / Math.max(1, rect.width)) * 2 - 1, -1, 1),
      y: clamp(((pointerY - rect.top) / Math.max(1, rect.height)) * 2 - 1, -1, 1)
    };
  };

  const zoomAtPointer = (event: WheelEvent): void => {
    if (!enabled) return;
    event.preventDefault();
    const oldH = desiredVisibleH;
    desiredVisibleH = clamp(oldH * Math.exp(event.deltaY * zoomSpeed * 0.01), minVisibleH, maxVisibleH);
    if (!pointerInside || oldH === desiredVisibleH) return;

    const ndc = cursorNdc();
    const basis = rtsCameraBasis(desiredYaw);
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const scaleDelta = (oldH - desiredVisibleH) * 0.5;
    const verticalCompensation = 1 / Math.max(0.55, Math.sin(pitch));
    desiredTarget.x += basis.rightX * ndc.x * scaleDelta * aspect + basis.forwardX * -ndc.y * scaleDelta * verticalCompensation;
    desiredTarget.z += basis.rightZ * ndc.x * scaleDelta * aspect + basis.forwardZ * -ndc.y * scaleDelta * verticalCompensation;
    clampTarget();
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointerInside = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!enabled || !dragging || event.pointerId !== dragPointerId || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    dragLastX = event.clientX;
    dragLastY = event.clientY;
    const basis = rtsCameraBasis(desiredYaw);
    const worldPerPixel = desiredVisibleH / Math.max(1, rect.height);
    const verticalCompensation = 1 / Math.max(0.55, Math.sin(pitch));
    desiredTarget.x -= basis.rightX * dx * worldPerPixel;
    desiredTarget.z -= basis.rightZ * dx * worldPerPixel;
    desiredTarget.x += basis.forwardX * dy * worldPerPixel * verticalCompensation;
    desiredTarget.z += basis.forwardZ * dy * worldPerPixel * verticalCompensation;
    clampTarget();
    event.preventDefault();
  };

  const stopDrag = (event?: PointerEvent): void => {
    if (event && dragPointerId >= 0 && event.pointerId !== dragPointerId) return;
    if (canvas && dragPointerId >= 0 && canvas.hasPointerCapture(dragPointerId)) canvas.releasePointerCapture(dragPointerId);
    dragging = false;
    dragPointerId = -1;
  };

  if (canvas) {
    const onEnter = (): void => { pointerInside = true; };
    const onLeave = (): void => { pointerInside = false; stopDrag(); };
    const onDown = (event: PointerEvent): void => {
      if (!enabled || (event.button !== 1 && !(event.button === 0 && event.altKey))) return;
      dragging = true;
      dragPointerId = event.pointerId;
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
    };
    const onUp = (event: PointerEvent): void => stopDrag(event);
    const onWindowBlur = (): void => { keys.clear(); stopDrag(); };
    canvas.addEventListener('pointerenter', onEnter);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', zoomAtPointer, { passive: false });
    window.addEventListener('blur', onWindowBlur);
    disposers.push(() => {
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', zoomAtPointer);
      window.removeEventListener('blur', onWindowBlur);
    });
  }

  const beforeRenderObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    if (enabled) {
      const basis = rtsCameraBasis(desiredYaw);
      let right = 0;
      let forward = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) right += 1;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) right -= 1;

      if (edgeScroll && pointerInside && canvas && !dragging) {
        const rect = canvas.getBoundingClientRect();
        const x = pointerX - rect.left;
        const y = pointerY - rect.top;
        if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
          if (x < edgeMargin) right -= 1 - x / edgeMargin;
          if (x > rect.width - edgeMargin) right += 1 - (rect.width - x) / edgeMargin;
          if (y < edgeMargin) forward += 1 - y / edgeMargin;
          if (y > rect.height - edgeMargin) forward -= 1 - (rect.height - y) / edgeMargin;
        }
      }

      const length = Math.hypot(right, forward);
      if (length > 0) {
        const zoomFactor = clamp(desiredVisibleH / 20, 0.65, 2.4);
        const distance = panSpeed * zoomFactor * dt / Math.max(1, length);
        desiredTarget.x += (basis.rightX * right + basis.forwardX * forward) * distance;
        desiredTarget.z += (basis.rightZ * right + basis.forwardZ * forward) * distance;
        clampTarget();
      }
    }

    visibleH = damp(visibleH, desiredVisibleH, sharpness, dt);
    camera.alpha += shortestAngle(camera.alpha, desiredYaw) * (1 - Math.exp(-sharpness * dt));
    camera.beta = pitch;
    camera.target.set(
      damp(camera.target.x, desiredTarget.x, sharpness, dt),
      damp(camera.target.y, desiredTarget.y, sharpness, dt),
      damp(camera.target.z, desiredTarget.z, sharpness, dt)
    );
    updateOrtho();
  });

  const resizeObserver = engine.onResizeObservable.add(updateOrtho);

  return {
    camera,
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) { keys.clear(); stopDrag(); }
    },
    focusOn(x: number, z: number) {
      desiredTarget.x = x;
      desiredTarget.z = z;
      clampTarget();
    },
    getVisibleH: () => desiredVisibleH,
    setVisibleH(h: number) { desiredVisibleH = clamp(h, minVisibleH, maxVisibleH); },
    setBounds(next: RtsCameraBounds) { bounds = { ...next }; clampTarget(); },
    reset() {
      desiredTarget.copyFrom(initialTarget);
      desiredVisibleH = clamp(options.initialVisibleH ?? 20, minVisibleH, maxVisibleH);
      desiredYaw = options.initialYaw ?? -Math.PI / 4;
      clampTarget();
    },
    dispose() {
      scene.onKeyboardObservable.remove(keyboardObserver);
      scene.onBeforeRenderObservable.remove(beforeRenderObserver);
      engine.onResizeObservable.remove(resizeObserver);
      for (const dispose of disposers.splice(0)) dispose();
      keys.clear();
    }
  };
}

export { ArcRotateCamera };
