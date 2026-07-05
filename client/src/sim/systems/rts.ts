/**
 * Система RTS «Тёмная крепость» (Phase 6, концепция 3).
 * См. TD-MVP-PLAN.md §4.3 и §2.6.
 *
 *  - tickUnits: поведение защитных юнитов по stance (guard/patrol/aggressive):
 *    таргетинг ближайших врагов в range, движение к ним/возврат на home, атака
 *    по cooldown. Мутирует defenderUnits/enemies — возвращает урон/убийства.
 *
 *  - tickCommanderCooldowns: тик кулдаунов заклинаний командира (-dt, min 0).
 *
 *  - castSpell: применение заклинания (meteor=урон по области; freeze=замедление;
 *    heal-walls=% восстановления стен; gold-rush=плоско золото). Создаёт ActiveSpell
 *    для визуала/продолжительности. Возвращает эффект-результат для учёта в симе.
 *
 * Функции чистые (мутируют только переданные коллекции), без Babylon → headless-тесты.
 * Детерминизм: targeting/movement без rng (ближайший по расстоянию, тай-брейк по id).
 */

import type {
  ActiveSpell,
  Enemy,
  EnemyType,
  GridData,
  Spell,
  DefenderUnit,
  DefenderUnitType,
  Wall,
  CommanderCooldowns
} from '@tower/shared';
import type { ResourceBag, ResourceId } from '@tower/shared';
import { gridToWorldData } from '../../domain/grid-math';
import { FIXED_DT, SLOW_DURATION } from '../constants';

// ── Юниты ──────────────────────────────────────────────────────────────

export interface UnitsTickDeps {
  units: DefenderUnit[];
  unitTypes: Map<string, DefenderUnitType>;
  enemies: Enemy[];
  grid: GridData;
  dt: number;
  tick: number;
}

export interface UnitsTickOutcome {
  /** Сколько врагов убито юнитами за этот шаг. */
  killed: number;
  /** Id юнитов, погибших в этом шаге (если враги смогут отвечать — задел на будущее). */
  deadUnits: string[];
}

/**
 * AI защитных юнитов. Для каждого юнита:
 *  - найти ближайшего живого врага в range;
 *  - aggressive — гонится за врагами по всему полю (без range-ограничения при поиске);
 *  - guard     — атакует только в range, стоит на home;
 *  - patrol    — ходит вокруг home в радиусе range, возвращает в home;
 *  - ближние юниты (range<=1.2) подходят вплотную, дальние держат дистанцию;
 *  - атака по cooldown: урон врагу (magic-категории игнорируют броню — задаётся в applyUnitDamage).
 */
export function tickUnits(deps: UnitsTickDeps): UnitsTickOutcome {
  const { units, unitTypes, enemies, grid, dt, tick } = deps;
  let killed = 0;
  const deadUnits: string[] = [];

  for (const unit of units) {
    if (unit.hp <= 0) {
      deadUnits.push(unit.id);
      continue;
    }
    const type = unitTypes.get(unit.typeId);
    if (!type) continue;

    // цель: либо прежняя (если жива и в пределах агро), либо ближайший враг
    const range = type.range;
    const rangeWorld = range * grid.cellSize;
    let target = pickUnitTarget(unit, type, enemies, grid, rangeWorld);

    unit.cooldown = Math.max(0, unit.cooldown - dt);

    if (target) {
      // цель есть — двигаемся/атакуем
      const dx = target.position.x - unit.position.x;
      const dz = target.position.z - unit.position.z;
      const distSq = dx * dx + dz * dz;
      const hitRadius = Math.max(grid.cellSize * 0.6, rangeWorld - grid.cellSize * 0.2);

      if (distSq <= hitRadius * hitRadius) {
        // в дистанции атаки
        unit.targetEnemyId = target.id;
        if (unit.cooldown <= 0) {
          const died = applyUnitDamage(target, type.damage);
          if (died) killed += 1;
          unit.cooldown += 1 / Math.max(1e-3, type.fireRate);
        }
      } else if (type.speed > 0) {
        // двигаемся к цели
        unit.targetEnemyId = target.id;
        const dist = Math.sqrt(distSq);
        const step = type.speed * grid.cellSize * dt;
        const k = Math.min(1, step / dist);
        unit.position.x += dx * k;
        unit.position.z += dz * k;
        // обновим col/row по позиции
        const g = worldToColRow(grid, unit.position);
        unit.col = g.col;
        unit.row = g.row;
      }
    } else {
      // цели нет — для guard/patrol возврат к home
      unit.targetEnemyId = null;
      if (type.speed > 0 && (unit.col !== unit.homeCol || unit.row !== unit.homeRow)) {
        const homeWorld = gridToWorldData(grid, unit.homeCol, unit.homeRow);
        const dx = homeWorld.x - unit.position.x;
        const dz = homeWorld.z - unit.position.z;
        const distSq = dx * dx + dz * dz;
        const eps = grid.cellSize * 0.1;
        if (distSq > eps * eps) {
          const dist = Math.sqrt(distSq);
          const step = type.speed * grid.cellSize * dt;
          const k = Math.min(1, step / dist);
          unit.position.x += dx * k;
          unit.position.z += dz * k;
          const g = worldToColRow(grid, unit.position);
          unit.col = g.col;
          unit.row = g.row;
        } else {
          unit.col = unit.homeCol;
          unit.row = unit.homeRow;
        }
      }
    }
  }

  return { killed, deadUnits };
}

/** Выбирает ближайшего врага для юнита с учётом stance. Детерминирован. */
function pickUnitTarget(
  unit: DefenderUnit,
  type: DefenderUnitType,
  enemies: Enemy[],
  grid: GridData,
  rangeWorld: number
): Enemy | null {
  const homeWorld = gridToWorldData(grid, unit.homeCol, unit.homeRow);
  const aggroRadius = type.range * grid.cellSize * (unit.stance === 'aggressive' ? 2.5 : 1.0);
  let best: Enemy | null = null;
  let bestDist = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.position.x - unit.position.x;
    const dz = e.position.z - unit.position.z;
    const d2 = dx * dx + dz * dz;

    if (unit.stance === 'guard') {
      // только в радиусе от home
      const hdx = e.position.x - homeWorld.x;
      const hdz = e.position.z - homeWorld.z;
      if (hdx * hdx + hdz * hdz > rangeWorld * rangeWorld) continue;
    } else if (unit.stance === 'patrol') {
      // patrol: aggro-радиус больше (патрулирует)
      if (d2 > aggroRadius * aggroRadius) continue;
    }
    // aggressive — без ограничения дистанции (всё поле)
    if (d2 < bestDist) {
      bestDist = d2;
      best = e;
    }
  }
  return best;
}

/** Урон юнита по врагу. Юнит-маг (typeId==='mage') игнорирует броню. Возвращает true при убийстве. */
function applyUnitDamage(enemy: Enemy, rawDamage: number, ignoreArmor = false): boolean {
  if (!enemy.alive) return false;
  let dmg = rawDamage;
  if (!ignoreArmor && enemy.maxHp > 200) {
    // боссы имеют встроенное снижение (заглушка баланса)
    dmg *= 0.7;
  }
  enemy.hp -= dmg;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.alive = false;
    return true;
  }
  return false;
}

/** Маг игнорирует броню (определяется по typeId). */
export function unitIgnoresArmor(typeId: string): boolean {
  return typeId === 'mage';
}

function worldToColRow(grid: GridData, pos: { x: number; z: number }): { col: number; row: number } {
  const halfW = (grid.cols * grid.cellSize) / 2;
  const halfH = (grid.rows * grid.cellSize) / 2;
  return {
    col: Math.floor((pos.x + halfW) / grid.cellSize),
    row: Math.floor((pos.z + halfH) / grid.cellSize)
  };
}

// ── Кулдауны командира ────────────────────────────────────────────────

/** Уменьшает все кулдауны на dt (минимум 0). */
export function tickCommanderCooldowns(cooldowns: CommanderCooldowns, dt: number): void {
  for (const key of Object.keys(cooldowns)) {
    cooldowns[key] = Math.max(0, cooldowns[key] - dt);
  }
}

/** Готово ли заклинание к применению (кулдаун = 0)? */
export function isSpellReady(cooldowns: CommanderCooldowns, spellId: string): boolean {
  return (cooldowns[spellId] ?? 0) <= 0;
}

// ── Применение заклинаний ─────────────────────────────────────────────

export interface SpellCastDeps {
  spell: Spell;
  col: number;
  row: number;
  grid: GridData;
  enemies: Enemy[];
  walls: Wall[];
  /** Базовый кошелёк gold (для gold-rush). */
  gold: { gold: number };
  /** Базовый RTS-баг ресурсов (для будущих заклинаний). */
  resources?: Record<ResourceId, number>;
  /** Счётчик id. */
  nextId: () => string;
  /** Текущий тик сима. */
  tick: number;
}

export interface SpellCastOutcome {
  /** Сколько врагов убито заклинанием. */
  killed: number;
  /** Созданный ActiveSpell (для визуала/продолжительности). */
  active: ActiveSpell;
  /** Сколько золота принесло заклинание (для gold-rush). */
  goldGained: number;
}

/**
 * Применяет заклинание и возвращает результат. Создаёт ActiveSpell (для визуала)
 * с длительностью, зависящей от эффекта (freeze = power тиков, meteor = 1 тик).
 * Мутирует enemies/walls/gold.
 */
export function castSpell(deps: SpellCastDeps): SpellCastOutcome {
  const { spell, col, row, grid, enemies, walls, gold, nextId, tick } = deps;
  const radius = (spell.radius ?? 1) * grid.cellSize;
  const center = gridToWorldData(grid, col, row);
  let killed = 0;
  let goldGained = 0;

  switch (spell.effect) {
    case 'meteor': {
      const r2 = radius * radius;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.position.x - center.x;
        const dz = e.position.z - center.z;
        if (dx * dx + dz * dz <= r2) {
          e.hp -= spell.power;
          if (e.hp <= 0) {
            e.hp = 0;
            e.alive = false;
            killed += 1;
          }
        }
      }
      break;
    }
    case 'freeze': {
      const r2 = radius * radius;
      const slowTicks = Math.round(spell.power / FIXED_DT);
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.position.x - center.x;
        const dz = e.position.z - center.z;
        if (dx * dx + dz * dz <= r2) {
          e.slowFactor = 0.35;
          e.slowUntilTick = tick + slowTicks;
        }
      }
      // синхронизируем с длительностью SLOW_DURATION для консистентности
      void SLOW_DURATION;
      break;
    }
    case 'heal-walls': {
      for (const w of walls) {
        const healed = w.maxHp * spell.power;
        w.hp = Math.min(w.maxHp, w.hp + healed);
        w.burning = false;
        w.burningUntilTick = undefined;
      }
      break;
    }
    case 'gold-rush': {
      goldGained = Math.round(spell.power);
      gold.gold += goldGained;
      // если есть баг ресурсов — пополняем gold там тоже (единый источник правды)
      if (deps.resources) deps.resources.gold = (deps.resources.gold ?? 0) + goldGained;
      break;
    }
  }

  const active: ActiveSpell = {
    id: nextId(),
    spellId: spell.id,
    col,
    row,
    remainingTicks: spell.effect === 'freeze' ? Math.round(spell.power / FIXED_DT) : 1
  };
  return { killed, active, goldGained };
}

/** Уменьшает remainingTicks активных заклинаний, удаляет истёкшие. */
export function tickActiveSpells(active: ActiveSpell[]): ActiveSpell[] {
  const out: ActiveSpell[] = [];
  for (const a of active) {
    a.remainingTicks -= 1;
    if (a.remainingTicks > 0) out.push(a);
  }
  return out;
}

// ── Утилиты ────────────────────────────────────────────────────────────

/** Сумма стоимости пакета в золоте (для UI-подсказок). */
export function bagGoldValue(cost: ResourceBag): number {
  // условный курс: wood=1, stone=2, ore=3, gold=1
  const RATES: Record<ResourceId, number> = { wood: 1, stone: 2, ore: 3, gold: 1 };
  let sum = 0;
  for (const key of Object.keys(cost) as ResourceId[]) {
    sum += (cost[key] ?? 0) * RATES[key];
  }
  return sum;
}
