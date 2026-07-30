/**
 * Part-graph types: stiff-limb rigid-part animation types.
 * Extracted from voxel-parts.ts — zero Babylon.js dependencies.
 */
import type { Voxel } from './types.js';
import type { RGB } from './dark-palette.js';

/** A single keyframe of rigid animation (mirror of .vox nTRN per-frame _r/_t). */
export interface Keyframe {
  /** Frame time (normalized 0..1 within clip or seconds). */
  t: number;
  /** Euler rotation (rad) relative to rest-pose. */
  rot: [number, number, number];
  /** Opt. position offset relative to rest-pose. */
  pos?: [number, number, number];
}

/** A node of part-graph: one rigid body part (research §5.5). */
export interface PartNode {
  /** Joint name: 'hips' | 'spine' | 'head' | 'upperArmL' | 'forearmL' | 'thighL' | ... */
  name: string;
  /** Joint center in model unit-voxels (absolute model coordinates). */
  pivot: [number, number, number];
  /** Part voxels (in same model coordinates as pivot). */
  voxels: Voxel[];
  /** Opt. variants for shape-swap (weapon / destroyed state, research §5.3 nSHP). */
  swapVariants?: PartNode[];
  /** Opt. rigid keyframe animation (clip); renderer interpolates/plays. */
  frames?: Keyframe[];
  /** Children parts (parent link = joint-joint). */
  children: PartNode[];
}

/**
 * Animation driver type for rig (M1). Renderer selects procedural
 * animation by this field: walk-cycle (humanoid), wing flap (bat),
 * 8-leg shuffle (spider), hovering (ghost), compression/stretch (slime).
 * If not set, renderer determines by presence of walk-nodes (spine/thighL/...),
 * otherwise rig is static (no idle).
 */
export type AnimKind = 'humanoid' | 'bat' | 'spider' | 'ghost' | 'slime' | 'static';

/** Complete character definition: part-graph root + opt. indexed palette (P1). */
export interface CharacterDef {
  name: string;
  root: PartNode;
  /** Opt. indexed palette (≤255, P1) — for palette-snap/debris. */
  palette?: RGB[];
  /** Type of procedural animation (M1). */
  animKind?: AnimKind;
}

export interface AssembleRigOptions {
  /** Meshing strategy for parts (default 'greedy' — fewer tris). */
  meshing?: 'naive' | 'greedy';
  /** Emissive material accent (whole body slightly glows). */
  emissive?: RGB;
  emissiveStrength?: number;
  alpha?: number;
  matte?: boolean;
}
