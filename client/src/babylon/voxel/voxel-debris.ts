/**
 * Воксельный дебрис (Фаза P1, research §6.3) — thin instances ОДНОГО unit-cube меша.
 *
 * При смерти парт'а/врага: берём его Voxel[] → спавним count кубов-дебриса с per-instance
 * Matrix (позиция + случайная velocity/rotation) + per-instance COLOR (snapToPalette).
 * Один draw call для ВСЕГО дебриса на поле (thin instances — research §6.3).
 *
 * Эффект-only (не реальная физика): интегрируем velocity (gravity), rotation, fade
 * альфы после TTL, despawn по TTL. CPU-апдейт матриц; ring-buffer reuse без GC churn.
 * Thin instances идеально подходят для не-анимируемого дебриса (ADR-4).
 */
import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  Vector3,
  type Scene
} from 'babylonjs';
import { paletteIndexToRGB, snapToPalette } from './voxel-palette';
import type { Voxel } from './voxel-builder';

/** Максимальное количество одновременного дебриса на поле (ring-buffer pool). */
export const MAX_DEBRIS = 4000;
/** Дефолтное TTL дебриса (сек). */
const DEBRIS_TTL = 1.6;
/** Гравитация (клеток/сек²). */
const DEBRIS_GRAVITY = -14.0;
/** Доля TTL после которой начинается fade альфы. */
const FADE_RATIO = 0.55;
/** Дефолтный размер дебрис-куба (доля cellSize). */
const DEBRIS_SIZE = 0.16;
/** Максимум дебриса за один spawn (ограничение всплеска). */
const MAX_PER_SPAWN = 20;

interface DebrisSlot {
  alive: boolean;
  pos: Vector3;
  vel: Vector3;
  rot: Vector3;          // euler углы
  angVel: Vector3;       // угловая скорость (рад/сек)
  color: [number, number, number, number]; // RGBA (alpha для fade)
  size: number;
  ttl: number;
  life: number;          // оставшееся время
}

export interface SpawnOptions {
  /** Начальная скорость «вверх» (клеток/сек) — всплеск от центра смерти. */
  velocity?: Vector3;
  /** Сколько кубов заспавнить (default = min(voxels.length, MAX_PER_SPAWN)). */
  count?: number;
  /** Размер куба (доля cellSize; default DEBRIS_SIZE). */
  size?: number;
}

/**
 * Пул дебриса: один unit-cube меш с thin instances (matrix + color буферы).
 * Владеет мешом; dispose() освобождает. update(dt) интегрирует кинематику.
 */
export class VoxelDebrisPool {
  private readonly mesh: Mesh;
  private readonly matrixBuf: Float32Array;
  private readonly colorBuf: Float32Array;
  private readonly slots: DebrisSlot[];
  /** Список активных индексов (компактно записываются в буфер каждый кадр). */
  private readonly active: number[] = [];
  /** Свободные слоты (ring-buffer reuse). */
  private readonly free: number[];
  private readonly cellSize: number;
  private readonly scene: Scene;
  private readonly tmpQuat = new Quaternion();
  private readonly tmpScale = new Vector3(1, 1, 1);
  private readonly tmpMat = Matrix.Identity();

  constructor(scene: Scene, cellSize: number) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.mesh = MeshBuilder.CreateBox('voxel-debris-cube', { size: 1 }, scene);
    this.mesh.isPickable = false;
    this.mesh.doNotSyncBoundingInfo = true;
    this.mesh.alwaysSelectAsActiveMesh = true;
    // материал: vertex/per-instance color несёт цвет; общий диффуз белый.
    const mat = new StandardMaterial('voxel-debris-mat', scene);
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = new Color3(0.06, 0.06, 0.06);
    mat.emissiveColor = new Color3(0.18, 0.14, 0.10); // лёгкое «тление»
    this.mesh.material = mat;

    this.matrixBuf = new Float32Array(MAX_DEBRIS * 16);
    this.colorBuf = new Float32Array(MAX_DEBRIS * 4);
    this.mesh.thinInstanceSetBuffer('matrix', this.matrixBuf, 16, false);
    this.mesh.thinInstanceSetBuffer('color', this.colorBuf, 4, false);
    this.mesh.thinInstanceCount = 0;

    this.slots = new Array(MAX_DEBRIS);
    for (let i = 0; i < MAX_DEBRIS; i++) {
      this.slots[i] = {
        alive: false,
        pos: new Vector3(),
        vel: new Vector3(),
        rot: new Vector3(),
        angVel: new Vector3(),
        color: [1, 1, 1, 1],
        size: DEBRIS_SIZE,
        ttl: DEBRIS_TTL,
        life: 0
      };
    }
    this.free = Array.from({ length: MAX_DEBRIS }, (_, i) => MAX_DEBRIS - 1 - i); // stack
  }

  /** Текущее количество активного дебриса. */
  get count(): number {
    return this.active.length;
  }

  /**
   * Спавн дебриса из вокселей парта: count кубиков вокруг worldPos с цветами
   * из partVoxels (snapToPalette), случайной velocity/rotation.
   */
  spawn(partVoxels: Voxel[], worldPos: Vector3, options: SpawnOptions = {}): void {
    if (partVoxels.length === 0 || this.free.length === 0) return;
    const count = Math.min(
      options.count ?? Math.min(partVoxels.length, MAX_PER_SPAWN),
      MAX_PER_SPAWN,
      this.free.length
    );
    const size = (options.size ?? DEBRIS_SIZE) * this.cellSize;
    const baseVel = options.velocity ?? new Vector3(0, 3, 0);
    const cs = this.cellSize;

    for (let i = 0; i < count; i++) {
      const idx = this.free.pop()!;
      const s = this.slots[idx]!;
      const v = partVoxels[(Math.random() * partVoxels.length) | 0]!;
      // snap к палитре для консистентности
      const snapped = snapToPalette(v.color);
      const rgb = paletteIndexToRGB(snapped);
      s.alive = true;
      s.pos.set(
        worldPos.x + (Math.random() - 0.5) * cs * 0.6,
        worldPos.y + (Math.random() - 0.2) * cs * 0.6,
        worldPos.z + (Math.random() - 0.5) * cs * 0.6
      );
      s.vel.set(
        baseVel.x + (Math.random() - 0.5) * 4,
        baseVel.y + Math.random() * 3,
        baseVel.z + (Math.random() - 0.5) * 4
      );
      s.rot.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      s.angVel.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      s.color[0] = rgb[0]; s.color[1] = rgb[1]; s.color[2] = rgb[2]; s.color[3] = 1;
      s.size = size * (0.6 + Math.random() * 0.8);
      s.ttl = DEBRIS_TTL;
      s.life = DEBRIS_TTL;
      this.active.push(idx);
    }
  }

  /** Интегрирует кинематику всех активных частиц (вызывать каждый кадр). */
  update(dt: number): void {
    if (this.active.length === 0) {
      this.mesh.thinInstanceCount = 0;
      return;
    }
    const g = DEBRIS_GRAVITY;
    let w = 0; // write-индекс в компактный буфер
    for (let a = 0; a < this.active.length; a++) {
      const idx = this.active[a]!;
      const s = this.slots[idx]!;
      if (!s.alive) continue; // уже мёртв (защита)
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        this.free.push(idx);
        continue;
      }
      // интеграция (полу-неявный Euler)
      s.vel.y += g * dt;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;
      // простая «земля» на y=0 — отскок/остановка (эффект, не физика)
      if (s.pos.y < 0) {
        s.pos.y = 0;
        s.vel.y *= -0.3;
        s.vel.x *= 0.7; s.vel.z *= 0.7;
      }
      s.rot.x += s.angVel.x * dt;
      s.rot.y += s.angVel.y * dt;
      s.rot.z += s.angVel.z * dt;
      // fade alpha в последней FADE_RATIO жизни
      const lifeRatio = s.life / s.ttl;
      const alpha = lifeRatio < FADE_RATIO ? Math.max(0, lifeRatio / FADE_RATIO) : 1;

      // записать matrix+color компактно по индексу w
      this.tmpScale.set(s.size, s.size, s.size);
      Quaternion.FromEulerAnglesToRef(s.rot.x, s.rot.y, s.rot.z, this.tmpQuat);
      Matrix.ComposeToRef(this.tmpScale, this.tmpQuat, s.pos, this.tmpMat);
      this.tmpMat.copyToArray(this.matrixBuf, w * 16);
      this.colorBuf[w * 4] = s.color[0]!;
      this.colorBuf[w * 4 + 1] = s.color[1]!;
      this.colorBuf[w * 4 + 2] = s.color[2]!;
      this.colorBuf[w * 4 + 3] = alpha;
      w++;
    }
    // обновить длину active (убрать мёртвые, оставшиеся в конце после compact-write)
    this.active.length = w;
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.mesh.thinInstanceBufferUpdated('color');
    this.mesh.thinInstanceCount = w;
  }

  /** Master-меш пула (для регистрации теней — опц.). */
  getMesh(): Mesh {
    return this.mesh;
  }

  dispose(): void {
    this.mesh.dispose();
    this.active.length = 0;
    this.free.length = 0;
  }
}
