/**
 * Тёмная дарк-фэнтези палитра вокселей (Phase 2 задача 2.4).
 * Принцип (TD-MVP-PLAN.md §3.3, §4.5): десатурация 15–30%, землистые тона,
 * кровавые/холодные акценты. Никакого «милого» вайба.
 *
 * Все цвета — линейные RGB 0..1 (Babylon Color3 в linear space). Materials используют
 * эти цвета как vertex colors (per-voxel) + material.emissiveColor для общего свечения.
 */

export type RGB = [number, number, number];

/** Осветлить/затемнить RGB (factor >1 светлее, <1 темнее). */
export function shade([r, g, b]: RGB, factor: number): RGB {
  return [Math.min(1, r * factor), Math.min(1, g * factor), Math.min(1, b * factor)];
}

/** Снизить насыщенность к серому (sat=0 → чистый luma, sat=1 → без изменений). */
export function desaturate([r, g, b]: RGB, sat = 0.25): RGB {
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return [luma + (r - luma) * sat, luma + (g - luma) * sat, luma + (b - luma) * sat];
}

// ── Базовые землистые тона (десатурированные) ──────────────────────────
export const PALETTE = {
  // камень / скала
  stoneDark:   desaturate([0.30, 0.30, 0.33], 0.18) as RGB,
  stone:       desaturate([0.42, 0.42, 0.46], 0.20) as RGB,
  stoneLight:  desaturate([0.55, 0.55, 0.58], 0.22) as RGB,
  // дерево (гнилое, тёмное)
  woodDark:    desaturate([0.18, 0.12, 0.07], 0.30) as RGB,
  wood:        desaturate([0.27, 0.18, 0.10], 0.30) as RGB,
  woodLight:   desaturate([0.36, 0.25, 0.14], 0.30) as RGB,
  // кость / череп
  bone:        desaturate([0.74, 0.71, 0.62], 0.35) as RGB,
  boneDark:    desaturate([0.55, 0.52, 0.45], 0.30) as RGB,
  // металл (ржавый/тусклый)
  metalDark:   desaturate([0.16, 0.17, 0.20], 0.20) as RGB,
  metal:       desaturate([0.34, 0.35, 0.40], 0.22) as RGB,
  metalLight:  desaturate([0.52, 0.53, 0.58], 0.25) as RGB,
  // плоть/труп (серо-зелёный)
  flesh:       desaturate([0.36, 0.40, 0.32], 0.30) as RGB,
  fleshDark:   desaturate([0.24, 0.28, 0.22], 0.28) as RGB,
  // земля / мох
  earth:       desaturate([0.20, 0.17, 0.11], 0.30) as RGB,
  moss:        desaturate([0.20, 0.30, 0.16], 0.28) as RGB
} as const;

// ── Акценты (魔法 / огонь / кровь / лёд) — остаются насыщенными ──────────
export const ACCENT = {
  fire:        [0.95, 0.45, 0.12] as RGB,        // огонь / факел
  fireCore:    [1.00, 0.85, 0.40] as RGB,
  blood:       [0.62, 0.10, 0.10] as RGB,        // кровь
  arcane:      [0.55, 0.28, 0.85] as RGB,        // магия (фиолет)
  arcaneCore:  [0.78, 0.55, 1.00] as RGB,
  ice:         [0.45, 0.82, 0.95] as RGB,        // лёд
  iceCore:     [0.70, 0.92, 1.00] as RGB,
  soul:        [0.45, 1.00, 0.75] as RGB,        // душа/некро (бирюза)
  eyeRed:      [1.00, 0.18, 0.12] as RGB,        // глаза врагов
  eyeDemon:    [1.00, 0.55, 0.10] as RGB,
  gold:        [0.83, 0.66, 0.22] as RGB         // золото / руны
} as const;

/** Цвет «глаз» по категории врага (для emissive-акцента). */
export function enemyEye(category: string): RGB {
  switch (category) {
    case 'boss': return ACCENT.eyeDemon;
    case 'tank': return ACCENT.eyeRed;
    case 'fast': return ACCENT.eyeDemon;
    default: return ACCENT.eyeRed;
  }
}

/** Базовый «корпусной» цвет башни по typeId. */
export function towerBase(typeId: string): RGB {
  switch (typeId) {
    case 'arrow':  return PALETTE.wood;
    case 'cannon': return PALETTE.metal;
    case 'arcane': return PALETTE.stoneDark;
    case 'ice':    return PALETTE.stone;
    default:       return PALETTE.stone;
  }
}

/** Emissive-акцент башни по typeId. */
export function towerAccent(typeId: string): RGB {
  switch (typeId) {
    case 'arrow':  return ACCENT.fire;
    case 'cannon': return ACCENT.fireCore;
    case 'arcane': return ACCENT.arcaneCore;
    case 'ice':    return ACCENT.iceCore;
    default:       return ACCENT.gold;
  }
}
