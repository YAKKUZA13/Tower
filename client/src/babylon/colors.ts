/**
 * Цвета UI/маркеров — тёмная дарк-фэнтези палитра (Phase 2).
 * Рендер врагов/башен теперь идёт воксель-моделями с собственными цветами
 * (babylon/voxel/dark-palette); отсюда берутся только свотчи для UI и маркеры пути/базы.
 */
import type { EnemyType } from '@tower/shared';

/** Свотч категории врага для UI (десатурированный). */
export function enemyCategoryColor(category: EnemyType['category']): [number, number, number] {
  switch (category) {
    case 'fast': return [0.62, 0.52, 0.18];
    case 'tank': return [0.52, 0.18, 0.18];
    case 'boss': return [0.40, 0.16, 0.52];
    case 'flyer': return [0.30, 0.46, 0.60];
    default: return [0.46, 0.56, 0.42];
  }
}

const TOWER_COLORS: Record<string, [number, number, number]> = {
  arrow: [0.27, 0.18, 0.10],
  cannon: [0.34, 0.35, 0.40],
  arcane: [0.30, 0.22, 0.50],
  ice: [0.34, 0.58, 0.66]
};

export function towerTypeColor(typeId: string): [number, number, number] {
  return TOWER_COLORS[typeId] ?? [0.45, 0.45, 0.48];
}

/** Акцент-свечение для UI-иконок (глаза/огонь/магия). */
const TOWER_ACCENTS: Record<string, [number, number, number]> = {
  arrow: [0.95, 0.45, 0.12],
  cannon: [1.00, 0.85, 0.40],
  arcane: [0.55, 0.28, 0.85],
  ice: [0.45, 0.82, 0.95]
};

export function towerAccentColor(typeId: string): [number, number, number] {
  return TOWER_ACCENTS[typeId] ?? [0.83, 0.66, 0.22];
}

export const PROJECTILE_COLOR: [number, number, number] = [1.0, 0.78, 0.30];
export const PATH_COLOR: [number, number, number] = [0.55, 0.42, 0.16];
export const BASE_COLOR: [number, number, number] = [0.30, 0.70, 0.55];
export const SPAWN_COLOR: [number, number, number] = [0.70, 0.22, 0.18];
