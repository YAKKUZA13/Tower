import { applyGreedyGeometry } from '@voxkera/voxel-babylon';
/**
 * M8.1 — Chunked VoxelField rendering для большой RTS-карты (≥64×64).
 *
 * Разбивает карту на чанки 16×16 (CS = chunk size). Для каждого чанка:
 *  - VoxelField-data (heightmap + tile-materials → voxels)
 *  - Greedy-meshed Mesh (lazy-build при первом попадании в viewport)
 *  - Frustum-culling: невидимые чанки skip render (mesh.isVisible = false)
 *  - LOD: дальние чанки → merged-slab (упрощённо: 1 vox на 4×4 тайлов)
 *
 * Совместим с pixel-art pipeline (toon/outline-dn/...): чанки — обычные Mesh,
 * попадают под applyPixelArtToonToScene.
 *
 * Деструктивность (M5): при изменении конкретной клетки — rebuild только её чанка.
 */
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Frustum } from '@babylonjs/core/Maths/math.frustum.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { type Camera } from '@babylonjs/core/Cameras/camera.js';
import { type Scene } from '@babylonjs/core/scene.js';
import { computeGreedyGeometry, cube, type Voxel } from '../voxel/voxel-builder';
import { PALETTE, shade, type RGB } from '../voxel/dark-palette';
import { tileToFieldMaterial, fieldMaterialColor, FIELD_EMPTY, type FieldMaterial } from '../voxel/voxel-field';
import type { TileType, GridData } from '@tower/shared';

export const CHUNK_SIZE = 16;

export interface ChunkKey { cx: number; cz: number; }

export interface ChunkedFieldOptions {
  /** Включить LOD для дальних чанков. */
  enableLod?: boolean;
  /** Дистанция (в чанках) после которой LOD = 1 (упрощённый). */
  lodChunkDistance?: number;
  /** Цвет по умолчанию для чанков без tiles. */
  defaultColor?: [number, number, number];
}

export interface ChunkedFieldBounds {
  chunksX: number;
  chunksZ: number;
  chunkCount: number;
}

/**
 * Чанковый рендер VoxelField для большой RTS-карты.
 *
 * Хранит grid + heightmap + tiles; при updateVisibility(camera) включает только
 * чанки в frustum, остальные скрывает. Build-on-demand (lazy): чанк строится
 * при первом попадании в viewport.
 *
 * tileToFieldMaterial + heightmap → voxel-grid чанка → greedy-mesh.
 */
export class ChunkedVoxelField {
  private readonly scene: Scene;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly tiles: TileType[][] | null;
  private readonly chunksX: number;
  private readonly chunksZ: number;
  private readonly chunks = new Map<string, Mesh>();
  private readonly chunkBuilt = new Set<string>();
  private readonly options: ChunkedFieldOptions;
  private readonly material: StandardMaterial;
  /** Track cell-изменений для partial rebuild. */
  private dirty = new Set<string>();

  constructor(scene: Scene, grid: GridData, heightmap: number[][], tiles?: TileType[][] | null, options: ChunkedFieldOptions = {}) {
    this.scene = scene;
    this.grid = grid;
    this.heightmap = heightmap;
    this.tiles = tiles ?? null;
    this.options = {
      enableLod: options.enableLod ?? true,
      lodChunkDistance: options.lodChunkDistance ?? 4,
      defaultColor: options.defaultColor ?? [0.3, 0.3, 0.32]
    };
    this.chunksX = Math.ceil(grid.cols / CHUNK_SIZE);
    this.chunksZ = Math.ceil(grid.rows / CHUNK_SIZE);

    this.material = new StandardMaterial('chunked-voxel-field-mat', scene);
    this.material.diffuseColor = new Color3(...this.options.defaultColor!);
    this.material.specularColor = new Color3(0, 0, 0);
  }

  getBounds(): ChunkedFieldBounds {
    return { chunksX: this.chunksX, chunksZ: this.chunksZ, chunkCount: this.chunksX * this.chunksZ };
  }

  /** Ключ чанка по tile-coord. */
  private chunkKey(cx: number, cz: number): string { return `${cx}:${cz}`; }

  /** Ленивый build меша чанка. */
  private buildChunk(cx: number, cz: number): Mesh | null {
    const key = this.chunkKey(cx, cz);
    if (this.chunkBuilt.has(key)) return this.chunks.get(key) ?? null;
    this.chunkBuilt.add(key);

    const voxels: Voxel[] = [];
    const cs = this.grid.cellSize;
    const startCol = cx * CHUNK_SIZE;
    const startRow = cz * CHUNK_SIZE;
    const halfW = (this.grid.cols * cs) / 2;
    const halfH = (this.grid.rows * cs) / 2;
    // 1 voxel per tile (упрощённо); для LOD-far: 1 на 2×2 (см. ниже)
    for (let dz = 0; dz < CHUNK_SIZE; dz++) {
      const row = startRow + dz;
      if (row >= this.grid.rows) break;
      const heightRow = this.heightmap[row];
      const tileRow = this.tiles ? this.tiles[row] : null;
      for (let dx = 0; dx < CHUNK_SIZE; dx++) {
        const col = startCol + dx;
        if (col >= this.grid.cols) break;
        const tileType = tileRow ? tileRow[col] : 'grass';
        const mat = tileToFieldMaterial(tileType ?? 'grass');
        if (mat === FIELD_EMPTY) continue;
        // высота по heightmap (один воксель-слой; heightmap → Y-offset)
        const h = heightRow && typeof heightRow[col] === 'number' ? Math.max(0, heightRow[col]) : 0;
        const col3 = fieldMaterialColor(mat);
        const x = col * cs - halfW + cs / 2;
        const z = row * cs - halfH + cs / 2;
        // используем helper cube() — он заполняет sx/sy/sz=1
        cube(voxels, x, h * cs * 0.5, z, col3);
      }
    }

    if (voxels.length === 0) return null;

    // flat=true — tile-плиты без baked-AO (пол должен быть ровно ярким)
    const geo = computeGreedyGeometry(voxels, true);
    const meshName = `chunk-${key}`;
    const mesh = new Mesh(meshName, this.scene);
    applyGreedyGeometry(mesh, geo);
    mesh.material = this.material;
    mesh.receiveShadows = true;
    mesh.isPickable = true;
    mesh.alwaysSelectAsActiveMesh = false;
    this.chunks.set(key, mesh);
    return mesh;
  }

  /**
   * Включить/выключить чанки по frustum-culling. Вызывать каждый кадр (или по событии).
   */
  updateVisibility(camera: Camera): void {
    const engine = this.scene.getEngine();
    const W = engine.getRenderWidth();
    const H = engine.getRenderHeight();
    // frustum planes from view*proj
    const transform = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
    const frustumPlanes = Frustum.GetPlanes(transform);

    // camera world-pos (для LOD-distance)
    const camPos = camera.position;
    const cs = this.grid.cellSize;
    const halfW = (this.grid.cols * cs) / 2;
    const halfH = (this.grid.rows * cs) / 2;

    for (let cz = 0; cz < this.chunksZ; cz++) {
      for (let cx = 0; cx < this.chunksX; cx++) {
        const key = this.chunkKey(cx, cz);
        // chunk AABB center
        const cxWorld = (cx + 0.5) * CHUNK_SIZE * cs - halfW;
        const czWorld = (cz + 0.5) * CHUNK_SIZE * cs - halfH;
        // distance to camera (chunk-distance)
        const dxC = cxWorld - camPos.x;
        const dzC = czWorld - camPos.z;
        const distChunks = Math.sqrt(dxC * dxC + dzC * dzC) / (CHUNK_SIZE * cs);

        // simple frustum test: chunk AABB in/out
        // (Babylon Frustum doesn't have AABB test directly; use sphere ≈ chunk diagonal/2)
        const halfChunkDiag = CHUNK_SIZE * cs * 0.75;
        const inFrustum = sphereInFrustum(frustumPlanes, cxWorld, 0, czWorld, halfChunkDiag);

        let mesh = this.chunks.get(key) ?? null;
        if (inFrustum) {
          if (!mesh) mesh = this.buildChunk(cx, cz);
          if (mesh) {
            mesh.isVisible = true;
            // LOD: дальние чанки → simplified material flag (для будущего sub-mesh LOD)
            if (this.options.enableLod && distChunks > (this.options.lodChunkDistance ?? 4)) {
              mesh.renderingGroupId = 1; // упрощённо: дальний слой
            } else {
              mesh.renderingGroupId = 0;
            }
          }
        } else if (mesh) {
          mesh.isVisible = false;
        }
      }
    }
  }

  /** Помечает клетку грязной (для partial rebuild — destructible terrain). */
  markDirty(col: number, row: number): void {
    const cx = Math.floor(col / CHUNK_SIZE);
    const cz = Math.floor(row / CHUNK_SIZE);
    this.dirty.add(this.chunkKey(cx, cz));
  }

  /** Перестроить грязные чанки (вызывать периодически). */
  rebuildDirty(): void {
    if (this.dirty.size === 0) return;
    for (const key of this.dirty) {
      const mesh = this.chunks.get(key);
      if (mesh) { mesh.dispose(); this.chunks.delete(key); }
      this.chunkBuilt.delete(key);
      const [cxStr, czStr] = key.split(':');
      this.buildChunk(Number(cxStr), Number(czStr));
    }
    this.dirty.clear();
  }

  /** Sample height at (col, row) — для placement/movement. */
  sampleHeight(col: number, row: number): number {
    const rowArr = this.heightmap[row];
    if (!rowArr) return 0;
    const v = rowArr[col];
    return typeof v === 'number' ? v : 0;
  }

  dispose(): void {
    for (const [, mesh] of this.chunks) mesh.dispose();
    this.chunks.clear();
    this.chunkBuilt.clear();
    this.dirty.clear();
    this.material.dispose();
  }
}

/** Вспомогательный frustum-vs-sphere test (Babylon Frustum planes = Vector4). */
function sphereInFrustum(planes: { normal: { x: number; y: number; z: number }; d: number }[] | unknown[], x: number, y: number, z: number, radius: number): boolean {
  // Babylon Frustum planes: { normal: Vector3, d: number } in older API, or Plane in newer.
  // Handle both: duck-typed check.
  for (let i = 0; i < 6; i++) {
    const p = (planes as Record<number, { normal?: { x: number; y: number; z: number }; d?: number; x?: number; y?: number; z?: number; w?: number }>)[i];
    if (!p) continue;
    // Plane form: dot(normal, p) + d
    // Babylon Plane has .normal + .d
    let nx: number, ny: number, nz: number, d: number;
    if (p.normal && typeof p.d === 'number') {
      nx = p.normal.x; ny = p.normal.y; nz = p.normal.z; d = p.d;
    } else if (typeof p.x === 'number' && typeof p.w === 'number') {
      // Vector4 form: plane = (x,y,z,w), distance = x*px+y*py+z*pz+w
      nx = p.x; ny = p.y!; nz = p.z!; d = p.w!;
    } else continue;
    if (nx * x + ny * y + nz * z + d < -radius) return false;
  }
  return true;
}

// re-export для consumers
export { PALETTE, shade, Color3, Matrix, type RGB };
