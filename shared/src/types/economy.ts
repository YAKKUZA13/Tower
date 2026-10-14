/**
 * RTS-экономика «Тёмная крепость» (Phase 6, концепция 3).
 * См. TD-MVP-PLAN.md §2.6 и §4.3.
 *
 * Параллельно с TD-обороной игрок развивает экономику: добывает ресурсы
 * (wood/stone/ore/gold), строит производственные здания с цепочками переработки
 * (Sawmill→доски; Mine→руда; Smelter: руда→золото; Barracks→юниты), тренирует
 * защитные юниты (Knight/Archer/Mage) со стойками, управляет командиром-заклинателем
 * с активными заклинаниями на кулдауне (Meteor/Freeze/Heal-Walls/Gold-Rush).
 *
 * Режим ОПЦИОНАЛЬНЫЙ — включается через MapDocument.rts.enabled. Без него — чистый TD.
 *
 * Все runtime-типы (ProductionBuilding/DefenderUnit) НЕ персистятся в карте — только
 * в снапшоте сима. Каталоги (типы) — глобальные (с сервера) или встроенные в GameCatalog.
 */

import type { ModelRef } from './td.js';

// ── Ресурсы ──────────────────────────────────────────────────────────
export type ResourceId = 'wood' | 'stone' | 'ore' | 'gold';

export type ResourceBag = Partial<Record<ResourceId, number>>;

/** Внешний вид ресурсного узла (M8.3). */
export type ResourceKind = 'wood' | 'stone' | 'ore' | 'gold';

// ── Производственные здания ──────────────────────────────────────────
export interface ProductionBuildingType {
  id: string;
  name: string;
  /** Цена постройки в ресурсах. */
  cost: ResourceBag;
  /**
   * Потребление ресурсов (input) в секунду. Если на складе нет нужного ресурса —
   * производство на этом шаге простаивает. Опц. (для добычников нет input).
   */
  input?: Array<{ resource: ResourceId; perSec: number }>;
  /** Выход ресурсов (output) в секунду. */
  output: Array<{ resource: ResourceId; perSec: number }>;
  modelRef: ModelRef;
  description: string;
}

/** Экземпляр производственного здания на поле (runtime, не персистится в карте). */
export interface ProductionBuilding {
  id: string;
  typeId: string;
  col: number;
  row: number;
  /** Накопленная доля секунды производства (для целочисленного accrual). */
  accum: Partial<Record<ResourceId, number>>;
}

// ── Защитные юниты ────────────────────────────────────────────────────
export type UnitStance = 'guard' | 'patrol' | 'aggressive';

export interface DefenderUnitType {
  id: string;
  name: string;
  /** Цена обучения в ресурсах. */
  cost: ResourceBag;
  hp: number;
  damage: number;
  /** Атака в клетках. */
  range: number;
  /** Скорость перемещения в клетках/сек (0 = статичный). */
  speed: number;
  /** Выстрелов/сек. */
  fireRate: number;
  modelRef: ModelRef;
  description: string;
  /**
   * M8.3: юнит — worker (добывает ресурсы из resource-nodes).
   * Worker НЕ атакует юнитов, но может move/gather. default false.
   */
  worker?: boolean;
  /** M8.3: сколько единиц ресурса worker уносит за один trip (default 5). */
  carryCapacity?: number;
  /** M8.3: сколько секунд worker копает на узле за one-load (default 1.5). */
  gatherTime?: number;
}

/** Экземпляр защитного юнита (runtime, не персистится в карте). */
export interface DefenderUnit {
  id: string;
  typeId: string;
  col: number;
  row: number;
  /** Текущая world-позиция (центр) — для гладкого движения и рендера. */
  position: { x: number; y: number; z: number };
  hp: number;
  maxHp: number;
  stance: UnitStance;
  /** До следующей атаки (сек). */
  cooldown: number;
  /** Id врага, по которому бьётся юнит (для визуала/продолжения). */
  targetEnemyId: string | null;
  /** Якорь стоянки (для guard/patrol-режима — возврат после погони). */
  homeCol: number;
  homeRow: number;
  // ── M8.2 (voxel-migration-plan): прямой контроль юнитов игроком (RTS-приказы). ──
  /** Приказ движения к клетке (override AI пока активен; null = нет приказа). */
  moveOrderCol?: number;
  moveOrderRow?: number;
  /** Приказ атаки конкретного врага (override auto-targeting). */
  attackOrderEnemyId?: string | null;
  // ── M8.2: waypoint queue (shift-накопленные приказы). ──
  /** Очередь последующих точек движения (FIFO после moveOrderCol/Row). */
  waypoints?: Array<{ col: number; row: number }>;
  /** patrol-loop: после достижения последнего waypoint возвращается к первому. */
  patrolLoop?: boolean;
  // ── M8.3: worker state (gathering). ──
  /** Id ресурсного узла, к которому worker приписан/копает. */
  gatherNodeId?: string | null;
  /** Накопленный carry (0..carryCapacity). */
  carry?: number;
  /** Текущий carry-kind (для рендера мешка на спине). */
  carryKind?: ResourceKind | null;
  /** Состояние worker-FSM: 'idle' | 'to-node' | 'gathering' | 'to-base'. */
  gatherState?: 'idle' | 'to-node' | 'gathering' | 'to-base';
  /** Таймер копания (0..gatherTime). */
  gatherTimer?: number;
  navigationStatus?: 'moving' | 'arrived' | 'blocked';
}

// ── M8.3: Tech tree / upgrades ────────────────────────────────────────
export type UpgradeTargetKind = 'unit-damage' | 'unit-armor' | 'unit-speed' | 'building-production' | 'unlock-unit' | 'unlock-building' | 'epoch';

export interface UpgradeType {
  id: string;
  name: string;
  description: string;
  /** К какому зданию крепится апгрейд (Town Hall / Barracks / ...). */
  buildingTypeId: string;
  cost: ResourceBag;
  /** Время исследования (сек). */
  researchTime: number;
  target: UpgradeTargetKind;
  /** Какой typeId юнита/здания затрагивает (для unlock-* / specific buffs). */
  targetType?: string;
  /** Величина эффекта (для unit-damage = множитель; для unit-speed = +%). */
  magnitude?: number;
  /** Tech-эпоха, в которую апгрейд доступен (1..3 типично). */
  epoch?: number;
  /** Какие апгрейды должны быть исследованы до этого. */
  requires?: string[];
}

// ── Командир-заклинатель ──────────────────────────────────────────────
export type SpellEffectKind = 'meteor' | 'freeze' | 'heal-walls' | 'gold-rush';

export interface Spell {
  id: string;
  name: string;
  description: string;
  effect: SpellEffectKind;
  /** Кулдаун (сек) между применениями. */
  cooldown: number;
  /** Радиус действия (клеток) — для meteor/freeze. */
  radius?: number;
  /** Величина эффекта: meteor — урон; freeze — длительность сек; heal-walls — % восстановления; gold-rush — плоско золота. */
  power: number;
}

export interface CommanderType {
  id: string;
  name: string;
  spells: Spell[];
  modelRef: ModelRef;
}

/** Runtime-кулдауны заклинаний командира: spellId → секунды до готовности (0 = готов). */
export type CommanderCooldowns = Record<string, number>;
