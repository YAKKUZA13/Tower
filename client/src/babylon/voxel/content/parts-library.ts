/**
 * Parts library for procedural kit-assembler (Phase P4, research §7).
 *
 * Slots: head, torso, upperArm, forearm, thigh, shin, weapon, accessory.
 * Minimum 3 variants per key slot (head/torso/weapon), ≥2 on limbs.
 * Each variant = Voxel[] in model coordinates (regions match the skeleton
 * skeletonRigged → same pivots/hierarchy, walk-cycle works unchanged).
 * Mirroring: upperArmL = mirror(upperArmR) by X (research §15.2).
 *
 * All parts — in common dark palette (via ThemeColors → dark-palette/hueVariant).
 */
import { box3, cube } from '@voxkera/voxel-core';
import type { Voxel } from '@voxkera/voxel-core';
import { ACCENT, PALETTE, shade } from './dark-palette.js';
import type { RGB } from './dark-palette.js';

/** Theme colors of archetype (palette-discipline, research §15.2B). */
export interface ThemeColors {
  bone: RGB;       // skull/bones
  dark: RGB;       // dark elements (dark bone/metal)
  flesh: RGB;      // flesh
  metal: RGB;      // metal
  cloth: RGB;      // cloth/robe
  accent: RGB;     // accent (eyes/runes)
}

export type Archetype = 'skeleton' | 'zombie' | 'demon' | 'generic';

/** Archetype palette (hue-variation via seed — in kit-assembler). */
export function archetypeTheme(archetype: Archetype): ThemeColors {
  switch (archetype) {
    case 'zombie': return { bone: PALETTE.flesh, dark: PALETTE.fleshDark, flesh: PALETTE.flesh, metal: PALETTE.metalDark, cloth: shade(PALETTE.flesh, 0.7), accent: ACCENT.eyeRed };
    case 'demon': return { bone: PALETTE.metalDark, dark: shade(ACCENT.blood, 0.55), flesh: shade(ACCENT.blood, 0.55), metal: PALETTE.metalDark, cloth: shade(PALETTE.metalDark, 0.8), accent: ACCENT.eyeDemon };
    case 'generic': return { bone: PALETTE.stoneLight, dark: PALETTE.stoneDark, flesh: PALETTE.flesh, metal: PALETTE.metal, cloth: PALETTE.woodDark, accent: ACCENT.arcane };
    default: return { bone: PALETTE.bone, dark: PALETTE.boneDark, flesh: PALETTE.bone, metal: PALETTE.metalLight, cloth: shade(PALETTE.boneDark, 0.8), accent: ACCENT.eyeRed };
  }
}

/** One part variant: id + builder (in model coordinates). side — for L/R mirroring. */
export interface PartVariant {
  id: string;
  build: (theme: ThemeColors, side?: 'L' | 'R') => Voxel[];
}

// ── HEAD (region y 15-19, x -2..2, z -1..1) ──────────────────────────────────
export const HEAD_VARIANTS: PartVariant[] = [
  {
    id: 'skullBare',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -2, 2, 15, 18, -1, 1, t.bone);
      box3(v, -1, 1, 19, 19, 0, 0, t.bone);          // crown
      cube(v, -1, 17, 1, t.accent); cube(v, 1, 17, 1, t.accent); // eye sockets
      cube(v, 0, 16, 1, t.dark);                      // nose
      box3(v, -1, 1, 14, 14, 0, 1, t.dark);           // teeth
      return v;
    }
  },
  {
    id: 'skullHelmet',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -2, 2, 15, 18, -1, 1, t.bone);
      box3(v, -2, 2, 18, 19, -1, 1, t.metal);         // helmet on top
      cube(v, 0, 19, 0, ACCENT.gold);                 // crest
      cube(v, -1, 16, 1, t.accent); cube(v, 1, 16, 1, t.accent); // eye slit
      box3(v, -1, 1, 14, 14, 0, 1, t.dark);
      return v;
    }
  },
  {
    id: 'skullHood',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -2, 2, 15, 18, -1, 1, t.bone);
      box3(v, -2, 2, 15, 19, -1, 1, t.cloth);         // hood over
      box3(v, -1, 1, 14, 16, 0, 1, t.dark);           // shadow-face
      cube(v, -1, 16, 1, t.accent); cube(v, 1, 16, 1, t.accent);
      return v;
    }
  }
];

// ── TORSO (spine+ribs, region y 11-14) ────────────────────────────────────────
export const TORSO_VARIANTS: PartVariant[] = [
  {
    id: 'ribCage',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -1, 0, 11, 14, 0, 0, t.bone);           // spine
      box3(v, -2, -1, 12, 12, 0, 0, t.bone); box3(v, 1, 2, 12, 12, 0, 0, t.bone);
      box3(v, -2, -1, 13, 13, 0, 0, t.bone); box3(v, 1, 2, 13, 13, 0, 0, t.bone);
      box3(v, -2, -2, 11, 11, 0, 0, t.bone); box3(v, 2, 3, 11, 11, 0, 0, t.bone);
      box3(v, -2, 2, 14, 14, 0, 1, t.bone);           // collar bones
      return v;
    }
  },
  {
    id: 'breastplate',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -2, 2, 11, 14, 0, 1, t.metal);          // breastplate
      box3(v, -1, 1, 12, 13, 1, 1, shade(t.metal, 1.2)); // highlight
      cube(v, 0, 11, 1, ACCENT.gold);                 // emblem
      box3(v, -2, 2, 14, 14, 0, 1, t.dark);           // pauldrons
      return v;
    }
  },
  {
    id: 'robes',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -2, 2, 11, 14, 0, 1, t.cloth);          // robe
      box3(v, -1, 1, 11, 14, 0, 0, shade(t.cloth, 0.8)); // fold
      cube(v, 0, 10, 1, t.accent);                    // rune
      return v;
    }
  }
];

// ── UPPER ARM (region y 10-13, x ∓2..∓3 — L/R mirrored) ────────────────────
export const UPPERARM_VARIANTS: PartVariant[] = [
  {
    id: 'boneArm',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x0 = side === 'L' ? -3 : 2, x1 = side === 'L' ? -2 : 3;
      box3(v, x0, x1, 10, 13, 0, 0, t.bone);
      return v;
    }
  },
  {
    id: 'armoredArm',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x0 = side === 'L' ? -3 : 2, x1 = side === 'L' ? -2 : 3;
      box3(v, x0, x1, 10, 13, 0, 0, t.metal);
      cube(v, side === 'L' ? -3 : 3, 12, 0, t.dark); // shoulder
      return v;
    }
  },
  {
    id: 'raggedArm',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x0 = side === 'L' ? -3 : 2, x1 = side === 'L' ? -2 : 3;
      box3(v, x0, x1, 10, 12, 0, 0, t.cloth);
      cube(v, x0, 13, 0, t.cloth);
      return v;
    }
  }
];

// ── FOREARM (region y 7-9, + hand y6) ───────────────────────────────────────
export const FOREARM_VARIANTS: PartVariant[] = [
  {
    id: 'boneForearm',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x0 = side === 'L' ? -3 : 2, x1 = side === 'L' ? -2 : 3;
      box3(v, x0, x1, 7, 9, 0, 0, t.bone);
      cube(v, side === 'L' ? -3 : 3, 6, 0, t.bone);   // hand
      return v;
    }
  },
  {
    id: 'armoredForearm',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x0 = side === 'L' ? -3 : 2, x1 = side === 'L' ? -2 : 3;
      box3(v, x0, x1, 7, 9, 0, 0, t.metal);
      cube(v, side === 'L' ? -3 : 3, 6, 0, t.bone);
      return v;
    }
  }
];

// ── THIGH (region y 7-8, x ∓1) ───────────────────────────────────────────────
export const THIGH_VARIANTS: PartVariant[] = [
  {
    id: 'boneThigh',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x = side === 'L' ? -1 : 1;
      box3(v, x, x, 7, 8, 0, 0, t.bone);
      return v;
    }
  },
  {
    id: 'armoredThigh',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x = side === 'L' ? -1 : 1;
      box3(v, x, x, 7, 8, 0, 0, t.metal);
      return v;
    }
  }
];

// ── SHIN (region y 2-5, + knee y6, + foot y0-1) ──────────────────────────
export const SHIN_VARIANTS: PartVariant[] = [
  {
    id: 'boneShin',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x = side === 'L' ? -1 : 1;
      box3(v, x, x, 2, 5, 0, 0, t.bone);
      cube(v, x, 6, 0, t.bone);                        // knee
      const fx = side === 'L' ? -2 : 1, fx1 = side === 'L' ? -1 : 2;
      box3(v, fx, fx1, 0, 1, 0, 1, t.bone);            // foot
      return v;
    }
  },
  {
    id: 'armoredShin',
    build: (t, side = 'L' as 'L' | 'R') => {
      const v: Voxel[] = [];
      const x = side === 'L' ? -1 : 1;
      box3(v, x, x, 2, 5, 0, 0, t.metal);
      cube(v, x, 6, 0, t.bone);
      const fx = side === 'L' ? -2 : 1, fx1 = side === 'L' ? -1 : 2;
      box3(v, fx, fx1, 0, 1, 0, 1, t.bone);
      return v;
    }
  }
];

// ── WEAPON (right hand x 3, y 6-13) ────────────────────────────────────────
export const WEAPON_VARIANTS: PartVariant[] = [
  {
    id: 'sword',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      cube(v, 3, 6, 1, PALETTE.woodDark);              // hilt
      box3(v, 3, 3, 7, 12, 1, 1, t.metal);             // blade
      cube(v, 3, 13, 1, ACCENT.gold);                  // pommel
      return v;
    }
  },
  {
    id: 'club',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, 3, 3, 6, 9, 1, 1, PALETTE.woodDark);     // shaft
      box3(v, 3, 3, 10, 13, 1, 1, t.metal);            // thick head
      cube(v, 3, 13, 1, t.metal);
      return v;
    }
  },
  {
    id: 'staff',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, 3, 3, 5, 13, 1, 1, PALETTE.woodDark);    // staff
      box3(v, 2, 4, 14, 16, 0, 2, t.accent);           // crystal
      cube(v, 3, 17, 1, t.accent);
      return v;
    }
  },
  {
    id: 'none',
    build: (_t?, _side?) => []
  }
];

// ── ACCESSORY (extra: horns/cape/none) ────────────────────────────────────────
export const ACCESSORY_VARIANTS: PartVariant[] = [
  { id: 'none', build: (_t?, _side?) => [] },
  {
    id: 'horns',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -3, -2, 18, 20, 0, 0, t.dark); box3(v, 2, 3, 18, 20, 0, 0, t.dark); // horns
      cube(v, -3, 21, 0, t.bone); cube(v, 3, 21, 0, t.bone);
      return v;
    }
  },
  {
    id: 'cape',
    build: (t, _side?) => {
      const v: Voxel[] = [];
      box3(v, -2, 2, 11, 16, -2, -2, t.cloth);         // cape behind back
      return v;
    }
  }
];

/** Mirror reflection of voxels by X (L ↔ R, research §15.2). */
export function mirrorX(voxels: Voxel[]): Voxel[] {
  return voxels.map((v) => ({ ...v, x: -v.x }));
}

/** Slot catalog for kit-assembler. */
export const SLOT_CATALOG = {
  head: HEAD_VARIANTS,
  torso: TORSO_VARIANTS,
  upperArm: UPPERARM_VARIANTS,
  forearm: FOREARM_VARIANTS,
  thigh: THIGH_VARIANTS,
  shin: SHIN_VARIANTS,
  weapon: WEAPON_VARIANTS,
  accessory: ACCESSORY_VARIANTS
} as const;

export type SlotName = keyof typeof SLOT_CATALOG;
