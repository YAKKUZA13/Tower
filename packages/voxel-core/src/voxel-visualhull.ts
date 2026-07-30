/**
 * Visual hull voxelizer (Phase P2, research §4.2).
 *
 * image(s) → Voxel[] core: for each voxel of N³-grid project its center into the 2D-pixel
 * of each camera (ortho projection along axis); if inside silhouette of ALL cameras → occupied.
 * Color — from front-view color (nearest non-background pixel). ~150 lines TS, no GPU/ML.
 *
 * Fundamental limit (research §4.2, 5 sources): visual hull = maximal shape
 * consistent with silhouettes. Does NOT recover concavities (eye sockets, armpits, under cloak).
 * Acceptable for block voxel aesthetic at 24–48³ resolution.
 *
 * Output = boolean occupancy grid + per-voxel color = exactly our Voxel{x,y,z,sx,sy,sz,color}.
 */
import type { RGB } from './dark-palette.js';
import type { Voxel } from './types.js';

/** Default voxel grid size (research §4.2: 32³ for a character). */
export const DEFAULT_GRID_N = 32;

/** One calibrated orthographic camera: silhouette + opt. color. */
export interface CameraView {
  /** Projection axis (camera looks along this axis). */
  axis: 'x' | 'y' | 'z';
  /** View direction sign (for color orientation/mirroring). */
  sign: 1 | -1;
  /** Binary silhouette mask (width*height, 1 = inside, 0 = outside). */
  silhouette: Uint8Array;
  width: number;
  height: number;
  /** Opt. RGBA buffer (width*height*4) — for voxel coloring. */
  color?: Uint8Array;
}

/** Default "neutral" color if no camera provided a color. */
const DEFAULT_COLOR: RGB = [0.42, 0.42, 0.46];

/**
 * visualHull: K orthographic silhouettes → occupancy Voxel[] (research §4.2).
 * Voxel (x,y,z) occupied iff its projection falls in silhouette of ALL cameras.
 * Color — from first camera with color buffer (usually front-view, axis='z').
 *
 * @param views cameras (minimum 2 for meaningful hull; typical 4: ±X, ±Z)
 * @param gridN grid size (default 32)
 */
export function visualHull(views: CameraView[], gridN: number = DEFAULT_GRID_N): Voxel[] {
  if (views.length === 0) return [];
  const out: Voxel[] = [];
  for (let x = 0; x < gridN; x++) {
    for (let y = 0; y < gridN; y++) {
      for (let z = 0; z < gridN; z++) {
        let color: RGB | undefined;
        let inside = true;
        for (const view of views) {
          const { u, v } = projectOrtho(view, x, y, z, gridN);
          if (u < 0 || u >= view.width || v < 0 || v >= view.height) { inside = false; break; }
          if (view.silhouette[v * view.width + u] === 0) { inside = false; break; }
          if (!color && view.color) color = readRGBA(view.color, view.width, u, v);
        }
        if (inside) {
          out.push({ x, y, z, sx: 1, sy: 1, sz: 1, color: color ?? DEFAULT_COLOR });
        }
      }
    }
  }
  return out;
}

/**
 * Projection of voxel (x,y,z) into 2D pixel (u,v) of camera (ortho along axis).
 * Tangent-axes: axis='z'→(x,y), axis='x'→(z,y), axis='y'→(x,z).
 * Sign mirrors u (for correct color orientation); does not affect occupancy.
 */
function projectOrtho(
  view: CameraView,
  x: number, y: number, z: number,
  gridN: number
): { u: number; v: number } {
  let t1: number, t2: number;
  switch (view.axis) {
    case 'z': t1 = x; t2 = y; break;
    case 'x': t1 = z; t2 = y; break;
    default: t1 = x; t2 = z; break; // 'y'
  }
  const mappedT1 = view.sign < 0 ? gridN - 1 - t1 : t1;
  const u = Math.floor((mappedT1 / gridN) * view.width);
  const v = Math.floor((t2 / gridN) * view.height);
  return { u, v };
}

/** Reads RGBA pixel → linear RGB (0..1). */
function readRGBA(color: Uint8Array, width: number, u: number, v: number): RGB {
  const o = (v * width + u) * 4;
  return [color[o]! / 255, color[o + 1]! / 255, color[o + 2]! / 255];
}

/**
 * silhouetteFromAlpha: alpha > threshold → 1 (inside silhouette).
 * For PNG with transparent background (research §4.4).
 */
export function silhouetteFromAlpha(rgba: Uint8Array, w: number, h: number, threshold = 128): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = rgba[i * 4 + 3]! > threshold ? 1 : 0;
  }
  return mask;
}

/**
 * silhouetteFromBackground: chroma-key by background color → pixel differs from background → 1.
 * bgColor = [r,g,b] in 0..255. tol — Euclidean distance threshold.
 */
export function silhouetteFromBackground(
  rgba: Uint8Array, w: number, h: number,
  bgColor: [number, number, number], tol = 30
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const tol2 = tol * tol;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const dr = rgba[o]! - bgColor[0];
    const dg = rgba[o + 1]! - bgColor[1];
    const db = rgba[o + 2]! - bgColor[2];
    mask[i] = (dr * dr + dg * dg + db * db) > tol2 ? 1 : 0;
  }
  return mask;
}

/** Occupancy bounds (for SIZE chunk .vox). */
export function occupancyBounds(voxels: Voxel[]): { x: number; y: number; z: number } {
  let mx = 0, my = 0, mz = 0;
  for (const v of voxels) {
    if (v.x + 1 > mx) mx = v.x + 1;
    if (v.y + 1 > my) my = v.y + 1;
    if (v.z + 1 > mz) mz = v.z + 1;
  }
  return { x: Math.max(1, mx), y: Math.max(1, my), z: Math.max(1, mz) };
}
