/**
 * M8.3 — RTS catalog: Town Hall / Barracks / Worker / upgrades.
 * Источник: AoE2/Warcraft tech tree; G4 plan — улучшенные recipe-структуры.
 *
 * Расширяет DEFAULT_CATALOG (towers/enemies/waves/relics/walls/productionBuildings/
 * defenderUnits/commanders) — РТС-only entries:
 *
 * Buildings:
 *  - town-hall (L1): база; trains workers; drop-off для всех ресурсов.
 *  - barracks: тренирует военных юнитов (knight/archer/mage).
 *  - sawmill/mine/smelter: производственная цепочка (уже в DEFAULT_CATALOG).
 *  - watch-tower: оборонительная постройка (как TD-tower, но RTS-placeable).
 *
 * Units:
 *  - worker: добывает wood/stone/ore/gold; строит здания; не атакует.
 *
 * Upgrades (tech tree):
 *  - town-hall-l2 / town-hall-l3 (эпоха upgrade; recipe per level — G4)
 *  - melee-attack-1, melee-armor-1, ranged-attack-1, gather-capacity-1
 *
 * Все записи — type-only (GameCatalog extension). Рантайм-создание экземпляров —
 * в DEFAULT_CATALOG.rtsExtension.
 */
import type {
  CommanderType,
  DefenderUnitType,
  ProductionBuildingType,
  ResourceId
} from '../types/economy.js';
import type { UpgradeType } from '../types/economy.js';
import type { GameCatalog } from '../types/sim.js';

// ── Buildings ──────────────────────────────────────────────────────────

export const RTS_TOWN_HALL_L1: ProductionBuildingType = {
  id: 'town-hall',
  name: 'Ратуша',
  // output — это drop-off accumulator: worker приносит → +1 в bag игрока.
  // (production не auto; workers приносят.) → output = [] (no passive production).
  output: [],
  cost: { wood: 200, stone: 100 },
  modelRef: { catalogId: 'building:town-hall', scale: 1 },
  description: 'Базовое здание. Хранит ресурсы, тренирует workers.'
};

export const RTS_TOWN_HALL_L2: ProductionBuildingType = {
  id: 'town-hall-l2',
  name: 'Ратуша II',
  output: [],
  cost: { wood: 400, stone: 200, ore: 50 },
  modelRef: { catalogId: 'building:town-hall-l2', scale: 1.1 },
  description: 'Эпоха 2. Открывает апгрейды и юнитов L2.'
};

export const RTS_BARRACKS: ProductionBuildingType = {
  id: 'rts-barracks',
  name: 'Военные казармы',
  output: [],
  cost: { wood: 120, stone: 60 },
  modelRef: { catalogId: 'building:barracks', scale: 1 },
  description: 'Тренирует военных юнитов: knight, archer, mage.'
};

export const RTS_WATCH_TOWER: ProductionBuildingType = {
  id: 'rts-watch-tower',
  name: 'Сторожевая башня',
  output: [],
  cost: { wood: 60, stone: 80 },
  modelRef: { catalogId: 'building:watch-tower', scale: 1 },
  description: 'Оборонительная постройка с дальнобойной атакой.'
};

// ── Units ──────────────────────────────────────────────────────────────

export const RTS_WORKER: DefenderUnitType = {
  id: 'worker',
  name: 'Рабочий',
  cost: { wood: 10, gold: 5 },
  hp: 30,
  damage: 2,                // слабая атака (только для самообороны)
  range: 1,
  speed: 4,
  fireRate: 0.5,
  modelRef: { catalogId: 'unit:worker', scale: 0.9 },
  description: 'Добывает ресурсы. Строит здания. Безопасен в бою.',
  worker: true,
  carryCapacity: 5,
  gatherTime: 1.5
};

// ── Upgrades ───────────────────────────────────────────────────────────

export const RTS_UPGRADES: UpgradeType[] = [
  // ── Epoch / Tier upgrades (Town Hall levels) ──
  {
    id: 'upgrade:town-hall-l2',
    name: 'Advance to L2',
    description: 'Раскрывает эпоху 2 — новые юниты/здания/апгрейды.',
    buildingTypeId: 'town-hall',
    cost: { wood: 400, stone: 200, ore: 50 },
    researchTime: 30,
    target: 'epoch',
    magnitude: 2,
    epoch: 1
  },
  {
    id: 'upgrade:town-hall-l3',
    name: 'Advance to L3',
    description: 'Раскрывает финальную эпоху — лучшие юниты и постройки.',
    buildingTypeId: 'town-hall',
    cost: { wood: 800, stone: 400, ore: 150, gold: 50 },
    researchTime: 60,
    target: 'epoch',
    magnitude: 3,
    epoch: 2,
    requires: ['upgrade:town-hall-l2']
  },
  // ── Unit buffs (Barracks) ──
  {
    id: 'upgrade:melee-attack-1',
    name: 'Melee Attack +1',
    description: 'Knight damage ×1.2',
    buildingTypeId: 'rts-barracks',
    cost: { wood: 80, stone: 40, gold: 20 },
    researchTime: 15,
    target: 'unit-damage',
    targetType: 'knight',
    magnitude: 1.2,
    epoch: 1
  },
  {
    id: 'upgrade:melee-armor-1',
    name: 'Melee Armor +1',
    description: 'Knight armor +10%',
    buildingTypeId: 'rts-barracks',
    cost: { wood: 80, stone: 60, gold: 20 },
    researchTime: 15,
    target: 'unit-armor',
    targetType: 'knight',
    magnitude: 0.1,
    epoch: 1
  },
  {
    id: 'upgrade:ranged-attack-1',
    name: 'Ranged Attack +1',
    description: 'Archer damage ×1.2',
    buildingTypeId: 'rts-barracks',
    cost: { wood: 100, stone: 40, gold: 30 },
    researchTime: 18,
    target: 'unit-damage',
    targetType: 'archer',
    magnitude: 1.2,
    epoch: 1
  },
  {
    id: 'upgrade:gather-capacity-1',
    name: 'Gather Capacity +5',
    description: 'Workers carry +5 per trip',
    buildingTypeId: 'town-hall',
    cost: { wood: 60, stone: 30 },
    researchTime: 12,
    target: 'unit-speed',
    targetType: 'worker',
    magnitude: 5,
    epoch: 1
  },
  // ── Unlock-units / buildings ──
  {
    id: 'upgrade:unlock-mage',
    name: 'Unlock Mage',
    description: 'Barracks может тренировать Mage (magic-damage).',
    buildingTypeId: 'rts-barracks',
    cost: { wood: 200, stone: 80, ore: 40, gold: 50 },
    researchTime: 25,
    target: 'unlock-unit',
    targetType: 'mage',
    epoch: 2,
    requires: ['upgrade:town-hall-l2']
  },
  {
    id: 'upgrade:unlock-smelter',
    name: 'Unlock Smelter',
    description: 'Smelter перерабатывает ore → gold.',
    buildingTypeId: 'town-hall',
    cost: { wood: 150, stone: 80 },
    researchTime: 20,
    target: 'unlock-building',
    targetType: 'smelter',
    epoch: 1
  }
];

// ── Сборка RTS-extension catalog ────────────────────────────────────────

export interface RtsCatalogExtension {
  productionBuildings: ProductionBuildingType[];
  defenderUnits: DefenderUnitType[];
  commanders: CommanderType[];
  upgrades: UpgradeType[];
}

/**
 * Возвращает все RTS-entries (buildings/units/upgrades) для расширения DEFAULT_CATALOG.
 * Используется в shared/src/index.ts (buildRtsCatalog()) и в серверном game-bootstrap.
 */
export function buildRtsCatalogExtension(): RtsCatalogExtension {
  return {
    // базовые RTS-здания + существующие (sawmill/mine/smelter/barracks из DEFAULT_CATALOG)
    productionBuildings: [
      RTS_TOWN_HALL_L1,
      RTS_TOWN_HALL_L2,
      RTS_BARRACKS,
      RTS_WATCH_TOWER
    ],
    defenderUnits: [RTS_WORKER],
    // commanders берутся из DEFAULT_CATALOG (commander:necromancer etc.)
    commanders: [],
    upgrades: RTS_UPGRADES
  };
}

/** ResourceId re-export (для consumers). */
export type { ResourceId };
export type { GameCatalog };
