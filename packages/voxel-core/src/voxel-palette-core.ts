/**
 * Indexed voxel palette (Phase P1, research §6.3, §15.2B).
 *
 * Single palette ≤255 colors for entire kit (like MagicaVoxel/Teardown). All variants
 * are authored against it; color is stored as an index. This:
 *  - guarantees color consistency of any assembly (P4 kit-assembler),
 *  - allows packing one palette texture for GPU (debris/shaders),
 *  - makes destruction cheap (debris inherits palette index).
 */
import { ACCENT, PALETTE, desaturate, shade } from './dark-palette.js';
import type { RGB } from './dark-palette.js';

/** Entry of canonical palette: label → base RGB (each expands to 3 variants). */
interface PaletteEntry {
  label: string;
  base: RGB;
}

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

/** Value-variation magnitude (±) for X_b/X_c (research §15.2B: 6-8%). */
const VALUE_VARIANT = 0.08;
/** Hue-shift magnitude (±deg) for X_c. */
const HUE_DEG = 4;

/** Hue shift of a color in (desaturated) RGB space (approximation ±hue°). */
function hueShift([r, g, b]: RGB, deg: number): RGB {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const nr = r * cos - g * sin * 0.3;
  const ng = r * sin * 0.3 + g * cos;
  return [
    Math.max(0, Math.min(1, nr)),
    Math.max(0, Math.min(1, ng)),
    Math.max(0, Math.min(1, b))
  ];
}

/** Canonical indexed palette (≤255): for each entry → [base, _b, _c]. */
export const INDEXED_PALETTE: RGB[] = (() => {
  const out: RGB[] = [];
  for (const e of PALETTE_ENTRIES) {
    out.push(e.base);
    out.push(shade(e.base, 1 - VALUE_VARIANT));       // X_b (darker)
    out.push(desaturate(hueShift(shade(e.base, 1 + VALUE_VARIANT), HUE_DEG), 0.2)); // X_c (lighter + hue)
  }
  return out;
})();

/** Map label → base index in INDEXED_PALETTE (3 slots: base, _b, _c). */
export const PALETTE_LABEL_BASE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  PALETTE_ENTRIES.forEach((e, i) => m.set(e.label, i * 3));
  return m;
})();

/** Max palette slots (for 256×1 texture). */
export const PALETTE_MAX = 256;

/**
 * snapToPalette: nearest-neighbor in weighted-RGB space → index (0..len-1).
 * For color consistency (debris, visual hull, import).
 */
export function snapToPalette(rgb: RGB): number {
  let best = 0;
  let bestD = Infinity;
  const wr = 0.3, wg = 0.59, wb = 0.11;
  for (let i = 0; i < INDEXED_PALETTE.length; i++) {
    const p = INDEXED_PALETTE[i]!;
    const dr = (p[0] - rgb[0]) * wr;
    const dg = (p[1] - rgb[1]) * wg;
    const db = (p[2] - rgb[2]) * wb;
    const d = dr * dr + dg * dg + db * db;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Returns RGB by palette index (out-of-bounds → black). */
export function paletteIndexToRGB(i: number): RGB {
  if (i < 0 || i >= INDEXED_PALETTE.length) return [0, 0, 0];
  return INDEXED_PALETTE[i]!;
}

/**
 * hueVariant: returns index of one of 3 variants (X / X_b / X_c) by seeded hash.
 * For procedural color variety of characters (P4 kit-assembler, shingles P-MO).
 * @param baseLabel base color label (e.g. 'stone')
 * @param seed deterministic seed (rng-value 0..1 or int)
 */
export function hueVariant(baseLabel: string, seed: number): number {
  const base = PALETTE_LABEL_BASE.get(baseLabel);
  if (base === undefined) return snapToPalette(PALETTE.stone);
  const h = Math.sin(seed * 99.13 + baseLabel.length * 7.7) * 43758.5453;
  const r = h - Math.floor(h); // [0,1)
  const variant = r < 0.5 ? 0 : r < 0.78 ? 1 : 2;
  return base + variant;
}
