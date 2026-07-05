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
  UnitStance
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
 */
export interface GameSnapshot {
  tick: number;
  status: SimStatus;
  /** Индекс текущей/следующей волны. -1 до первой волны. */
  waveIndex: number;
  gold: number;
  lives: number;
  pathLength: number;
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
  /** Текущий запас ресурсов. */
  resources?: Record<ResourceId, number>;
  /** Производственные здания (Sawmill/Mine/Smelter/Barracks). */
  productionBuildings?: ProductionBuilding[];
  /** Защитные юниты (Knight/Archer/Mage). */
  defenderUnits?: DefenderUnit[];
  /** Кулдауны заклинаний командира: spellId → сек до готовности (0 = готов). */
  commanderCooldowns?: CommanderCooldowns;
  /** Активные заклинания в обработке (визуал + ещё не погашенные эффекты). */
  activeSpells?: ActiveSpell[];
  // ── окружение (Фаза 3 использует; заложено с Фазы 1 для детерминированности) ──
  timeOfDay: number; // 0..1
  weather: Weather;
  // ── co-op (Фаза 7; в single-player один игрок-owner) ──
  ownerId: string;
  players: Array<{ userId: string; role: CoopRole; ready: boolean }>;
}

export interface PlayerInput {
  tick: number;
  userId: string;
  action: PlayerAction;
}

/** Активное заклинание в обработке (Phase 6). Хранится в snapshot для интерполяции рендера. */
export interface ActiveSpell {
  id: string;
  spellId: string;
  /** Центр применения в клетках. */
  col: number;
  row: number;
  /** Сколько тиков эффект ещё активен (для freeze/ring-визуала). */
  remainingTicks: number;
}

/**
 * Действия игрока. Phase 1 реализует подмножество (place-tower/sell-tower/
 * start-wave/set-targeting); place-wall/repair-wall — Фаза 4; pick-relic/
 * remove-relic/skip-draft — Фаза 5; build-production/train-unit/set-unit-stance/
 * cast-spell — Фаза 6 (RTS).
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
  | { kind: 'cast-spell'; spellId: string; col: number; row: number };

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
}
