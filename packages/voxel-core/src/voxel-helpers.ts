/**
 * Pure helper functions for voxel building: cube, box3, AO, color utilities.
 * Extracted from voxel-builder.ts — zero Babylon.js dependencies.
 */
import type { RGB, Voxel } from './types.js';

/** One unit-voxel at cell (x,y,z). */
export function cube(list: Voxel[], x: number, y: number, z: number, color: RGB): void {
  list.push({ x, y, z, sx: 1, sy: 1, sz: 1, color });
}

/** Fill integer box [x0..x1]×[y0..y1]×[z0..z1] with unit-voxels. */
export function box3(
  list: Voxel[],
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
  color: RGB
): void {
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        list.push({ x, y, z, sx: 1, sy: 1, sz: 1, color });
      }
    }
  }
}

export const FACE_TINT_TOP = 1.0;
export const FACE_TINT_SIDE = 0.6;
export const FACE_TINT_BOTTOM = 0.38;

/** AO level (0=fully occluded .. 3=open) → brightness factor. */
export const AO_FACTORS = [0.55, 0.72, 0.88, 1.0];
/** Per-cell jitter amplitude (±JITTER/2) for non-accent colors — hand-painted feel. */
export const COLOR_JITTER = 0.10;

/** Deterministic pseudo-random [0,1) from int-key (for per-cell jitter). */
export function hash01(x: number, y: number, z: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/** Emissive-like colors (bright + saturated) do NOT get face-darkening. */
export function isAccentColor([r, g, b]: RGB): boolean {
  const max = Math.max(r, g, b);
  const sat = max - Math.min(r, g, b);
  return max > 0.7 && sat > 0.25;
}

/**
 * Per-vertex AO (0FPS algorithm) for a box vertex. Given the vertex position
 * and face normal, determine the corner in the tangent plane and sample 3
 * neighboring voxels. Returns ao level 0..3 (0 = fully occluded, 3 = open).
 */
export function vertexAO(
  cells: Map<string, RGB>,
  cx: number, cy: number, cz: number,     // box cell center
  nx: number, ny: number, nz: number,     // face normal (±1 on one axis)
  px: number, py: number, pz: number      // vertex position (absolute)
): number {
  const mx = cx + nx, my = cy + ny, mz = cz + nz;
  const has = (x: number, y: number, z: number): boolean => cells.has(`${x},${y},${z}`);
  let s1: boolean, s2: boolean, cor: boolean;
  if (nx !== 0) {
    const dy = py > cy ? 1 : -1, dz = pz > cz ? 1 : -1;
    s1 = has(mx, my + dy, mz);
    s2 = has(mx, my, mz + dz);
    cor = has(mx, my + dy, mz + dz);
  } else if (ny !== 0) {
    const dx = px > cx ? 1 : -1, dz = pz > cz ? 1 : -1;
    s1 = has(mx + dx, my, mz);
    s2 = has(mx, my, mz + dz);
    cor = has(mx + dx, my, mz + dz);
  } else {
    const dx = px > cx ? 1 : -1, dy = py > cy ? 1 : -1;
    s1 = has(mx + dx, my, mz);
    s2 = has(mx, my + dy, mz);
    cor = has(mx + dx, my + dy, mz);
  }
  if (s1 && s2) return 0;
  return 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (cor ? 1 : 0));
}

/** Quantize RGB → 24-bit key for multi-attribute color comparison during greedy merge. */
export function colorKeyOf(rgb: RGB): number {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)));
  return (r << 16) | (g << 8) | b;
}
