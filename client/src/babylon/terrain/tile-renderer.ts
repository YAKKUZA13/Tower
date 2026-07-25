/**
 * TileRenderer (Phase T — референс 'Isometric Fantasy Tiles').
 *
 * Рендерит тайловое поле боя через thin instances: один мастер-меш на TileType
 * (grass/dirt/road/water/rock/sand), thin-instance-матрицы на каждую клетку.
 * 1 draw call на тип тайла (макс 6 на всё поле). Совместимо с ADR-4.
 *
 * Tile-мастер (через AssetCatalog → voxel-builder): плоская воксель-плита 6×6×1
 * (XZ×Y), после normalizeMesh XZ-size=6, Y-size=1, центр в (0,0,0).
 * TileRenderer масштабирует мастер на cellSize/6 → финальный размер клетки
 * cellSize × cellSize/6 × cellSize (тоньше поля, читается как воксель-плитка).
 *
 * Y-позиция: master после normalize имеет y ∈ [−0.5, +0.5]; после scale cs/6
 * тайл идёт y ∈ [−cs/12, +cs/12]. Чтобы ВЕРХ тайла был на y=0 (flush с
 * основанием башен/стен/врагов), центр тайла ставится на y = −cs/12.
 *
 * receiveShadows=true на тайлах — тени от акторов ложатся на конкретные клетки
 * (вместо невидимого ground-плейна в createScene).
 *
 * Тайлы статичны на карте — populate() один раз в конструкторе. Не зависит
 * от GameSnapshot (визуальный слой, не сим).
 */
import { Matrix, Mesh, Quaternion, Vector3, type Scene } from 'babylonjs';
import type { GridData, TileType } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';

const TILE_CATALOG_ID: Record<TileType, string> = {
  grass: 'tile:grass',
  dirt: 'tile:dirt',
  road: 'tile:road',
  water: 'tile:water',
  rock: 'tile:rock',
  sand: 'tile:sand'
};

const ALL_TILE_TYPES: readonly TileType[] = ['grass', 'dirt', 'road', 'water', 'rock', 'sand'];

interface TileMesh {
  mesh: Mesh;
  buffer: Float32Array;
}

export class TileRenderer {
  private readonly masters = new Map<TileType, TileMesh>();
  private readonly grid: GridData;
  private readonly cellSize: number;

  constructor(
    private readonly scene: Scene,
    grid: GridData,
    tiles: TileType[][],
    cellSize: number,
    catalog: AssetCatalog
  ) {
    this.grid = grid;
    this.cellSize = cellSize;

    // Собрать типы тайлов, реально встречающиеся на карте
    const used = new Set<TileType>();
    for (let r = 0; r < grid.rows; r++) {
      const row = tiles[r];
      if (!row) continue;
      for (let c = 0; c < grid.cols; c++) used.add(row[c] ?? 'grass');
    }
    if (used.size === 0) used.add('grass');

    const maxCells = grid.rows * grid.cols;
    for (const type of ALL_TILE_TYPES) {
      if (!used.has(type)) continue;
      const id = TILE_CATALOG_ID[type];
      const master = catalog.buildMaster(id, `tile-master-${type}`, { matte: true });
      master.isVisible = true;
      master.isPickable = false;
      master.receiveShadows = true; // тени акторов ложатся на тайлы
      master.doNotSyncBoundingInfo = true;
      master.alwaysSelectAsActiveMesh = true; // thin instances не имеют auto-bounds
      const buffer = new Float32Array(maxCells * 16);
      master.thinInstanceSetBuffer('matrix', buffer, 16, false);
      master.thinInstanceCount = 0;
      this.masters.set(type, { mesh: master, buffer });
    }

    this.populate(tiles);
  }

  /** Заполняет thin-instance буферы матрицами клеток. Вызывается один раз. */
  private populate(tiles: TileType[][]): void {
    const cs = this.cellSize;
    const cols = this.grid.cols;
    const rows = this.grid.rows;
    const halfW = (cols * cs) / 2;
    const halfD = (rows * cs) / 2;
    // tile-мастер: XZ-size=6, Y-size=1 → scale=cs/6 даёт плоский тайл cellSize×(cs/6)×cellSize.
    const s = cs / 6;
    const tmpScale = new Vector3(s, s, s);
    const tmpRot = Quaternion.Identity();
    const tmpMat = Matrix.Identity();

    const counts = new Map<TileType, number>();
    // tile-мастер: XZ-size=6, Y-size=1 → scale=cs/6 даёт плоский тайл cellSize×(cs/6)×cellSize.
    // Y = -cs/12 → ВЕРХ тайла на y=0 (flush с основанием башен/стен/врагов, post-MVP фикс).
    const tileY = -cs / 12;
    for (let r = 0; r < rows; r++) {
      const row = tiles[r];
      for (let c = 0; c < cols; c++) {
        const type = (row?.[c] ?? 'grass') as TileType;
        const entry = this.masters.get(type);
        if (!entry) continue;
        let idx = counts.get(type) ?? 0;
        // cell-center в world coords (центр поля в origin)
        const x = c * cs + cs / 2 - halfW;
        const z = r * cs + cs / 2 - halfD;
        Matrix.ComposeToRef(tmpScale, tmpRot, new Vector3(x, tileY, z), tmpMat);
        tmpMat.copyToArray(entry.buffer, idx * 16);
        idx += 1;
        counts.set(type, idx);
      }
    }

    for (const [type, count] of counts) {
      const entry = this.masters.get(type);
      if (!entry) continue;
      entry.mesh.thinInstanceBufferUpdated('matrix');
      entry.mesh.thinInstanceCount = count;
    }
  }

  /** Master-меши (по типу тайла) — для регистрации теней. */
  getShadowReceiverMeshes(): Mesh[] {
    return Array.from(this.masters.values()).map((t) => t.mesh);
  }

  dispose(): void {
    for (const { mesh } of this.masters.values()) mesh.dispose();
    this.masters.clear();
  }
}
