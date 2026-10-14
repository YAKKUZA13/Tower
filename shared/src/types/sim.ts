/**
 * Симуляция TD: снапшот состояния, ввод игрока, события.
 * Источник для Phase 1 (game-sim + game-store + renderers). См. TD-MVP-PLAN.md раздел 2.7.
 *
 * Сим детерминирован (ADR-2): seeded-rng, fixed-step, input-ordered.
 * Single-player = host=local; co-op (Фаза 7) использует тот же GameSnapshot.
 */

import type { Enemy, EnemyType, Tower, TowerType, Wall, WallMaterial, WallMaterialDef, Wave } from './td.js';
import type { PlacedRelic, RelicType } from './relic.js';
import type {
  CommanderCooldowns,
  CommanderType,
  DefenderUnit,
  DefenderUnitType,
  ProductionBuilding,
  ProductionBuildingType,
  ResourceBag,
  ResourceId,
  Spell,
  UnitStance,
  UpgradeType
} from './economy.js';

export type SimStatus = 'prep' | 'wave' | 'draft' | 'won' | 'lost';
export type CoopRole = 'builder' | 'economist' | 'commander' | 'free';
export type Weather = 'clear' | 'rain' | 'storm';

/** Снаряд (runtime, не персистится в карте). */
export interface Projectile {
  id: string;
  /** typeId башни, выпустившей снаряд (для цвета/эффекта рендера). */
  typeId: string;
  x: number;
  y: number;
  z: number;
  targetEnemyId: string | null;
  damage: number;
  splashRadius?: number;
  slowFactor?: number;
  /** Категория башни — для учёта брони (physical/magic/siege). */
  category: TowerType['category'];
  alive: boolean;
}

/**
 * Полный снапшот сима (ADR-2 — сериализуем, детерминирован).
 * Поля для стен/реликвий/RTS — опциональны; заполняются в Фазах 4/5/6.
 *
 * M8.4: добавлено `playersState: PlayerState[]` для per-player competing state.
 * Legacy TD-поля (`enemies`, `gold`, `lives`, ...) оставлены для TD sandbox.
 */
export interface GameSnapshot {
  worldSites?: RtsWorldSite[];
  tick: number;
  status: SimStatus;
  /** Индекс текущей/следующей волны. -1 до первой волны. @deprecated M8 (TD-only). */
  waveIndex: number;
  /** @deprecated M8 (TD-only) — единый кошелёк; в RTS используйте playersState[i].resources. */
  gold: number;
  /** @deprecated M8 (TD-only) — base-hp; в RTS defeat хранится в playersState[i].defeated. */
  lives: number;
  pathLength: number;
  /** @deprecated M8 — в RTS враги = units других игроков (см. playersState). */
  enemies: Enemy[];
  towers: Tower[];
  projectiles: Projectile[];
  /** Стены лабиринта (Фаза 4). */
  walls: Wall[];
  /** Версия текущего маршрута врагов (A* вокруг стен). Растёт при перестройке. Рендер обновляет tube. */
  routeVersion: number;
  /** Сколько врагов ещё не убито в текущей волне (pending + живые). Для UI/rules. */
  waveEnemiesRemaining: number;
  /** Реликвии, размещённые на поле (Фаза 5). */
  relics: PlacedRelic[];
  /** 3 typeId реликвий для драфта (только когда status==='draft'). */
  pendingRelicChoices: string[];
  // ── RTS «Тёмная крепость» (Фаза 6). Заполняются только если включён rts.enabled. ──
  /** Текущий запас ресурсов. @deprecated M8 — используйте playersState[i].resources. */
  resources?: Record<ResourceId, number>;
  /** @deprecated M8 — используйте playersState[i].buildings. */
  productionBuildings?: ProductionBuilding[];
  /** @deprecated M8 — используйте playersState[i].units. */
  defenderUnits?: DefenderUnit[];
  /** Кулдауны заклинаний командира: spellId → сек до готовности (0 = готов). */
  commanderCooldowns?: CommanderCooldowns;
  /** Активные заклинания в обработке (визуал + ещё не погашенные эффекты). */
  activeSpells?: ActiveSpell[];
  // ── M8.4: per-player competing state (канонический для RTS PvP) ──
  /** Per-player массив (1..4); в single-player = 1 элемент. */
  playersState?: PlayerState[];
  // ── окружение (Фаза 3 использует; заложено с Фазы 1 для детерминированности) ──
  timeOfDay: number; // 0..1
  weather: Weather;
  // ── co-op (Фаза 7; в single-player один игрок-owner) ──
  ownerId: string;
  /** @deprecated M8 — legacy co-op roles; в RTS используйте playersState[i].slot/color. */
  players: Array<{ userId: string; role: CoopRole; ready: boolean }>;
}

/**
 * Per-player RTS state (M8.4). Каждый игрок имеет свою экономику/армию/здания;
 * competing (PvP), не co-op.
 *
 * В single-player — ровно один PlayerState (slot=0, ownerId=ownerId).
 * В PvP — 2..4 (slot=0..3). `defeated` переключается при уничтожении всех зданий игрока.
 */
export interface PlayerState {
  /** Slot 0..3 (1v1 = 0,1; 1v1v1v1 = 0..3). */
  slot: number;
  userId: string;
  /** Hex RGB без '#' (напр. '2E86DE'). */
  color: string;
  defeated: boolean;
  /** Per-player ресурсы (M8.3 economy). */
  resources: Record<ResourceId, number>;
  /** Per-player юниты (workers + military). */
  units: DefenderUnit[];
  /** Per-player здания. */
  buildings: ProductionBuilding[];
  /** Per-player кулдауны заклинаний (если есть commander для этого игрока). */
  commanderCooldowns?: CommanderCooldowns;
  /** Активные заклинания игрока. */
  activeSpells?: ActiveSpell[];
  /** Текущая tech-эпоха (1..3, M8.3). */
  epoch?: number;
  /** Завершённые апгрейды typeId[] (M8.3). */
  researchedUpgrades?: string[];
  /** В исследовании: { upgradeId, remainingSec }. */
  researching?: Array<{ upgradeId: string; remainingSec: number }> | null;
  /** Клетки, видимые игроком (Fog of War, M8.4). В снапшоте клиенту — НЕ передаются
   *  (для security сервер фильтрует snapshot per-player). Это поле — только для UI-.debug. */
  visibleCells?: Array<string>;
}

export interface PlayerInput {
  tick: number;
  userId: string;
  action: PlayerAction;
}

/** Активное заклинание в обработке (Phase 6). Хранится в snapshot для интерполяции рендера. */
export interface ActiveSpell {
  radius?: number;
  effect?: import('./economy.js').SpellEffectKind;
  /** Meteor damage resolves after the visible warning/fall, in authoritative ticks. */
  impactAfterTicks?: number;
  power?: number;
  id: string;
  spellId: string;
  /** Центр применения в клетках. */
  col: number;
  row: number;
  /** Сколько тиков эффект ещё активен (для freeze/ring-визуала). */
  remainingTicks: number;
}

/** Optional single-player world activity, serializable in the authoritative snapshot. */
export interface RtsWorldSite {
  id: string;
  kind: 'supplies' | 'beacon';
  name: string;
  col: number;
  row: number;
  guardIds: string[];
  progress: number;
  secured: boolean;
  reward: { wood?: number; stone?: number; gold?: number };
}

/**
 * Действия игрока. Phase 1 реализует подмножество (place-tower/sell-tower/
 * start-wave/set-targeting); place-wall/repair-wall — Фаза 4; pick-relic/
 * remove-relic/skip-draft — Фаза 5; build-production/train-unit/set-unit-stance/
 * cast-spell — Фаза 6 (RTS).
 *
 * M8.2: добавлены order-unit-patrol, order-unit-attack-move, order-unit-waypoint-queue.
 * M8.3: добавлены order-unit-gather, research-upgrade, build-rts-building.
 */
export type PlayerAction =
  | { kind: 'place-tower'; typeId: string; col: number; row: number }
  | { kind: 'sell-tower'; towerId: string }
  | { kind: 'start-wave' }
  | { kind: 'set-targeting'; towerId: string; mode: TowerType['targetingMode'] }
  | { kind: 'place-wall'; material: WallMaterial; col: number; row: number }
  | { kind: 'repair-wall'; wallId: string }
  | { kind: 'pick-relic'; relicTypeId: string; col: number; row: number }
  | { kind: 'remove-relic'; relicId: string }
  | { kind: 'skip-draft' }
  // ── Phase 6: RTS ──
  | { kind: 'build-production'; typeId: string; col: number; row: number }
  | { kind: 'train-unit'; typeId: string; col: number; row: number }
  | { kind: 'set-unit-stance'; unitId: string; stance: UnitStance }
  | { kind: 'cast-spell'; spellId: string; col: number; row: number }
  // ── M8.2 (voxel-migration-plan): прямой контроль юнитов (RTS-приказы, additive). ──
  | { kind: 'order-unit-move'; unitIds: string[]; col: number; row: number; formation?: import('../types/sim.js').FormationKind }
  | { kind: 'order-unit-attack'; unitIds: string[]; enemyId: string }
  | { kind: 'order-unit-stop'; unitIds: string[] }
  | { kind: 'order-unit-attack-move'; unitIds: string[]; col: number; row: number }
  | { kind: 'order-unit-patrol'; unitIds: string[]; waypoints: Array<{ col: number; row: number }> }
  | { kind: 'order-unit-waypoint-queue'; unitIds: string[]; waypoints: Array<{ col: number; row: number }>; append?: boolean }
  // ── M8.3: economy ──
  | { kind: 'order-unit-gather'; unitIds: string[]; nodeId: string }
  // ── M8.3: tech tree ──
  | { kind: 'research-upgrade'; upgradeId: string; buildingId: string }
  // ── M8.4: control groups (client-only, but tagged for net) ──
  | { kind: 'assign-control-group'; unitIds: string[]; group: number }
  // slot-specific wrappers (for per-player input routing in PvP)
  | { kind: 'rts-slot-action'; slot: number; inner: PlayerAction };

/** M8.2: вид формации (для order-unit-move). */
export type FormationKind = 'none' | 'grid' | 'wedge' | 'line' | 'column';

/** Каталоги правил игры (башни/враги/волны). Источник для sim + UI. */
export interface GameCatalog {
  towers: TowerType[];
  enemies: EnemyType[];
  waves: Wave[];
  /** Материалы стен (Фаза 4). Опционально для совместимости со старыми каталогами. */
  walls?: WallMaterialDef[];
  /** Реликвии для драфта (Фаза 5). Опционально для совместимости. */
  relics?: RelicType[];
  /** Производственные здания RTS (Фаза 6). Опционально — только при включённом режиме. */
  productionBuildings?: ProductionBuildingType[];
  /** Типы защитных юнитов RTS (Фаза 6). */
  defenderUnits?: DefenderUnitType[];
  /** Командиры-заклинатели RTS (Фаза 6). */
  commanders?: CommanderType[];
  /** M8.3: Tech tree — список апгрейдов. */
  upgrades?: UpgradeType[];
}
