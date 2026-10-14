export type RGB = [number, number, number];

export interface Voxel {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  color: RGB;
  /** Surface material identity; 0 is the default opaque material. */
  material?: number;
}

export interface VoxelMeshOptions {
  /** Name of the mesh. */
  name: string;
  /** Preserve grid coordinates when false; defaults to the legacy height-1 normalization. */
  normalize?: boolean;
  /** Emissive accent for the material (eyes/fire/magic). */
  emissive?: RGB;
  /** Emissive multiplier (0 = no glow, 0.25 = visible). */
  emissiveStrength?: number;
  /** Material alpha. */
  alpha?: number;
  /** Suppress specular (matte stone/bone). */
  matte?: boolean;
  /** Flat mode: no baked AO and no jitter, only 3-tier face tint. */
  flat?: boolean;
  /** Meshing strategy. 'naive' = CreateBox per voxel + MergeMeshes.
   *  'greedy' = multi-attribute greedy meshing. */
  meshing?: 'naive' | 'greedy';
}

export const GREEDY_VOXEL_THRESHOLD = 80;

export interface GreedyGeometry {
  positions: number[];
  indices: number[];
  colors: number[];   // RGBA per vertex (baked tint*ao)
  /** Optional material id per quad, in emission order (six indices per quad). */
  materialIds?: number[];
  normals: number[];  // face normal per vertex
}

/**
 * Validate that a GreedyGeometry's vertex color buffer has the expected format:
 * - Length is a multiple of 16 (4 vertices × 4 RGBA components)
 * - No NaN values
 * - All alpha values are in [0, 1]
 *
 * Returns an array of warning strings (empty = valid).
 */
export function validateVertexColors(geo: GreedyGeometry): string[] {
  const warnings: string[] = [];
  if (geo.colors.length % 16 !== 0) {
    warnings.push(`colors length ${geo.colors.length} is not a multiple of 16 (expected 4*RGBA per quad)`);
  }
  if (geo.colors.length !== geo.positions.length / 3 * 4) {
    warnings.push(`colors length ${geo.colors.length} != positions/3*4 = ${geo.positions.length / 3 * 4}`);
  }
  for (let i = 0; i < geo.colors.length; i++) {
    if (Number.isNaN(geo.colors[i]!)) {
      warnings.push(`NaN at colors[${i}]`);
      break; // one NaN warning is enough
    }
  }
  for (let v = 0; v < geo.colors.length / 4; v++) {
    const a = geo.colors[v * 4 + 3]!;
    if (a < 0 || a > 1) {
      warnings.push(`alpha out of range at vertex ${v}: ${a}`);
    }
  }
  return warnings;
}

/**
 * Extract a flat RGBA tuple for a specific quad vertex from a GreedyGeometry.
 * Quad index = quadIdx (0-based), vertex = 0..3 (CCW from bottom-left).
 */
export function getQuadVertexColor(geo: GreedyGeometry, quadIdx: number, vertex: number): [number, number, number, number] {
  const base = (quadIdx * 4 + vertex) * 4;
  return [
    geo.colors[base]!,
    geo.colors[base + 1]!,
    geo.colors[base + 2]!,
    geo.colors[base + 3]!,
  ];
}
