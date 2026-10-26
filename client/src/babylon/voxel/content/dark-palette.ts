/**
 * Dark dark-fantasy voxel palette (Phase 2 task 2.4).
 * Principle (TD-MVP-PLAN.md §3.3, §4.5): desaturation 15–30%, earthy tones,
 * bloody/cold accents. No "cute" vibe.
 *
 * All colors are linear RGB 0..1 (Babylon Color3 in linear space). Materials use
 * these colors as vertex colors (per-voxel) + material.emissiveColor for overall glow.
 */
import type { RGB } from '@voxkera/voxel-core';
export type { RGB };

export {shade, desaturate} from '@voxkera/voxel-core';
import {shade, desaturate} from '@voxkera/voxel-core';
// ── Base earthy tones (desaturated) ──────────────────────────────────────────
export const PALETTE = {
  // stone / rock
  stoneDark:   desaturate([0.30, 0.30, 0.33], 0.18) as RGB,
  stone:       desaturate([0.42, 0.42, 0.46], 0.20) as RGB,
  stoneLight:  desaturate([0.55, 0.55, 0.58], 0.22) as RGB,
  // wood (rotten, dark)
  woodDark:    desaturate([0.18, 0.12, 0.07], 0.30) as RGB,
  wood:        desaturate([0.27, 0.18, 0.10], 0.30) as RGB,
  woodLight:   desaturate([0.36, 0.25, 0.14], 0.30) as RGB,
  // bone / skull
  bone:        desaturate([0.74, 0.71, 0.62], 0.35) as RGB,
  boneDark:    desaturate([0.55, 0.52, 0.45], 0.30) as RGB,
  // metal (rusty/dull)
  metalDark:   desaturate([0.16, 0.17, 0.20], 0.20) as RGB,
  metal:       desaturate([0.34, 0.35, 0.40], 0.22) as RGB,
  metalLight:  desaturate([0.52, 0.53, 0.58], 0.25) as RGB,
  // flesh/corpse (gray-green)
  flesh:       desaturate([0.36, 0.40, 0.32], 0.30) as RGB,
  fleshDark:   desaturate([0.24, 0.28, 0.22], 0.28) as RGB,
  // earth / moss
  earth:       desaturate([0.20, 0.17, 0.11], 0.30) as RGB,
  moss:        desaturate([0.20, 0.30, 0.16], 0.28) as RGB
} as const;

// ── Accents (magic / fire / blood / ice) — remain saturated ──────────────────
export const ACCENT = {
  fire:        [0.95, 0.45, 0.12] as RGB,        // fire / torch
  fireCore:    [1.00, 0.85, 0.40] as RGB,
  blood:       [0.62, 0.10, 0.10] as RGB,        // blood
  arcane:      [0.55, 0.28, 0.85] as RGB,        // magic (purple)
  arcaneCore:  [0.78, 0.55, 1.00] as RGB,
  ice:         [0.45, 0.82, 0.95] as RGB,        // ice
  iceCore:     [0.70, 0.92, 1.00] as RGB,
  soul:        [0.45, 1.00, 0.75] as RGB,        // soul/necro (teal)
  eyeRed:      [1.00, 0.18, 0.12] as RGB,        // enemy eyes
  eyeDemon:    [1.00, 0.55, 0.10] as RGB,
  gold:        [0.83, 0.66, 0.22] as RGB         // gold / runes
} as const;

/** Eye color by enemy category (for emissive accent). */
export function enemyEye(category: string): RGB {
  switch (category) {
    case 'boss': return ACCENT.eyeDemon;
    case 'tank': return ACCENT.eyeRed;
    case 'fast': return ACCENT.eyeDemon;
    default: return ACCENT.eyeRed;
  }
}

/** Base "body" color of tower by typeId. */
export function towerBase(typeId: string): RGB {
  switch (typeId) {
    case 'arrow':  return PALETTE.wood;
    case 'cannon': return PALETTE.metal;
    case 'arcane': return PALETTE.stoneDark;
    case 'ice':    return PALETTE.stone;
    default:       return PALETTE.stone;
  }
}

/** Emissive accent of tower by typeId. */
export function towerAccent(typeId: string): RGB {
  switch (typeId) {
    case 'arrow':  return ACCENT.fire;
    case 'cannon': return ACCENT.fireCore;
    case 'arcane': return ACCENT.arcaneCore;
    case 'ice':    return ACCENT.iceCore;
    default:       return ACCENT.gold;
  }
}

/** Emissive accent of relic totem by model catalogId. */
export function relicAccent(catalogId: string): RGB {
  switch (catalogId) {
    case 'relic:totem-fire':   return ACCENT.fire;
    case 'relic:totem-arcane': return ACCENT.arcane;
    case 'relic:totem-gold':   return ACCENT.gold;
    case 'relic:totem-ice':    return ACCENT.ice;
    case 'relic:totem-blood':  return ACCENT.blood;
    default:                   return ACCENT.arcane;
  }
}
