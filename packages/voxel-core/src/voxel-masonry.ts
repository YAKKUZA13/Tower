import type { RGB, Voxel } from './types.js';

/** Integer cell dimensions. Wall relief faces +Z; floor relief faces +Y. */
export interface MasonryOptions {
  width: number;
  height: number;
  depth: number;
  brickWidth?: number;
  brickHeight?: number;
  joint?: number;
  relief?: number;
  chipChance?: number;
  seed?: number;
  color?: RGB;
  colorVariation?: number;
  orientation?: 'wall' | 'floor';
  maxCells?: number;
}

// Integer mixing: results do not depend on traversal order or global RNG state.
function noise(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Running-bond masonry with recessed joints, per-stone relief and edge chips.
 * Produces unit cells for the common greedy mesher; no renderer or scene names.
 * Width/height span the face; depth bounds the backing + relief, including chips.
 * A one-cell backing closes the joints. Damage only removes the exposed layer.
 */
export function createMasonryVoxels(options: MasonryOptions): Voxel[] {
  const { width, height, depth, brickWidth = 12, brickHeight = 6, joint = 1,
    relief = Math.min(1, depth - 1), chipChance = 0.15, seed = 1, color = [0.38, 0.34, 0.29],
    colorVariation = 0.15, orientation = 'wall', maxCells = 250_000 } = options;
  for (const [name, value] of Object.entries({ width, height, depth, brickWidth, brickHeight, maxCells })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  }
  if (!Number.isSafeInteger(joint) || joint < 0 || joint >= Math.min(brickWidth, brickHeight)) {
    throw new Error('joint must be an integer smaller than each brick face dimension');
  }
  if (!Number.isSafeInteger(relief) || relief < 0 || relief >= depth) throw new Error('relief must be in [0, depth)');
  if (!Number.isSafeInteger(seed)) throw new Error('seed must be a safe integer');
  if (orientation !== 'wall' && orientation !== 'floor') throw new Error('invalid masonry orientation');
  for (const value of [chipChance, colorVariation, ...color]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('color and variation must be in [0, 1]');
  }
  if (color.length !== 3) throw new Error('color must have three channels');
  if (width * height * depth > maxCells) throw new Error('masonry candidate-cell budget exceeded');
  const voxels: Voxel[] = [];
  for (let v = 0; v < height; v++) {
    const row = Math.floor(v / brickHeight);
    const localV = v % brickHeight;
    const offset = (row % 2) * Math.floor(brickWidth / 2);
    for (let u = 0; u < width; u++) {
      const column = Math.floor((u + offset) / brickWidth);
      const localU = (u + offset) % brickWidth;
      const inJoint = localU < joint || localV < joint;
      const stoneDepth = Math.max(1, depth - Math.floor(noise(column, row, seed) * (relief + 1)));
      const edge = localU === joint || localU === brickWidth - 1 || localV === joint || localV === brickHeight - 1;
      const chip = edge && noise(u, v, seed ^ 0x6d2b79f5) < chipChance;
      const count = inJoint ? 1 : Math.max(1, stoneDepth - Number(chip));
      const brightness = inJoint ? 0.48 : 1 + (noise(column, row, seed ^ 0x1b873593) - 0.5) * colorVariation;
      const tint = color.map(c => Math.min(1, c * brightness)) as RGB;
      for (let w = 0; w < count; w++) {
        voxels.push({ x: u, y: orientation === 'floor' ? w : v, z: orientation === 'floor' ? v : w,
          sx: 1, sy: 1, sz: 1, color: tint });
      }
    }
  }
  return voxels;
}
