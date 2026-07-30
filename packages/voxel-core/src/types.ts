export type RGB = [number, number, number];

export interface Voxel {
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  color: RGB;
}

export interface VoxelMeshOptions {
  /** Name of the mesh. */
  name: string;
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
  normals: number[];  // face normal per vertex
}
