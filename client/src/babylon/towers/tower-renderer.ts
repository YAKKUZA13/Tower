/**
 * Рендер башен через InstancedMesh (ADR-4). Башен немного и они статичны.
 * Phase 2: геометрия — воксельная модель из каталога (вместо box-примитива).
 *
 * ВАЖНО (InstancedMesh): source-меш отдаёт только геометрию; его scaling НЕ применяется
 * к инстансам. cellSize задаётся на каждом инстансе. Модель нормализована
 * (base @ y=-0.5, height 1.0) → base «стоит» на groundY.
 */
import { InstancedMesh, Mesh, Vector3, type Scene } from 'babylonjs';
import type { GameSnapshot, GridData, TowerType } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';

interface TypeBase {
  /** Скрытый источник геометрии для инстансов (unit-размер). */
  source: Mesh;
  cellSize: number;
  rotationY: number;
}

export class TowerRenderer {
  private readonly bases = new Map<string, TypeBase>();
  private readonly instances = new Map<string, InstancedMesh>();

  constructor(
    scene: Scene,
    towerTypes: TowerType[],
    private grid: GridData,
    private heightmap: number[][],
    catalog: AssetCatalog
  ) {
    for (const type of towerTypes) {
      const source = catalog.buildMaster(type.modelRef.catalogId, `tower-${type.id}`);
      source.isVisible = false; // рендерятся только инстансы
      source.isPickable = false;
      source.doNotSyncBoundingInfo = true;
      this.bases.set(type.id, { source, cellSize: grid.cellSize, rotationY: type.modelRef.rotationY ?? 0 });
    }
  }

  /** Клик-пикинг по инстансам башен: возвращает towerId или null. */
  pickTowerId(mesh: { name: string } | null | undefined): string | null {
    if (!mesh) return null;
    if (mesh.name.startsWith('tower-inst-')) return mesh.name.slice('tower-inst-'.length);
    return null;
  }

  /** Source-меши (по типу) — для регистрации теней. Инстансы наследуют тень от source. */
  getShadowCasterMeshes(): Mesh[] {
    return Array.from(this.bases.values()).map((b) => b.source);
  }

  sync(state: GameSnapshot): void {
    const seen = new Set<string>();
    const halfW = (this.grid.cols * this.grid.cellSize) / 2;
    const halfH = (this.grid.rows * this.grid.cellSize) / 2;

    for (const tower of state.towers) {
      seen.add(tower.id);
      const type = this.bases.get(tower.typeId);
      if (!type) continue;
      let inst = this.instances.get(tower.id);
      if (!inst) {
        inst = type.source.createInstance(`tower-inst-${tower.id}`);
        inst.isPickable = true;
        // cellSize — на инстанс (geometry остаётся unit)
        inst.scaling.set(type.cellSize, type.cellSize, type.cellSize);
        this.instances.set(tower.id, inst);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, tower.col, tower.row, true);
      const x = (tower.col + 0.5) * this.grid.cellSize - halfW;
      const z = (tower.row + 0.5) * this.grid.cellSize - halfH;
      // модель base @ y=-0.5 → центр на groundY + cellSize/2
      inst.position.set(x, groundY + type.cellSize / 2, z);
      inst.rotation.y = tower.rotationY + type.rotationY;
    }
    for (const [id, inst] of this.instances) {
      if (!seen.has(id)) {
        inst.dispose();
        this.instances.delete(id);
      }
    }
  }

  dispose(): void {
    for (const inst of this.instances.values()) inst.dispose();
    this.instances.clear();
    for (const b of this.bases.values()) b.source.dispose();
    this.bases.clear();
  }
}
