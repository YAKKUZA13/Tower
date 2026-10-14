/**
 * Greedy meshing (research §12.2 — Lysenko 0fps).
 *
 * Multi-attribute greedy meshing: sweep 3 axes; for each pair of adjacent layers
 * build a 2D mask[u×v] of face keys (key = packed (colorQuant | normalSign));
 * greedy-merge the mask into maximal axis-aligned rectangles; emit quads (2 tris)
 * with vertex colors (baked per-face tint + per-vertex AO).
 */
import type { RGB, Voxel, GreedyGeometry } from './types.js';
import { FACE_TINT_TOP, FACE_TINT_SIDE, FACE_TINT_BOTTOM, AO_FACTORS, isAccentColor, colorKeyOf, vertexAO } from './voxel-helpers.js';

/**
 * Pure (no-Scene) greedy geometry: Voxel[] → {positions, indices, colors, normals}.
 *
 * Throws if any voxel has non-unit size (sx/sy/sz !== 1). The greedy algorithm
 * assumes unit cubes. Route non-unit voxels to the naive builder instead.
 */
export function computeGreedyGeometry(voxels: Voxel[], flat: boolean): GreedyGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const normals: number[] = [];
  const materialIds: number[] | undefined = voxels.some(v => v.material !== undefined) ? [] : undefined;
  const cellMaterials = new Map<string, number>();

  const cells = new Map<string, RGB>();
  for (const v of voxels) {
    // Phase 4.1: reject non-unit voxels — greedy algorithm assumes unit cubes.
    if (v.sx !== 1 || v.sy !== 1 || v.sz !== 1) {
      throw new Error(
        `computeGreedyGeometry: non-unit voxel at (${v.x},${v.y},${v.z}) ` +
        `size (${v.sx},${v.sy},${v.sz}). Use the naive builder for non-unit voxels.`
      );
    }
    if (!Number.isInteger(v.material ?? 0) || (v.material ?? 0) < 0 || (v.material ?? 0) > 65535) {
      throw new Error('voxel material id must be an integer in [0, 65535]');
    }
    const key = `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.z)}`;
    cells.set(key, v.color);
    if (materialIds) cellMaterials.set(key, v.material ?? 0);
  }
  if (cells.size === 0) return { positions, indices, colors, normals, ...(materialIds ? { materialIds } : {}) };

  const colAt = (x: number, y: number, z: number): RGB | undefined => cells.get(`${x},${y},${z}`);

  let bmin0 = Infinity, bmin1 = Infinity, bmin2 = Infinity;
  let bmax0 = -Infinity, bmax1 = -Infinity, bmax2 = -Infinity;
  for (const k of cells.keys()) {
    const p = k.split(',');
    const x = +p[0]!, y = +p[1]!, z = +p[2]!;
    if (x < bmin0) bmin0 = x; if (x > bmax0) bmax0 = x;
    if (y < bmin1) bmin1 = y; if (y > bmax1) bmax1 = y;
    if (z < bmin2) bmin2 = z; if (z > bmax2) bmax2 = z;
  }
  const boundsMin = [bmin0, bmin1, bmin2];
  const boundsMax = [bmax0, bmax1, bmax2];

  for (let axis = 0; axis < 3; axis++) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const minU = boundsMin[u]!, maxU = boundsMax[u]!;
    const minV = boundsMin[v]!, maxV = boundsMax[v]!;
    const uLen = maxU - minU + 1;
    const vLen = maxV - minV + 1;
    const mask = new Int32Array(uLen * vLen);
    const mergeable = new Uint8Array(uLen * vLen);
    const faceIds = new Map<string, number>();

    for (let d = boundsMin[axis]!; d <= boundsMax[axis]! + 1; d++) {
      for (let iu = 0; iu < uLen; iu++) {
        for (let iv = 0; iv < vLen; iv++) {
          const cu = minU + iu;
          const cv = minV + iv;
          const lo: [number, number, number] = [0, 0, 0];
          lo[axis] = d - 1; lo[u] = cu; lo[v] = cv;
          const hi: [number, number, number] = [0, 0, 0];
          hi[axis] = d; hi[u] = cu; hi[v] = cv;
          const loC = colAt(lo[0], lo[1], lo[2]);
          const hiC = colAt(hi[0], hi[1], hi[2]);
          let key = 0;
          if (!!loC !== !!hiC) {
            const sign = loC ? 1 : -1;
            const own = loC ? lo : hi;
            const color = (loC ?? hiC)!;
            const levels = faceAO(cells, own, axis, u, v, sign, flat || isAccentColor(color));
            const uniform = levels.every(level => level === levels[0]);
            const material = cellMaterials.get(`${own[0]},${own[1]},${own[2]}`) ?? 0;
            // Only constant-AO unit faces are merged. Nonconstant faces retain all
            // four samples, so no contact shadow can disappear inside a large quad.
            const signature = `${colorKeyOf(color)}:${material}:${levels[0]}`;
            let id = faceIds.get(signature);
            if (id === undefined) { id = faceIds.size + 1; faceIds.set(signature, id); }
            key = id * 2 + (sign > 0 ? 1 : 0);
            mergeable[iu * vLen + iv] = Number(uniform);
          }
          mask[iu * vLen + iv] = key;
        }
      }
      for (let n = 0; n < mask.length; n++) {
        const key = mask[n]!;
        if (key === 0) continue;
        const sign = (key & 1) === 1 ? 1 : -1;
        const iu0 = Math.floor(n / vLen);
        const iv0 = n % vLen;
        let w = 1;
        while (mergeable[n] && iv0 + w < vLen && mergeable[iu0 * vLen + iv0 + w] && mask[iu0 * vLen + iv0 + w] === key) w++;
        let h = 1;
        let canGrow = Boolean(mergeable[n]);
        while (iu0 + h < uLen && canGrow) {
          for (let k = 0; k < w; k++) {
            if (!mergeable[(iu0 + h) * vLen + iv0 + k] || mask[(iu0 + h) * vLen + iv0 + k] !== key) { canGrow = false; break; }
          }
          if (canGrow) h++;
        }
        if (materialIds) {
          const own = [0, 0, 0];
          own[axis] = sign > 0 ? d - 1 : d; own[u] = minU + iu0; own[v] = minV + iv0;
          materialIds.push(cellMaterials.get(`${own[0]},${own[1]},${own[2]}`) ?? 0);
        }
        emitGreedyQuad(
          axis, u, v, d, minU, minV, iu0, iv0, w, h, sign,
          colAt, cells, flat, positions, indices, colors, normals
        );
        for (let a = 0; a < h; a++) {
          for (let b = 0; b < w; b++) mask[(iu0 + a) * vLen + iv0 + b] = 0;
        }
      }
    }
  }
  return { positions, indices, colors, normals, ...(materialIds ? { materialIds } : {}) };
}

function emitGreedyQuad(
  axis: number, u: number, v: number, d: number,
  minU: number, minV: number, iu0: number, iv0: number, w: number, h: number,
  sign: number,
  colAt: (x: number, y: number, z: number) => RGB | undefined,
  cells: Map<string, RGB>,
  flat: boolean,
  positions: number[], indices: number[], colors: number[], normals: number[]
): void {
  const umin = minU + iu0 - 0.5;
  const umax = minU + iu0 + h - 0.5;
  const vmin = minV + iv0 - 0.5;
  const vmax = minV + iv0 + w - 0.5;
  const dAxis = d - 0.5;
  const cu = [umin, umax, umax, umin];
  const cv = [vmin, vmin, vmax, vmax];
  const ownAxis = sign > 0 ? d - 1 : d;
  const ownIU = [iu0, iu0 + h - 1, iu0 + h - 1, iu0];
  const ownIV = [iv0, iv0, iv0 + w - 1, iv0 + w - 1];
  const ownPos: [number, number, number] = [0, 0, 0];
  ownPos[axis] = ownAxis; ownPos[u] = minU + ownIU[0]!; ownPos[v] = minV + ownIV[0]!;
  const color = colAt(ownPos[0], ownPos[1], ownPos[2])!;
  const accent = isAccentColor(color);

  const baseIdx = positions.length / 3;
  const brightness: number[] = [];
  for (let c = 0; c < 4; c++) {
    const pu = cu[c]!;
    const pv = cv[c]!;
    const p: [number, number, number] = [0, 0, 0];
    p[axis] = dAxis; p[u] = pu; p[v] = pv;
    positions.push(p[0], p[1], p[2]);
    const nrm: [number, number, number] = [0, 0, 0];
    nrm[axis] = sign;
    normals.push(nrm[0], nrm[1], nrm[2]);
    let t = FACE_TINT_TOP;
    if (!accent) {
      if (axis === 1 && sign > 0) t = FACE_TINT_TOP;
      else if (axis === 1 && sign < 0) t = FACE_TINT_BOTTOM;
      else t = FACE_TINT_SIDE;
    }
    let ao = 1.0;
    if (!accent && !flat) {
      const own: [number, number, number] = [0, 0, 0];
      own[axis] = ownAxis; own[u] = minU + ownIU[c]!; own[v] = minV + ownIV[c]!;
      const level = vertexAO(cells, own[0], own[1], own[2], nrm[0], nrm[1], nrm[2], p[0], p[1], p[2]);
      ao = AO_FACTORS[level]!;
    }
    const b = t * ao;
    brightness.push(b);
    colors.push(color[0] * b, color[1] * b, color[2] * b, 1);
  }
  // Choose the diagonal from the actual interpolated brightness, not the
  // integer AO levels (the level-to-brightness curve is nonlinear).
  const corners = brightness[0]! + brightness[2]! > brightness[1]! + brightness[3]!
    ? [0, 1, 3, 1, 2, 3] : [0, 1, 2, 0, 2, 3];
  for (let triangle = 0; triangle < 6; triangle += 3) {
    const a = baseIdx + corners[triangle]!;
    const b = baseIdx + corners[triangle + 1]!;
    const c = baseIdx + corners[triangle + 2]!;
    indices.push(a, sign > 0 ? b : c, sign > 0 ? c : b);
  }
}

function faceAO(cells: Map<string, RGB>, own: number[], axis: number, u: number, v: number,
  sign: number, flat: boolean): number[] {
  if (flat) return [3, 3, 3, 3];
  const normal = [0, 0, 0]; normal[axis] = sign;
  return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([du, dv]) => {
    const p = [...own]; p[axis] += sign * 0.5; p[u] += du!; p[v] += dv!;
    return vertexAO(cells, own[0]!, own[1]!, own[2]!, normal[0]!, normal[1]!, normal[2]!, p[0]!, p[1]!, p[2]!);
  });
}
