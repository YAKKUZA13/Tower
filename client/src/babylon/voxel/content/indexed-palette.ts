import {createIndexedPalette, type PaletteEntry} from '@voxkera/voxel-core';
import {PALETTE, ACCENT} from './dark-palette.js';
/** Canonical base colors (from dark-palette.ts — desaturated + accents). */
const PALETTE_ENTRIES: PaletteEntry[] = [
  // stone
  { label: 'stoneDark', base: PALETTE.stoneDark },
  { label: 'stone', base: PALETTE.stone },
  { label: 'stoneLight', base: PALETTE.stoneLight },
  // wood
  { label: 'woodDark', base: PALETTE.woodDark },
  { label: 'wood', base: PALETTE.wood },
  { label: 'woodLight', base: PALETTE.woodLight },
  // bone
  { label: 'bone', base: PALETTE.bone },
  { label: 'boneDark', base: PALETTE.boneDark },
  // metal
  { label: 'metalDark', base: PALETTE.metalDark },
  { label: 'metal', base: PALETTE.metal },
  { label: 'metalLight', base: PALETTE.metalLight },
  // flesh
  { label: 'flesh', base: PALETTE.flesh },
  { label: 'fleshDark', base: PALETTE.fleshDark },
  // earth/moss
  { label: 'earth', base: PALETTE.earth },
  { label: 'moss', base: PALETTE.moss },
  // accents (saturated)
  { label: 'fire', base: ACCENT.fire },
  { label: 'fireCore', base: ACCENT.fireCore },
  { label: 'blood', base: ACCENT.blood },
  { label: 'arcane', base: ACCENT.arcane },
  { label: 'arcaneCore', base: ACCENT.arcaneCore },
  { label: 'ice', base: ACCENT.ice },
  { label: 'iceCore', base: ACCENT.iceCore },
  { label: 'soul', base: ACCENT.soul },
  { label: 'eyeRed', base: ACCENT.eyeRed },
  { label: 'eyeDemon', base: ACCENT.eyeDemon },
  { label: 'gold', base: ACCENT.gold }
];


export const {INDEXED_PALETTE, PALETTE_LABEL_BASE, snapToPalette, paletteIndexToRGB, hueVariant} = createIndexedPalette(PALETTE_ENTRIES, PALETTE.stone);
export {PALETTE_MAX} from '@voxkera/voxel-core';
