/**
 * M8.R / R9 — Trees (poisson-disk leaf billboards).
 * Источник: David Holland «3D Pixel Art» §trees; Acerola shell-texturing.
 *
 * Trunk = mesh; leaves = billboards по canopy-mesh через **poisson-disk sampling**
 * (CPU, build-time). Leaf-shader = grass-shader (Bramwell base-position hack).
 *
 * Build-time ассет-bake: этот скрипт генерирует placement-array (leaf world-positions
 * на canopy) и сохраняет в ассет. Рантайм-рендер использует grass.ts shader.
 *
 * Зависимости: poissonDiskPlacement из grass.ts (переиспользуем для leaf placement
 * на canopy polygon surfaces).
 */
import type { Triangle } from './types.js';

/**
 * Fast Adaptive Blue Noise on Polygonal Surfaces (Brian Curless, упрощённо):
 * poisson-disk на треугольниках canopy-mesh, взвешенный по area.
 * Детерминированный (seeded rng).
 */
export function poissonLeavesOnMesh(
  triangles: Triangle[],
  density: number,           // leaves per unit-area
  rng: () => number
): Array<{ pos: [number, number, number]; normal: [number, number, number]; scale: number; rotY: number }> {
  // 1. total area + per-triangle CDF
  const areas: number[] = [];
  let totalArea = 0;
  for (const tri of triangles) {
    // |cross(b-a, c-a)| / 2
    const ax = tri.b[0] - tri.a[0], ay = tri.b[1] - tri.a[1], az = tri.b[2] - tri.a[2];
    const bx = tri.c[0] - tri.a[0], by = tri.c[1] - tri.a[1], bz = tri.c[2] - tri.a[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area = 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
    areas.push(area);
    totalArea += area;
  }
  if (totalArea < 1e-6) return [];

  const cdf: number[] = [];
  let acc = 0;
  for (const a of areas) {
    acc += a / totalArea;
    cdf.push(acc);
  }
  // last must be exactly 1
  cdf[cdf.length - 1] = 1;

  const targetLeaves = Math.max(1, Math.round(totalArea * density));
  const points: Array<{ pos: [number, number, number]; normal: [number, number, number]; scale: number; rotY: number }> = [];

  // 2. rejection-based poisson-disk
  const minDist = Math.sqrt(1 / Math.max(1, density));
  const minDistSq = minDist * minDist;
  const maxAttempts = targetLeaves * 12;
  let attempts = 0;

  const pickTriangle = (r: number): number => {
    // binary search in cdf
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (r < cdf[mid]) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  while (points.length < targetLeaves && attempts < maxAttempts) {
    attempts++;
    const r1 = rng();
    const r2 = rng();
    const r3 = rng();
    const r4 = rng();

    const triIdx = pickTriangle(r1);
    const tri = triangles[triIdx];
    // barycentric
    const sqrtR2 = Math.sqrt(r2);
    const b1 = 1 - sqrtR2;
    const b2 = sqrtR2 * (1 - r3);
    const b3 = sqrtR2 * r3;
    const px = tri.a[0] * b1 + tri.b[0] * b2 + tri.c[0] * b3;
    const py = tri.a[1] * b1 + tri.b[1] * b2 + tri.c[1] * b3;
    const pz = tri.a[2] * b1 + tri.b[2] * b2 + tri.c[2] * b3;

    // rejection: check min-distance to existing points
    let ok = true;
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i].pos;
      const dx = p[0] - px, dy = p[1] - py, dz = p[2] - pz;
      if (dx * dx + dy * dy + dz * dz < minDistSq) { ok = false; break; }
    }
    if (!ok) continue;

    // face normal
    const ax = tri.b[0] - tri.a[0], ay = tri.b[1] - tri.a[1], az = tri.b[2] - tri.a[2];
    const bx = tri.c[0] - tri.a[0], by = tri.c[1] - tri.a[1], bz = tri.c[2] - tri.a[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const normal: [number, number, number] = [nx / nlen, ny / nlen, nz / nlen];

    points.push({
      pos: [px, py, pz],
      normal,
      scale: 0.8 + r4 * 0.5,
      rotY: rng() * Math.PI * 2
    });
  }
  return points;
}

/**
 * Build-time: bakes canopy-mesh triangles → leaf positions JSON.
 * Используется scripts/poisson-leaves.ts (CLI bake) и runtime-генератором деревьев
 * (когда canopy задаётся как triangle-array).
 */
export interface TreeCanopyAsset {
  /** Canopy triangles (a, b, c = xyz positions, world-space относительно origin дерева). */
  triangles: Triangle[];
  /** Bake: leaf placements (pos, normal, scale, rotY). */
  leaves: Array<{ pos: [number, number, number]; normal: [number, number, number]; scale: number; rotY: number }>;
}

/**
 * Convenience: bake a canopy mesh → TreeCanopyAsset (детерминированно).
 */
export function bakeTreeCanopy(
  triangles: Triangle[],
  density: number,
  rng: () => number
): TreeCanopyAsset {
  const leaves = poissonLeavesOnMesh(triangles, density, rng);
  return { triangles, leaves };
}
