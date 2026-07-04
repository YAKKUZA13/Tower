/**
 * Рендер стен лабиринта через thin instances (ADR-4): 1 draw call на материал.
 * Phase 4 задача 4.6.
 *
 *  - master-меш — воксельная модель материала (wall:wood/stone/bone), masterWorld = identity.
 *  - cellSize + groundY закладываются в thin-matrix (как у врагов).
 *  - per-instance COLOR-буфер: повреждение затемняет, горение обугливает (tint ≈ чёрный).
 *  - разрушение → одиночный «взрыв» обломков из пула ParticleSystem (воксель-крошево).
 *
 * Пикинг: стены НЕ пикингуются напрямую; ремонт идёт по клетке (pickGrid → стена в клетке).
 */
import {
  Color4,
  Constants,
  Matrix,
  Mesh,
  ParticleSystem,
  Quaternion,
  RawTexture,
  Texture,
  Vector3,
  type Scene
} from 'babylonjs';
import type { GameSnapshot, GridData, Wall, WallMaterialDef } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';

const MAX_PER_MATERIAL = 1500;
const DEBRIS_POOL = 6;
const DEBRIS_PER_BURST = 28;

interface MaterialMesh {
  mesh: Mesh;
  matrixBuf: Float32Array;
  colorBuf: Float32Array;
}

interface WallRec {
  col: number;
  row: number;
  material: Wall['material'];
}

export class WallRenderer {
  private readonly types = new Map<Wall['material'], MaterialMesh>();
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly cellSize: number;
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly tmpMatrix = Matrix.Identity();
  private readonly tmpRot = Quaternion.Identity();
  private readonly tmpScale = new Vector3(1, 1, 1);

  private prevById = new Map<string, WallRec>();
  private readonly debris: ParticleSystem[] = [];
  private debrisTexture: RawTexture;
  private debrisIdx = 0;

  constructor(scene: Scene, wallDefs: WallMaterialDef[], grid: GridData, heightmap: number[][], catalog: AssetCatalog) {
    this.grid = grid;
    this.heightmap = heightmap;
    this.cellSize = grid.cellSize;
    this.halfW = (grid.cols * grid.cellSize) / 2;
    this.halfH = (grid.rows * grid.cellSize) / 2;

    for (const def of wallDefs) {
      const master = catalog.buildMaster(def.modelRef.catalogId, `wall-${def.material}`);
      master.isVisible = true;
      master.isPickable = false;
      master.doNotSyncBoundingInfo = true;
      master.alwaysSelectAsActiveMesh = true; // thin instances не имеют auto-bounds
      const matrixBuf = new Float32Array(MAX_PER_MATERIAL * 16);
      const colorBuf = new Float32Array(MAX_PER_MATERIAL * 4);
      master.thinInstanceSetBuffer('matrix', matrixBuf, 16, false);
      master.thinInstanceSetBuffer('color', colorBuf, 4, false);
      master.thinInstanceCount = 0;
      this.types.set(def.material, { mesh: master, matrixBuf, colorBuf });
    }

    this.debrisTexture = makeDebrisTexture(scene);
    for (let i = 0; i < DEBRIS_POOL; i++) {
      const ps = new ParticleSystem(`wall-debris-${i}`, DEBRIS_PER_BURST, scene);
      ps.particleTexture = this.debrisTexture;
      ps.emitter = new Vector3(0, 0, 0);
      ps.minEmitBox = new Vector3(-0.1, -0.1, -0.1);
      ps.maxEmitBox = new Vector3(0.1, 0.1, 0.1);
      ps.color1 = new Color4(0.30, 0.26, 0.20, 1);
      ps.color2 = new Color4(0.18, 0.15, 0.12, 1);
      ps.colorDead = new Color4(0.1, 0.08, 0.06, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.18;
      ps.minLifeTime = 0.5;
      ps.maxLifeTime = 1.1;
      ps.emitRate = 0;
      ps.manualEmitCount = 0;
      ps.direction1 = new Vector3(-2, 4, -2);
      ps.direction2 = new Vector3(2, 7, 2);
      ps.gravity = new Vector3(0, -9, 0);
      ps.minEmitPower = 2;
      ps.maxEmitPower = 5;
      ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
      ps.start();
      ps.targetStopDuration = 1.2;
      this.debris.push(ps);
    }
  }

  sync(state: GameSnapshot): void {
    const cs = this.cellSize;
    // сброс счётчиков по материалам
    const counts = new Map<Wall['material'], number>();
    for (const { mesh } of this.types.values()) mesh.thinInstanceCount = 0;

    const currentIds = new Set<string>();
    for (const w of state.walls) {
      currentIds.add(w.id);
      const tm = this.types.get(w.material);
      if (!tm) continue;
      let idx = counts.get(w.material) ?? 0;
      if (idx >= MAX_PER_MATERIAL) continue;

      const groundY = sampleHeight(this.heightmap, this.grid, w.col, w.row, true);
      const x = (w.col + 0.5) * cs - this.halfW;
      const z = (w.row + 0.5) * cs - this.halfH;
      // модель base @ y=-0.5 → центр на groundY + cs/2
      this.tmpScale.set(cs, cs, cs);
      Matrix.ComposeToRef(this.tmpScale, this.tmpRot, new Vector3(x, groundY + cs / 2, z), this.tmpMatrix);
      this.tmpMatrix.copyToArray(tm.matrixBuf, idx * 16);

      // per-instance color: повреждение затемняет, горение обугливает
      const d = w.maxHp > 0 ? Math.max(0, Math.min(1, w.hp / w.maxHp)) : 1;
      let r = 0.50 + 0.50 * d;
      let g = 0.45 + 0.50 * d;
      let b = 0.40 + 0.50 * d;
      if (w.burning) {
        // обугливание к чёрному + лёгкий тёплый огонёк
        r = r * 0.25 + 0.30 * 0.35;
        g = g * 0.18 + 0.14 * 0.25;
        b = b * 0.12 + 0.05 * 0.20;
      }
      const ci = idx * 4;
      tm.colorBuf[ci] = r;
      tm.colorBuf[ci + 1] = g;
      tm.colorBuf[ci + 2] = b;
      tm.colorBuf[ci + 3] = 1;

      counts.set(w.material, idx + 1);
    }

    for (const [material, count] of counts) {
      const tm = this.types.get(material);
      if (!tm) continue;
      tm.mesh.thinInstanceBufferUpdated('matrix');
      tm.mesh.thinInstanceBufferUpdated('color');
      tm.mesh.thinInstanceCount = count;
    }

    // разрушенные стены → взрыв обломков
    for (const [id, rec] of this.prevById) {
      if (currentIds.has(id)) continue;
      this.spawnDebris(rec);
    }
    // обновить кэш
    this.prevById.clear();
    for (const w of state.walls) {
      this.prevById.set(w.id, { col: w.col, row: w.row, material: w.material });
    }
  }

  private spawnDebris(rec: WallRec): void {
    if (this.debris.length === 0) return;
    const ps = this.debris[this.debrisIdx];
    this.debrisIdx = (this.debrisIdx + 1) % this.debris.length;
    const groundY = sampleHeight(this.heightmap, this.grid, rec.col, rec.row, true);
    const x = (rec.col + 0.5) * this.cellSize - this.halfW;
    const z = (rec.row + 0.5) * this.cellSize - this.halfH;
    (ps.emitter as Vector3).set(x, groundY + this.cellSize * 0.4, z);
    ps.manualEmitCount = DEBRIS_PER_BURST;
  }

  dispose(): void {
    for (const { mesh } of this.types.values()) mesh.dispose();
    this.types.clear();
    for (const ps of this.debris) {
      ps.stop(true);
      ps.dispose();
    }
    this.debris.length = 0;
    this.debrisTexture.dispose();
  }
}

/** Маленький тёмный «кусок» для обломков (без внешних ассетов). */
function makeDebrisTexture(scene: Scene): RawTexture {
  const s = 8;
  const data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = x - s / 2 + 0.5;
      const dy = y - s / 2 + 0.5;
      const inside = dx * dx + dy * dy <= (s / 2) * (s / 2);
      const a = inside ? 255 : 0;
      const o = (y * s + x) * 4;
      data[o] = 90;
      data[o + 1] = 78;
      data[o + 2] = 62;
      data[o + 3] = a;
    }
  }
  const tex = new RawTexture(data, s, s, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
  tex.name = 'wall-debris-texture';
  tex.hasAlpha = true;
  return tex;
}
