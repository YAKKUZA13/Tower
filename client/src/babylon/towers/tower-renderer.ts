/**
 * Рендер башен через InstancedMesh (ADR-4). Башен немного и они статичны.
 * Phase 2: геометрия — воксельная модель из каталога (вместо box-примитива).
 *
 * ВАЖНО (InstancedMesh): source-меш отдаёт только геометрию; его scaling НЕ применяется
 * к инстансам. cellSize задаётся на каждом инстансе. Модель нормализована
 * (base @ y=-0.5, height 1.0) → base «стоит» на groundY.
 *
 * Post-MVP улучшения:
 *  - **Rotation lerp**: визуальный поворот к цели плавно догоняет авторитетный
 *    `tower.rotationY` со скоростью ~10 рад/сек (Kingdom Rush feel).
 *  - **Muzzle flash**: пул ParticleSystem; при детекте нового `lastFireTick`
 *    выстреливаем короткий бёрст эмиссивных частиц со ствола.
 *  - **Range ring**: тонкий emissive-тор на земле; showRange(towerId|null)
 *    управляет видимостью (hover/select в Game.vue).
 */
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { GameSnapshot, GridData, TowerType } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';

const ROT_LERP_PER_SEC = 10; // рад/сек — скорость доворота к цели
const MUZZLE_POOL = 8;
const MUZZLE_PARTICLES = 12;

interface TypeBase {
  /** Скрытый источник геометрии для инстансов (unit-размер). */
  source: Mesh;
  cellSize: number;
  rotationY: number;
}

interface InstanceView {
  inst: InstancedMesh;
  /** Текущий визуальный yaw (lerp к tower.rotationY). */
  currentRotY: number;
  /** Последний замеченный lastFireTick (для muzzle flash детекта). */
  lastSeenFireTick: number;
  /** Позиция ствола (мир) — для muzzle emitter. Кешируется из позиции инстанса. */
  muzzleWorld: Vector3;
}

export class TowerRenderer {
  private readonly bases = new Map<string, TypeBase>();
  private readonly instances = new Map<string, InstanceView>();
  /** Range-ring по typeId — единый тор, переиспользуется между башнями. */
  private rangeRing: Mesh | null = null;
  private rangeTowerId: string | null = null;
  private readonly particles: ParticleSystem[] = [];
  private particleIdx = 0;
  private lastNow = 0;

  constructor(
    private scene: Scene,
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

    // пул частиц для muzzle-flash (переиспользуется между башнями; emitRate=0 = «свободна»)
    for (let i = 0; i < MUZZLE_POOL; i++) {
      const ps = new ParticleSystem(`tower-muzzle-${i}`, MUZZLE_PARTICLES, scene);
      ps.emitter = new Vector3(0, 0, 0);
      ps.minEmitBox = new Vector3(-0.05, -0.05, -0.05);
      ps.maxEmitBox = new Vector3(0.05, 0.05, 0.05);
      ps.color1 = new Color4(1, 0.85, 0.4, 1);
      ps.color2 = new Color4(1, 0.45, 0.15, 1);
      ps.colorDead = new Color4(0.3, 0.15, 0.05, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.18;
      ps.minLifeTime = 0.06;
      ps.maxLifeTime = 0.16;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.direction1 = new Vector3(-2, 1, -2);
      ps.direction2 = new Vector3(2, 3, 2);
      ps.minEmitPower = 1;
      ps.maxEmitPower = 3;
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.start();
      ps.targetStopDuration = 0.12;
      this.particles.push(ps);
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

  /**
   * Показать/скрыть радиус башни. null — скрыть.
   * `rangeCells` — радиус в клетках из TowerType.range; `cellSize` — размер клетки.
   * Диаметр ring = 2 * range * cellSize. Создаёт ring при первом вызове.
   */
  showRange(towerId: string | null, rangeCells = 0): void {
    this.rangeTowerId = towerId;
    if (!this.rangeRing) {
      const ring = MeshBuilder.CreateTorus('tower-range-ring', {
        diameter: 2,
        thickness: 0.04,
        tessellation: 48
      }, this.scene);
      const mat = new StandardMaterial('tower-range-ring-mat', this.scene);
      mat.emissiveColor = new Color3(0.95, 0.75, 0.25);
      mat.diffuseColor = new Color3(0, 0, 0);
      mat.disableLighting = true;
      mat.alpha = 0.55;
      mat.zOffset = -2;
      ring.material = mat;
      ring.isPickable = false;
      ring.setEnabled(false);
      this.rangeRing = ring;
    }
    if (!towerId) {
      this.rangeRing.setEnabled(false);
      return;
    }
    // diameter: ring создан с diameter=2; scale-x/z чтобы получить 2*range*cellSize.
    const diameterWorld = 2 * rangeCells * this.grid.cellSize;
    this.rangeRing.scaling.set(diameterWorld / 2, 1, diameterWorld / 2);
    const view = this.instances.get(towerId);
    if (view) {
      this.rangeRing.position.set(view.inst.position.x, 0.04, view.inst.position.z);
      this.rangeRing.setEnabled(true);
    } else {
      this.rangeRing.setEnabled(false);
    }
  }

  sync(state: GameSnapshot): void {
    const seen = new Set<string>();
    const halfW = (this.grid.cols * this.grid.cellSize) / 2;
    const halfH = (this.grid.rows * this.grid.cellSize) / 2;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (this.lastNow === 0) this.lastNow = nowMs;
    const dt = Math.min(0.1, (nowMs - this.lastNow) / 1000);
    this.lastNow = nowMs;

    for (const tower of state.towers) {
      seen.add(tower.id);
      const type = this.bases.get(tower.typeId);
      if (!type) continue;
      let view = this.instances.get(tower.id);
      if (!view) {
        const inst = type.source.createInstance(`tower-inst-${tower.id}`);
        inst.isPickable = true;
        // cellSize — на инстанс (geometry остаётся unit)
        inst.scaling.set(type.cellSize, type.cellSize, type.cellSize);
        view = {
          inst,
          currentRotY: tower.rotationY + type.rotationY,
          lastSeenFireTick: tower.lastFireTick ?? -1,
          muzzleWorld: new Vector3(0, type.cellSize * 0.85, 0)
        };
        this.instances.set(tower.id, view);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, tower.col, tower.row, true);
      const x = (tower.col + 0.5) * this.grid.cellSize - halfW;
      const z = (tower.row + 0.5) * this.grid.cellSize - halfH;
      // модель base @ y=-0.5 → центр на groundY + cellSize/2
      view.inst.position.set(x, groundY + type.cellSize / 2, z);

      // rotation lerp: плавный доворот к tower.rotationY
      const targetRot = tower.rotationY + type.rotationY;
      view.currentRotY = lerpAngleRad(view.currentRotY, targetRot, ROT_LERP_PER_SEC * dt);
      view.inst.rotation.y = view.currentRotY;

      // muzzle flash: если lastFireTick обновился → выпустить бёрст
      const fireTick = tower.lastFireTick ?? -1;
      if (fireTick !== view.lastSeenFireTick && fireTick >= 0) {
        view.lastSeenFireTick = fireTick;
        this.spawnMuzzle(x, groundY + type.cellSize * 0.85, z);
      }

      // обновить кеш muzzle-позиции на случай будущих эффектов
      view.muzzleWorld.set(x, groundY + type.cellSize * 0.85, z);
    }
    for (const [id, view] of this.instances) {
      if (!seen.has(id)) {
        view.inst.dispose();
        this.instances.delete(id);
      }
    }

    // обновить позицию range-ring если активен
    if (this.rangeRing && this.rangeTowerId) {
      const view = this.instances.get(this.rangeTowerId);
      if (view) {
        this.rangeRing.position.set(view.inst.position.x, 0.04, view.inst.position.z);
        this.rangeRing.setEnabled(true);
      } else {
        this.rangeRing.setEnabled(false);
      }
    }
  }

  /**
   * Установить диаметр range-ring (альтернатива если внешний код знает диаметр напрямую).
   * Диаметр в world units.
   */
  setRangeRingDiameter(diameterWorld: number): void {
    if (!this.rangeRing) return;
    this.rangeRing.scaling.set(diameterWorld / 2, 1, diameterWorld / 2);
  }

  private spawnMuzzle(x: number, y: number, z: number): void {
    if (this.particles.length === 0) return;
    const ps = this.particles[this.particleIdx]!;
    this.particleIdx = (this.particleIdx + 1) % this.particles.length;
    (ps.emitter as Vector3).set(x, y, z);
    ps.manualEmitCount = MUZZLE_PARTICLES;
    ps.start(0.12);
  }

  dispose(): void {
    for (const view of this.instances.values()) view.inst.dispose();
    this.instances.clear();
    for (const b of this.bases.values()) b.source.dispose();
    this.bases.clear();
    this.rangeRing?.dispose();
    this.rangeRing = null;
    for (const ps of this.particles) {
      ps.stop(true);
      ps.dispose();
    }
    this.particles.length = 0;
  }
}

/** Кратчайший путь по окружности между двумя углами (rad). */
function lerpAngleRad(from: number, to: number, maxStep: number): number {
  // нормализуем разность к [−π, +π]
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-maxStep, Math.min(maxStep, diff));
  return from + step;
}
