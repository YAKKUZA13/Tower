import type { GreedyGeometry } from './types.js';

export interface VoxelMaterialRange {
  material: number;
  indexStart: number;
  indexCount: number;
}

/** Stable index partition for opaque surface labels. Geometry and occupancy stay shared. */
export function partitionVoxelMaterials(geometry: GreedyGeometry): { indices: number[]; ranges: VoxelMaterialRange[] } {
  const quadCount = geometry.indices.length / 6;
  if (!Number.isInteger(quadCount) || (geometry.materialIds && geometry.materialIds.length !== quadCount)) {
    throw new Error('material labels must correspond to six-index quads');
  }
  const buckets = new Map<number, number[]>();
  for (let quad = 0; quad < quadCount; quad++) {
    const id = geometry.materialIds?.[quad] ?? 0;
    if (!Number.isInteger(id) || id < 0 || id > 65535) throw new Error('invalid material id');
    let bucket = buckets.get(id);
    if (!bucket) { bucket = []; buckets.set(id, bucket); }
    for (let i = 0; i < 6; i++) bucket.push(geometry.indices[quad * 6 + i]!);
  }
  const indices: number[] = [];
  const ranges: VoxelMaterialRange[] = [];
  for (const id of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(id)!;
    ranges.push({ material: id, indexStart: indices.length, indexCount: bucket.length });
    for (const index of bucket) indices.push(index);
  }
  return { indices, ranges };
}
