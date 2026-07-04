/**
 * Пул снарядов через thin instances (ADR-4). Один master-mesh, фикс. буфер → 1 draw call.
 * Phase 2: master — воксельный болт из каталога (вместо box-примитива).
 *
 * ВАЖНО (thin instances): masterWorld = identity; масштаб закладывается в thin-matrix.
 */
import { Color3, Matrix, Mesh, Quaternion, StandardMaterial, Vector3, type Scene } from 'babylonjs';
import type { GameSnapshot } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { PROJECTILE_COLOR } from '../colors';

const POOL_SIZE = 512;

export class ProjectilePool {
  private readonly mesh: Mesh;
  private readonly buffer: Float32Array;
  private readonly tmpMatrix = Matrix.Identity();
  private readonly tmpRotation = Quaternion.Identity();
  private readonly tmpScale: Vector3;

  constructor(scene: Scene, cellSize: number, catalog: AssetCatalog) {
    const master = catalog.buildMaster('projectile:bolt', 'projectiles');
    // магический «огонёк»: яркий, не зависит от освещения
    const mat = master.material instanceof StandardMaterial ? master.material : null;
    if (mat) {
      const [r, g, b] = PROJECTILE_COLOR;
      mat.emissiveColor = new Color3(r, g, b);
      mat.diffuseColor = new Color3(r, g, b);
      mat.disableLighting = true;
    }
    master.isVisible = true;
    master.isPickable = false;
    master.doNotSyncBoundingInfo = true;
    master.alwaysSelectAsActiveMesh = true;
    this.mesh = master;
    // размер снаряда (cellSize закладывается в thin-matrix, не в master.scaling)
    const s = Math.max(0.16, cellSize * 0.16);
    this.tmpScale = new Vector3(s, s, s);
    this.buffer = new Float32Array(POOL_SIZE * 16);
    this.mesh.thinInstanceSetBuffer('matrix', this.buffer, 16, false);
    this.mesh.thinInstanceCount = 0;
  }

  sync(state: GameSnapshot): void {
    const projectiles = state.projectiles;
    const n = Math.min(POOL_SIZE, projectiles.length);
    for (let i = 0; i < n; i++) {
      const p = projectiles[i];
      Matrix.ComposeToRef(
        this.tmpScale,
        this.tmpRotation,
        new Vector3(p.x, p.y, p.z),
        this.tmpMatrix
      );
      this.tmpMatrix.copyToArray(this.buffer, i * 16);
    }
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceCount = n;
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
