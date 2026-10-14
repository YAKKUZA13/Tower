/**
 * RiggedUnitRenderer (M2 — voxel-migration-plan).
 *
 * Параллельный путь к UnitRenderer (InstancedMesh, ADR-4): RTS-юниты и командир
 * рендерятся через part-graph риг — мастер-риг на тип, cloneRig на спавн юнита.
 * Walk-cycle (idle/движение) + attack-swing (при reset cooldown) + cast-pose
 * командира (при новом заклинании). Здания — статичные InstancedMesh (как UnitRenderer;
 * recipe-вариантность — M3). HP-бары и эффекты заклинаний — общие менеджеры.
 *
 * Сим НЕ знает о риге (инвариант ADR-2): вся анимация рендер-only. Attack-swing
 * детектится по reset `DefenderUnit.cooldown` (он скачет вверх при атаке).
 */
import { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { type Scene } from '@babylonjs/core/scene.js';
import type {
  DefenderUnitType,
  GameSnapshot,
  GridData,
  ProductionBuildingType,
  DefenderUnit
} from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import { sampleHeight } from '../terrain/terrain-math';
import {
  assembleRig,
  cloneRig,
  collectRigMeshes,
  disposeRig,
  findNodesByName,
  type CharacterDef
} from '../voxel/voxel-parts';
import { UNIT_RIGS } from '../voxel/importers/unit-rigs';
import { VOXEL_BUILDERS, builderEmissive } from '../voxel/voxel-builder';
import { ACCENT } from '../voxel/dark-palette';
import { SpellEffectManager, HpBarManager, type UnitSceneRenderer } from './unit-effects';
import type { ShadowController } from '../enemies/enemy-renderer-rigged';
import { createRigMotion, advanceRigMotion, type RigMotion } from '@tower/voxel-core';

// ── Walk-cycle константы (согласованы с RiggedEnemyRenderer) ──
const WALK_FREQ = 7.0;       // чуть медленнее, чем у врагов (размеренный шаг солдата)
const WALK_AMP_THIGH = 0.5;
const WALK_AMP_SHIN = 0.4;
const WALK_AMP_ARM = 0.35;
const WALK_AMP_FOREARM = 0.2;
const IDLE_AMP = 0.05;
const IDLE_FREQ = 2.0;
const IDLE_SPEED = 0.05;

/** Длительность анимации взмаха оружием (сек). */
const ATTACK_SWING_DURATION = 0.28;
/** Амплитуда взмаха предплечьем (рад, rotation.x — мах сверху вниз). */
const ATTACK_SWING_AMP = 1.6;

/** Длительность каст-позы командира (сек). */
const COMMANDER_CAST_DURATION = 0.7;
/** Амплитуда поднятия посоха (рад, rotation.x — рука вверх). */
const COMMANDER_CAST_AMP = -1.1;

const WALK_NODES = [
  'spine', 'thighL', 'shinL', 'thighR', 'shinR',
  'upperArmL', 'forearmL', 'upperArmR', 'forearmR'
] as const;

interface BuildingEntry {
  source: Mesh;
  cellSize: number;
  rotationY: number;
}

interface MasterUnit {
  root: TransformNode;
  nodes: readonly string[];
}

interface UnitInstance {
  motion: RigMotion;
  root: TransformNode;
  pickProxy: Mesh;
  nodes: Map<string, TransformNode>;
  prevCooldown: number;
  /** Оставшееся время взмаха (>0 = анимация атаки). */
  attackT: number;
  facingY: number;
  prevX: number;
  prevZ: number;
  /** M4: кеш мешей клона для shadow + зарегистрирован ли в ShadowGenerator. */
  meshes: Mesh[];
  shadowed: boolean;
}

export class RiggedUnitRenderer implements UnitSceneRenderer {
  private readonly scene: Scene;
  private readonly grid: GridData;
  private readonly heightmap: number[][];
  private readonly halfW: number;
  private readonly halfH: number;
  private readonly baseCol: number;
  private readonly baseRow: number;

  private readonly unitMasters = new Map<string, MasterUnit>();
  private readonly unitInstances = new Map<string, UnitInstance>();
  private readonly buildingEntries = new Map<string, BuildingEntry>();
  private readonly buildingInstances = new Map<string, InstancedMesh>();

  private commanderMaster: MasterUnit | null = null;
  private commanderInstance: UnitInstance | null = null;

  private readonly spells: SpellEffectManager;
  private readonly hpBars: HpBarManager;
  private readonly pickMaterial: StandardMaterial;
  private lastNowMs = 0;
  /** M4: контроллер per-clone теней. */
  private shadowCtl: ShadowController | null;

  constructor(
    scene: Scene,
    unitTypes: DefenderUnitType[],
    buildingTypes: ProductionBuildingType[],
    grid: GridData,
    heightmap: number[][],
    catalog: AssetCatalog,
    commanderCatalogId: string | null,
    base: { col: number; row: number },
    shadowCtl: ShadowController | null = null
  ) {
    this.scene = scene;
    this.grid = grid;
    this.heightmap = heightmap;
    this.halfW = (grid.cols * grid.cellSize) / 2;
    this.halfH = (grid.rows * grid.cellSize) / 2;
    this.baseCol = base.col;
    this.baseRow = base.row;
    this.spells = new SpellEffectManager(scene, grid, heightmap);
    this.hpBars = new HpBarManager(scene, grid);
    this.pickMaterial = new StandardMaterial('unit-pick-material', scene);
    this.pickMaterial.alpha = 0;
    this.pickMaterial.disableColorWrite = true;
    this.pickMaterial.disableDepthWrite = true;
    this.shadowCtl = shadowCtl;

    // Мастер-риги юнитов (G2: приоритет .glTF, затем UNIT_RIGS, затем singlePart).
    for (const ut of unitTypes) {
      const def = this.resolveUnitDef(ut.modelRef.catalogId, ut.id, catalog);
      const root = assembleRig(scene, def, {
        meshing: 'greedy',
        emissive: builderEmissive(ut.modelRef.catalogId) ?? ACCENT.soul,
        emissiveStrength: 0.48
      });
      root.setEnabled(false);
      const hasWalk = walkNodesPresent(def);
      this.unitMasters.set(ut.id, { root, nodes: hasWalk ? WALK_NODES : [] });
    }

    // Здания — статичные InstancedMesh (структуры, не анимируются; recipe — M3).
    for (const bt of buildingTypes) {
      const source = catalog.buildMaster(bt.modelRef.catalogId, `building-src-${bt.id}`, { emissiveStrength: 0.28 });
      source.isVisible = false;
      source.isPickable = false;
      source.doNotSyncBoundingInfo = true;
      this.buildingEntries.set(bt.id, { source, cellSize: grid.cellSize, rotationY: bt.modelRef.rotationY ?? 0 });
    }

    // Командир — отдельный детальный риг (кастует).
    if (commanderCatalogId) {
      const def = this.resolveUnitDef(commanderCatalogId, 'commander', catalog);
      const root = assembleRig(scene, def, {
        meshing: 'greedy',
        emissive: builderEmissive(commanderCatalogId) ?? ACCENT.arcane,
        emissiveStrength: 0.44
      });
      root.setEnabled(false);
      const hasWalk = walkNodesPresent(def);
      this.commanderMaster = { root, nodes: hasWalk ? WALK_NODES : [] };
    }
  }

  /**
   * Резолвит CharacterDef юнита: G2 .glTF (через каталог) → UNIT_RIGS → singlePart fallback.
   */
  private resolveUnitDef(catalogId: string, fallbackName: string, catalog: AssetCatalog): CharacterDef {
    // G2: приоритет — предзагруженный .glTF rigged-деф.
    const gltfDef = catalog.getRiggedDef(catalogId);
    if (gltfDef && gltfDef.root.children.length + gltfDef.root.voxels.length > 0) return gltfDef;
    const fn = UNIT_RIGS[catalogId];
    if (fn) return fn();
    // fallback: single-part из процедурного билдера (статичный риг).
    const voxels = VOXEL_BUILDERS[catalogId]?.() ?? [];
    return {
      name: `unit-${fallbackName}`,
      root: { name: 'body', pivot: [0, 0, 0], voxels, children: [] }
    };
  }

  pickUnitId(mesh: { name: string; metadata?: unknown } | null | undefined): string | null {
    if (!mesh) return null;
    const metadata = mesh.metadata as { rigId?: unknown; rigKind?: unknown } | null | undefined;
    if (metadata?.rigKind === 'unit' && typeof metadata.rigId === 'string') return metadata.rigId;
    // rigged-юниты: рут-клон именован `unit-rig-<id>`; здания/командир не пикаются как юниты.
    if (mesh.name.startsWith('unit-rig-')) return mesh.name.slice('unit-rig-'.length);
    if (mesh.name.startsWith('unit-inst-')) return mesh.name.slice('unit-inst-'.length);
    if (mesh.name.startsWith('unit-pick-')) return mesh.name.slice('unit-pick-'.length);
    return null;
  }

  getShadowCasterMeshes(): Mesh[] {
    const out: Mesh[] = [];
    for (const m of this.unitMasters.values()) out.push(...collectRigMeshes(m.root));
    for (const e of this.buildingEntries.values()) out.push(e.source);
    if (this.commanderMaster) out.push(...collectRigMeshes(this.commanderMaster.root));
    return out;
  }

  sync(state: GameSnapshot, dt: number): void {
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const frameDt = this.lastNowMs === 0 ? 0 : Math.min(0.1, (nowMs - this.lastNowMs) / 1000);
    this.lastNowMs = nowMs;
    const t = nowMs / 1000;
    void dt;

    this.syncBuildings(state);
    this.syncUnits(state, frameDt, t);
    this.syncCommander(state, frameDt, t);
    this.spells.sync(state);
  }

  // ── Здания (статичные InstancedMesh) ─────────────────────────────────

  /** Множитель размера зданий относительно cellSize. Здания должны быть крупнее
   *  юнитов (Town Hall выше солдата), иначе база читается как «кубик у ног юнита». */
  private static readonly BUILDING_SIZE_MULT = 2.1;

  private syncBuildings(state: GameSnapshot): void {
    const seen = new Set<string>();
    const cellSize = this.grid.cellSize;
    const buildingScale = cellSize * RiggedUnitRenderer.BUILDING_SIZE_MULT;
    for (const b of state.productionBuildings ?? []) {
      seen.add(b.id);
      const entry = this.buildingEntries.get(b.typeId);
      if (!entry) continue;
      let inst = this.buildingInstances.get(b.id);
      if (!inst) {
        inst = entry.source.createInstance(`building-inst-${b.id}`);
        inst.isPickable = true;
        inst.scaling.set(buildingScale, buildingScale, buildingScale);
        this.buildingInstances.set(b.id, inst);
      }
      const groundY = sampleHeight(this.heightmap, this.grid, b.col, b.row, true);
      const x = (b.col + 0.5) * cellSize - this.halfW;
      const z = (b.row + 0.5) * cellSize - this.halfH;
      // base меша @ y=-0.5 (normalizeMesh) → основание на groundY: pos.y = groundY + 0.5*scale.
      inst.position.set(x, groundY + 0.5 * buildingScale, z);
      inst.rotation.y = entry.rotationY;
    }
    for (const [id, inst] of this.buildingInstances) {
      if (!seen.has(id)) { inst.dispose(); this.buildingInstances.delete(id); }
    }
  }

  // ── Юниты (rigged: walk-cycle + attack swing) ───────────────────────

  private syncUnits(state: GameSnapshot, dt: number, t: number): void {
    const seen = new Set<string>();
    const cellSize = this.grid.cellSize;
    for (const unit of state.defenderUnits ?? []) {
      seen.add(unit.id);
      const master = this.unitMasters.get(unit.typeId);
      if (!master) continue;
      let inst = this.unitInstances.get(unit.id);
      if (!inst) {
        const root = cloneRig(master.root);
        root.name = `unit-rig-${unit.id}`;
        root.setEnabled(true);
        const meshes = collectRigMeshes(root);
        // Тегируем меши рига метаданными — чтобы picking/box-select находили юнита
        // по любому парту (клик/рамка попадают в <joint>-part меши, а не в корень).
        for (const m of meshes) {
          m.metadata = { ...(m.metadata as Record<string, unknown> | null), rigId: unit.id, rigKind: 'unit' };
          m.isPickable = true;
          m.doNotSyncBoundingInfo = false;
          m.alwaysSelectAsActiveMesh = true;
        }
        const pickProxy = this.createPickProxy(root, unit.id);
        inst = {
          root,
          pickProxy,
          motion: createRigMotion(unit.position.x, unit.position.z),
          nodes: master.nodes.length > 0 ? findNodesByName(root, master.nodes) : new Map(),
          prevCooldown: unit.cooldown,
          attackT: 0,
          facingY: 0,
          prevX: unit.position.x,
          prevZ: unit.position.z,
          meshes,
          shadowed: false
        };
        this.unitInstances.set(unit.id, inst);
        // M4: per-clone тень (юнитов мало — все shadowed).
        this.addShadow(inst);
      }

      const motion = advanceRigMotion(inst.motion, unit.position.x, unit.position.z, dt, cellSize);
      const groundY = sampleHeight(this.heightmap, this.grid,
        motion.x / cellSize + this.grid.cols / 2 - .5, motion.z / cellSize + this.grid.rows / 2 - .5, true);
      // Slightly oversized silhouettes are intentional in the isometric RTS view:
      // weapons, backpacks and class headgear must remain legible at normal zoom.
      const unitScale = cellSize * 1.34;
      inst.root.position.set(motion.x, groundY + unitScale * 0.5, motion.z);
      inst.root.scaling.set(unitScale, unitScale, unitScale);

      // facing к цели
      if (unit.targetEnemyId) {
        const enemy = state.enemies.find((e) => e.id === unit.targetEnemyId);
        if (enemy) {
          const dx = enemy.position.x - unit.position.x;
          const dz = enemy.position.z - unit.position.z;
          if (dx * dx + dz * dz > 1e-4) inst.facingY = Math.atan2(dx, dz);
        }
      }
      inst.root.rotation.y = unit.targetEnemyId ? inst.facingY : motion.facing;

      // attack detection: cooldown сбросился вверх → только что атаковал
      if (unit.cooldown > inst.prevCooldown + 0.01) {
        inst.attackT = ATTACK_SWING_DURATION;
      }
      inst.prevCooldown = unit.cooldown;

      inst.prevX = unit.position.x;
      inst.prevZ = unit.position.z;

      this.animateUnit(inst, motion.phase / WALK_FREQ, motion.speed / cellSize, dt);
      if(unit.gatherState === 'gathering') {
        const phase = t * 7;
        const forearm = inst.nodes.get('forearmR'), spine = inst.nodes.get('spine');
        if(forearm) forearm.rotation.x = -.35-Math.sin(phase)*.6;
        if(spine) spine.rotation.x = .1+Math.max(0,Math.sin(phase))*.12;
      }

      // HP-бар (общий менеджер)
      this.hpBars.update(unit, inst.root.position, groundY);
    }
    // удалить исчезнувших
    for (const [id, inst] of this.unitInstances) {
      if (!seen.has(id)) {
        this.removeShadow(inst);
        disposeRig(inst.root);
        this.unitInstances.delete(id);
        this.hpBars.remove(id);
      }
    }
  }

  /** Walk-cycle + attack-swing (render-only). */
  private animateUnit(inst: UnitInstance, t: number, speed: number, dt: number): void {
    const idle = speed < IDLE_SPEED;
    const phase = t * WALK_FREQ;
    const setRot = (name: string, x: number): void => {
      const n = inst.nodes.get(name);
      if (n) n.rotation.x = x;
    };

    // attack-swing затухает; перекрывает walk-cycle для руки с оружием.
    let swing = 0;
    if (inst.attackT > 0) {
      inst.attackT = Math.max(0, inst.attackT - dt);
      const p = 1 - inst.attackT / ATTACK_SWING_DURATION; // 0..1
      // косинусный замах: вверх (отриц) → вниз (положит) → возврат
      swing = -Math.sin(p * Math.PI) * ATTACK_SWING_AMP + Math.sin(p * Math.PI * 2) * .25;
    }

    if (idle) {
      setRot('spine', Math.sin(t * IDLE_FREQ) * IDLE_AMP);
      setRot('thighL', 0); setRot('thighR', 0);
      setRot('shinL', 0); setRot('shinR', 0);
      setRot('upperArmL', 0);
      setRot('forearmL', 0);
      setRot('upperArmR', 0);
      setRot('forearmR', swing); // боеготовность/замах в idle
      return;
    }
      const gain = Math.min(1, speed / 1.0);
    setRot('thighL', Math.sin(phase) * WALK_AMP_THIGH * gain);
    setRot('thighR', Math.sin(phase + Math.PI) * WALK_AMP_THIGH * gain);
    setRot('shinL', Math.max(0, Math.sin(phase + Math.PI / 2)) * WALK_AMP_SHIN * gain);
    setRot('shinR', Math.max(0, Math.sin(phase + Math.PI + Math.PI / 2)) * WALK_AMP_SHIN * gain);
    setRot('upperArmL', Math.sin(phase + Math.PI) * WALK_AMP_ARM * gain);
    setRot('upperArmR', Math.sin(phase) * WALK_AMP_ARM * gain);
    // правое предплечье (оружие): walk-сгиб, перекрытый swing при атаке.
    const walkFore = Math.max(0, Math.sin(phase)) * WALK_AMP_FOREARM * gain;
    setRot('forearmR', swing !== 0 ? swing : walkFore);
    setRot('forearmL', Math.max(0, Math.sin(phase + Math.PI)) * WALK_AMP_FOREARM * gain);
    setRot('spine', 0.07 * gain);
  }

  // ── Командир (rigged: idle-дыхание + cast-pose при новом заклинании) ──

  private syncCommander(state: GameSnapshot, dt: number, t: number): void {
    if (!this.commanderMaster) return;
    if (!this.commanderInstance) {
      const root = cloneRig(this.commanderMaster.root);
      root.name = 'unit-rig-commander';
      root.setEnabled(true);
      const meshes = collectRigMeshes(root);
      for (const m of meshes) {
        m.metadata = { ...(m.metadata as Record<string, unknown> | null), rigId: 'commander', rigKind: 'unit' };
        m.isPickable = true;
        m.doNotSyncBoundingInfo = false;
      }
      const pickProxy = this.createPickProxy(root, 'commander');
      this.commanderInstance = {
        root,
        pickProxy,
        motion: createRigMotion(0, 0),
        nodes: this.commanderMaster.nodes.length > 0
          ? findNodesByName(root, this.commanderMaster.nodes) : new Map(),
        prevCooldown: 0,
        attackT: 0,
        facingY: 0,
        prevX: 0,
        prevZ: 0,
        meshes,
        shadowed: false
      };
      this.addShadow(this.commanderInstance);
    }
    const inst = this.commanderInstance;
    const cellSize = this.grid.cellSize;
    const cc = Math.max(0, Math.min(this.grid.cols - 1, this.baseCol + 1));
    const cr = Math.max(0, Math.min(this.grid.rows - 1, this.baseRow - 1));
    const x = (cc + 0.5) * cellSize - this.halfW;
    const z = (cr + 0.5) * cellSize - this.halfH;
    const groundY = sampleHeight(this.heightmap, this.grid, cc, cr, true);
    const commanderScale = cellSize * 1.34;
    inst.root.position.set(x, groundY + commanderScale * 0.5, z);
    inst.root.scaling.set(commanderScale, commanderScale, commanderScale);
      inst.root.rotation.y = 0;

    // cast-pose: при новом заклинании командир поднимает посох.
    const newSpell = this.spells.consumeNewSpell(state);
    if (newSpell) inst.attackT = COMMANDER_CAST_DURATION;
    if (inst.attackT > 0) {
      inst.attackT = Math.max(0, inst.attackT - dt);
      const p = 1 - inst.attackT / COMMANDER_CAST_DURATION;
      const raise = Math.sin(p * Math.PI) * COMMANDER_CAST_AMP;
      const n = inst.nodes.get('forearmR');
      if (n) n.rotation.x = raise;
      const spine = inst.nodes.get('spine');
      if (spine) spine.rotation.x = Math.sin(p * Math.PI) * 0.15;
    } else {
      // idle-дыхание
      const setRot = (name: string, v: number): void => {
        const nd = inst.nodes.get(name);
        if (nd) nd.rotation.x = v;
      };
      setRot('spine', Math.sin(t * IDLE_FREQ) * IDLE_AMP);
      setRot('forearmR', 0);
    }
  }

  /**
   * Rig parts are narrow and animated, which made cursor ray hits unreliable at
   * the normal RTS zoom. A transparent, normalized body volume provides a
   * stable interaction target without changing the visible model.
   */
  private createPickProxy(root: TransformNode, id: string): Mesh {
    const proxy = MeshBuilder.CreateBox(`unit-pick-${id}`, { width: 0.82, height: 1.12, depth: 0.72 }, this.scene);
    proxy.parent = root;
    proxy.position.y = 0;
    proxy.isPickable = true;
    proxy.material = this.pickMaterial;
    proxy.visibility = 1;
    proxy.metadata = { rigId: id, rigKind: 'unit', pickProxy: true };
    return proxy;
  }

  dispose(): void {
    for (const inst of this.unitInstances.values()) { this.removeShadow(inst); disposeRig(inst.root); }
    this.unitInstances.clear();
    for (const inst of this.buildingInstances.values()) inst.dispose();
    this.buildingInstances.clear();
    for (const m of this.unitMasters.values()) disposeRig(m.root);
    this.unitMasters.clear();
    for (const e of this.buildingEntries.values()) e.source.dispose();
    this.buildingEntries.clear();
    if (this.commanderInstance) { this.removeShadow(this.commanderInstance); disposeRig(this.commanderInstance.root); this.commanderInstance = null; }
    if (this.commanderMaster) { disposeRig(this.commanderMaster.root); this.commanderMaster = null; }
    this.spells.dispose();
    this.hpBars.dispose();
    this.pickMaterial.dispose();
  }

  /** M4: регистрирует/снимает меши клона в ShadowGenerator. */
  private addShadow(inst: UnitInstance): void {
    if (!this.shadowCtl || inst.shadowed) return;
    for (const m of inst.meshes) this.shadowCtl.add(m);
    inst.shadowed = true;
  }
  private removeShadow(inst: UnitInstance): void {
    if (!this.shadowCtl || !inst.shadowed) return;
    for (const m of inst.meshes) this.shadowCtl.remove(m);
    inst.shadowed = false;
  }
}

/** Есть ли в def суставы walk-cycle. */
function walkNodesPresent(def: CharacterDef): boolean {
  const names = new Set<string>();
  const walk = (p: { name: string; children: CharacterDef['root']['children'] }): void => {
    names.add(p.name);
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return WALK_NODES.some((n) => names.has(n));
}
