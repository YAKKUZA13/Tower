/**
 * Solid voxelization: triangle mesh → solid Voxel[] (M6 D6/D8, research §12.7).
 *
 * Replaces box-approximation in gltf-parts.ts with exact conversion: arbitrary
 * triangle-mesh (glTF/Blockbench) → filled voxel volume.
 *
 * Algorithm:
 *  1. Surface voxelization: each triangle → set of voxels via
 *     triangle-AABB overlap test (Akenine-Möll, research §12.7). Marks
 *     mesh surface.
 *  2. Solid fill: for each (x,z)-column fill Y between min/max occupied
 *     surface-voxel (column fill — works for closed mostly-convex meshes
 *     like characters; for concavities gives acceptable filling).
 *
 * Pure (no Babylon/Scene) — headless-testable. Returns Voxel[] with color.
 */
import { cube } from './voxel-helpers.js';
import type { Voxel } from './types.js';
import type { RGB } from './dark-palette.js';

export interface SolidVoxelizeOptions {
  /** Voxel size in model units (smaller = higher resolution). */
 voxelSize?: number;
  /** Color of all voxels (or callback by position). */
  color?: RGB | ((x: number, y: number, z: number) => RGB);
  /** Fill interior (solid) or surface only. Default true. */
  solid?: boolean;
}

/**
 * Triangle-AABB overlap test (Akenine-Möll 2001, research §12.7).
 * true if triangle (a,b,c) intersects AABB [min,max].
 */
function triBoxOverlap(
  a: Vec3, b: Vec3, c: Vec3,
  min: Vec3, max: Vec3
): boolean {
  const center: Vec3 = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5];
  const half: Vec3 = [(max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5];

  // move triangle to AABB space (center at origin)
  const v0: Vec3 = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const v1: Vec3 = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
  const v2: Vec3 = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];

  // edge vectors
  const e0: Vec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e1: Vec3 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  const e2: Vec3 = [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]];

  // 9 axis tests (cross products edge × AABB-axis)
  if (!axisTest(e0[2], -e0[1], v0, v1, v2, half[1], half[2])) return false;
  if (!axisTest(-e0[2], e0[0], v0, v1, v2, half[0], half[2])) return false;
  if (!axisTest(e0[1], -e0[0], v0, v1, v2, half[0], half[1])) return false;
  if (!axisTest(e1[2], -e1[1], v0, v1, v2, half[1], half[2])) return false;
  if (!axisTest(-e1[2], e1[0], v0, v1, v2, half[0], half[2])) return false;
  if (!axisTest(e1[1], -e1[0], v0, v1, v2, half[0], half[1])) return false;
  if (!axisTest(e2[2], -e2[1], v0, v1, v2, half[1], half[2])) return false;
  if (!axisTest(-e2[2], e2[0], v0, v1, v2, half[0], half[2])) return false;
  if (!axisTest(e2[1], -e2[0], v0, v1, v2, half[0], half[1])) return false;

  // 3 AABB-axis overlap (separating axes X,Y,Z)
  const minmax = (p0: number, p1: number, p2: number, h: number): boolean => {
    const mn = Math.min(p0, p1, p2);
    const mx = Math.max(p0, p1, p2);
    return mn <= h && mx >= -h;
  };
  if (!minmax(v0[0], v1[0], v2[0], half[0])) return false;
  if (!minmax(v0[1], v1[1], v2[1], half[1])) return false;
  if (!minmax(v0[2], v1[2], v2[2], half[2])) return false;

  // plane-AABB overlap (triangle normal)
  const n: Vec3 = [
    e0[1] * e1[2] - e0[2] * e1[1],
    e0[2] * e1[0] - e0[0] * e1[2],
    e0[0] * e1[1] - e0[1] * e1[0]
  ];
  const r = half[0] * Math.abs(n[0]) + half[1] * Math.abs(n[1]) + half[2] * Math.abs(n[2]);
  const dist = Math.abs(n[0] * (center[0] - a[0]) + n[1] * (center[1] - a[1]) + n[2] * (center[2] - a[2]));
  return dist <= r;
}

/** Axis test helper (Akenine-Möll): projected overlap on one axis. */
function axisTest(a: number, b: number, v0: Vec3, v1: Vec3, v2: Vec3, ha: number, hb: number): boolean {
  const p0 = a * v0[0] + b * v0[1];
  const p1 = a * v1[0] + b * v1[1];
  const p2 = a * v2[0] + b * v2[1];
  const mn = Math.min(p0, p1, p2);
  const mx = Math.max(p0, p1, p2);
  const rad = ha * Math.abs(b) + hb * Math.abs(a);
  return mx >= -rad && mn <= rad;
}

type Vec3 = [number, number, number];

/**
 * Solid voxelization: positions/indices (triangle mesh) → Voxel[].
 * @param positions flat [x,y,z, x,y,z, ...]
 * @param indices triangle index triplets
 */
export function solidVoxelize(positions: number[], indices: number[], options: SolidVoxelizeOptions = {}): Voxel[] {
  const voxelSize = options.voxelSize ?? 1;
  const solid = options.solid !== false;
  const colorOpt = options.color ?? [0.7, 0.7, 0.7] as RGB;
  const colorFn = typeof colorOpt === 'function' ? colorOpt : () => colorOpt;

  if (positions.length === 0 || indices.length === 0) return [];

  // mesh bounding box
  let bmin: Vec3 = [Infinity, Infinity, Infinity];
  let bmax: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < bmin[0]) bmin[0] = x; if (y < bmin[1]) bmin[1] = y; if (z < bmin[2]) bmin[2] = z;
    if (x > bmax[0]) bmax[0] = x; if (y > bmax[1]) bmax[1] = y; if (z > bmax[2]) bmax[2] = z;
  }

  const minVx = Math.floor(bmin[0] / voxelSize);
  const minVy = Math.floor(bmin[1] / voxelSize);
  const minVz = Math.floor(bmin[2] / voxelSize);
  const maxVx = Math.floor(bmax[0] / voxelSize);
  const maxVy = Math.floor(bmax[1] / voxelSize);
  const maxVz = Math.floor(bmax[2] / voxelSize);

  // surface: Set of occupied voxels (key x,y,z in voxel-coordinates)
  const surface = new Set<number>();
  const keyOf = (x: number, y: number, z: number): number => (x - minVx) + (y - minVy) * 100000 + (z - minVz) * 10000000000;

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]! * 3, i1 = indices[t + 1]! * 3, i2 = indices[t + 2]! * 3;
    const a: Vec3 = [positions[i0]!, positions[i0 + 1]!, positions[i0 + 2]!];
    const b: Vec3 = [positions[i1]!, positions[i1 + 1]!, positions[i1 + 2]!];
    const c: Vec3 = [positions[i2]!, positions[i2 + 1]!, positions[i2 + 2]!];
    // triangle AABB in voxel-coordinates
    const tminVx = Math.floor(Math.min(a[0], b[0], c[0]) / voxelSize);
    const tmaxVx = Math.floor(Math.max(a[0], b[0], c[0]) / voxelSize);
    const tminVy = Math.floor(Math.min(a[1], b[1], c[1]) / voxelSize);
    const tmaxVy = Math.floor(Math.max(a[1], b[1], c[1]) / voxelSize);
    const tminVz = Math.floor(Math.min(a[2], b[2], c[2]) / voxelSize);
    const tmaxVz = Math.floor(Math.max(a[2], b[2], c[2]) / voxelSize);
    for (let vx = tminVx; vx <= tmaxVx; vx++) {
      for (let vy = tminVy; vy <= tmaxVy; vy++) {
        for (let vz = tminVz; vz <= tmaxVz; vz++) {
          const vmin: Vec3 = [vx * voxelSize, vy * voxelSize, vz * voxelSize];
          const vmax: Vec3 = [(vx + 1) * voxelSize, (vy + 1) * voxelSize, (vz + 1) * voxelSize];
          if (triBoxOverlap(a, b, c, vmin, vmax)) {
            surface.add(keyOf(vx, vy, vz));
          }
        }
      }
    }
  }

  // solid fill: column-fill along Y between min/max surface for each (x,z)
  const occupied = new Set<number>(surface);
  if (solid) {
    for (let vx = minVx; vx <= maxVx; vx++) {
      for (let vz = minVz; vz <= maxVz; vz++) {
        let yMin = Infinity, yMax = -Infinity;
        for (let vy = minVy; vy <= maxVy; vy++) {
          if (surface.has(keyOf(vx, vy, vz))) {
            if (vy < yMin) yMin = vy;
            if (vy > yMax) yMax = vy;
          }
        }
        if (yMin === Infinity) continue;
        for (let vy = yMin; vy <= yMax; vy++) occupied.add(keyOf(vx, vy, vz));
      }
    }
  }

  // → Voxel[] (coordinates in model units × voxelSize, centered in cell)
  const out: Voxel[] = [];
  for (const k of occupied) {
    const vx = (k % 100000) + minVx;
    const vy = (Math.floor(k / 100000) % 100000) + minVy;
    const vz = Math.floor(k / 10000000000) + minVz;
    const wx = vx * voxelSize;
    const wy = vy * voxelSize;
    const wz = vz * voxelSize;
    cube(out, Math.round(wx), Math.round(wy), Math.round(wz), colorFn(wx, wy, wz));
  }
  return out;
}
