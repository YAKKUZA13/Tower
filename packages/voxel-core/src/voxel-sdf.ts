/**
 * Signed Distance Fields for procedural forms (Phase P-SDF, research §12.5).
 *
 * SDF primitives (Quilez): sdBox/sdSphere/sdCapsule/sdRoundCone/sdTorus.
 * CSG EXACT: opUnion=min, opIntersection=max, opSubtraction=max(-a,b), opSmoothUnion.
 * opRep — domain repetition (free instancing, O(1)).
 * sdfToVoxels: sample φ on integer grid, threshold φ≤0 → Voxel[] (for block aesthetic).
 *
 * Usage: horns/crystals/smooth details of procedural characters (P4 kit, P-MO stamps)
 * via CSG instead of manual boxes — the cleanest path to detailed forms (research §12.5).
 */
import type { RGB } from './dark-palette.js';
import type { Voxel } from './types.js';

export type Vec3 = [number, number, number];
export type SDF = (p: Vec3) => number;
export interface BBox3 { min: Vec3; max: Vec3; }

// ── SDF primitives (Quilez, iquilezles.org) ──────────────────────────────────

/** Box of size size (half-dimensions) — sdBox with abs-folding. */
export function sdBox(p: Vec3, size: Vec3): number {
  const q: Vec3 = [Math.abs(p[0]) - size[0], Math.abs(p[1]) - size[1], Math.abs(p[2]) - size[2]];
  const outside = Math.hypot(Math.max(q[0], 0), Math.max(q[1], 0), Math.max(q[2], 0));
  const inside = Math.min(Math.max(q[0], Math.max(q[1], q[2])), 0);
  return outside + inside;
}

/** Sphere of radius r. */
export function sdSphere(p: Vec3, r: number): number {
  return Math.hypot(p[0], p[1], p[2]) - r;
}

/** Capsule: cylinder of radius r between points a and b + spheres on ends. */
export function sdCapsule(p: Vec3, a: Vec3, b: Vec3, r: number): number {
  const pa: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const ba: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const h = Math.min(1, Math.max(0, (pa[0] * ba[0] + pa[1] * ba[1] + pa[2] * ba[2]) / (ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2] + 1e-12)));
  return Math.hypot(pa[0] - ba[0] * h, pa[1] - ba[1] * h, pa[2] - ba[2] * h) - r;
}

/** Round cone: cone between two radii r1/r2 of height h (Quilez). */
export function sdRoundCone(p: Vec3, r1: number, r2: number, h: number): number {
  const qx = Math.hypot(p[0], p[2]);
  const b = (r1 - r2) / h;
  const a = Math.sqrt(1 - b * b);
  const k = b * qx + a * p[1];
  if (k < 0) return Math.hypot(qx, p[1]) - r1;
  if (k > h) return Math.hypot(qx, p[1] - h) - r2;
  return Math.sqrt(qx * qx + p[1] * p[1]) - (b * qx + a * p[1]);
}

/** Torus: radius R (center), thickness t (tube). */
export function sdTorus(p: Vec3, R: number, t: number): number {
  const qx = Math.hypot(p[0], p[2]) - R;
  return Math.hypot(qx, p[1]) - t;
}

// ── CSG operations (EXACT, research §12.5) ───────────────────────────────────

/** Union A ∪ B = min(a, b). */
export function opUnion(a: number, b: number): number { return Math.min(a, b); }
/** Intersection A ∩ B = max(a, b). */
export function opIntersection(a: number, b: number): number { return Math.max(a, b); }
/** Subtraction A \ B = max(-b, a) (Quilez convention; research §12.5). */
export function opSubtraction(a: number, b: number): number { return Math.max(-b, a); }
/** Smooth union (research §12.5): smin(a,b,k) = min(a,b) - max(k-|a-b|,0)²/(4k). */
export function opSmoothUnion(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/**
 * opRep — domain repetition (free instancing, O(1), research §12.5).
 * Repeats SDF on spacing grid. Returns new SDF.
 */
export function opRep(sdf: SDF, spacing: Vec3): SDF {
  const mod = (x: number, n: number): number => {
    const half = n * 0.5;
    return ((x + half) % n + n) % n - half;
  };
  return (p: Vec3): number => sdf([mod(p[0], spacing[0]), mod(p[1], spacing[1]), mod(p[2], spacing[2])]);
}

// ── sdfToVoxels: SDF → Voxel[] ───────────────────────────────────────────────

/**
 * Samples SDF on integer grid in bounds, threshold φ≤0 → occupied.
 * @param sdf distance function
 * @param bounds AABB to sample (voxel coordinates)
 * @param color color of all voxels (or colorFn for per-voxel)
 * @param gridStep grid step (1 = every voxel; 2 = every 2 — decimation)
 */
export function sdfToVoxels(
  sdf: SDF,
  bounds: BBox3,
  color: RGB | ((p: Vec3, phi: number) => RGB),
  gridStep = 1
): Voxel[] {
  const out: Voxel[] = [];
  const isFn = typeof color === 'function';
  for (let x = Math.floor(bounds.min[0]); x <= Math.ceil(bounds.max[0]); x += gridStep) {
    for (let y = Math.floor(bounds.min[1]); y <= Math.ceil(bounds.max[1]); y += gridStep) {
      for (let z = Math.floor(bounds.min[2]); z <= Math.ceil(bounds.max[2]); z += gridStep) {
        const p: Vec3 = [x, y, z];
        const phi = sdf(p);
        if (phi <= 0) {
          const c = isFn ? (color as (p: Vec3, phi: number) => RGB)(p, phi) : color;
          out.push({ x, y, z, sx: 1, sy: 1, sz: 1, color: c });
        }
      }
    }
  }
  return out;
}

// ── combinator-helpers (curried SDF for convenience) ─────────────────────────

/** Union of two SDFs. */
export function unionSdf(a: SDF, b: SDF): SDF {
  return (p) => opUnion(a(p), b(p));
}
/** Subtraction: a \ b. */
export function subtractSdf(a: SDF, b: SDF): SDF {
  return (p) => opSubtraction(a(p), b(p));
}
/** Smooth union of two SDFs. */
export function smoothUnionSdf(a: SDF, b: SDF, k: number): SDF {
  return (p) => opSmoothUnion(a(p), b(p), k);
}
