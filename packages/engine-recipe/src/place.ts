/**
 * Place algebra (порт из forge/src/recipe/v3/place.rs, research §15.2A).
 * ~400 строк чистой геометрии. FrameTable хранит world-AABB каждого resolved unit
 * (wall-frame для Beside/OnFace, roof-frame для OnTopOf). resolvePlace/resolvedFootprintBase
 * вычисляют world-позицию анкора. seatedY — origin-convention-агностик (position.y = base - bbox.min.y).
 *
 * Детерминизм: FrameTable = ordered array; get() — backward-only linear scan.
 */
import type { Align, BBox, Face, ParamMap, Place, PrimitiveRegistry } from './types.js';

/** Frame: world-AABB resolved unit. wall — для Beside/OnFace; roof — для OnTopOf. */
export interface Frame {
  wall_min: [number, number, number];
  wall_max: [number, number, number];
  roof_min: [number, number, number];
  roof_max: [number, number, number];
  faces_flipped_x: boolean;
}

export const Frame = {
  fromAabb(min: [number, number, number], max: [number, number, number]): Frame {
    return {
      wall_min: min, wall_max: max, roof_min: min, roof_max: max, faces_flipped_x: false
    };
  },
  mirroredX(f: Frame): Frame {
    return {
      wall_min: [-f.wall_max[0], f.wall_min[1], f.wall_min[2]],
      wall_max: [-f.wall_min[0], f.wall_max[1], f.wall_max[2]],
      roof_min: [-f.roof_max[0], f.roof_min[1], f.roof_min[2]],
      roof_max: [-f.roof_min[0], f.roof_max[1], f.roof_max[2]],
      faces_flipped_x: !f.faces_flipped_x
    };
  }
};

/** Ordered array of {id, Frame} — declaration order preserved. */
export class FrameTable {
  private frames: { id: string; frame: Frame; isMirror: boolean; isVolume: boolean }[] = [];
  insert(id: string, frame: Frame, isMirror = false, isVolume = false): void {
    this.frames.push({ id, frame, isMirror, isVolume });
  }
  /** Backward-only get (forward ref → undefined → caller emits UnknownRef). */
  get(id: string): { frame: Frame; isMirror: boolean } | undefined {
    for (let i = this.frames.length - 1; i >= 0; i--) {
      if (this.frames[i]!.id === id) return this.frames[i]!;
    }
    return undefined;
  }
  isMirror(id: string): boolean {
    return this.get(id)?.isMirror ?? false;
  }
  snapshot(): { id: string; frame: Frame; isVolume: boolean }[] {
    return this.frames.map((f) => ({ id: f.id, frame: f.frame, isVolume: f.isVolume }));
  }
  /** Только Volume-frames (solid buildings) — GroundRing избегает их, но НЕ props. */
  volumeSnapshot(): { id: string; frame: Frame }[] {
    return this.frames.filter((f) => f.isVolume).map((f) => ({ id: f.id, frame: f.frame }));
  }
  resolvableIds(): string[] {
    return this.frames.map((f) => f.id);
  }
}

// ── Face math ────────────────────────────────────────────────────────────────
export function faceOutwardNormal(f: Face): [number, number, number] {
  switch (f) {
    case 'South': return [0, 0, 1];
    case 'North': return [0, 0, -1];
    case 'East': return [1, 0, 0];
    case 'West': return [-1, 0, 0];
  }
}
export function faceOnFaceYaw(f: Face): number {
  switch (f) {
    case 'South': return 0;
    case 'North': return 180;
    case 'East': return 270;
    case 'West': return 90;
  }
}
export function faceMirrorX(f: Face): Face {
  if (f === 'East') return 'West';
  if (f === 'West') return 'East';
  return f; // N/S unchanged
}
export function effectiveFace(face: Face, frame: Frame): Face {
  return frame.faces_flipped_x ? faceMirrorX(face) : face;
}
/** [axisIsX, sign] — какая ось и знак у нормали. */
export function normalAxis(n: [number, number, number]): [boolean, number] {
  return Math.abs(n[0]) > 0.5 ? [true, Math.sign(n[0])] : [false, Math.sign(n[2])];
}
/** right-handed, CCW looking down +Y (EulerRot::YXZ). */
export function rotateYaw(v: [number, number, number], yawDeg: number): [number, number, number] {
  const r = (yawDeg * Math.PI) / 180;
  const s = Math.sin(r), c = Math.cos(r);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

// ── frame helpers ────────────────────────────────────────────────────────────
function wallCenterXz(f: Frame): [number, number] {
  return [(f.wall_min[0] + f.wall_max[0]) * 0.5, (f.wall_min[2] + f.wall_max[2]) * 0.5];
}
function roofCenterXz(f: Frame): [number, number] {
  return [(f.roof_min[0] + f.roof_max[0]) * 0.5, (f.roof_min[2] + f.roof_max[2]) * 0.5];
}
function roofTopY(f: Frame): number { return f.roof_max[1]; }
function wallBaseY(f: Frame): number { return f.wall_min[1]; }

function alignSlide(align: Align, f: Frame, tangentIsX: boolean): number {
  const half = tangentIsX
    ? (f.wall_max[0] - f.wall_min[0]) * 0.5
    : (f.wall_max[2] - f.wall_min[2]) * 0.5;
  return align === 'Center' ? 0 : align === 'Start' ? -half : half;
}
function alignSign(align: Align): number {
  return align === 'Start' ? -1 : align === 'End' ? 1 : 0;
}

// ── asset bbox helpers ───────────────────────────────────────────────────────
function bboxOf(asset: string, params: ParamMap, registry: PrimitiveRegistry): BBox | undefined {
  const prim = registry.primitiveFor(asset);
  return prim ? prim.boundingBox(params ?? {}) : undefined;
}

/** seatedY: position.y = baseY - bbox.min.y → bbox bottom сидит на baseY. */
export function seatedY(asset: string, params: ParamMap, registry: PrimitiveRegistry, baseY: number): number {
  const b = bboxOf(asset, params, registry);
  return baseY - (b ? b.min[1] : 0);
}

function partHalfExtentOnAxis(asset: string, params: ParamMap, registry: PrimitiveRegistry, normal: [number, number, number]): number {
  const b = bboxOf(asset, params, registry);
  if (!b) return 0;
  const [axisIsX] = normalAxis(normal);
  return axisIsX ? (b.max[0] - b.min[0]) * 0.5 : (b.max[2] - b.min[2]) * 0.5;
}
function partTangentHalf(asset: string, params: ParamMap, registry: PrimitiveRegistry, normalIsX: boolean): number {
  const b = bboxOf(asset, params, registry);
  if (!b) return 0;
  return normalIsX ? (b.max[2] - b.min[2]) * 0.5 : (b.max[0] - b.min[0]) * 0.5;
}

export interface PlaceResolveError { kind: 'UnknownRef'; id: string; valid: string[] }
export interface PlaceResolveErrorAsset { kind: 'UnknownAsset'; id: string }
export type ResolveErr = PlaceResolveError | PlaceResolveErrorAsset;

/**
 * resolvePlace — для Parts/Row-starts: world [x,y,z] анкор. Бросает ResolveErr
 * при unknown ref/asset (caller собирает в CompileError[]).
 */
export function resolvePlace(
  place: Place, asset: string, params: ParamMap,
  frames: FrameTable, registry: PrimitiveRegistry
): [number, number, number] {
  switch (place.type) {
    case 'At':
      return place.pos;

    case 'Origin':
      return [place.offset[0], seatedY(asset, params, registry, place.offset[1]), place.offset[2]];

    case 'OnTopOf': {
      const rec = mustGet(frames, place.target);
      const c = roofCenterXz(rec.frame);
      const baseY = roofTopY(rec.frame) - (place.sink ?? 0);
      return [c[0] + place.offset[0], seatedY(asset, params, registry, baseY), c[1] + place.offset[1]];
    }

    case 'Beside': {
      const rec = mustGet(frames, place.target);
      const f = rec.frame;
      const n = faceOutwardNormal(effectiveFace(place.face, f));
      const gap = place.gap ?? 0;
      const align = place.align ?? 'Center';
      const offset = place.offset ?? [0, 0];
      const half = partHalfExtentOnAxis(asset, params, registry, n);
      const baseY = wallBaseY(f) + offset[1];
      const [axisIsX, sign] = normalAxis(n);
      const c = wallCenterXz(f);
      let px: number, pz: number;
      if (axisIsX) {
        const tHalf = (f.wall_max[0] - f.wall_min[0]) * 0.5;
        px = c[0] + sign * (tHalf + gap + half);
        pz = c[1] + alignSlide(align, f, false) + offset[0];
      } else {
        const tHalf = (f.wall_max[2] - f.wall_min[2]) * 0.5;
        pz = c[1] + sign * (tHalf + gap + half);
        px = c[0] + alignSlide(align, f, true) + offset[0];
      }
      if (align !== 'Center') {
        const tan = partTangentHalf(asset, params, registry, axisIsX);
        if (axisIsX) pz -= alignSign(align) * tan; else px -= alignSign(align) * tan;
      }
      return [px, seatedY(asset, params, registry, baseY), pz];
    }

    case 'OnFace': {
      const rec = mustGet(frames, place.target);
      const f = rec.frame;
      const effFace = effectiveFace(place.face, f);
      const n = faceOutwardNormal(effFace);
      const c = wallCenterXz(f);
      const baseY = wallBaseY(f) + (place.v ?? 0);
      const [axisIsX, sign] = normalAxis(n);
      const u = place.u ?? 0;
      const out = place.out ?? 0;
      let px: number, pz: number;
      if (axisIsX) {
        const tHalf = (f.wall_max[0] - f.wall_min[0]) * 0.5;
        px = c[0] + sign * (tHalf + out);
        pz = c[1] + u;
      } else {
        const tHalf = (f.wall_max[2] - f.wall_min[2]) * 0.5;
        pz = c[1] + sign * (tHalf + out);
        px = c[0] + u;
      }
      return [px, seatedY(asset, params, registry, baseY), pz];
    }
  }
}

/**
 * resolveFootprintBase — для Volumes/Groups: base [x,y,z] (footprint center at ground),
 * где half=[halfX,halfZ] известны (без primitive bbox lookup). Beside разделяет реальные
 * footprints.
 */
export function resolveFootprintBase(
  place: Place, half: [number, number], frames: FrameTable
): [number, number, number] {
  switch (place.type) {
    case 'At': return place.pos;
    case 'Origin': return place.offset;
    case 'OnTopOf': {
      const rec = mustGet(frames, place.target);
      const c = roofCenterXz(rec.frame);
      return [c[0] + place.offset[0], roofTopY(rec.frame) - (place.sink ?? 0), c[1] + place.offset[1]];
    }
    case 'Beside': {
      const rec = mustGet(frames, place.target);
      const f = rec.frame;
      const n = faceOutwardNormal(effectiveFace(place.face, f));
      const gap = place.gap ?? 0;
      const align = place.align ?? 'Center';
      const offset = place.offset ?? [0, 0];
      const baseY = wallBaseY(f) + offset[1];
      const [axisIsX, sign] = normalAxis(n);
      const c = wallCenterXz(f);
      let px: number, pz: number;
      if (axisIsX) {
        const tHalf = (f.wall_max[0] - f.wall_min[0]) * 0.5;
        px = c[0] + sign * (tHalf + gap + half[0]);
        pz = c[1] + alignSlide(align, f, false) - alignSign(align) * half[1] + offset[0];
      } else {
        const tHalf = (f.wall_max[2] - f.wall_min[2]) * 0.5;
        pz = c[1] + sign * (tHalf + gap + half[1]);
        px = c[0] + alignSlide(align, f, true) - alignSign(align) * half[0] + offset[0];
      }
      return [px, baseY, pz];
    }
    case 'OnFace': {
      const rec = mustGet(frames, place.target);
      const f = rec.frame;
      const n = faceOutwardNormal(effectiveFace(place.face, f));
      const c = wallCenterXz(f);
      const baseY = wallBaseY(f) + (place.v ?? 0);
      const [axisIsX, sign] = normalAxis(n);
      const u = place.u ?? 0;
      const out = place.out ?? 0;
      let px: number, pz: number;
      if (axisIsX) {
        const tHalf = (f.wall_max[0] - f.wall_min[0]) * 0.5;
        px = c[0] + sign * (tHalf + out + half[0]);
        pz = c[1] + u;
      } else {
        const tHalf = (f.wall_max[2] - f.wall_min[2]) * 0.5;
        pz = c[1] + sign * (tHalf + out + half[1]);
        px = c[0] + u;
      }
      return [px, baseY, pz];
    }
  }
}

/** Throws ResolveErr-like; caller converts. */
function mustGet(frames: FrameTable, id: string): { frame: Frame; isMirror: boolean } {
  const rec = frames.get(id);
  if (!rec) {
    const e: PlaceResolveError = { kind: 'UnknownRef', id, valid: frames.resolvableIds() };
    throw e;
  }
  return rec;
}

/** Footprint [w_X, d_Z] after a 90-multiple yaw. */
export function footprintWorld(w: number, d: number, yaw: number): [number, number] {
  const q = Math.round((((yaw % 360) + 360) % 360) / 90) % 4;
  return q === 1 || q === 3 ? [d, w] : [w, d];
}

/** Group local half-extents [halfX, halfZ]: union AABB дочерних offset (повёрнутых yaw). */
export function groupLocalFootprint(
  group: { parts: { offset: [number, number, number]; asset: string; params?: ParamMap }[]; rotation_y?: number },
  registry: PrimitiveRegistry
): [number, number] {
  let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity;
  for (const child of group.parts) {
    const r = rotateYaw([child.offset[0], 0, child.offset[2]], group.rotation_y ?? 0);
    const b = bboxOf(child.asset, child.params ?? {}, registry);
    const span = b ? Math.max((b.max[0] - b.min[0]) * 0.5, (b.max[2] - b.min[2]) * 0.5) : 0;
    mnx = Math.min(mnx, r[0] - span); mxx = Math.max(mxx, r[0] + span);
    mnz = Math.min(mnz, r[2] - span); mxz = Math.max(mxz, r[2] + span);
  }
  if (!isFinite(mnx)) return [0.5, 0.5];
  return [Math.max(Math.abs(mxx), Math.abs(mnx)), Math.max(Math.abs(mxz), Math.abs(mnz))];
}

/** Frame part'а: AABB = pos + bbox (degenerate если нет primitive). */
export function partFrame(
  asset: string, params: ParamMap, pos: [number, number, number], registry: PrimitiveRegistry
): Frame {
  const b = bboxOf(asset, params, registry);
  if (!b) return Frame.fromAabb(pos, pos);
  return Frame.fromAabb(
    [pos[0] + b.min[0], pos[1] + b.min[1], pos[2] + b.min[2]],
    [pos[0] + b.max[0], pos[1] + b.max[1], pos[2] + b.max[2]]
  );
}
