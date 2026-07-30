/**
 * xorshift32 — детерминированный PRNG (порт из forge, research §15.2A).
 * Без зависимостей. Детерминизм: НИКАКОЙ итерации Map/Set в placement path —
 * только упорядоченные массивы рецепта + FrameTable (ordered array).
 *
 * Константы: zero-seed → golden-ratio 0x9E3779B9; shifts <<13, >>17, <<5.
 */
export class Xorshift32 {
  state: number;

  constructor(seed: number) {
    // golden-ratio constant если seed=0 (как в forge)
    this.state = seed === 0 ? 0x9e3779b9 : seed >>> 0;
  }

  nextU32(): number {
    let x = this.state >>> 0;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.state = x >>> 0;
    return this.state;
  }

  /** uniform в [0,1) — точно как forge: (nextU32() >> 8) / (1<<24). */
  nextF32(): number {
    return (this.nextU32() >>> 8) / (1 << 24);
  }
}

/** Per-scatter seed из recipe.seed + id (когда scatter.seed = null). */
export function seedFromId(recipeSeed: number, id: string): number {
  const rng = new Xorshift32((recipeSeed + 1) >>> 0);
  // ручной UTF-8 byte-encoding (без DOM/TextEncoder — shared lib = ES2022)
  for (const b of utf8Bytes(id)) {
    rng.state = (rng.state ^ b) >>> 0;
    rng.nextU32();
  }
  return rng.state;
}

/** Минимальный UTF-8 encoder → массив байт (shared/ не имеет DOM lib). */
function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // surrogate pair → codepoint
      const c2 = s.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return out;
}
