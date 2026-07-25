/**
 * RiggedEnemyRenderer — рендер врагов через part-graph риг + walk-cycle (Фаза P0).
 *
 * Параллельный путь к EnemyRenderer (thin instances, ADR-4) — НЕ заменяет его.
 * Используется для анимируемых типов (флаг useRiggedEnemies в Game.vue): каждый
 * враг = клон CharacterDef-рига (TransformNode-иерархия, research §5.4 «B-model»),
 * конечности вращаются вокруг суставов синусоидально (walk-cycle). Idle → «дыхание».
 *
 * Thin instances НЕ поддерживают per-instance node-анимацию (research §8) — поэтому
 * для анимируемых врагов нужен clone-на-спавн + per-frame rotation суставов.
 * Сим НЕ знает о риге (инвариант §2.1): вся анимация рендер-only.
 */
import { Mesh, TransformNode, Vector3, type Scene } from 'babylonjs';
import type { EnemyType, GameSnapshot } from '@tower/shared';
import type { AssetCatalog } from '../asset-catalog';
import {
  assembleRig,
  cloneRig,
  collectRigMeshes,
  disposeRig,
  findNodesByName,
  getPartVoxels,
  type CharacterDef
} from '../voxel/voxel-parts';
import { RIGGED_DEFS, skeletonRigged } from '../voxel/importers/manual-parts';
import { VOXEL_BUILDERS, builderEmissive, type Voxel } from '../voxel/voxel-builder';
import { VoxelDebrisPool } from '../voxel/voxel-debris';
import { assembleCharacter } from '../voxel/procedural-kit/kit-assembler';
import { ACCENT } from '../voxel/dark-palette';
import type { AnimKind } from '../voxel/voxel-parts';
import { classifyLod } from '../lod';
import type { EnemySceneRenderer } from './enemy-renderer';

// ── M4: LOD + per-clone shadows (D2/D3/D13) ──
/** Максимум одновременно shadowed-клонов (ближайшие к фокусу). Bounds shadow-pass cost. */
const MAX_SHADOWED_ENEMIES = 24;
/** Максимум одновременно animated-клонов (walk-cycle); сверх — static (позиция/facing только). */
const MAX_ANIMATED_ENEMIES = 80;

/** Контроллер теней: add/remove меша в/из ShadowGenerator (M4). */
export interface ShadowController {
  add: (mesh: Mesh) => void;
  remove: (mesh: Mesh) => void;
}

// ── Walk-cycle константы (research §5.4: синусоидальные joint-angle скрипты) ──
/** Угловая частота шага (рад/сек). */
const WALK_FREQ = 9.0;
/** Амплитуда качания бёдер (рад). */
const WALK_AMP_THIGH = 0.55;
/** Амплитуда сгиба колена (рад, со сдвигом фазы). */
const WALK_AMP_SHIN = 0.45;
/** Амплитуда качания плеч (рад, противофаза ногам). */
const WALK_AMP_ARM = 0.40;
/** Амплитуда сгиба локтя (рад). */
const WALK_AMP_FOREARM = 0.25;
/** Амплитуда «дыхания» в idle (рад). */
const IDLE_AMP = 0.06;
/** Частота «дыхания» (рад/сек). */
const IDLE_FREQ = 2.5;
/** Порог скорости (клеток/сек) ниже которого враг считается стоящим (idle). */
const IDLE_SPEED = 0.05;
/** Имена суставов, управляемых walk-cycle (гуманоид). */
const WALK_NODES = [
  'spine',
  'thighL', 'shinL', 'thighR', 'shinR',
  'upperArmL', 'forearmL', 'upperArmR', 'forearmR'
] as const;

// ── Нестандартные animKind: наборы управляемых нод (M1) ──
/** Взмах крыльев летучей мыши: wingL/wingR + тело (bob). */
const BAT_NODES = ['wingL', 'wingR', 'hips'] as const;
/** Частота взмаха крыльев (рад/сек). */
const BAT_FLAP_FREQ = 14.0;
/** Амплитуда взмаха крыльев (рад, rotation.z). */
const BAT_FLAP_AMP = 0.85;
/** Амплитуда вертикального покачивания тела (доля cellSize). */
const BAT_BOB_AMP = 0.12;

/** Паук: 8 ног (4 пары) + тело. */
const SPIDER_NODES = [
  'legL1', 'legL2', 'legL3', 'legL4',
  'legR1', 'legR2', 'legR3', 'legR4', 'hips'
] as const;
/** Частота перебирания ног (рад/сек). */
const SPIDER_STRIDE_FREQ = 16.0;
/** Амплитуда подъёма ноги (рад, rotation.y — вбок). */
const SPIDER_STRIDE_AMP = 0.45;

/** Призрак: тело (hover bob) + капюшон + руки. */
const GHOST_NODES = ['hips', 'head', 'armL', 'armR'] as const;
/** Частота парения (рад/сек). */
const GHOST_HOVER_FREQ = 1.8;
/** Амплитуда парения (доля cellSize). */
const GHOST_HOVER_AMP = 0.14;
/** Амплитуда покачивания рук призрака (рад). */
const GHOST_SWAY_AMP = 0.18;

/** Слизень: единый блоб (squash/stretch). */
const SLIME_NODES = ['hips'] as const;
/** Частота пульсации слизня (рад/сек). */
const SLIME_SQUASH_FREQ = 3.5;
/** Амплитуда squash (множитель scaling.y: 1±amp). */
const SLIME_SQUASH_AMP = 0.16;

/** Соответствие animKind → список управляемых нод. */
const ANIM_NODE_SETS: Record<AnimKind, readonly string[]> = {
  humanoid: WALK_NODES,
  bat: BAT_NODES,
  spider: SPIDER_NODES,
  ghost: GHOST_NODES,
  slime: SLIME_NODES,
  static: [] as const
};

/** Множитель размера по категории (как в EnemyRenderer). */
function categorySizeMult(category: EnemyType['category']): number {
  switch (category) {
    case 'boss': return 1.7;
    case 'tank': return 1.2;
    case 'fast': return 0.85;
    default: return 1.0;
  }
}

/** Детерминированный сид из id врага → [0, 2π) для per-instance фазы walk-cycle. */
function phaseFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (Math.abs(h) % 6283) / 1000;
}

/** Single-part CharacterDef fallback для типов без rigged-дефа (статичный риг). */
function singlePartDef(catalogId: string, name: string): CharacterDef {
  const builder = VOXEL_BUILDERS[catalogId];
  const voxels = builder ? builder() : [];
  // pivot = центр основания модели (воксель-координаты); вращение вокруг Y не критично.
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, minY = Infinity;
  for (const v of voxels) {
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
    if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    if (v.y < minY) minY = v.y;
  }
  const pivot: [number, number, number] = Number.isFinite(minX)
    ? [(minX + maxX) * 0.5, minY, (minZ + maxZ) * 0.5]
    : [0, 0, 0];
  return {
    name,
    root: { name: 'body', pivot, voxels, children: [] }
  };
}

interface MasterRig {
  root: TransformNode;
  def: CharacterDef;
  /** Тип анимационного драйвера (M1): humanoid walk / bat flap / spider scuttle / ... */
  animKind: AnimKind;
  /** Все воксели тела (для дебриса при смерти — Фаза P1). */
  bodyVoxels: Voxel[];
}

interface InstanceView {
  root: TransformNode;
  nodes: Map<string, TransformNode>;
  phaseSeed: number;
  sizeMult: number;
  prevX: number;
  prevZ: number;
  facingY: number;
  /** Кеш мешей клона (для shadow add/remove, M4). */
  meshes: Mesh[];
  /** Зарегистрирован ли клон в ShadowGenerator (M4). */
  shadowed: boolean;
}

export class RiggedEnemyRenderer implements EnemySceneRenderer {
  private readonly masters = new Map<string, MasterRig>();
  private readonly instances = new Map<string, InstanceView>();
  private readonly sizeByType = new Map<string, number>();
  /** enemyId → typeId (для определения мастера при дебрисе на смерти). */
  private readonly typeIdByEnemyId = new Map<string, string>();
  private readonly cellSize: number;
  private readonly scene: Scene;
  /** Пул воксельного дебриса (1 draw call для всего поля, research §6.3). */
  private readonly debris: VoxelDebrisPool;
  private lastNowMs = 0;
  /** Кеш предыдущих id — для детекта смерти (исчезновение id). */
  private prevIds = new Set<string>();
  /** Кеш процедурных CharacterDef по seed (Фаза P4 — генерация детерминирована). */
  private readonly proceduralCache = new Map<number, CharacterDef>();
  /** M4: фокус для LOD-классификации (камера/база) и контроллер теней. */
  private focus: { position: { x: number; z: number } } | null;
  private shadowCtl: ShadowController | null;
  /** G2: каталог для резолва .glTF rigged-дефов. */
  private catalog: AssetCatalog | null;

  constructor(
    scene: Scene,
    enemyTypes: EnemyType[],
    cellSize: number,
    catalog: AssetCatalog,
    focus: { position: { x: number; z: number } } | null = null,
    shadowCtl: ShadowController | null = null
  ) {
    this.scene = scene;
    this.cellSize = cellSize;
    this.debris = new VoxelDebrisPool(scene, cellSize);
    this.focus = focus;
    this.shadowCtl = shadowCtl;
    this.catalog = catalog;
    for (const type of enemyTypes) {
      const catalogId = type.modelRef.catalogId;
      const sizeMult = categorySizeMult(type.category);
      this.sizeByType.set(type.id, sizeMult);
      // G2: приоритет — .glTF rigged-деф (предзагружен каталогом), затем процедурный.
      const gltfDef = catalog.getRiggedDef(catalogId);
      const defFn = RIGGED_DEFS[catalogId];
      // Фаза P4: enemy:procedural → assembleCharacter(seed) (кеш по seed)
      let def: CharacterDef;
      if (catalogId === 'enemy:procedural' && type.modelRef.seed !== undefined) {
        def = this.getProceduralDef(type.modelRef.seed);
      } else if (gltfDef) {
        def = gltfDef; // реальная gltf-геометрия (M6 solid voxelization)
      } else if (defFn) {
        def = defFn();
      } else {
        def = singlePartDef(catalogId, `enemy-${type.id}`);
      }
      const em = builderEmissive(catalogId) ?? ACCENT.eyeRed;
      const root = assembleRig(scene, def, {
        meshing: 'greedy',
        emissive: em,
        emissiveStrength: 0.18
      });
      root.setEnabled(false); // мастер скрыт; рендерятся только клоны
      // M1: animKind из def (или авто-детект по walk-нодам для back-compat).
      const animKind: AnimKind = def.animKind ?? (listHasWalkNodes(def) ? 'humanoid' : 'static');
      this.masters.set(type.id, { root, def, animKind, bodyVoxels: collectBodyVoxels(def) });
    }
  }

  sync(state: GameSnapshot): void {
    const cs = this.cellSize;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = this.lastNowMs === 0 ? 0 : Math.min(0.1, (nowMs - this.lastNowMs) / 1000);
    this.lastNowMs = nowMs;
    const t = nowMs / 1000;

    // M4: LOD-классификация (до позиционного цикла) — тиры по расстоянию до фокуса.
    const tiers = this.classifyInstances(state);

    const currentIds = new Set<string>();
    for (const enemy of state.enemies) {
      currentIds.add(enemy.id);
      const master = this.masters.get(enemy.typeId);
      if (!master) continue;
      const sizeMult = this.sizeByType.get(enemy.typeId) ?? 1;
      let inst = this.instances.get(enemy.id);
      if (!inst) {
        // spawn: клонируем мастер-риг
        const root = cloneRig(master.root);
        root.name = `enemy-rig-${enemy.id}`;
        root.setEnabled(true);
        // M4: кеш мешей клона для shadow add/remove.
        const meshes = collectRigMeshes(root);
        // Тегируем меши метаданными — picking/attack-order находят врага по любому парту.
        for (const m of meshes) {
          m.metadata = { ...(m.metadata as Record<string, unknown> | null), rigId: enemy.id, rigKind: 'enemy' };
          m.isPickable = true;
        }
        // M1: собираем ноды по animKind (для walk/flap/scuttle/hover/squash).
        const nodeSet = ANIM_NODE_SETS[master.animKind];
        const nodes = nodeSet.length > 0 ? findNodesByName(root, nodeSet) : new Map();
        inst = {
          root,
          nodes,
          phaseSeed: phaseFromId(enemy.id),
          sizeMult,
          prevX: enemy.position.x,
          prevZ: enemy.position.z,
          facingY: 0,
          meshes,
          shadowed: false
        };
        this.instances.set(enemy.id, inst);
        this.typeIdByEnemyId.set(enemy.id, enemy.typeId);
      }

      const scale = cs * sizeMult;
      // позиция: base модели (-0.5 локально) → на groundY (enemy.position.y).
      inst.root.position.set(
        enemy.position.x,
        enemy.position.y + 0.5 * scale,
        enemy.position.z
      );
      inst.root.scaling.set(scale, scale, scale);

      // facing: по движению с последнего кадра
      const dx = enemy.position.x - inst.prevX;
      const dz = enemy.position.z - inst.prevZ;
      const moved = Math.hypot(dx, dz);
      const speed = dt > 0 ? moved / dt : 0;
      if (moved > 1e-5) {
        inst.facingY = Math.atan2(dx, dz);
      }
      inst.prevX = enemy.position.x;
      inst.prevZ = enemy.position.z;
      inst.root.rotation.y = inst.facingY;

      // M4: per-clone тени + LOD-анимация по тиру.
      const tier = tiers.get(enemy.id) ?? 'animated';
      if (tier === 'shadowed' && !inst.shadowed) this.addInstanceShadow(inst);
      else if (tier !== 'shadowed' && inst.shadowed) this.removeInstanceShadow(inst);
      // walk-cycle только для non-static (static — позиция/facing, без joint-апдейтов).
      if (tier !== 'static') {
        this.animate(inst, master, t, speed);
      }
    }

    // смерть: id исчезли из снапшота → дебрис + dispose клона + снять тень
    for (const [id, inst] of this.instances) {
      if (!currentIds.has(id)) {
        if (inst.shadowed) this.removeInstanceShadow(inst);
        // позиция смерти (основание клона) → всплеск дебриса из вокселей тела
        const master = this.findMasterByTypeId(this.typeIdByEnemyId.get(id) ?? '');
        if (master && master.bodyVoxels.length > 0) {
          this.debris.spawn(master.bodyVoxels, inst.root.position, {
            velocity: new Vector3(0, 3.5, 0),
            count: Math.min(master.bodyVoxels.length, 18)
          });
        }
        disposeRig(inst.root);
        this.instances.delete(id);
        this.typeIdByEnemyId.delete(id);
      }
    }
    this.prevIds = currentIds;
    // интеграция дебриса
    this.debris.update(dt);
  }

  /** M4: классификация LOD по расстоянию до фокуса (камера/база). */
  private classifyInstances(state: GameSnapshot): Map<string, import('../lod').LodTier> {
    if (!this.focus) return new Map(); // без фокуса — все animated (нет LOD)
    const fx = this.focus.position.x;
    const fz = this.focus.position.z;
    const dists = state.enemies.map((e) => ({ id: e.id, d2: (e.position.x - fx) ** 2 + (e.position.z - fz) ** 2 }));
    return classifyLod(dists, MAX_SHADOWED_ENEMIES, MAX_ANIMATED_ENEMIES);
  }

  /** M4: регистрирует меши клона в ShadowGenerator. */
  private addInstanceShadow(inst: InstanceView): void {
    if (!this.shadowCtl) return;
    for (const m of inst.meshes) this.shadowCtl.add(m);
    inst.shadowed = true;
  }

  /** M4: снимает меши клона с ShadowGenerator. */
  private removeInstanceShadow(inst: InstanceView): void {
    if (!this.shadowCtl) return;
    for (const m of inst.meshes) this.shadowCtl.remove(m);
    inst.shadowed = false;
  }

  /** Диспетчер анимации по animKind мастера (M1). */
  private animate(inst: InstanceView, master: MasterRig, t: number, speed: number): void {
    switch (master.animKind) {
      case 'humanoid': this.animateWalk(inst, t, speed); break;
      case 'bat': this.animateBat(inst, t, speed); break;
      case 'spider': this.animateSpider(inst, t, speed); break;
      case 'ghost': this.animateGhost(inst, t, speed); break;
      case 'slime': this.animateSlime(inst, t, speed); break;
      default: break; // static — нет анимации
    }
  }

  /** Процедурный walk-cycle: синусоиды на rotation.x суставов (research §5.4). */
  private animateWalk(inst: InstanceView, t: number, speed: number): void {
    const idle = speed < IDLE_SPEED;
    const phase = t * WALK_FREQ + inst.phaseSeed;
    // плавный gain: idle → 0, движение → 1 (чтобы не было резкого переключения)
    const gain = idle ? 0 : Math.min(1, speed / 1.0);
    const setRot = (name: string, x: number): void => {
      const n = inst.nodes.get(name);
      if (n) n.rotation.x = x;
    };

    if (idle) {
      // «дыхание»: лёгкий наклон позвоночника
      setRot('spine', Math.sin(t * IDLE_FREQ + inst.phaseSeed) * IDLE_AMP);
      setRot('thighL', 0); setRot('thighR', 0);
      setRot('shinL', 0); setRot('shinR', 0);
      setRot('upperArmL', 0); setRot('upperArmR', 0);
      setRot('forearmL', 0); setRot('forearmR', 0);
      return;
    }

    // ноги: L/R в противофазе; голени со сдвигом фазы (сгиб колена)
    setRot('thighL', Math.sin(phase) * WALK_AMP_THIGH * gain);
    setRot('thighR', Math.sin(phase + Math.PI) * WALK_AMP_THIGH * gain);
    setRot('shinL', Math.max(0, Math.sin(phase + Math.PI / 2)) * WALK_AMP_SHIN * gain);
    setRot('shinR', Math.max(0, Math.sin(phase + Math.PI + Math.PI / 2)) * WALK_AMP_SHIN * gain);
    // руки в противофазе ногам (L рука ↔ R нога)
    setRot('upperArmL', Math.sin(phase + Math.PI) * WALK_AMP_ARM * gain);
    setRot('upperArmR', Math.sin(phase) * WALK_AMP_ARM * gain);
    setRot('forearmL', Math.max(0, Math.sin(phase + Math.PI)) * WALK_AMP_FOREARM * gain);
    setRot('forearmR', Math.max(0, Math.sin(phase)) * WALK_AMP_FOREARM * gain);
    // лёгкий наклон торса вперёд при движении
    setRot('spine', 0.08 * gain);
  }

  /** Взмах крыльев + лёгкий вертикальный bob тела (летучая мышь). */
  private animateBat(inst: InstanceView, t: number, speed: number): void {
    const phase = t * BAT_FLAP_FREQ + inst.phaseSeed;
    const gain = Math.max(0.55, Math.min(1, 0.55 + speed / 1.5)); // в полёте чуть энергичнее
    const wl = inst.nodes.get('wingL');
    const wr = inst.nodes.get('wingR');
    // крылья в противофазе качаются по Z (взмах вверх/вниз).
    if (wl) wl.rotation.z = -Math.abs(Math.sin(phase)) * BAT_FLAP_AMP * gain;
    if (wr) wr.rotation.z = Math.abs(Math.sin(phase)) * BAT_FLAP_AMP * gain;
    // bob тела — добавляем к Y (sync уже выставил base).
    inst.root.position.y += Math.sin(phase) * BAT_BOB_AMP * inst.sizeMult;
  }

  /** Перебирание 8 ног (4 пары в противофазе) — паучий скейтинг. */
  private animateSpider(inst: InstanceView, t: number, speed: number): void {
    const idle = speed < IDLE_SPEED;
    const gain = idle ? 0.25 : Math.min(1, speed / 1.0);
    const phase = t * SPIDER_STRIDE_FREQ + inst.phaseSeed;
    // диагональные пары (L1+R2+L3+R4 vs R1+L2+R3+L4) в противофазе — как настоящие пауки.
    const setY = (name: string, v: number): void => {
      const n = inst.nodes.get(name);
      if (n) n.rotation.y = v;
    };
    const groupA = ['legL1', 'legR2', 'legL3', 'legR4'];
    const groupB = ['legR1', 'legL2', 'legR3', 'legL4'];
    const liftA = Math.max(0, Math.sin(phase)) * SPIDER_STRIDE_AMP * gain;
    const liftB = Math.max(0, Math.sin(phase + Math.PI)) * SPIDER_STRIDE_AMP * gain;
    for (const n of groupA) setY(n, liftA);
    for (const n of groupB) setY(n, liftB);
  }

  /** Парение призрака — вертикальный bob + покачивание рук/капюшона. */
  private animateGhost(inst: InstanceView, t: number, _speed: number): void {
    const phase = t * GHOST_HOVER_FREQ + inst.phaseSeed;
    const setRot = (name: string, x: number): void => {
      const n = inst.nodes.get(name);
      if (n) n.rotation.x = x;
    };
    setRot('head', Math.sin(phase) * 0.08);                    // лёгкий наклон капюшона
    setRot('armL', Math.sin(phase + Math.PI / 3) * GHOST_SWAY_AMP);
    setRot('armR', Math.sin(phase - Math.PI / 3) * GHOST_SWAY_AMP);
    inst.root.position.y += (Math.sin(phase) * 0.5 + 0.5) * GHOST_HOVER_AMP * inst.sizeMult;
  }

  /** Слизень — squash/stretch: scaling.y пульсирует (сжатие↔растяжение). */
  private animateSlime(inst: InstanceView, t: number, _speed: number): void {
    const phase = t * SLIME_SQUASH_FREQ + inst.phaseSeed;
    const squash = Math.sin(phase) * SLIME_SQUASH_AMP;
    // объём сохраняется: y растёт → x,z сжимаются (простая area-preserving деформация).
    inst.root.scaling.y *= 1 + squash;
    inst.root.scaling.x *= 1 - squash * 0.5;
    inst.root.scaling.z *= 1 - squash * 0.5;
  }

  /** Source-меши партов (для регистрации теней; research §5.5). */
  getShadowCasterMeshes(): Mesh[] {
    const out: Mesh[] = [];
    for (const m of this.masters.values()) out.push(...collectRigMeshes(m.root));
    return out;
  }

  /** Воксели парта по имени у данного врага (для дебриса — Фаза P1). */
  getPartVoxelsForEnemy(enemyId: string, partName: string): import('../voxel/voxel-builder').Voxel[] {
    const inst = this.instances.get(enemyId);
    if (!inst) return [];
    const master = this.findMasterOfInstance(inst);
    return master ? getPartVoxels(master.def, partName) : [];
  }

  private findMasterOfInstance(inst: InstanceView): MasterRig | undefined {
    for (const m of this.masters.values()) {
      if (listHasWalkNodes(m.def)) {
        // эвристика: совпадение по наличию walk-нод (для demo достаточно)
        if (inst.nodes.size > 0) return m;
      }
    }
    return undefined;
  }

  private findMasterByTypeId(typeId: string): MasterRig | undefined {
    return this.masters.get(typeId);
  }

  /** Процедурный CharacterDef по seed (кеш — генерация детерминирована, Фаза P4). */
  private getProceduralDef(seed: number): CharacterDef {
    let def = this.proceduralCache.get(seed);
    if (!def) {
      def = assembleCharacter(seed);
      this.proceduralCache.set(seed, def);
    }
    return def;
  }

  dispose(): void {
    for (const inst of this.instances.values()) disposeRig(inst.root);
    this.instances.clear();
    for (const m of this.masters.values()) disposeRig(m.root);
    this.masters.clear();
    this.sizeByType.clear();
    this.typeIdByEnemyId.clear();
    this.prevIds.clear();
    this.debris.dispose();
  }
}

/** Собирает все воксели CharacterDef (для дебриса при смерти). */
function collectBodyVoxels(def: CharacterDef): Voxel[] {
  const out: Voxel[] = [];
  const walk = (p: { voxels: Voxel[]; children: unknown[] }): void => {
    for (const v of p.voxels) out.push(v);
    for (const c of p.children) walk(c as { voxels: Voxel[]; children: unknown[] });
  };
  walk(def.root);
  return out;
}

/** Есть ли в def суставы walk-cycle (иначе анимация пропускается). */
function listHasWalkNodes(def: CharacterDef): boolean {
  const names = new Set<string>();
  const walk = (p: { name: string; children: typeof def.root['children'] }): void => {
    names.add(p.name);
    for (const c of p.children) walk(c);
  };
  walk(def.root);
  return WALK_NODES.some((n) => names.has(n));
}

// re-export для P1 (debris использует getPartVoxels через CharacterDef)
void skeletonRigged;
