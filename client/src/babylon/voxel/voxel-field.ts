import { applyGreedyGeometry } from '@tower/voxel-babylon';
/**
 * Воксельное поле боя — destructible field + heightmap→voxel (M5, research §13/§15.2D).
 *
 * Единое greedy-meshed воксельное поле вместо плитки-тайлов. Поле хранится как
 * render-local voxel grid (Uint8Array материал-на-клетку-на-слой) — НЕ в сим-снапшоте
 * (инвариант ADR-2: разрушаемость — рендер-only; для PvP sync через отдельный
 * terrain-delta канал, M8.5). destruction = локальная модификация grid + re-greedy.
 *
 * Pure-ядро (data/damage/heightmap/tiles) — headless-тестируемо; `VoxelField` — тонкая
 * Scene-обёртка (mesh + rebuild).
 *
 * D10 heightmap→voxel: value-noise terrain prototype → воксельные столбцы (холмы) +
 * water-level. Интеграция 3D-террейна в плоский sim (sampleHeight=0) — отдельная задача
 * (требует sim-правок размещения); здесь — prototype + foundation.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { type Scene } from '@babylonjs/core/scene.js';
import { computeGreedyGeometry, cube, type Voxel } from './voxel-builder';
import { PALETTE, ACCENT, shade, type RGB } from './dark-palette';
import type { TileType } from '@tower/shared';

/** Материал клетки поля (0 = пусто). */
export type FieldMaterial = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const FIELD_EMPTY = 0;
export const FIELD_GRASS = 1;
export const FIELD_DIRT = 2;
export const FIELD_ROAD = 3;
export const FIELD_WATER = 4;
export const FIELD_ROCK = 5;
export const FIELD_SAND = 6;
export const FIELD_STONE = 7;

/** Цвет материала поля (для greedy vertex colors). */
export function fieldMaterialColor(m: FieldMaterial): RGB {
  switch (m) {
    case FIELD_GRASS: return PALETTE.moss;
    case FIELD_DIRT: return shade(PALETTE.wood, 0.7);
    case FIELD_ROAD: return shade(PALETTE.woodDark, 1.1);
    case FIELD_WATER: return ACCENT.ice;
    case FIELD_ROCK: return PALETTE.stoneDark;
    case FIELD_SAND: return shade(PALETTE.bone, 0.85);
    case FIELD_STONE: return PALETTE.stone;
    default: return PALETTE.stoneDark;
  }
}

/** TileType (sim) → FieldMaterial. */
export function tileToFieldMaterial(t: TileType): FieldMaterial {
  switch (t) {
    case 'grass': return FIELD_GRASS;
    case 'dirt': return FIELD_DIRT;
    case 'road': return FIELD_ROAD;
    case 'water': return FIELD_WATER;
    case 'rock': return FIELD_ROCK;
    case 'sand': return FIELD_SAND;
    default: return FIELD_GRASS;
  }
}

/** Данные воксельного поля: cols×rows×layers grid материалов. */
export interface VoxelFieldData {
  cols: number;
  rows: number;
  /** Число вертикальных слоёв вокселей (глубина поля). */
  layers: number;
  /** grid[col + row*cols + layer*cols*rows] = FieldMaterial. */
  grid: Uint8Array;
}

export function makeFieldData(cols: number, rows: number, layers: number): VoxelFieldData {
  return { cols, rows, layers, grid: new Uint8Array(cols * rows * layers) };
}

/** Индекс клетки в grid. */
export function fieldIndex(data: VoxelFieldData, col: number, row: number, layer: number): number {
  return col + row * data.cols + layer * data.cols * data.rows;
}

/** Установить материал клетки (с защитой границ). */
export function setCell(data: VoxelFieldData, col: number, row: number, layer: number, m: FieldMaterial): void {
  if (col < 0 || row < 0 || col >= data.cols || row >= data.rows || layer < 0 || layer >= data.layers) return;
  data.grid[fieldIndex(data, col, row, layer)] = m;
}

/** Прочитать материал клетки (0 = пусто/вне границ). */
export function getCell(data: VoxelFieldData, col: number, row: number, layer: number): FieldMaterial {
  if (col < 0 || row < 0 || col >= data.cols || row >= data.rows || layer < 0 || layer >= data.layers) return FIELD_EMPTY;
  return data.grid[fieldIndex(data, col, row, layer)] as FieldMaterial;
}

/**
 * Разрушение поля: очищает клетки в радиусе (цилиндр по XZ, все слои) от (col,row).
 * Возвращает число очищенных клеток. Render-local (сим не знает).
 */
export function damageField(data: VoxelFieldData, col: number, row: number, radius: number): number {
  let cleared = 0;
  const r2 = radius * radius;
  for (let dr = -Math.ceil(radius); dr <= Math.ceil(radius); dr++) {
    for (let dc = -Math.ceil(radius); dc <= Math.ceil(radius); dc++) {
      if (dc * dc + dr * dr > r2) continue;
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= data.cols || r >= data.rows) continue;
      for (let l = 0; l < data.layers; l++) {
        const idx = fieldIndex(data, c, r, l);
        if (data.grid[idx] !== FIELD_EMPTY) {
          data.grid[idx] = FIELD_EMPTY;
          cleared++;
        }
      }
    }
  }
  return cleared;
}

/** Плоское поле из тайлов карты: 2 слоя (top = тайл, bottom = камень-подложка). */
export function tilesToField(tiles: TileType[][], layers = 2): VoxelFieldData {
  const rows = tiles.length;
  const cols = rows > 0 ? tiles[0]!.length : 0;
  const data = makeFieldData(cols, rows, layers);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = tiles[r]![c] ?? 'grass';
      setCell(data, c, r, layers - 1, tileToFieldMaterial(t)); // верхний слой = тайл
      setCell(data, c, r, layers - 2, FIELD_STONE);            // нижний = камень
    }
  }
  return data;
}

// ── D10: heightmap → voxel terrain (value-noise prototype, research §15.2D) ──

/** Seeded value-noise heightmap (детерминированный, mulberry32-стиль хеш). */
export function generateHeightmap(cols: number, rows: number, seed: number, opts: { scale?: number; amplitude?: number; base?: number } = {}): number[][] {
  const scale = opts.scale ?? 0.18;
  const amp = opts.amplitude ?? 4;
  const base = opts.base ?? 3;
  const out: number[][] = [];
  // два октана value-noise через синус-хеш (дёшево, детерминировано)
  for (let r = 0; r < rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const n1 = hashNoise(c * scale, r * scale, seed);
      const n2 = hashNoise(c * scale * 2.3, r * scale * 2.3, seed + 1) * 0.5;
      const h = base + Math.round((n1 + n2) * amp);
      row.push(h);
    }
    out.push(row);
  }
  return out;
}

/** Value-noise через синус-хеш (0..1). */
function hashNoise(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Heightmap → voxel field (D10). Каждый столбец высотой heights[r][c] заполняется
 * камнем; клетки ниже waterLevel → вода на верхушке (если высота < waterLevel).
 */
export function heightmapToField(heights: number[][], waterLevel = 2): VoxelFieldData {
  const rows = heights.length;
  const cols = rows > 0 ? heights[0]!.length : 0;
  let maxH = 0;
  for (const row of heights) for (const h of row) if (h > maxH) maxH = h;
  const layers = Math.max(1, maxH + 1);
  const data = makeFieldData(cols, rows, layers);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const h = heights[r]![c]!;
      for (let l = 0; l <= h; l++) {
        // верхний слой = трава (выше воды) или песок (у воды) или камень (скалы)
        let m: FieldMaterial = FIELD_STONE;
        if (l === h) {
          if (h <= waterLevel) m = FIELD_SAND;
          else m = FIELD_GRASS;
        } else if (l > h - 2) {
          m = FIELD_DIRT;
        }
        setCell(data, c, r, l, m);
      }
      // вода: заливаем до waterLevel если высота ниже
      if (h < waterLevel) {
        for (let l = h + 1; l <= waterLevel; l++) {
          setCell(data, c, r, l, FIELD_WATER);
        }
      }
    }
  }
  return data;
}

/** Конвертация поля → Voxel[] (для greedy mesh). Слой l → y = l. */
export function fieldToVoxels(data: VoxelFieldData): Voxel[] {
  const v: Voxel[] = [];
  for (let l = 0; l < data.layers; l++) {
    for (let r = 0; r < data.rows; r++) {
      for (let c = 0; c < data.cols; c++) {
        const m = getCell(data, c, r, l);
        if (m === FIELD_EMPTY) continue;
        cube(v, c, l, r, fieldMaterialColor(m));
      }
    }
  }
  return v;
}
/** Scene-обёртка: держит mesh поля, пересобирает greedy при разрушении. */
export class VoxelField {
  private mesh: Mesh | null = null;
  private readonly scene: Scene;
  private readonly cellSize: number;
  readonly data: VoxelFieldData;

  constructor(scene: Scene, data: VoxelFieldData, cellSize: number) {
    this.scene = scene;
    this.data = data;
    this.cellSize = cellSize;
    this.rebuild();
  }

  /** Поле лежит плоско: верх на y=0 (стык с sampleHeight=0), масштаб cellSize. */
  rebuild(): void {
    const voxels = fieldToVoxels(this.data);
    const geo = computeGreedyGeometry(voxels, true); // flat=true: поле без baked AO (ровная яркость)
    const old = this.mesh;
    const mesh = new Mesh('voxel-field', this.scene);
    if (geo.positions.length > 0) {
      applyGreedyGeometry(mesh, geo);
    }
    // НЕ normalizeMesh: поле в реальных воксель-координатах; масштабируем cellSize,
    // центрируем по XZ, верхний слой (y=layers-1) → на y=0 (стык ground).
    const topY = this.data.layers - 1;
    mesh.scaling.set(this.cellSize, this.cellSize, this.cellSize);
    mesh.position.set(
      -(this.data.cols * this.cellSize) / 2 + this.cellSize / 2,
      -topY * this.cellSize,
      -(this.data.rows * this.cellSize) / 2 + this.cellSize / 2
    );
    const mat = new StandardMaterial('voxel-field-mat', this.scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.03, 0.03, 0.03);
    mesh.material = mat;
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.freezeWorldMatrix();
    this.mesh = mesh;
    if (old) old.dispose();
  }

  /** Разрушение поля в радиусе (render-local). Перестраивает mesh. */
  damage(col: number, row: number, radius: number): number {
    const cleared = damageField(this.data, col, row, radius);
    if (cleared > 0) this.rebuild();
    return cleared;
  }

  dispose(): void {
    if (this.mesh) { this.mesh.dispose(); this.mesh = null; }
  }
}
