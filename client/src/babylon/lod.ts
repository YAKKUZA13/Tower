/**
 * LOD-классификатор для rigged-акторов (M4 — voxel-migration-plan D2/D3/D13).
 *
 * Rigged-клоны дороже thin-instances (per-frame joint-rotation + N мешей на тень).
 * Чтобы держать 60 FPS при толпе, акторы делятся на 3 тира по расстоянию до фокуса
 * (камера/база): ближайшие = 'shadowed' (анимация + per-clone тень), средние =
 * 'animated' (анимация без тени), дальние = 'static' (только позиция/facing, без
 * walk-cycle — экономия joint-апдейтов).
 *
 * Pure-функция (детерминирована): сортирует по расстоянию, назначает тиры. Рендерер
 * применяет: skip-анимация для static, add/remove clone-мешей в ShadowGenerator для
 * shadowed. Контракт ADR-2 сохранён (сим не знает о LOD — рендер-only).
 */

export type LodTier = 'shadowed' | 'animated' | 'static';

export interface LodDist { id: string; d2: number; }

/**
 * Классифицирует акторов в тиры по квадрату расстояния до фокуса.
 * Ближайшие maxShadowed → 'shadowed'; следующие до maxAnimated → 'animated'; прочие → 'static'.
 */
export function classifyLod(
  dists: LodDist[],
  maxShadowed: number,
  maxAnimated: number
): Map<string, LodTier> {
  const out = new Map<string, LodTier>();
  if (dists.length === 0) return out;
  // сортировка по возрастанию расстояния (ближние первыми)
  const sorted = dists.slice().sort((a, b) => a.d2 - b.d2);
  const shadowCap = Math.min(maxShadowed, sorted.length);
  const animCap = Math.min(maxAnimated, sorted.length);
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i]!.id;
    if (i < shadowCap) out.set(id, 'shadowed');
    else if (i < animCap) out.set(id, 'animated');
    else out.set(id, 'static');
  }
  return out;
}
