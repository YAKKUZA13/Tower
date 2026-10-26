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
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { AreaEffectRenderer } from '@voxkera/scene-babylon';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type { ActiveSpell, DefenderUnit, GameSnapshot, GridData } from '@tower/shared';
import { sampleHeight } from '../terrain/terrain-math';

/**
 * Интерфейс рендера RTS-юнитов/зданий/заклинаний (M2).
 * Реализуется: UnitRenderer (InstancedMesh, LOD-fallback) и RiggedUnitRenderer
 * (part-graph риг + walk-cycle + attack swing). Game-loop типизирован против него.
 */
export interface UnitSceneRenderer {
  sync(state: GameSnapshot, dt: number): void;
  pickUnitId(mesh: { name: string; metadata?: unknown } | null | undefined): string | null;
  getShadowCasterMeshes(): Mesh[];
  dispose(): void;
}

/** Adapts authoritative spell events to reusable shader effects. */
export class SpellEffectManager {
  private readonly effects: AreaEffectRenderer;
  private readonly seen = new Set<string>();
  private readonly castSeen = new Set<string>();
  private lastTick: number | null = null;
  constructor(private scene: Scene, private grid: GridData, private heightmap: number[][]) {
    this.effects = new AreaEffectRenderer(scene, {cellSize:grid.cellSize,
      heightAt:(x,z)=>sampleHeight(heightmap,grid,x/grid.cellSize+grid.cols/2-.5,z/grid.cellSize+grid.rows/2-.5)});
  }
  sync(state: { activeSpells?: ActiveSpell[]; tick?: number }): void {
    const dt = state.tick === undefined ? this.scene.getEngine().getDeltaTime()/1000
      : this.lastTick === null ? 0 : Math.max(0,state.tick-this.lastTick)/30;
    this.lastTick = state.tick ?? null;
    this.effects.update(dt);
    for (const active of state.activeSpells ?? []) {
      if (this.seen.has(active.id)) continue;
      this.seen.add(active.id);
      this.effects.spawn({
        id: active.id, kind: (active.effect ?? active.spellId) === 'freeze' ? 'freeze'
          : (active.effect ?? active.spellId) === 'meteor' ? 'meteor' : 'gold',
        center: {
          x: (active.col+.5-this.grid.cols/2)*this.grid.cellSize,
          y: sampleHeight(this.heightmap,this.grid,active.col,active.row,true),
          z: (active.row+.5-this.grid.rows/2)*this.grid.cellSize
        },
        radius: (active.radius ?? 1)*this.grid.cellSize,
        duration: Math.max(1.8,active.remainingTicks/30)
      });
    }
    const current = new Set((state.activeSpells ?? []).map(a=>a.id));
    for(const id of this.seen) if(!current.has(id)) this.seen.delete(id);
    for(const id of this.castSeen) if(!current.has(id)) this.castSeen.delete(id);
  }
  consumeNewSpell(state: { activeSpells?: ActiveSpell[] }): ActiveSpell | null {
    for(const active of state.activeSpells ?? []) {
      if(this.castSeen.has(active.id)) continue;
      this.castSeen.add(active.id);
      return active;
    }
    return null;
  }
  dispose(): void { this.effects.dispose(); this.seen.clear(); this.castSeen.clear(); }
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
