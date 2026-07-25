/**
 * Индекс-палитра вокселей (Фаза P1, research §6.3, §15.2B).
 *
 * Единая палитра ≤255 цветов для всего кита (как MagicaVoxel/Teardown). Все варианты
 * авторятся против неё; цвет хранится как индекс. Это:
 *  - гарантирует консистентность цвета любой сборки (P4 kit-assembler),
 *  - позволяет упаковать одну палитр-текстуру для GPU (дебрис/шейдеры),
 *  - делает разрушаемость дешёвой (дебрис наследует палитр-индекс).
 *
 * hue-варианты (research §15.2B): для каждого ключевого цвета определяем X / X_b / X_c
 * (±6-8% value, ±4° hue) — процедурная вариативность без новой палитры.
 */
import { Constants, RawTexture, Texture, type Scene } from 'babylonjs';
import { ACCENT, PALETTE, desaturate, shade, type RGB } from './dark-palette';

/** Запись канонической палитры: label → base RGB (каждый расширяется 3 вариантами). */
interface PaletteEntry {
  label: string;
  base: RGB;
}

/** Канонические базовые цвета (из dark-palette.ts — десатурированные + акценты). */
const PALETTE_ENTRIES: PaletteEntry[] = [
  // камень
  { label: 'stoneDark', base: PALETTE.stoneDark },
  { label: 'stone', base: PALETTE.stone },
  { label: 'stoneLight', base: PALETTE.stoneLight },
  // дерево
  { label: 'woodDark', base: PALETTE.woodDark },
  { label: 'wood', base: PALETTE.wood },
  { label: 'woodLight', base: PALETTE.woodLight },
  // кость
  { label: 'bone', base: PALETTE.bone },
  { label: 'boneDark', base: PALETTE.boneDark },
  // металл
  { label: 'metalDark', base: PALETTE.metalDark },
  { label: 'metal', base: PALETTE.metal },
  { label: 'metalLight', base: PALETTE.metalLight },
  // плоть
  { label: 'flesh', base: PALETTE.flesh },
  { label: 'fleshDark', base: PALETTE.fleshDark },
  // земля/мох
  { label: 'earth', base: PALETTE.earth },
  { label: 'moss', base: PALETTE.moss },
  // акценты (насыщенные)
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

/** Величина value-вариации (±) для X_b/X_c (research §15.2B: 6-8%). */
const VALUE_VARIANT = 0.08;
/** Величина hue-сдвига (±град) для X_c. */
const HUE_DEG = 4;

/** Сдвиг hue цвета в (десатурированном) RGB-пространстве (аппроксимация ±hue°). */
function hueShift([r, g, b]: RGB, deg: number): RGB {
  // лёгкий поворот по rg-плоскости (earth tones — hue вокруг жёлто-зелёного).
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  // поворот в rg (аппроксимация hue без конверсии в HSL — достаточно для variantности)
  const nr = r * cos - g * sin * 0.3;
  const ng = r * sin * 0.3 + g * cos;
  return [
    Math.max(0, Math.min(1, nr)),
    Math.max(0, Math.min(1, ng)),
    Math.max(0, Math.min(1, b))
  ];
}

/** Каноническая индекс-палитра (≤255): для каждого entry → [base, _b, _c]. */
export const INDEXED_PALETTE: RGB[] = (() => {
  const out: RGB[] = [];
  for (const e of PALETTE_ENTRIES) {
    out.push(e.base);                         // X (base)
    out.push(shade(e.base, 1 - VALUE_VARIANT)); // X_b (темнее)
    out.push(desaturate(hueShift(shade(e.base, 1 + VALUE_VARIANT), HUE_DEG), 0.2)); // X_c (светлее + hue)
  }
  return out;
})();

/** Map label → базовый индекс в INDEXED_PALETTE (3 слота: base, _b, _c). */
export const PALETTE_LABEL_BASE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  PALETTE_ENTRIES.forEach((e, i) => m.set(e.label, i * 3));
  return m;
})();

/** Максимум слотов палитры (для текстуры 256×1). */
export const PALETTE_MAX = 256;

/**
 * snapToPalette: nearest-neighbor в weighted-RGB пространстве → индекс (0..len-1).
 * Для консистентности цвета (дебрис, visual hull, импорт).
 */
export function snapToPalette(rgb: RGB): number {
  let best = 0;
  let bestD = Infinity;
  // веса rec709-подобные (восприятий distance)
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

/** Возвращает RGB по индексу палитры (выход за границы → чёрный). */
export function paletteIndexToRGB(i: number): RGB {
  if (i < 0 || i >= INDEXED_PALETTE.length) return [0, 0, 0];
  return INDEXED_PALETTE[i]!;
}

/**
 * hueVariant: возвращает индекс одного из 3 вариантов (X / X_b / X_c) по seeded hash.
 * Для процедурной вариативности цвета персонажей (P4 kit-assembler, shingles P-MO).
 * @param baseLabel label базового цвета (напр. 'stone')
 * @param seed детерминированный сид (rng-value 0..1 или int)
 */
export function hueVariant(baseLabel: string, seed: number): number {
  const base = PALETTE_LABEL_BASE.get(baseLabel);
  if (base === undefined) return snapToPalette(PALETTE.stone);
  // seeded выбор 0/1/2
  const h = Math.sin(seed * 99.13 + baseLabel.length * 7.7) * 43758.5453;
  const r = h - Math.floor(h); // [0,1)
  const variant = r < 0.5 ? 0 : r < 0.78 ? 1 : 2;
  return base + variant;
}

/**
 * buildPaletteTexture: GPU-текстура 256×1 RGBA из INDEXED_PALETTE (для дебриса/шейдеров).
 * Паддинг неиспользуемых слотов — последний цвет палитры (визуально нейтрально).
 */
export function buildPaletteTexture(scene: Scene): RawTexture {
  const data = new Uint8Array(PALETTE_MAX * 4);
  const n = INDEXED_PALETTE.length;
  for (let i = 0; i < PALETTE_MAX; i++) {
    const c = i < n ? INDEXED_PALETTE[i]! : INDEXED_PALETTE[n - 1]!;
    data[i * 4] = Math.round(c[0] * 255);
    data[i * 4 + 1] = Math.round(c[1] * 255);
    data[i * 4 + 2] = Math.round(c[2] * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new RawTexture(
    data, PALETTE_MAX, 1, Constants.TEXTUREFORMAT_RGBA, scene,
    false, false, Texture.NEAREST_SAMPLINGMODE
  );
  tex.name = 'voxel-indexed-palette';
  return tex;
}
