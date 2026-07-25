/**
 * M2 (voxel-migration-plan): общие эффекты рендера RTS-юнитов.
 *
 * Вынесено из UnitRenderer, чтобы переиспользовать в RiggedUnitRenderer
 * (rigged-путь) без дублирования:
 *  - `SpellEffectManager`: пул ParticleSystem + ring-индикатор для meteor/freeze/gold-rush.
 *  - `HpBarManager`: DynamicTexture-полоски HP над юнитами (billboard, рисуется при уроне).
 *
 * Оба — render-only (инвариант ADR-2: сим не трогаем).
 */
import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Vector3,
  type Scene
} from 'babylonjs';
import type { ActiveSpell, DefenderUnit, GameSnapshot, GridData } from '@tower/shared';
import { sampleHeight } from '../terrain/terrain-math';

/**
 * Интерфейс рендера RTS-юнитов/зданий/заклинаний (M2).
 * Реализуется: UnitRenderer (InstancedMesh, LOD-fallback) и RiggedUnitRenderer
 * (part-graph риг + walk-cycle + attack swing). Game-loop типизирован против него.
 */
export interface UnitSceneRenderer {
  sync(state: GameSnapshot, dt: number): void;
  pickUnitId(mesh: { name: string } | null | undefined): string | null;
  getShadowCasterMeshes(): Mesh[];
  dispose(): void;
}

const SPELL_PARTICLE_POOL = 8;

/** Менеджер эффектов заклинаний (particles + ring-индикаторы). */
export class SpellEffectManager {
  private readonly particles: ParticleSystem[] = [];
  private readonly activeSpellSeen = new Set<string>();
  private readonly scene: Scene;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly halfW: number;
  private readonly halfH: number;

  constructor(scene: Scene, grid: GridData, heightmap: number[][]) {
    this.scene = scene;
    this.grid = grid;
    this.heightmap = heightmap;
    this.halfW = (grid.cols * grid.cellSize) / 2;
    this.halfH = (grid.rows * grid.cellSize) / 2;
    for (let i = 0; i < SPELL_PARTICLE_POOL; i++) {
      const ps = new ParticleSystem(`unit-spell-ps-${i}`, 80, scene);
      ps.emitter = new Vector3(0, 0, 0);
      ps.minEmitBox = new Vector3(-0.3, 0, -0.3);
      ps.maxEmitBox = new Vector3(0.3, 0.6, 0.3);
      ps.color1 = new Color4(1, 0.5, 0.1, 1);
      ps.color2 = new Color4(1, 0.85, 0.4, 1);
      ps.colorDead = new Color4(0, 0, 0, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.18;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.9;
      ps.emitRate = 0;
      ps.direction1 = new Vector3(-1, 2, -1);
      ps.direction2 = new Vector3(1, 4, 1);
      ps.minEmitPower = 1;
      ps.maxEmitPower = 3;
      ps.gravity = new Vector3(0, -3, 0);
      this.particles.push(ps);
    }
  }

  /** Обработка новых/истёкших активных заклинаний — вызывать каждый кадр. */
  sync(state: { activeSpells?: ActiveSpell[] }): void {
    for (const active of state.activeSpells ?? []) {
      if (this.activeSpellSeen.has(active.id)) continue;
      this.activeSpellSeen.add(active.id);
      this.spawnSpellEffect(active);
    }
    const currentIds = new Set((state.activeSpells ?? []).map((a) => a.id));
    for (const id of Array.from(this.activeSpellSeen)) {
      if (!currentIds.has(id)) this.activeSpellSeen.delete(id);
    }
  }

  /** Возвращает true если есть НОВОЕ заклинание в этом кадре (для каст-анимации командира). */
  consumeNewSpell(state: { activeSpells?: ActiveSpell[] }): ActiveSpell | null {
    for (const active of state.activeSpells ?? []) {
      if (!this.activeSpellSeen.has(active.id) || this.justSaw(active.id)) {
        return active;
      }
    }
    return null;
  }

  private readonly justSeen = new Set<string>();
  private justSaw(id: string): boolean {
    return this.justSeen.has(id);
  }

  private spawnSpellEffect(active: ActiveSpell): void {
    this.justSeen.add(active.id);
    const cellSize = this.grid.cellSize;
    const x = (active.col + 0.5) * cellSize - this.halfW;
    const z = (active.row + 0.5) * cellSize - this.halfH;
    const groundY = sampleHeight(this.heightmap, this.grid, active.col, active.row, true);

    const ps = this.particles.find((p) => p.emitRate === 0) ?? this.particles[0];
    if (ps) {
      ps.emitter = new Vector3(x, groundY + 0.3, z);
      ps.targetStopDuration = 0.6;
      ps.minEmitPower = 2;
      ps.maxEmitPower = 5;
      if (active.spellId === 'meteor') {
        ps.color1 = new Color4(1, 0.4, 0.1, 1); ps.color2 = new Color4(1, 0.85, 0.3, 1);
        ps.minSize = 0.12; ps.maxSize = 0.26; ps.emitRate = 220;
      } else if (active.spellId === 'gold-rush') {
        ps.color1 = new Color4(0.9, 0.75, 0.25, 1); ps.color2 = new Color4(1, 0.95, 0.5, 1);
        ps.minSize = 0.06; ps.maxSize = 0.14; ps.emitRate = 160;
      } else {
        ps.color1 = new Color4(0.55, 0.8, 1, 1); ps.color2 = new Color4(0.75, 0.95, 1, 1);
        ps.minSize = 0.08; ps.maxSize = 0.16; ps.emitRate = 120;
      }
      ps.start(0.6);
    }

    if (active.spellId === 'freeze' || active.spellId === 'meteor') {
      const ring = MeshBuilder.CreateTorus(`spell-ring-${active.id}`, {
        diameter: cellSize * 4, thickness: 0.18, tessellation: 24
      }, this.scene);
      const mat = new StandardMaterial(`spell-ring-mat-${active.id}`, this.scene);
      mat.emissiveColor = active.spellId === 'freeze' ? new Color3(0.5, 0.85, 1) : new Color3(1, 0.4, 0.1);
      mat.disableLighting = true;
      mat.alpha = 0.6;
      ring.material = mat;
      ring.isPickable = false;
      ring.position.set(x, groundY + 0.1, z);
      const duration = Math.max(0.5, active.remainingTicks / 30);
      const startTime = performance.now();
      const observer = this.scene.onBeforeRenderObservable.add(() => {
        const elapsed = (performance.now() - startTime) / 1000;
        const t = Math.min(1, elapsed / duration);
        ring.scaling.set(1 + t * 0.3, 1, 1 + t * 0.3);
        mat.alpha = 0.6 * (1 - t);
        if (t >= 1) {
          this.scene.onBeforeRenderObservable.remove(observer);
          ring.dispose();
        }
      });
    }
  }

  dispose(): void {
    for (const ps of this.particles) ps.dispose();
    this.particles.length = 0;
    this.activeSpellSeen.clear();
    this.justSeen.clear();
  }
}

interface HpBar {
  mesh: Mesh;
  tex: DynamicTexture;
  context: CanvasRenderingContext2D;
}

/** Менеджер HP-баров над юнитами (DynamicTexture, обновляется при уроне). */
export class HpBarManager {
  private readonly bars = new Map<string, HpBar>();
  private readonly scene: Scene;
  private readonly grid: GridData;

  constructor(scene: Scene, grid: GridData) {
    this.scene = scene;
    this.grid = grid;
  }

  update(unit: DefenderUnit, pos: Vector3, groundY: number): void {
    if (unit.hp >= unit.maxHp) {
      const bar = this.bars.get(unit.id);
      if (bar) bar.mesh.setEnabled(false);
      return;
    }
    let bar = this.bars.get(unit.id);
    if (!bar) {
      const tex = new DynamicTexture(`unit-hp-tex-${unit.id}`, { width: 64, height: 8 }, this.scene, false);
      tex.hasAlpha = true;
      const mat = new StandardMaterial(`unit-hp-mat-${unit.id}`, this.scene);
      mat.diffuseTexture = tex;
      mat.opacityTexture = tex;
      mat.emissiveColor = new Color3(1, 1, 1);
      mat.disableLighting = true;
      mat.backFaceCulling = false;
      mat.zOffset = -2;
      const plane = MeshBuilder.CreatePlane(`unit-hp-${unit.id}`, { width: 0.8, height: 0.1 }, this.scene);
      plane.material = mat;
      plane.isPickable = false;
      plane.billboardMode = 7;
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      bar = { mesh: plane, tex, context: ctx };
      this.bars.set(unit.id, bar);
    }
    bar.mesh.setEnabled(true);
    bar.mesh.position.set(pos.x, groundY + this.grid.cellSize * 1.1, pos.z);
    const ratio = Math.max(0, Math.min(1, unit.hp / unit.maxHp));
    const ctx = bar.context;
    ctx.clearRect(0, 0, 64, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, 64, 8);
    ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444';
    ctx.fillRect(1, 1, Math.round(62 * ratio), 6);
    bar.tex.update();
  }

  remove(unitId: string): void {
    const bar = this.bars.get(unitId);
    if (bar) { bar.mesh.dispose(); bar.tex.dispose(); this.bars.delete(unitId); }
  }

  dispose(): void {
    for (const bar of this.bars.values()) { bar.mesh.dispose(); bar.tex.dispose(); }
    this.bars.clear();
  }
}
