/**
 * Рендер RTS-юнитов и производственных зданий (Phase 6 задача 6.4, концепция 3).
 *
 *  - Защитные юниты (Knight/Archer/Mage): InstancedMesh на тип (как башни/реликвии,
 *    ADR-4) — юнитов немного и они подвижны; инстансы пере-позиционируются каждый кадр.
 *  - Производственные здания (Sawmill/Mine/Smelter/Barracks): InstancedMesh на тип —
 *    статичны, как башни.
 *  - Командир-некромант: отдельный детальный инстанс (один).
 *  - HP-бары над юнитами (DynamicTexture-полоска, обновляется при уроне).
 *  - Эффекты заклинаний: пул короткоживущих particle-system (meteor/freeze/gold-rush)
 *    + ring-mesh для freeze/meteor; спавнятся при появлении ActiveSpell.
 *
 * Сим/domain не тронуты — рендер только читает state.defenderUnits /
 * state.productionBuildings / state.activeSpells (детерминизм ADR-2 сохранён).
 */
import {
  Color3,
  Color4,
  DynamicTexture,
  InstancedMesh,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  StandardMaterial,
  Vector3,
  type Scene
} from 'babylonjs';
import type {
  ActiveSpell,
  DefenderUnitType,
  GameSnapshot,
  GridData,
  ProductionBuildingType,
  DefenderUnit
} from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';

interface SourceEntry {
  source: Mesh;
  cellSize: number;
  rotationY: number;
}

interface UnitHpBar {
  mesh: Mesh;
  tex: DynamicTexture;
  context: CanvasRenderingContext2D;
}

const SPELL_PARTICLE_POOL = 8;

export class UnitRenderer {
  private readonly unitSources = new Map<string, SourceEntry>();
  private readonly buildingSources = new Map<string, SourceEntry>();
  private readonly unitInstances = new Map<string, InstancedMesh>();
  private readonly buildingInstances = new Map<string, InstancedMesh>();
  private readonly hpBars = new Map<string, UnitHpBar>();
  private readonly unitTypes: Map<string, DefenderUnitType>;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly halfW: number;
  private readonly halfH: number;
  private commanderInstance: InstancedMesh | null = null;
  private commanderSource: Mesh | null = null;
  private readonly particles: ParticleSystem[] = [];
  private readonly activeSpellSeen = new Set<string>();
  private readonly baseCol: number;
  private readonly baseRow: number;

  constructor(
    private readonly scene: Scene,
    unitTypes: DefenderUnitType[],
    buildingTypes: ProductionBuildingType[],
    grid: GridData,
    heightmap: number[][],
    catalog: AssetCatalog,
    commanderCatalogId: string | null,
    base: { col: number; row: number }
  ) {
    this.grid = grid;
    this.heightmap = heightmap;
    this.halfW = (grid.cols * grid.cellSize) / 2;
    this.halfH = (grid.rows * grid.cellSize) / 2;
    this.unitTypes = new Map(unitTypes.map((u) => [u.id, u]));
    this.baseCol = base.col;
    this.baseRow = base.row;

    for (const ut of unitTypes) {
      const source = catalog.buildMaster(ut.modelRef.catalogId, `unit-src-${ut.id}`, { emissiveStrength: 0.22 });
      source.isVisible = false;
      source.isPickable = false;
      source.doNotSyncBoundingInfo = true;
      this.unitSources.set(ut.id, { source, cellSize: grid.cellSize, rotationY: ut.modelRef.rotationY ?? 0 });
    }

    for (const bt of buildingTypes) {
      const source = catalog.buildMaster(bt.modelRef.catalogId, `building-src-${bt.id}`, { emissiveStrength: 0.2 });
      source.isVisible = false;
      source.isPickable = false;
      source.doNotSyncBoundingInfo = true;
      this.buildingSources.set(bt.id, { source, cellSize: grid.cellSize, rotationY: bt.modelRef.rotationY ?? 0 });
    }

    if (commanderCatalogId) {
      this.commanderSource = catalog.buildMaster(commanderCatalogId, 'unit-src-commander', { emissiveStrength: 0.3 });
      this.commanderSource.isVisible = false;
      this.commanderSource.isPickable = false;
      this.commanderSource.doNotSyncBoundingInfo = true;
    }

    // пул частиц для заклинаний (переиспользуются; emitRate=0 = «свободна»)
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

  /** Клик-пикинг по инстансам юнитов: возвращает unitId или null. */
  pickUnitId(mesh: { name: string } | null | undefined): string | null {
    if (!mesh) return null;
    if (mesh.name.startsWith('unit-inst-')) return mesh.name.slice('unit-inst-'.length);
    return null;
  }

  /** Source-меши (по типу) — для регистрации теней. Инстансы наследуют тень от source. */
  getShadowCasterMeshes(): Mesh[] {
    const list: Mesh[] = [];
    for (const s of this.unitSources.values()) list.push(s.source);
    for (const s of this.buildingSources.values()) list.push(s.source);
    if (this.commanderSource) list.push(this.commanderSource);
    return list;
  }

  sync(state: GameSnapshot, dt: number): void {
    this.syncBuildings(state);
    this.syncUnits(state);
    this.syncCommander(state);
    this.syncSpells(state);
    void dt;
  }

  // ── Здания ───────────────────────────────────────────────────────────

  private syncBuildings(state: GameSnapshot): void {
    const seen = new Set<string>();
    const cellSize = this.grid.cellSize;
    for (const b of state.productionBuildings ?? []) {
      seen.add(b.id);
      const entry = this.buildingSources.get(b.typeId);
      if (!entry) continue;
      let inst = this.buildingInstances.get(b.id);
      if (!inst) {
        inst = entry.source.createInstance(`building-inst-${b.id}`);
        inst.isPickable = true;
        inst.scaling.set(entry.cellSize, entry.cellSize, entry.cellSize);
        this.buildingInstances.set(b.id, inst);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, b.col, b.row, true);
      const x = (b.col + 0.5) * cellSize - this.halfW;
      const z = (b.row + 0.5) * cellSize - this.halfH;
      inst.position.set(x, groundY + cellSize / 2, z);
      inst.rotation.y = entry.rotationY;
    }
    for (const [id, inst] of this.buildingInstances) {
      if (!seen.has(id)) {
        inst.dispose();
        this.buildingInstances.delete(id);
      }
    }
  }

  // ── Юниты ────────────────────────────────────────────────────────────

  private syncUnits(state: GameSnapshot): void {
    const seen = new Set<string>();
    const cellSize = this.grid.cellSize;
    for (const unit of state.defenderUnits ?? []) {
      seen.add(unit.id);
      const entry = this.unitSources.get(unit.typeId);
      if (!entry) continue;
      let inst = this.unitInstances.get(unit.id);
      if (!inst) {
        inst = entry.source.createInstance(`unit-inst-${unit.id}`);
        inst.isPickable = true;
        inst.scaling.set(entry.cellSize, entry.cellSize, entry.cellSize);
        this.unitInstances.set(unit.id, inst);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, unit.col, unit.row, true);
      // позиция из world-координат сима (unit.position.x/z), y — по земле
      inst.position.set(unit.position.x, groundY + cellSize * 0.5, unit.position.z);
      // поворот к цели
      if (unit.targetEnemyId) {
        const enemy = state.enemies.find((e) => e.id === unit.targetEnemyId);
        if (enemy) {
          const dx = enemy.position.x - unit.position.x;
          const dz = enemy.position.z - unit.position.z;
          if (dx * dx + dz * dz > 1e-4) inst.rotation.y = Math.atan2(dx, dz);
        }
      }

      this.updateHpBar(unit, inst.position, groundY);
    }
    // удалить исчезнувших юнитов
    for (const [id, inst] of this.unitInstances) {
      if (!seen.has(id)) {
        inst.dispose();
        this.unitInstances.delete(id);
        const bar = this.hpBars.get(id);
        if (bar) {
          bar.mesh.dispose();
          bar.tex.dispose();
          this.hpBars.delete(id);
        }
      }
    }
  }

  private updateHpBar(unit: DefenderUnit, pos: Vector3, groundY: number): void {
    if (unit.hp >= unit.maxHp) {
      // полный HP — скрыть бар
      const bar = this.hpBars.get(unit.id);
      if (bar) bar.mesh.setEnabled(false);
      return;
    }
    let bar = this.hpBars.get(unit.id);
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
      plane.billboardMode = 7; // BILLBOARDMODE_ALL
      const ctx = tex.getContext() as CanvasRenderingContext2D;
      bar = { mesh: plane, tex, context: ctx };
      this.hpBars.set(unit.id, bar);
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

  // ── Командир ─────────────────────────────────────────────────────────

  private syncCommander(_state: GameSnapshot): void {
    if (!this.commanderSource) return;
    // командир стоит чуть в стороне от базы (визуальный плейсхолдер лорда)
    if (!this.commanderInstance) {
      this.commanderInstance = this.commanderSource.createInstance('unit-inst-commander');
      this.commanderInstance.isPickable = true;
      this.commanderInstance.scaling.set(this.grid.cellSize, this.grid.cellSize, this.grid.cellSize);
    }
    const cellSize = this.grid.cellSize;
    // ставим командира рядом с базой (на 1 клетку по диагонали, с защитой от выхода за поле)
    const cc = Math.max(0, Math.min(this.grid.cols - 1, this.baseCol + 1));
    const cr = Math.max(0, Math.min(this.grid.rows - 1, this.baseRow - 1));
    const x = (cc + 0.5) * cellSize - this.halfW;
    const z = (cr + 0.5) * cellSize - this.halfH;
    const groundY = sampleHeight(this.heightmap, this.grid, cc, cr, true);
    this.commanderInstance.position.set(x, groundY + cellSize / 2, z);
    this.commanderInstance.rotation.y = _state.tick * 0.01;
  }

  // ── Заклинания: эффекты (particles + rings) ──────────────────────────

  private syncSpells(state: GameSnapshot): void {
    // новые активные заклинания → запустить эффект
    for (const active of state.activeSpells ?? []) {
      if (this.activeSpellSeen.has(active.id)) continue;
      this.activeSpellSeen.add(active.id);
      this.spawnSpellEffect(active);
    }
    // очистка истёкших
    const currentIds = new Set((state.activeSpells ?? []).map((a) => a.id));
    for (const id of Array.from(this.activeSpellSeen)) {
      if (!currentIds.has(id)) this.activeSpellSeen.delete(id);
    }
  }

  private spawnSpellEffect(active: ActiveSpell): void {
    const cellSize = this.grid.cellSize;
    const x = (active.col + 0.5) * cellSize - this.halfW;
    const z = (active.row + 0.5) * cellSize - this.halfH;
    const groundY = sampleHeight(this.heightmap, this.grid, active.col, active.row, true);

    // подобрать свободную систему частиц
    const ps = this.particles.find((p) => p.emitRate === 0) ?? this.particles[0];
    if (ps) {
      ps.emitter = new Vector3(x, groundY + 0.3, z);
      ps.targetStopDuration = 0.6;
      ps.minEmitPower = 2;
      ps.maxEmitPower = 5;
      // цвет по типу заклинания
      if (active.spellId === 'meteor') {
        ps.color1 = new Color4(1, 0.4, 0.1, 1);
        ps.color2 = new Color4(1, 0.85, 0.3, 1);
        ps.minSize = 0.12;
        ps.maxSize = 0.26;
        ps.emitRate = 220;
      } else if (active.spellId === 'gold-rush') {
        ps.color1 = new Color4(0.9, 0.75, 0.25, 1);
        ps.color2 = new Color4(1, 0.95, 0.5, 1);
        ps.minSize = 0.06;
        ps.maxSize = 0.14;
        ps.emitRate = 160;
      } else {
        ps.color1 = new Color4(0.55, 0.8, 1, 1);
        ps.color2 = new Color4(0.75, 0.95, 1, 1);
        ps.minSize = 0.08;
        ps.maxSize = 0.16;
        ps.emitRate = 120;
      }
      ps.start(0.6);
    }

    // кольцо-индикатор (freeze/meteor) — короткая анимация расширения
    if (active.spellId === 'freeze' || active.spellId === 'meteor') {
      const ring = MeshBuilder.CreateTorus(`spell-ring-${active.id}`, {
        diameter: cellSize * 4,
        thickness: 0.18,
        tessellation: 24
      }, this.scene);
      const mat = new StandardMaterial(`spell-ring-mat-${active.id}`, this.scene);
      mat.emissiveColor = active.spellId === 'freeze'
        ? new Color3(0.5, 0.85, 1)
        : new Color3(1, 0.4, 0.1);
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
    for (const inst of this.unitInstances.values()) inst.dispose();
    this.unitInstances.clear();
    for (const inst of this.buildingInstances.values()) inst.dispose();
    this.buildingInstances.clear();
    for (const s of this.unitSources.values()) s.source.dispose();
    this.unitSources.clear();
    for (const s of this.buildingSources.values()) s.source.dispose();
    this.buildingSources.clear();
    this.commanderInstance?.dispose();
    this.commanderInstance = null;
    this.commanderSource?.dispose();
    this.commanderSource = null;
    for (const bar of this.hpBars.values()) {
      bar.mesh.dispose();
      bar.tex.dispose();
    }
    this.hpBars.clear();
    for (const ps of this.particles) ps.dispose();
    this.particles.length = 0;
    this.activeSpellSeen.clear();
  }
}
