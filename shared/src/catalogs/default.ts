/**
 * Дефолтные каталоги TD.
 * Phase 1 (примитивы) → Phase 2: modelRef.catalogId теперь ссылается на воксельные
 * модели (client/src/babylon/voxel) или GLB (client/public/catalog). См. TD-MVP-PLAN.md §2.9, §3.
 */

import type { EnemyType, TowerType, WallMaterialDef, Wave } from '../types/td.js';
import type { RelicType } from '../types/relic.js';
import type {
  CommanderType,
  DefenderUnitType,
  ProductionBuildingType,
  ResourceId
} from '../types/economy.js';
import type { GameCatalog } from '../types/sim.js';

// ── Башни (4) ────────────────────────────────────────────────────────
export const DEFAULT_TOWER_TYPES: TowerType[] = [
  {
    id: 'arrow',
    name: 'Лучник',
    category: 'physical',
    cost: 50,
    range: 3.0,
    damage: 8,
    fireRate: 1.6,
    projectileSpeed: 14,
    projectileType: 'arrow',
    targetingMode: 'first',
    upgrades: [],
    modelRef: { catalogId: 'tower:arrow', scale: 1 },
    description: 'Дешёвая скорострельная башня. Бьёт одиночные цели.'
  },
  {
    id: 'cannon',
    name: 'Осада',
    category: 'siege',
    cost: 120,
    range: 3.4,
    damage: 26,
    fireRate: 0.55,
    projectileSpeed: 8,
    projectileType: 'shell',
    targetingMode: 'first',
    splashRadius: 1.6,
    upgrades: [],
    modelRef: { catalogId: 'tower:cannon', scale: 1 },
    description: 'Медленные, мощные снаряды по площади.'
  },
  {
    id: 'arcane',
    name: 'Аркан',
    category: 'magic',
    cost: 95,
    range: 3.2,
    damage: 16,
    fireRate: 1.0,
    projectileSpeed: 11,
    projectileType: 'bolt',
    targetingMode: 'strongest',
    upgrades: [],
    modelRef: { catalogId: 'tower:arcane', scale: 1 },
    description: 'Магическая башня. Игнорирует броню, бьёт сильнейших.'
  },
  {
    id: 'ice',
    name: 'Лёд',
    category: 'magic',
    cost: 80,
    range: 2.8,
    damage: 6,
    fireRate: 1.2,
    projectileSpeed: 10,
    projectileType: 'bolt',
    targetingMode: 'first',
    slowFactor: 0.5,
    upgrades: [],
    modelRef: { catalogId: 'tower:ice', scale: 1 },
    description: 'Слабый урон, но замедляет поражённых врагов.'
  }
];

// ── Враги (4 + 1 босс) ───────────────────────────────────────────────
export const DEFAULT_ENEMY_TYPES: EnemyType[] = [
  {
    id: 'skeleton',
    name: 'Скелет',
    category: 'normal',
    baseHp: 32,
    speed: 1.3,
    reward: 8,
    damageToBase: 1,
    wallDamage: 5,
    armor: 0,
    flies: false,
    modelRef: { catalogId: 'enemy:skeleton', scale: 1 }
  },
  {
    id: 'goblin',
    name: 'Гоблин',
    category: 'fast',
    baseHp: 18,
    speed: 2.3,
    reward: 6,
    damageToBase: 1,
    wallDamage: 4,
    armor: 0,
    flies: false,
    modelRef: { catalogId: 'enemy:goblin', scale: 1 }
  },
  {
    id: 'zombie',
    name: 'Зомби',
    category: 'tank',
    baseHp: 70,
    speed: 0.85,
    reward: 13,
    damageToBase: 2,
    wallDamage: 8,
    armor: 2,
    flies: false,
    modelRef: { catalogId: 'enemy:zombie', scale: 1 }
  },
  {
    id: 'demon',
    name: 'Демон',
    category: 'tank',
    baseHp: 160,
    speed: 0.95,
    reward: 26,
    damageToBase: 3,
    wallDamage: 12,
    armor: 4,
    flies: false,
    modelRef: { catalogId: 'enemy:demon', scale: 1 }
  },
  {
    id: 'boss',
    name: 'Владыка',
    category: 'boss',
    baseHp: 900,
    speed: 0.7,
    reward: 120,
    damageToBase: 10,
    wallDamage: 30,
    armor: 10,
    flies: false,
    modelRef: { catalogId: 'enemy:boss', scale: 1 }
  }
];

// ── Волны (~10) ──────────────────────────────────────────────────────
export const DEFAULT_WAVES: Wave[] = [
  { index: 0, rewardBonus: 20, groups: [{ enemyTypeId: 'skeleton', count: 8, interval: 0.9, startDelay: 0 }] },
  { index: 1, rewardBonus: 25, groups: [{ enemyTypeId: 'skeleton', count: 10, interval: 0.7, startDelay: 0 }, { enemyTypeId: 'goblin', count: 4, interval: 0.6, startDelay: 4 }] },
  { index: 2, rewardBonus: 30, groups: [{ enemyTypeId: 'goblin', count: 14, interval: 0.5, startDelay: 0 }] },
  { index: 3, rewardBonus: 35, groups: [{ enemyTypeId: 'skeleton', count: 12, interval: 0.6, startDelay: 0 }, { enemyTypeId: 'zombie', count: 4, interval: 1.4, startDelay: 3 }] },
  { index: 4, rewardBonus: 40, groups: [{ enemyTypeId: 'zombie', count: 10, interval: 1.0, startDelay: 0 }, { enemyTypeId: 'goblin', count: 10, interval: 0.4, startDelay: 6 }] },
  { index: 5, rewardBonus: 50, groups: [{ enemyTypeId: 'skeleton', count: 18, interval: 0.4, startDelay: 0 }, { enemyTypeId: 'demon', count: 2, interval: 2.5, startDelay: 5 }] },
  { index: 6, rewardBonus: 55, groups: [{ enemyTypeId: 'zombie', count: 14, interval: 0.8, startDelay: 0 }, { enemyTypeId: 'goblin', count: 16, interval: 0.35, startDelay: 4 }] },
  { index: 7, rewardBonus: 65, groups: [{ enemyTypeId: 'demon', count: 6, interval: 1.6, startDelay: 0 }, { enemyTypeId: 'skeleton', count: 20, interval: 0.35, startDelay: 2 }] },
  { index: 8, rewardBonus: 80, groups: [{ enemyTypeId: 'zombie', count: 18, interval: 0.6, startDelay: 0 }, { enemyTypeId: 'demon', count: 8, interval: 1.2, startDelay: 6 }] },
  { index: 9, rewardBonus: 200, isBoss: true, groups: [{ enemyTypeId: 'boss', count: 1, interval: 1, startDelay: 0 }, { enemyTypeId: 'demon', count: 6, interval: 1.5, startDelay: 3 }] }
];

export const DEFAULT_WALL_MATERIALS: WallMaterialDef[] = [
  {
    material: 'wood',
    name: 'Дерево',
    maxHp: 60,
    cost: 8,
    repairRatio: 0.4,
    modelRef: { catalogId: 'wall:wood', scale: 1 }
  },
  {
    material: 'stone',
    name: 'Камень',
    maxHp: 160,
    cost: 18,
    repairRatio: 0.4,
    modelRef: { catalogId: 'wall:stone', scale: 1 }
  },
  {
    material: 'bone',
    name: 'Кость',
    maxHp: 100,
    cost: 12,
    repairRatio: 0.4,
    modelRef: { catalogId: 'wall:bone', scale: 1 }
  }
];

// ── Реликвии (Фаза 5, концепция 1) ───────────────────────────────────
// 4 common / 5 rare / 3 epic. Визуальная модель тотема подобрана по теме эффекта.
// catalogId тотемов резолвятся в client/src/babylon/voxel/voxel-builder.ts.
export const DEFAULT_RELICS: RelicType[] = [
  // ── Common (мелкие, направленные бонусы) ──
  {
    id: 'rune-of-arrows',
    name: 'Руна стрел',
    rarity: 'common',
    description: '+15% урона всем физическим башням.',
    effect: { target: 'towers-by-category', categoryFilter: 'physical', damageMult: 1.15 },
    modelRef: { catalogId: 'relic:totem-fire', scale: 1 }
  },
  {
    id: 'glyph-of-haste',
    name: 'Глиф спешки',
    rarity: 'common',
    description: '+12% скорострельности всем башням.',
    effect: { target: 'all-towers', fireRateMult: 1.12 },
    modelRef: { catalogId: 'relic:totem-gold', scale: 1 }
  },
  {
    id: 'lucky-coin',
    name: 'Счастливая монета',
    rarity: 'common',
    description: '+1 золота за каждое убийство.',
    effect: { target: 'economy', goldOnKillBonus: 1 },
    modelRef: { catalogId: 'relic:totem-gold', scale: 1 }
  },
  {
    id: 'mithril-runes',
    name: 'Мифриловые руны',
    rarity: 'common',
    description: '+20% к прочности всех новых и существующих стен.',
    effect: { target: 'walls', wallHpMult: 1.20 },
    modelRef: { catalogId: 'relic:totem-ice', scale: 1 }
  },
  // ── Rare (заметные, узконаправленные) ──
  {
    id: 'blood-frenzy',
    name: 'Кровавый раж',
    rarity: 'rare',
    description: '+25% урона всем башням.',
    effect: { target: 'all-towers', damageMult: 1.25 },
    modelRef: { catalogId: 'relic:totem-blood', scale: 1 }
  },
  {
    id: 'eagle-eye',
    name: 'Орлиный глаз',
    rarity: 'rare',
    description: '+18% дальности всем башням.',
    effect: { target: 'all-towers', rangeMult: 1.18 },
    modelRef: { catalogId: 'relic:totem-ice', scale: 1 }
  },
  {
    id: 'greed-pact',
    name: 'Пакт жадности',
    rarity: 'rare',
    description: '+15% золота за убийства и зачистку волн.',
    effect: { target: 'economy', goldMult: 1.15 },
    modelRef: { catalogId: 'relic:totem-gold', scale: 1 }
  },
  {
    id: 'frost-shard',
    name: 'Осколок льда',
    rarity: 'rare',
    description: 'Попадания всех башень замедляют врагов на 20%.',
    effect: { target: 'all-towers', slowOnHit: 0.8 },
    modelRef: { catalogId: 'relic:totem-ice', scale: 1 }
  },
  {
    id: 'arcane-surge',
    name: 'Магический всплеск',
    rarity: 'rare',
    description: '+30% урона всем магическим башням.',
    effect: { target: 'towers-by-category', categoryFilter: 'magic', damageMult: 1.30 },
    modelRef: { catalogId: 'relic:totem-arcane', scale: 1 }
  },
  // ── Epic (мощные, многоэффектные) ──
  {
    id: 'war-drums',
    name: 'Боевые барабаны',
    rarity: 'epic',
    description: '+20% урона и +10% скорострельности всем башням.',
    effect: { target: 'all-towers', damageMult: 1.20, fireRateMult: 1.10 },
    modelRef: { catalogId: 'relic:totem-blood', scale: 1 }
  },
  {
    id: 'siege-breaker',
    name: 'Разрушитель осад',
    rarity: 'epic',
    description: '+35% урона осадным башням и +0.4 к радиусу взрыва снарядов.',
    effect: { target: 'towers-by-category', categoryFilter: 'siege', damageMult: 1.35, splashAdded: 0.4 },
    modelRef: { catalogId: 'relic:totem-fire', scale: 1 }
  },
  {
    id: 'overcharge',
    name: 'Перегрузка',
    rarity: 'epic',
    description: '+25% урона, +15% дальности всем башням и +1 золота за убийство.',
    effect: { target: 'global', damageMult: 1.25, rangeMult: 1.15, goldOnKillBonus: 1 },
    modelRef: { catalogId: 'relic:totem-arcane', scale: 1 }
  }
];

// ── RTS: Производственные здания (Фаза 6) ─────────────────────────────
// Цепочки переработки: Sawmill/Mine (добыча) → Smelter (руда→золото) / Barracks (юниты).
// Симплекс: 4 здания, 4 ресурса. Стоимость зданий в разных ресурсах → нужна экономика.
export const DEFAULT_PRODUCTION_BUILDINGS: ProductionBuildingType[] = [
  {
    id: 'sawmill',
    name: 'Лесопилка',
    cost: { wood: 30 },
    output: [{ resource: 'wood', perSec: 1.2 }],
    modelRef: { catalogId: 'building:sawmill', scale: 1 },
    description: 'Добывает дерево. Основа ранней экономики.'
  },
  {
    id: 'mine',
    name: 'Шахта',
    cost: { wood: 40 },
    output: [{ resource: 'stone', perSec: 0.6 }, { resource: 'ore', perSec: 0.6 }],
    modelRef: { catalogId: 'building:mine', scale: 1 },
    description: 'Добывает камень и руду.'
  },
  {
    id: 'smelter',
    name: 'Плавильня',
    cost: { wood: 50, stone: 30 },
    input: [{ resource: 'ore', perSec: 0.6 }],
    output: [{ resource: 'gold', perSec: 0.4 }],
    modelRef: { catalogId: 'building:smelter', scale: 1 },
    description: 'Переплавляет руду в золото. Цепочка переработки.'
  },
  {
    id: 'barracks',
    name: 'Казармы',
    cost: { wood: 60, stone: 40 },
    output: [],
    modelRef: { catalogId: 'building:barracks', scale: 1 },
    description: 'Тренировочный лагерь для защитных юнитов. Сама не производит ресурсы.'
  }
];

// ── RTS: Защитные юниты (Фаза 6) ──────────────────────────────────────
// Knight — ближний танковый; Archer — дальний скорострельный; Mage — медленный маг.
export const DEFAULT_DEFENDER_UNITS: DefenderUnitType[] = [
  {
    id: 'knight',
    name: 'Рыцарь',
    cost: { gold: 25 },
    hp: 90,
    damage: 14,
    range: 1.0,
    speed: 1.4,
    fireRate: 1.0,
    modelRef: { catalogId: 'unit:knight', scale: 1 },
    description: 'Прочный ближний боец. Принимает удар на себя.'
  },
  {
    id: 'archer',
    name: 'Лучник',
    cost: { gold: 30, wood: 10 },
    hp: 45,
    damage: 10,
    range: 3.0,
    speed: 1.2,
    fireRate: 1.4,
    modelRef: { catalogId: 'unit:archer', scale: 1 },
    description: 'Дальний скорострельный стрелок. Бьёт издали.'
  },
  {
    id: 'mage',
    name: 'Маг',
    cost: { gold: 45, ore: 10 },
    hp: 40,
    damage: 22,
    range: 2.6,
    speed: 1.0,
    fireRate: 0.7,
    modelRef: { catalogId: 'unit:mage', scale: 1 },
    description: 'Медленный, но мощный. Игнорирует броню магией.'
  }
];

// ── RTS: Командиры-заклинатели (Фаза 6) ───────────────────────────────
export const DEFAULT_COMMANDERS: CommanderType[] = [
  {
    id: 'commander:necromancer',
    name: 'Некромант',
    modelRef: { catalogId: 'unit:commander', scale: 1 },
    spells: [
      {
        id: 'meteor',
        name: 'Метеор',
        description: 'Огненный дождь по области: урон всем врагам в радиусе.',
        effect: 'meteor',
        cooldown: 22,
        radius: 2.5,
        power: 80
      },
      {
        id: 'freeze',
        name: 'Стужа',
        description: 'Замораживает врагов в области на короткое время.',
        effect: 'freeze',
        cooldown: 18,
        radius: 3.0,
        power: 3
      },
      {
        id: 'heal-walls',
        name: 'Стальная воля',
        description: 'Восстанавливает 50% прочности всех стен лабиринта.',
        effect: 'heal-walls',
        cooldown: 30,
        power: 0.5
      },
      {
        id: 'gold-rush',
        name: 'Жатва',
        description: 'Мгновенно приносит золото в казну крепости.',
        effect: 'gold-rush',
        cooldown: 28,
        power: 60
      }
    ]
  }
];

/** Все возможные ресурсы RTS в фиксированном порядке (для UI/итерации). */
export const RESOURCE_ORDER: ResourceId[] = ['wood', 'stone', 'ore', 'gold'];

export const DEFAULT_CATALOG: GameCatalog = {
  towers: DEFAULT_TOWER_TYPES,
  enemies: DEFAULT_ENEMY_TYPES,
  waves: DEFAULT_WAVES,
  walls: DEFAULT_WALL_MATERIALS,
  relics: DEFAULT_RELICS,
  productionBuildings: DEFAULT_PRODUCTION_BUILDINGS,
  defenderUnits: DEFAULT_DEFENDER_UNITS,
  commanders: DEFAULT_COMMANDERS
};
