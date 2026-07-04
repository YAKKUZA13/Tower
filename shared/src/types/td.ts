/**
 * Core Tower-Defense типы (каталоги + runtime).
 * Источник для Phase 1 (sim + renderers). См. TD-MVP-PLAN.md раздел 2.
 */

export type TargetingMode = 'first' | 'last' | 'nearest' | 'strongest' | 'weakest';

export interface ModelRef {
  catalogId: string;
  scale: number;
  rotationY?: number;
}

// ── Башни ───────────────────────────────────────────────
export interface TowerLevel {
  cost: number;
  damageMult: number;
  rangeMult: number;
  fireRateMult: number;
}

export interface UpgradePath {
  name: string;
  levels: TowerLevel[];
}

export interface TowerType {
  id: string;
  name: string;
  category: 'physical' | 'magic' | 'siege';
  cost: number;
  range: number;
  damage: number;
  fireRate: number;          // выстрелов/сек
  projectileSpeed: number;   // клеток/сек
  projectileType: 'bullet' | 'arrow' | 'shell' | 'bolt';
  targetingMode: TargetingMode;
  splashRadius?: number;
  slowFactor?: number;
  upgrades: UpgradePath[];
  modelRef: ModelRef;
  description: string;
}

/** Экземпляр башни на поле (runtime, не персистится в карте). */
export interface Tower {
  id: string;
  typeId: string;
  col: number;
  row: number;
  level: number;
  upgradePathIndex: number;
  cooldown: number;          // до след. выстрела (сек)
  rotationY: number;         // визуальный поворот к цели
  targetingMode?: TargetingMode; // per-instance режим (override дефолта TowerType)
}

// ── Враги и волны ─────────────────────────────────────────
export interface EnemyType {
  id: string;
  name: string;
  category: 'normal' | 'fast' | 'tank' | 'flyer' | 'boss';
  baseHp: number;
  speed: number;             // клеток/сек
  reward: number;            // золото за убийство
  damageToBase: number;      // урон базе при доходе
  wallDamage: number;        // dps по стенам
  armor?: number;
  flies: boolean;            // игнорирует стены
  modelRef: ModelRef;
}

/** Экземпляр врага (runtime). */
export interface Enemy {
  id: string;
  typeId: string;
  hp: number;
  maxHp: number;
  pathProgress: number;      // 0..pathLength
  position: { x: number; y: number; z: number };
  alive: boolean;
  slowUntilTick?: number;
  slowFactor?: number;       // множитель скорости пока действует slow (0..1)
}

export interface WaveGroup {
  enemyTypeId: string;
  count: number;
  interval: number;          // сек между спавнами в группе
  startDelay: number;        // сек от начала волны
}

export interface Wave {
  index: number;
  groups: WaveGroup[];
  rewardBonus: number;
  isBoss?: boolean;
}

// ── Стены (maze-building, Фаза 4 — концепция 2) ──────────────────────
export type WallMaterial = 'wood' | 'stone' | 'bone';

/** Каталог материала стены: характеристики + модель. */
export interface WallMaterialDef {
  material: WallMaterial;
  name: string;
  maxHp: number;
  cost: number;
  /** Доля от cost, которую стоит ремонт 1 HP (полный ремонт = cost*repairRatio*(missingHp/fullHp)). */
  repairRatio: number;
  modelRef: ModelRef;
}

/** Экземпляр стены на поле (runtime, не персистится в карте). */
export interface Wall {
  id: string;
  col: number;
  row: number;
  hp: number;
  maxHp: number;
  material: WallMaterial;
  burning: boolean;
  burningUntilTick?: number;
}
