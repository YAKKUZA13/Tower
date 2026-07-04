/**
 * Каталог моделей TD (ADR-5: CC0 ассеты → glTF → Babylon).
 * Источник для Phase 2 (asset-catalog + рендереры). См. TD-MVP-PLAN.md раздел 2.9.
 *
 * CatalogId — это логический идентификатор модели (например 'tower:arrow', 'enemy:skeleton',
 * 'base:crystal'). Резолвится в конкретный меш через CatalogEntry:
 *  - если есть glbPath  → AssetCatalog грузит GLB (реальные CC0 ассеты);
 *  - иначе              → AssetCatalog строит процедурную воксель-модель (билдер по имени builder).
 *
 * Процедурные воксель-модели авторства проекта = наши (CC0-эквивалент), дают тот же
 * «тёмный» вайб и 1 draw call на тип через thin/instanced rendering (ADR-4).
 */

export type CatalogKind =
  | 'tower'
  | 'enemy'
  | 'projectile'
  | 'base'
  | 'spawn'
  | 'wall'
  | 'relic'
  | 'unit'
  | 'building';

/** Имя процедурного воксель-билдера (см. client/babylon/voxel/model-defs.ts). */
export type VoxelBuilderId = string;

export interface CatalogEntry {
  catalogId: string;
  kind: CatalogKind;
  /** Имя файла GLB относительно /catalog (например 'towers/arrow.glb'). Если задано — GLB грузится. */
  glbPath?: string;
  /** Имя процедурного воксель-билдера; используется, когда glbPath отсутствует или грузится с ошибкой. */
  builder?: VoxelBuilderId;
  /** Базовый RGB (0..1) — для UI-свотчей и тонировки. */
  baseColor?: [number, number, number];
  /** Emissive-акцент (глаза/огонь/магия) — для материала и UI. */
  emissive?: [number, number, number];
  /** Глобальный масштаб модели относительно клетки (нормализует разные исходники GLB). */
  scale?: number;
  /** Поворот по Y в радианах (нормализация ориентации GLB). */
  rotationY?: number;
}

export interface CatalogManifest {
  version: number;
  entries: CatalogEntry[];
}
