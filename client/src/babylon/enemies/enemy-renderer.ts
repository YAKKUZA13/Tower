/**
 * Рендер врагов через thin instances (ADR-4): 1 draw call на тип врага.
 * Phase 2: master-меш — воксельная модель из каталога (вместо box-примитива).
 *
 * ВАЖНО (thin instances): мировой матрице мастера оставляем identity, а cellSize и
 * per-категорию масштаб закладываем в саму thin-matrix. Иначе master.scaling умножал бы
 * и трансляции (враги улетали бы в cellSize×x). Модель нормализована (base @ y=-0.5,
 * height 1.0), поэтому base «стоит» на groundY; Y-масштаб × hpRatio = обратная связь.
 *
 * Post-MVP улучшения:
 *  - **Y-bobbing**: каждый враг «дышит» — sin(nowMs*ω + per-id seed)*amp. Делает
 *    рой живым даже со статичными procedural-моделями. 1 sin на врага.
 *  - **Hit-flash**: при попадании tint → красноватый «урон» на ~180мс (через
 *    per-instance color buffer). Сим помечает `enemy.hitFlashUntilTick`.
 *  - **Death poof**: при исчезновении врага (alive=true → false) — короткий
 *    particle burst из пула (переиспользуется между врагами).
 *  - **HP bar** для boss/tank-категорий: DynamicTexture+Plane (billboardMode=ALL),
 *    пул переиспользуемых баров; для normal/fast — не показываем (как в Bloons).
 */
import {
  Color3,
  Color4,
  Constants,
  DynamicTexture,
  Matrix,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Quaternion,
  RawTexture,
  StandardMaterial,
  Texture,
  Vector3,
  type Scene
} from 'babylonjs';
import type { EnemyType, Enemy, GameSnapshot } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { VoxelDebrisPool } from '../voxel/voxel-debris';
import { VOXEL_BUILDERS, type Voxel } from '../voxel/voxel-builder';

/**
 * Общий интерфейс рендера врагов в сцену (Фаза P0: добавлен rigged-путь).
 * EnemyRenderer (thin instances) и RiggedEnemyRenderer (part-graph + walk-cycle)
 * оба реализуют его → game-loop полиморфен. Структурный — существующий EnemyRenderer
 * уже имеет эти 3 метода, поэтому совместим без изменений.
 */
export interface EnemySceneRenderer {
  sync(state: GameSnapshot): void;
  getShadowCasterMeshes(): Mesh[];
  dispose(): void;
}

const MAX_PER_TYPE = 2000;
/** Амплитуда Y-bobbing в долях cellSize. */
const BOB_AMP_RATIO = 0.04;
/** Частота Y-bobbing (рад/сек). */
const BOB_FREQ = 6.0;
/** Размер пула particle-system для death poof. */
const DEATH_POOF_POOL = 8;
const DEATH_POOF_PARTICLES = 24;
/** Сколько HP-баров держать в пуле (только для boss/tank). */
const HP_BAR_POOL = 12;

/** Множитель размера по категории врага. */
function categorySizeMult(category: EnemyType['category']): number {
  switch (category) {
    case 'boss': return 1.7;
    case 'tank': return 1.2;
    case 'fast': return 0.85;
    default: return 1.0;
  }
}

/** Должна ли категория врага показывать HP-bar. */
function shouldShowHpBar(category: EnemyType['category']): boolean {
  return category === 'boss' || category === 'tank';
}

/** Детерминированный сид из id врага → [0, 2π) для per-instance фазы bobbing. */
function phaseFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return ((Math.abs(h) % 6283) / 1000);
}

interface TypeMesh {
  mesh: Mesh;
  matrixBuf: Float32Array;
  colorBuf: Float32Array;
  sizeMult: number;
  category: EnemyType['category'];
}

interface HpBarSlot {
  plane: Mesh;
  tex: DynamicTexture;
  ctx: CanvasRenderingContext2D;
  /** Какому enemyId сейчас назначен (null = свободен). */
  enemyId: string | null;
}

interface PrevEnemyRec {
  col: number;
  row: number;
  x: number;
  z: number;
  typeId: string;
  sizeMult: number;
}

export class EnemyRenderer {
  private readonly types = new Map<string, TypeMesh>();
  private readonly tmpMatrix = Matrix.Identity();
  private readonly tmpRotation = Quaternion.Identity();
  private readonly tmpScale = new Vector3(1, 1, 1);
  private readonly cellSize: number;
  private readonly scene: Scene;

  /** Пул HP-баров (переиспользуется между врагами с категорией boss/tank). */
  private readonly hpBars: HpBarSlot[] = [];
  /** map enemyId → slot index (для быстрого обновления). */
  private readonly hpBarByEnemy = new Map<string, number>();

  /** Пул particle-system для death-poof; emitRate=0 = «свободна». */
  private readonly particles: ParticleSystem[] = [];
  private readonly particleTex: RawTexture;
  private particleIdx = 0;

  /** Кеш предыдущих врагов — для детекта death (исчезновение id). */
  private prevById = new Map<string, PrevEnemyRec>();
  /** Опц. пул воксельного дебриса (Фаза P1 — разрушаемость не-rigged врагов). */
  private readonly debris: VoxelDebrisPool | null = null;
  /** typeId → Voxel[] мастера (для дебриса). */
  private readonly typeVoxels = new Map<string, Voxel[]>();
  private lastNowMs = 0;

  constructor(
    scene: Scene,
    enemyTypes: EnemyType[],
    cellSize: number,
    catalog: AssetCatalog,
    options: { enableDebris?: boolean } = {}
  ) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.debris = options.enableDebris ? new VoxelDebrisPool(scene, cellSize) : null;
    for (const type of enemyTypes) {
      // мастер остаётся unit-размера (masterWorld = identity)
      const master = catalog.buildMaster(type.modelRef.catalogId, `enemy-${type.id}`);
      master.isVisible = true;
      master.isPickable = false;
      master.doNotSyncBoundingInfo = true;
      master.alwaysSelectAsActiveMesh = true; // thin instances не имеют auto-bounds
      const matrixBuf = new Float32Array(MAX_PER_TYPE * 16);
      const colorBuf = new Float32Array(MAX_PER_TYPE * 4);
      master.thinInstanceSetBuffer('matrix', matrixBuf, 16, false);
      master.thinInstanceSetBuffer('color', colorBuf, 4, false);
      master.thinInstanceCount = 0;
      this.types.set(type.id, {
        mesh: master,
        matrixBuf,
        colorBuf,
        sizeMult: categorySizeMult(type.category),
        category: type.category
      });
      // кешируем Voxel[] мастера для дебриса (если включён)
      if (this.debris) {
        const builder = VOXEL_BUILDERS[type.modelRef.catalogId];
        if (builder) this.typeVoxels.set(type.id, builder());
      }
    }

    // пул HP-баров
    for (let i = 0; i < HP_BAR_POOL; i++) {
      const tex = new DynamicTexture(`enemy-hp-tex-${i}`, { width: 64, height: 8 }, scene, false);
      tex.hasAlpha = true;
      const mat = new StandardMaterial(`enemy-hp-mat-${i}`, scene);
      mat.diffuseTexture = tex;
      mat.opacityTexture = tex;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.zOffset = -3;
      const plane = MeshBuilder.CreatePlane(`enemy-hp-${i}`, { width: 1.0, height: 0.14 }, scene);
      plane.material = mat;
      plane.isPickable = false;
      plane.billboardMode = 7; // BILLBOARDMODE_ALL
      plane.setEnabled(false);
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      this.hpBars.push({ plane, tex, ctx, enemyId: null });
    }

    // пул particle-system для death-poof
    this.particleTex = makePoofTexture(scene);
    for (let i = 0; i < DEATH_POOF_POOL; i++) {
      const ps = new ParticleSystem(`enemy-poof-${i}`, DEATH_POOF_PARTICLES, scene);
      ps.particleTexture = this.particleTex;
      ps.emitter = new Vector3(0, 0, 0);
      ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
      ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
      ps.color1 = new Color4(0.55, 0.10, 0.10, 1);
      ps.color2 = new Color4(0.30, 0.06, 0.06, 1);
      ps.colorDead = new Color4(0.05, 0.02, 0.02, 0);
      ps.minSize = 0.06;
      ps.maxSize = 0.18;
      ps.minLifeTime = 0.3;
      ps.maxLifeTime = 0.7;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.direction1 = new Vector3(-2, 3, -2);
      ps.direction2 = new Vector3(2, 5, 2);
      ps.gravity = new Vector3(0, -6, 0);
      ps.minEmitPower = 1.5;
      ps.maxEmitPower = 4;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.start();
      ps.targetStopDuration = 0.7;
      this.particles.push(ps);
    }
  }

  sync(state: GameSnapshot): void {
    const cs = this.cellSize;
    const counts = new Map<string, number>();
    for (const { mesh } of this.types.values()) mesh.thinInstanceCount = 0;

    // nowMs — для Y-bobbing.
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const bobAmp = cs * BOB_AMP_RATIO;
    const tick = state.tick;

    // Освободить HP-bar слоты для врагов, которых больше нет.
    const currentIds = new Set<string>();
    for (const enemy of state.enemies) currentIds.add(enemy.id);

    const usedSlots = new Set<number>();
    for (const [enemyId, slotIdx] of this.hpBarByEnemy) {
      if (!currentIds.has(enemyId)) {
        // враг исчез — освободить слот (death poof отдельно ниже)
        const slot = this.hpBars[slotIdx]!;
        slot.enemyId = null;
        slot.plane.setEnabled(false);
        this.hpBarByEnemy.delete(enemyId);
      } else {
        usedSlots.add(slotIdx);
      }
    }

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
      // Y-bobbing
      const bob = Math.sin(nowMs * 0.001 * BOB_FREQ * 2 * Math.PI + phaseFromId(enemy.id)) * bobAmp;
      Matrix.ComposeToRef(
        this.tmpScale,
        this.tmpRotation,
        new Vector3(enemy.position.x, enemy.position.y + halfH + bob, enemy.position.z),
        this.tmpMatrix
      );
      this.tmpMatrix.copyToArray(t.matrixBuf, idx * 16);

      // per-instance color: hit-flash
      const ci = idx * 4;
      const FLASH_TICKS = 6;
      let r = 1, g = 1, b = 1;
      if (enemy.hitFlashUntilTick && enemy.hitFlashUntilTick > tick) {
        const flash = Math.min(1, (enemy.hitFlashUntilTick - tick) / FLASH_TICKS);
        r = 1 + 0.8 * flash;
        g = 1 - 0.5 * flash;
        b = 1 - 0.5 * flash;
      }
      t.colorBuf[ci] = r;
      t.colorBuf[ci + 1] = g;
      t.colorBuf[ci + 2] = b;
      t.colorBuf[ci + 3] = 1;

      // HP-bar для boss/tank категорий с hp < maxHp
      if (shouldShowHpBar(t.category) && enemy.hp < enemy.maxHp) {
        this.updateHpBar(enemy, enemy.position.x, enemy.position.y + halfH * 2 + bob + 0.2, enemy.position.z, usedSlots);
      }

      idx += 1;
      counts.set(enemy.typeId, idx);
    }
    for (const [typeId, count] of counts) {
      const t = this.types.get(typeId);
      if (!t) continue;
      t.mesh.thinInstanceBufferUpdated('matrix');
      t.mesh.thinInstanceBufferUpdated('color');
      t.mesh.thinInstanceCount = count;
    }

    // death-poof: для всех id что были в prev но исчезли
    for (const [id, rec] of this.prevById) {
      if (!currentIds.has(id)) this.spawnPoof(rec);
    }
    // обновить кеш prev
    this.prevById.clear();
    for (const e of state.enemies) {
      const t = this.types.get(e.typeId);
      this.prevById.set(e.id, {
        col: Math.floor((e.position.x + (cs * 0)) / cs),
        row: 0,
        x: e.position.x,
        z: e.position.z,
        typeId: e.typeId,
        sizeMult: t?.sizeMult ?? 1
      });
    }
    // интеграция дебриса (если включён)
    if (this.debris) {
      const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const dt = this.lastNowMs === 0 ? 0 : Math.min(0.1, (nowMs - this.lastNowMs) / 1000);
      this.lastNowMs = nowMs;
      this.debris.update(dt);
    }
  }

  private updateHpBar(enemy: Enemy, x: number, y: number, z: number, usedSlots: Set<number>): void {
    let slotIdx = this.hpBarByEnemy.get(enemy.id);
    if (slotIdx === undefined) {
      // найти свободный слот
      const freeIdx = this.hpBars.findIndex((s) => s.enemyId === null);
      if (freeIdx < 0) return; // пул исчерпан — не показываем
      slotIdx = freeIdx;
      this.hpBars[slotIdx]!.enemyId = enemy.id;
      this.hpBarByEnemy.set(enemy.id, slotIdx);
    }
    usedSlots.add(slotIdx);
    const slot = this.hpBars[slotIdx]!;
    slot.plane.setEnabled(true);
    slot.plane.position.set(x, y, z);
    const ratio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
    const ctx = slot.ctx;
    ctx.clearRect(0, 0, 64, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, 64, 8);
    ctx.fillStyle = ratio > 0.5 ? '#dc2626' : ratio > 0.25 ? '#f59e0b' : '#7f1d1d';
    ctx.fillRect(1, 1, Math.round(62 * ratio), 6);
    slot.tex.update();
  }

  private spawnPoof(rec: PrevEnemyRec): void {
    if (this.particles.length === 0) return;
    const ps = this.particles[this.particleIdx]!;
    this.particleIdx = (this.particleIdx + 1) % this.particles.length;
    (ps.emitter as Vector3).set(rec.x, this.cellSize * 0.4, rec.z);
    ps.manualEmitCount = Math.round(DEATH_POOF_PARTICLES * Math.max(0.6, Math.min(1.4, rec.sizeMult)));
    ps.start(0.7);
    // опц. воксельный дебрис из Voxel[] мастера (Фаза P1)
    if (this.debris) {
      const voxels = this.typeVoxels.get(rec.typeId);
      if (voxels && voxels.length > 0) {
        this.debris.spawn(voxels, new Vector3(rec.x, this.cellSize * 0.5, rec.z), {
          velocity: new Vector3(0, 3.0, 0),
          count: Math.min(voxels.length, 14)
        });
      }
    }
  }

  /** Master-меши (по типу) — для регистрации теней. Thin instances наследуют тень от master. */
  getShadowCasterMeshes(): Mesh[] {
    return Array.from(this.types.values()).map((t) => t.mesh);
  }

  dispose(): void {
    for (const { mesh } of this.types.values()) mesh.dispose();
    this.types.clear();
    for (const slot of this.hpBars) {
      slot.plane.dispose();
      slot.tex.dispose();
    }
    this.hpBars.length = 0;
    this.hpBarByEnemy.clear();
    for (const ps of this.particles) {
      ps.stop(true);
      ps.dispose();
    }
    this.particles.length = 0;
    this.particleTex.dispose();
    this.prevById.clear();
    this.debris?.dispose();
    this.typeVoxels.clear();
  }
}

/** Крошечная тёмная текстура-«осколок» для death-poof (без внешних ассетов). */
function makePoofTexture(scene: Scene): RawTexture {
  const s = 8;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - s / 2 + 0.5;
      const dy = y - s / 2 + 0.5;
      const inside = dx * dx + dy * dy <= (s / 2) * (s / 2);
      const a = inside ? 255 : 0;
      const o = (y * s + x) * 4;
      data[o] = 120;
      data[o + 1] = 30;
      data[o + 2] = 30;
      data[o + 3] = a;
    }
  }
  const tex = new RawTexture(data, s, s, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  tex.name = 'enemy-poof-texture';
  tex.hasAlpha = true;
  return tex;
}
