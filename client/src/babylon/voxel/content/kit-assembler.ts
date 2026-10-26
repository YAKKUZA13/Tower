/**
 * Procedural kit-assembler (Phase P4, research §7).
 *
 * assembleCharacter(seed): slot-random assembly of variant CharacterDef from part
 * library (parts-library). Seeded mulberry32 (as in sim — for consistency) →
 * deterministic: same seed → byte-identical voxels. Level 1 (slot-random) +
 * Level 2 (constraints-grammar): weapon=staff → accessory=cape; head=helmet →
 * no horns. Mirrored L/R pairs taken from single choice + mirrorX.
 *
 * Hierarchy/pivots — standard humanoid skeleton (like skeletonRigged) → walk-cycle
 * from P0 works on any assembly unchanged. All colors — via archetypeTheme
 * (palette-discipline, research §15.2B).
 */
import { box3 } from '@voxkera/voxel-core';
import type { Voxel } from '@voxkera/voxel-core';
import { PALETTE, shade } from './dark-palette.js';
import type { RGB } from './dark-palette.js';
import type { CharacterDef, PartNode } from '@voxkera/voxel-core';
import {
  SLOT_CATALOG,
  archetypeTheme,
  mirrorX,
  type Archetype,
  type ThemeColors
} from './parts-library.js';

/** mulberry32 PRNG (replica sim/rng.ts — determinism-consistency, without cross-coupling). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AssembleOptions {
  archetype?: Archetype;
}

/**
 * assembleCharacter: seeded slot-random assembly of variant character.
 * @param seed deterministic seed (same seed → identical voxels)
 */
export function assembleCharacter(seed: number, options?: AssembleOptions): CharacterDef {
  const rng = mulberry32(seed);
  const archetype = options?.archetype ?? pickArchetype(rng);
  const theme = archetypeTheme(archetype);
  // light hue-variation of theme (per-character diversity within archetype)
  const themed: ThemeColors = varyTheme(theme, rng());

  // ── variant selection by slots ──
  const headIdx = pickIndex(rng, SLOT_CATALOG.head.length);
  const torsoIdx = pickIndex(rng, SLOT_CATALOG.torso.length);
  const armIdx = pickIndex(rng, SLOT_CATALOG.upperArm.length);
  const foreIdx = pickIndex(rng, SLOT_CATALOG.forearm.length);
  const thighIdx = pickIndex(rng, SLOT_CATALOG.thigh.length);
  const shinIdx = pickIndex(rng, SLOT_CATALOG.shin.length);
  const weaponIdx = pickIndex(rng, SLOT_CATALOG.weapon.length);

  // ── constraints-grammar (research §7.2) ──
  let accessoryIdx = pickIndex(rng, SLOT_CATALOG.accessory.length);
  const headId = SLOT_CATALOG.head[headIdx]!.id;
  const weaponId = SLOT_CATALOG.weapon[weaponIdx]!.id;
  const accessoryId = SLOT_CATALOG.accessory[accessoryIdx]!.id;
  // weapon=staff → mage → cape (no horns); head=helmet → no horns (won't fit)
  if (weaponId === 'staff' && accessoryId !== 'cape') accessoryIdx = indexOf(SLOT_CATALOG.accessory, 'cape');
  if (headId === 'skullHelmet' && SLOT_CATALOG.accessory[accessoryIdx]!.id === 'horns') {
    accessoryIdx = indexOf(SLOT_CATALOG.accessory, 'none');
  }

  // ── part assembly ──
  const head = SLOT_CATALOG.head[headIdx]!.build(themed);
  const torso = SLOT_CATALOG.torso[torsoIdx]!.build(themed);
  const hips = buildHips(themed);
  // arms/legs: L from chosen variant (side='L'), R = mirrorX of same variant (side='R')
  const upperArmL = SLOT_CATALOG.upperArm[armIdx]!.build(themed, 'L');
  const upperArmR = SLOT_CATALOG.upperArm[armIdx]!.build(themed, 'R');
  const forearmL = SLOT_CATALOG.forearm[foreIdx]!.build(themed, 'L');
  const forearmR = SLOT_CATALOG.forearm[foreIdx]!.build(themed, 'R');
  const thighL = SLOT_CATALOG.thigh[thighIdx]!.build(themed, 'L');
  const thighR = SLOT_CATALOG.thigh[thighIdx]!.build(themed, 'R');
  const shinL = SLOT_CATALOG.shin[shinIdx]!.build(themed, 'L');
  const shinR = SLOT_CATALOG.shin[shinIdx]!.build(themed, 'R');
  const weapon = SLOT_CATALOG.weapon[weaponIdx]!.build(themed);
  // accessory attaches to head (horns) or spine (cape)
  const accessory = SLOT_CATALOG.accessory[accessoryIdx]!.build(themed);
  const accId = SLOT_CATALOG.accessory[accessoryIdx]!.id;
  if (accId === 'horns') head.push(...accessory);
  if (accId === 'cape') torso.push(...accessory);

  // weapon in right forearm
  forearmR.push(...weapon);

  // ── standard humanoid skeleton (pivots like skeletonRigged) ──
  const hipsNode: PartNode = { name: 'hips', pivot: [0, 9, 0], voxels: hips, children: [] };
  const spine: PartNode = { name: 'spine', pivot: [0, 11, 0], voxels: torso, children: [] };
  const headNode: PartNode = { name: 'head', pivot: [0, 15, 0], voxels: head, children: [] };
  const upperArmL_: PartNode = { name: 'upperArmL', pivot: [-2, 13, 0], voxels: upperArmL, children: [] };
  const forearmL_: PartNode = { name: 'forearmL', pivot: [-2, 9, 0], voxels: forearmL, children: [] };
  const upperArmR_: PartNode = { name: 'upperArmR', pivot: [2, 13, 0], voxels: upperArmR, children: [] };
  const forearmR_: PartNode = { name: 'forearmR', pivot: [2, 9, 0], voxels: forearmR, children: [] };
  const thighL_: PartNode = { name: 'thighL', pivot: [-1, 8, 0], voxels: thighL, children: [] };
  const shinL_: PartNode = { name: 'shinL', pivot: [-1, 6, 0], voxels: shinL, children: [] };
  const thighR_: PartNode = { name: 'thighR', pivot: [1, 8, 0], voxels: thighR, children: [] };
  const shinR_: PartNode = { name: 'shinR', pivot: [1, 6, 0], voxels: shinR, children: [] };

  hipsNode.children.push(spine);
  spine.children.push(headNode, upperArmL_, upperArmR_);
  upperArmL_.children.push(forearmL_);
  upperArmR_.children.push(forearmR_);
  hipsNode.children.push(thighL_, thighR_);
  thighL_.children.push(shinL_);
  thighR_.children.push(shinR_);

  void mirrorX; // mirrorX not needed: variants build with side='L'/'R' directly

  return { name: `procedural-${archetype}-${seed}`, root: hipsNode };
}

/** assembleCrowd: count unique characters (seed+i). */
export function assembleCrowd(seed: number, count: number): CharacterDef[] {
  const out: CharacterDef[] = [];
  for (let i = 0; i < count; i++) out.push(assembleCharacter(seed + i));
  return out;
}

// ── helpers ──
function pickIndex(rng: () => number, n: number): number {
  return Math.floor(rng() * n) % n;
}
function indexOf(slot: readonly { id: string }[], id: string): number {
  const i = slot.findIndex((v) => v.id === id);
  return i < 0 ? 0 : i;
}
function pickArchetype(rng: () => number): Archetype {
  const all: Archetype[] = ['skeleton', 'zombie', 'demon', 'generic'];
  return all[Math.floor(rng() * all.length) % all.length]!;
}
/** Per-character hue/value-variation of theme (±shadows, research §15.2B). */
function varyTheme(t: ThemeColors, r: number): ThemeColors {
  const f = 0.92 + r * 0.16; // 0.92..1.08
  return {
    bone: shade(t.bone, f),
    dark: shade(t.dark, f),
    flesh: shade(t.flesh, f),
    metal: shade(t.metal, f),
    cloth: shade(t.cloth, f),
    accent: t.accent // accents not varied (magic/eyes stable)
  };
}
/** Hips — common for all archetypes. */
function buildHips(t: ThemeColors): Voxel[] {
  const v: Voxel[] = [];
  box3(v, -2, 2, 9, 10, 0, 1, t.dark);
  return v;
}

// export theme for UI/debug
export { archetypeTheme, type Archetype, type ThemeColors };
// re-export palette types for convenience
void PALETTE;
