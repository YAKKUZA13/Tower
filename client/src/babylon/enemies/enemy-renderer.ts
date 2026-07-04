/**
 * Рендер врагов через thin instances (ADR-4): 1 draw call на тип врага.
 * Phase 2: master-меш — воксельная модель из каталога (вместо box-примитива).
 *
 * ВАЖНО (thin instances): мировой матрице мастера оставляем identity, а cellSize и
 * per-категорию масштаб закладываем в саму thin-matrix. Иначе master.scaling умножал бы
 * и трансляции (враги улетали бы в cellSize×x). Модель нормализована (base @ y=-0.5,
 * height 1.0), поэтому base «стоит» на groundY; Y-масштаб × hpRatio = обратная связь.
 */
import { Matrix, Mesh, Quaternion, Vector3, type Scene } from 'babylonjs';
import type { EnemyType, GameSnapshot } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';

const MAX_PER_TYPE = 2000;

/** Множитель размера по категории врага. */
function categorySizeMult(category: EnemyType['category']): number {
  switch (category) {
    case 'boss': return 1.7;
    case 'tank': return 1.2;
    case 'fast': return 0.85;
    default: return 1.0;
  }
}

interface TypeMesh {
  mesh: Mesh;
  buffer: Float32Array;
  sizeMult: number;
}

export class EnemyRenderer {
  private readonly types = new Map<string, TypeMesh>();
  private readonly tmpMatrix = Matrix.Identity();
  private readonly tmpRotation = Quaternion.Identity();
  private readonly tmpScale = new Vector3(1, 1, 1);
  private readonly cellSize: number;

  constructor(
    scene: Scene,
    enemyTypes: EnemyType[],
    cellSize: number,
    catalog: AssetCatalog
  ) {
    this.cellSize = cellSize;
    for (const type of enemyTypes) {
      // мастер остаётся unit-размера (masterWorld = identity)
      const master = catalog.buildMaster(type.modelRef.catalogId, `enemy-${type.id}`);
      master.isVisible = true;
      master.isPickable = false;
      master.doNotSyncBoundingInfo = true;
      master.alwaysSelectAsActiveMesh = true; // thin instances не имеют auto-bounds
      const buffer = new Float32Array(MAX_PER_TYPE * 16);
      master.thinInstanceSetBuffer('matrix', buffer, 16, false);
      master.thinInstanceCount = 0;
      this.types.set(type.id, { mesh: master, buffer, sizeMult: categorySizeMult(type.category) });
    }
  }

  sync(state: GameSnapshot): void {
    const cs = this.cellSize;
    const counts = new Map<string, number>();
    for (const { mesh } of this.types.values()) mesh.thinInstanceCount = 0;

    for (const enemy of state.enemies) {
      const t = this.types.get(enemy.typeId);
      if (!t) continue;
      let idx = counts.get(enemy.typeId) ?? 0;
      if (idx >= MAX_PER_TYPE) continue;
      const hpRatio = enemy.maxHp > 0 ? Math.max(0.35, Math.min(1, enemy.hp / enemy.maxHp)) : 1;
      const m = t.sizeMult;
      const sy = m * hpRatio;
      // cellSize закладывается в thin-matrix: scale = cs·(m, m·hp, m); base @ groundY.
      this.tmpScale.set(cs * m, cs * sy, cs * m);
      const halfH = (cs * sy) / 2;
      Matrix.ComposeToRef(
        this.tmpScale,
        this.tmpRotation,
        new Vector3(enemy.position.x, enemy.position.y + halfH, enemy.position.z),
        this.tmpMatrix
      );
      this.tmpMatrix.copyToArray(t.buffer, idx * 16);
      idx += 1;
      counts.set(enemy.typeId, idx);
    }
    for (const [typeId, count] of counts) {
      const t = this.types.get(typeId);
      if (!t) continue;
      t.mesh.thinInstanceBufferUpdated('matrix');
      t.mesh.thinInstanceCount = count;
    }
  }

  /** Master-меши (по типу) — для регистрации теней. Thin instances наследуют тень от master. */
  getShadowCasterMeshes(): Mesh[] {
    return Array.from(this.types.values()).map((t) => t.mesh);
  }

  dispose(): void {
    for (const { mesh } of this.types.values()) mesh.dispose();
    this.types.clear();
  }
}