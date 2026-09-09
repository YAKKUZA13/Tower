/** Small deterministic PRNG used by scene grammars and reproducible fixtures. */
export interface SceneRandom {
  /** Uniform value in the half-open interval [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  integer(min: number, maxExclusive: number): number;
  chance(probability: number): boolean;
  pick<T>(values: readonly T[]): T;
}

/**
 * Creates a Mulberry32 stream. The algorithm is intentionally fixed so a scene
 * seed produces the same serialized output across editor, server and client.
 */
export function createSceneRandom(seed: number): SceneRandom {
  if (!Number.isInteger(seed)) throw new Error('Scene random seed must be an integer');
  let state = seed >>> 0;
  const next = (): number => {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };

  return {
    next,
    range(min: number, max: number): number {
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        throw new Error('Scene random range requires finite min <= max');
      }
      return min + next() * (max - min);
    },
    integer(min: number, maxExclusive: number): number {
      if (!Number.isInteger(min) || !Number.isInteger(maxExclusive) || maxExclusive <= min) {
        throw new Error('Scene random integer requires integer min < maxExclusive');
      }
      return min + Math.floor(next() * (maxExclusive - min));
    },
    chance(probability: number): boolean {
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        throw new Error('Scene random probability must be in [0,1]');
      }
      return next() < probability;
    },
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new Error('Cannot pick from an empty scene collection');
      return values[Math.floor(next() * values.length)]!;
    }
  };
}
