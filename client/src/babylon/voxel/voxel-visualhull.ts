/**
 * Visual hull вокселайзер (Фаза P2, research §4.2).
 *
 * image(s) → Voxel[] ядро: для каждого вокселя N³-сетки проецируем его центр в 2D-пиксель
 * каждой камеры (ortho projection по axis); если внутри silhouette ВСЕХ камер → занят.
 * Цвет — из front-view color (ближайший не-background пиксель). ~150 строк TS, без GPU/ML.
 *
 * Фундаментальный лимит (research §4.2, 5 источников): visual hull = максимальная форма,
 * согласованная с силуэтами. НЕ восстанавливает вогнутости (глазницы, подмышки, под плащом).
 * Приемлемо для блочной воксельной эстетики на разрешении 24–48³.
 *
 * Вывод = boolean occupancy grid + per-voxel color = ровно наш Voxel{x,y,z,sx,sy,sz,color}.
 */
import type { RGB } from './dark-palette';
import type { Voxel } from './voxel-builder';

/** Дефолтный размер воксельной сетки (research §4.2: 32³ для персонажа). */
export const DEFAULT_GRID_N = 32;

/** Одна калиброванная ортогональная камера: силуэт + опц. цвет. */
export interface CameraView {
  /** Ось проекции (камера смотрит вдоль этой оси). */
  axis: 'x' | 'y' | 'z';
  /** Знак направления взгляда (для ориентации/отзеркаливания цвета). */
  sign: 1 | -1;
  /** Бинарная маска силуэта (width*height, 1 = внутри, 0 = снаружи). */
  silhouette: Uint8Array;
  width: number;
  height: number;
  /** Опц. RGBA-буфер (width*height*4) — для окраски вокселей. */
  color?: Uint8Array;
}

/** Дефолтный «нейтральный» цвет, если ни одна камера не дала цвет. */
const DEFAULT_COLOR: RGB = [0.42, 0.42, 0.46];

/**
 * visualHull: K ортогональных силуэтов → occupancy Voxel[] (research §4.2).
 * Воксель (x,y,z) занят iff его проекция попадает в silhouette ВСЕХ камер.
 * Цвет — из первой камеры с color-буфером (обычно front-view, axis='z').
 *
 * @param views камеры (минимум 2 для осмысленного hull; типично 4: ±X, ±Z)
 * @param gridN размер сетки (default 32)
 */
export function visualHull(views: CameraView[], gridN: number = DEFAULT_GRID_N): Voxel[] {
  if (views.length === 0) return [];
  const out: Voxel[] = [];
  for (let x = 0; x < gridN; x++) {
    for (let y = 0; y < gridN; y++) {
      for (let z = 0; z < gridN; z++) {
        let color: RGB | undefined;
        let inside = true;
        for (const view of views) {
          const { u, v } = projectOrtho(view, x, y, z, gridN);
          if (u < 0 || u >= view.width || v < 0 || v >= view.height) { inside = false; break; }
          if (view.silhouette[v * view.width + u] === 0) { inside = false; break; }
          if (!color && view.color) color = readRGBA(view.color, view.width, u, v);
        }
        if (inside) {
          out.push({ x, y, z, sx: 1, sy: 1, sz: 1, color: color ?? DEFAULT_COLOR });
        }
      }
    }
  }
  return out;
}

/**
 * Проекция вокселя (x,y,z) в 2D-пиксель (u,v) камеры (ortho по axis).
 * Тангенс-оси: axis='z'→(x,y), axis='x'→(z,y), axis='y'→(x,z).
 * Знак sign зеркалит u (для корректной ориентации цвета); на occupancy не влияет.
 */
function projectOrtho(
  view: CameraView,
  x: number, y: number, z: number,
  gridN: number
): { u: number; v: number } {
  let t1: number, t2: number;
  switch (view.axis) {
    case 'z': t1 = x; t2 = y; break;
    case 'x': t1 = z; t2 = y; break;
    default: t1 = x; t2 = z; break; // 'y'
  }
  // маппинг [0..gridN) → [0..width/height); sign зеркалит t1 (по горизонтали)
  const mappedT1 = view.sign < 0 ? gridN - 1 - t1 : t1;
  const u = Math.floor((mappedT1 / gridN) * view.width);
  const v = Math.floor((t2 / gridN) * view.height);
  return { u, v };
}

/** Читает RGBA-пиксель → линейный RGB (0..1). */
function readRGBA(color: Uint8Array, width: number, u: number, v: number): RGB {
  const o = (v * width + u) * 4;
  return [color[o]! / 255, color[o + 1]! / 255, color[o + 2]! / 255];
}

/**
 * silhouetteFromAlpha: alpha > threshold → 1 (внутри силуэта).
 * Для PNG с прозрачным фоном (research §4.4).
 */
export function silhouetteFromAlpha(rgba: Uint8Array, w: number, h: number, threshold = 128): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    mask[i] = rgba[i * 4 + 3]! > threshold ? 1 : 0;
  }
  return mask;
}

/**
 * silhouetteFromBackground: chroma-key по фоновому цвету → пиксель отличается от фона → 1.
 * bgColor = [r,g,b] в 0..255. tol — евклидов порог расстояния.
 */
export function silhouetteFromBackground(
  rgba: Uint8Array, w: number, h: number,
  bgColor: [number, number, number], tol = 30
): Uint8Array {
  const mask = new Uint8Array(w * h);
  const tol2 = tol * tol;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const dr = rgba[o]! - bgColor[0];
    const dg = rgba[o + 1]! - bgColor[1];
    const db = rgba[o + 2]! - bgColor[2];
    mask[i] = (dr * dr + dg * dg + db * db) > tol2 ? 1 : 0;
  }
  return mask;
}

/** Габариты occupancy (для SIZE-чанка .vox). */
export function occupancyBounds(voxels: Voxel[]): { x: number; y: number; z: number } {
  let mx = 0, my = 0, mz = 0;
  for (const v of voxels) {
    if (v.x + 1 > mx) mx = v.x + 1;
    if (v.y + 1 > my) my = v.y + 1;
    if (v.z + 1 > mz) mz = v.z + 1;
  }
  return { x: Math.max(1, mx), y: Math.max(1, my), z: Math.max(1, mz) };
}
