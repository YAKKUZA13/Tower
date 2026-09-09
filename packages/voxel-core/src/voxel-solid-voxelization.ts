/**
 * Solid voxelization: triangle mesh → solid Voxel[] (M6 D6/D8, research §12.7).
 *
 * Replaces box-approximation in gltf-parts.ts with conservative surface
 * voxelization plus an explicitly approximate column-based interior fill.
 *
 * Algorithm:
 *  1. Surface voxelization: each triangle → set of voxels via
 *     triangle-AABB overlap test (Akenine-Möll, research §12.7). Marks
 *     mesh surface.
 *  2. Solid fill: for each touched (x,z)-column fill Y between min/max occupied
 *     surface voxel. This is suitable for mostly Y-monotone character parts;
 *     it is not a topology-correct fill for arbitrary concave/open meshes.
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
  /** Reject accidentally huge grids before triangle iteration. */
  maxCandidateCells?: number;
}

/**
 * Triangle-AABB overlap test (Akenine-Möll 2001, research §12.7).
 * true if triangle (a,b,c) intersects AABB [min,max].
 */
export type VoxelizeVec3 = [number, number, number];

export function triangleIntersectsAabb(
  a: VoxelizeVec3, b: VoxelizeVec3, c: VoxelizeVec3,
  min: VoxelizeVec3, max: VoxelizeVec3
): boolean {
  const center: VoxelizeVec3 = [(min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5];
  const half: VoxelizeVec3 = [(max[0] - min[0]) * 0.5, (max[1] - min[1]) * 0.5, (max[2] - min[2]) * 0.5];

  // move triangle to AABB space (center at origin)
  const v0: VoxelizeVec3 = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const v1: VoxelizeVec3 = [b[0] - center[0], b[1] - center[1], b[2] - center[2]];
  const v2: VoxelizeVec3 = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];

  // A triangle and an AABB can be separated by 13 axis families: the three
  // box axes, the triangle normal, or one of 3 triangle edges x 3 box axes.
  const e0: VoxelizeVec3 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e1: VoxelizeVec3 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
  const e2: VoxelizeVec3 = [v0[0] - v2[0], v0[1] - v2[1], v0[2] - v2[2]];
  const normal: VoxelizeVec3 = [
    e0[1] * e1[2] - e0[2] * e1[1],
    e0[2] * e1[0] - e0[0] * e1[2],
    e0[0] * e1[1] - e0[1] * e1[0]
  ];
  const axes: VoxelizeVec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], normal];
  for (const edge of [e0, e1, e2]) {
    axes.push(
      [0, edge[2], -edge[1]],
      [-edge[2], 0, edge[0]],
      [edge[1], -edge[0], 0]
    );
  }
  for (const axis of axes) {
    const lengthSquared = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
    if (lengthSquared <= Number.EPSILON) continue;
    const p0 = v0[0] * axis[0] + v0[1] * axis[1] + v0[2] * axis[2];
    const p1 = v1[0] * axis[0] + v1[1] * axis[1] + v1[2] * axis[2];
    const p2 = v2[0] * axis[0] + v2[1] * axis[1] + v2[2] * axis[2];
    const radius = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
    if (Math.min(p0, p1, p2) > radius || Math.max(p0, p1, p2) < -radius) return false;
  }
  return true;
}

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

  if (!Number.isFinite(voxelSize) || voxelSize <= 0) throw new Error('voxelSize must be a positive finite number');
  if (positions.length === 0 || indices.length === 0) return [];
  if (positions.length % 3 !== 0) throw new Error('positions length must be divisible by 3');
  if (indices.length % 3 !== 0) throw new Error('indices length must be divisible by 3');
  if (positions.some((value) => !Number.isFinite(value))) throw new Error('positions must contain only finite numbers');
  const vertexCount = positions.length / 3;
  if (indices.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) {
    throw new Error('indices must reference existing vertices');
  }

  // mesh bounding box
  let bmin: VoxelizeVec3 = [Infinity, Infinity, Infinity];
  let bmax: VoxelizeVec3 = [-Infinity, -Infinity, -Infinity];
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

  const sizeX = maxVx - minVx + 1;
  const sizeY = maxVy - minVy + 1;
  const sizeZ = maxVz - minVz + 1;
  const candidateCells = sizeX * sizeY * sizeZ;
  const maxCandidateCells = options.maxCandidateCells ?? 8_000_000;
  if (!Number.isSafeInteger(candidateCells) || candidateCells > maxCandidateCells) {
    throw new Error(`voxel grid requires ${candidateCells} candidate cells; limit is ${maxCandidateCells}`);
  }

  // surface: Set of occupied voxels (key x,y,z in voxel-coordinates)
  const surface = new Set<number>();
  const slice = sizeX * sizeY;
  const keyOf = (x: number, y: number, z: number): number =>
    (x - minVx) + (y - minVy) * sizeX + (z - minVz) * slice;
  const columns = new Map<number, { x: number; z: number; minY: number; maxY: number }>();

  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t]! * 3, i1 = indices[t + 1]! * 3, i2 = indices[t + 2]! * 3;
    const a: VoxelizeVec3 = [positions[i0]!, positions[i0 + 1]!, positions[i0 + 2]!];
    const b: VoxelizeVec3 = [positions[i1]!, positions[i1 + 1]!, positions[i1 + 2]!];
    const c: VoxelizeVec3 = [positions[i2]!, positions[i2 + 1]!, positions[i2 + 2]!];
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
          const vmin: VoxelizeVec3 = [vx * voxelSize, vy * voxelSize, vz * voxelSize];
          const vmax: VoxelizeVec3 = [(vx + 1) * voxelSize, (vy + 1) * voxelSize, (vz + 1) * voxelSize];
          if (triangleIntersectsAabb(a, b, c, vmin, vmax)) {
            const key = keyOf(vx, vy, vz);
            if (!surface.has(key)) {
              surface.add(key);
              const columnKey = (vx - minVx) + (vz - minVz) * sizeX;
              const column = columns.get(columnKey);
              if (column) {
                column.minY = Math.min(column.minY, vy);
                column.maxY = Math.max(column.maxY, vy);
              } else {
                columns.set(columnKey, { x: vx, z: vz, minY: vy, maxY: vy });
              }
            }
          }
        }
      }
    }
  }

  // Solid fill only visits surface-touched columns instead of rescanning the
  // entire bounding volume. It remains a Y-column closure, not a general fill.
  const occupied = new Set<number>(surface);
  if (solid) {
    for (const column of columns.values()) {
      for (let vy = column.minY; vy <= column.maxY; vy++) occupied.add(keyOf(column.x, vy, column.z));
    }
  }

  // Voxel[] uses integer grid coordinates. voxelSize maps model space into this
  // grid; multiplying back and rounding would collapse all sub-unit cells.
  const out: Voxel[] = [];
  for (const key of [...occupied].sort((left, right) => left - right)) {
    const zOffset = Math.floor(key / slice);
    const inSlice = key - zOffset * slice;
    const yOffset = Math.floor(inSlice / sizeX);
    const xOffset = inSlice - yOffset * sizeX;
    const vx = xOffset + minVx;
    const vy = yOffset + minVy;
    const vz = zOffset + minVz;
    const wx = (vx + 0.5) * voxelSize;
    const wy = (vy + 0.5) * voxelSize;
    const wz = (vz + 0.5) * voxelSize;
    cube(out, vx, vy, vz, colorFn(wx, wy, wz));
  }
  return out;
}
