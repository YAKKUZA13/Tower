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
  InstancedMesh,
  Mesh,
  Vector3,
  type Scene
} from 'babylonjs';
import type {
  GameSnapshot,
  GridData,
  ProductionBuildingType,
  DefenderUnitType
} from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';
import { SpellEffectManager, HpBarManager, type UnitSceneRenderer } from './unit-effects';

// Реэкспорт интерфейса для потребителей (Game.vue, game-loop), импортирующих из этого модуля.
export type { UnitSceneRenderer };

interface SourceEntry {
  source: Mesh;
  cellSize: number;
  rotationY: number;
}

const SPELL_PARTICLE_POOL = 8;
void SPELL_PARTICLE_POOL;

export class UnitRenderer implements UnitSceneRenderer {
  private readonly unitSources = new Map<string, SourceEntry>();
  private readonly buildingSources = new Map<string, SourceEntry>();
  private readonly unitInstances = new Map<string, InstancedMesh>();
  private readonly buildingInstances = new Map<string, InstancedMesh>();
  private readonly unitTypes: Map<string, DefenderUnitType>;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly halfW: number;
  private readonly halfH: number;
  private commanderInstance: InstancedMesh | null = null;
  private commanderSource: Mesh | null = null;
  private readonly spells: SpellEffectManager;
  private readonly hpBars: HpBarManager;
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
    this.spells = new SpellEffectManager(scene, grid, heightmap);
    this.hpBars = new HpBarManager(scene, grid);

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
    this.spells.sync(state);
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

      this.hpBars.update(unit, inst.position, groundY);
    }
    // удалить исчезнувших юнитов
    for (const [id, inst] of this.unitInstances) {
      if (!seen.has(id)) {
        inst.dispose();
        this.unitInstances.delete(id);
        this.hpBars.remove(id);
      }
    }
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
    this.spells.dispose();
    this.hpBars.dispose();
  }
}
