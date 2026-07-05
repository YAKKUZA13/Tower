/**
 * Headless smoke-тест RTS-режима (Фаза 6).
 * Проверяет:
 *  1. Сим с rts.enabled инициализирует ресурсы/здания/кулдауны.
 *  2. build-production/train-unit работают (списывают ресурсы, создают сущности).
 *  3. Производство накапливает ресурсы по цепочке (Sawmill → wood; Smelter → gold).
 *  4. Юниты атакуют врагов в радиусе и убивают их.
 *  5. Заклинания наносят урон/дают золото + уходят в кулдаун.
 *  6. Сим без rts.enabled — чистый TD (resources отсутствуют).
 *  7. Детерминизм: одинаковый seed → одинаковый сценарий.
 *
 * Запуск: npx tsx scripts/smoke-rts.ts
 */
import { GameSim } from '../client/src/sim/game-sim';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import type { MapDocument, PlayerInput } from '../shared/src/index';

function makeMap(rtsEnabled: boolean): MapDocument {
  return {
    version: 2,
    grid: { cols: 16, rows: 10, cellSize: 1.5 },
    heightmap: Array.from({ length: 10 }, () => Array.from({ length: 16 }, () => 0)),
    path: { waypoints: [{ col: 0, row: 5 }, { col: 15, row: 5 }] },
    spawnPoint: { col: 0, row: 5 },
    base: { col: 15, row: 5, hp: 20 },
    startingGold: 100,
    waves: [],
    rts: rtsEnabled
      ? {
          enabled: true,
          startingResources: { wood: 60, stone: 30, ore: 0, gold: 0 },
          startBuildings: [{ typeId: 'sawmill', col: 2, row: 2 }]
        }
      : undefined
  };
}

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ FAIL: ${name} ${details}`);
  }
}

function run(rtsEnabled: boolean, seed = 42): { sim: GameSim; tick: (n?: number) => void } {
  const sim = new GameSim({ map: makeMap(rtsEnabled), catalog: DEFAULT_CATALOG, ownerId: 'tester', seed });
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) sim.step(1 / 30);
  };
  return { sim, tick };
}

console.log('\n=== RTS Smoke Test (Фаза 6) ===\n');

// ── 1. Инициализация RTS ──
console.log('1. Инициализация RTS-режима:');
{
  const { sim } = run(true);
  check('rts включён', sim.isRtsEnabled());
  check('resources.wood = 60', sim.state.resources?.wood === 60, `got ${sim.state.resources?.wood}`);
  check('resources.stone = 30', sim.state.resources?.stone === 30);
  check('resources.ore = 0', sim.state.resources?.ore === 0);
  check('gold = 100 (TD)', sim.state.gold === 100, `got ${sim.state.gold}`);
  check('startBuildings содержит sawmill', (sim.state.productionBuildings ?? []).some((b) => b.typeId === 'sawmill'));
  check('defenderUnits пустой', (sim.state.defenderUnits ?? []).length === 0);
  check('commanderCooldowns содержат meteor', (sim.state.commanderCooldowns?.meteor ?? -1) === 0);
}

// ── 2. Сим без RTS — чистый TD ──
console.log('\n2. Карта без RTS:');
{
  const { sim } = run(false);
  check('rts выключен', !sim.isRtsEnabled());
  check('resources отсутствуют', sim.state.resources === undefined);
  check('productionBuildings отсутствуют', sim.state.productionBuildings === undefined);
  check('commanderCooldowns отсутствуют', sim.state.commanderCooldowns === undefined);
}

// ── 3. Производство: Sawmill добывает wood ──
console.log('\n3. Производство (Sawmill → wood):');
{
  const { sim, tick } = run(true);
  const wood0 = sim.state.resources?.wood ?? 0;
  tick(60); // 2 секунды
  const wood1 = sim.state.resources?.wood ?? 0;
  check('wood вырос от Sawmill', wood1 > wood0, `was ${wood0}, now ${wood1}`);
  // 1.2/sec * 2s = 2.4 → за 2 сек должно накопить 2 целых
  check('wood вырос минимум на 2', wood1 - wood0 >= 2, `delta ${wood1 - wood0}`);
}

// ── 4. build-production: список ресурсов ──
console.log('\n4. Строительство здания (Mine):');
{
  const { sim } = run(true);
  const wood0 = sim.state.resources?.wood ?? 0;
  const input: PlayerInput = {
    tick: 0,
    userId: 'tester',
    action: { kind: 'build-production', typeId: 'mine', col: 5, row: 2 }
  };
  sim.applyInput(input);
  check('Mine построена', (sim.state.productionBuildings ?? []).some((b) => b.typeId === 'mine'));
  // cost mine = { wood: 40 } → 60 - 40 = 20
  check('wood списан (60 → 20)', sim.state.resources?.wood === wood0 - 40, `got ${sim.state.resources?.wood}`);
  // повторно на ту же клетку нельзя
  sim.applyInput(input);
  check('Повторная застройка клетки запрещена', (sim.state.productionBuildings ?? []).filter((b) => b.typeId === 'mine').length === 1);
}

// ── 5. train-unit: рыцарь создаётся, списывает ресурсы ──
console.log('\n5. Тренировка юнита (Knight):');
{
  const { sim } = run(true);
  // даём ресурсы на knight (gold: 25)
  sim.state.gold += 100;
  const gold0 = sim.state.gold;
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'train-unit', typeId: 'knight', col: 8, row: 3 } });
  const units = sim.state.defenderUnits ?? [];
  check('Knight обучен', units.length === 1 && units[0].typeId === 'knight');
  check('gold списан (25)', sim.state.gold === gold0 - 25, `got ${sim.state.gold}`);
  check('hp рыцаря 90', units[0]?.hp === 90);
  check('stance по умолчанию guard', units[0]?.stance === 'guard');
}

// ── 6. set-unit-stance ──
console.log('\n6. Смена stance юнита:');
{
  const { sim } = run(true);
  sim.state.gold += 100;
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'train-unit', typeId: 'knight', col: 8, row: 3 } });
  const unitId = sim.state.defenderUnits![0].id;
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'set-unit-stance', unitId, stance: 'aggressive' } });
  check('Stance = aggressive', sim.state.defenderUnits![0].stance === 'aggressive');
}

// ── 7. cast-spell: meteor + cooldown ──
console.log('\n7. Заклинания командира:');
{
  const { sim } = run(true);
  const cellSize = 1.5;
  const halfW = (16 * cellSize) / 2;
  const halfH = (10 * cellSize) / 2;
  // центр клетки (11, 5) в world
  const cx = (11 + 0.5) * cellSize - halfW;
  const cz = (5 + 0.5) * cellSize - halfH;
  sim.state.enemies.push({
    id: 'test-enemy',
    typeId: 'skeleton',
    hp: 1000,
    maxHp: 1000,
    pathProgress: 0,
    position: { x: cx, y: 0, z: cz },
    alive: true
  });
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'cast-spell', spellId: 'meteor', col: 11, row: 5 } });
  const enemy = sim.state.enemies[0];
  check('Meteor нанёс урон врагу', enemy.hp === 1000 - 80, `got ${enemy.hp}`);
  check('Кулдаун meteor выставлен', (sim.state.commanderCooldowns?.meteor ?? 0) > 0);
  // повторный каст в кулдауне
  const hpBefore = enemy.hp;
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'cast-spell', spellId: 'meteor', col: 11, row: 5 } });
  check('Кулдаун блокирует повтор (hp не изменился)', enemy.hp === hpBefore);
  check('Создан ActiveSpell', (sim.state.activeSpells ?? []).length >= 1);
}

// ── 8. gold-rush ──
console.log('\n8. gold-rush заклинание:');
{
  const { sim } = run(true);
  const gold0 = sim.state.gold;
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'cast-spell', spellId: 'gold-rush', col: 5, row: 5 } });
  check('gold-rush принёс 60 золота', sim.state.gold === gold0 + 60, `got ${sim.state.gold}`);
  check('Кулдаун gold-rush выставлен', (sim.state.commanderCooldowns?.['gold-rush'] ?? 0) > 0);
}

// ── 9. Юниты атакуют врагов ──
console.log('\n9. Юнит атакует врага:');
{
  const { sim, tick } = run(true);
  sim.state.gold += 200;
  // лучник в (8,5) — прямо на пути врагов, рядом со spawn
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'train-unit', typeId: 'archer', col: 8, row: 5 } });
  // враг с неизвестным typeId → tickMovement пропустит (continue), позиция не переопределится
  // (это симулирует стационарного врага; tickUnits работает с любым enemy.alive)
  sim.state.enemies.push({
    id: 'e1',
    typeId: '__test-static__',
    hp: 200,
    maxHp: 200,
    pathProgress: 0,
    position: { x: 0, y: 0, z: 0 },
    alive: true
  });
  const cellSize = 1.5;
  const halfW = (16 * cellSize) / 2;
  const halfH = (10 * cellSize) / 2;
  // поставим врага рядом с лучником (8,5) — в (8,4), дистанция 1 клетка
  sim.state.enemies[0].position = {
    x: (8 + 0.5) * cellSize - halfW,
    y: 0,
    z: (4 + 0.5) * cellSize - halfH
  };
  tick(60); // 2 сек
  const hp = sim.state.enemies[0].hp;
  // лучник: damage 10, fireRate 1.4 → ~2.8 атаки за 2 сек → ~28 урона
  check('Юнит нанёс урон врагу', hp < 200, `hp=${hp}`);
}

// ── 10. Кулдаун тикает вниз ──
console.log('\n10. Тик кулдауна:');
{
  const { sim, tick } = run(true);
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'cast-spell', spellId: 'gold-rush', col: 5, row: 5 } });
  const cd0 = sim.state.commanderCooldowns?.['gold-rush'] ?? 0;
  tick(60); // 2 сек
  const cd1 = sim.state.commanderCooldowns?.['gold-rush'] ?? 0;
  check('Кулдаун уменьшился', cd1 < cd0, `was ${cd0}, now ${cd1}`);
}

// ── 11. Smelter цепочка: руда → золото (в state.gold) ──
console.log('\n11. Цепочка Smelter (ore → gold):');
{
  const { sim, tick } = run(true);
  // построим smelter и дадим ему руду через накопление
  // cost smelter = {wood:50, stone:30}, у нас 60/30 → хватит
  sim.applyInput({ tick: 0, userId: 't', action: { kind: 'build-production', typeId: 'smelter', col: 3, row: 3 } });
  // даём руду напрямую (имитация добычи Mine)
  sim.state.resources!.ore = 100;
  const gold0 = sim.state.gold;
  tick(60 * 5); // 5 секунд: 0.6 ore/sec → 3 ore списано, 0.4 gold/sec * 5 = 2 gold
  check('Smelter произвёл золото (state.gold вырос)', sim.state.gold > gold0, `was ${gold0}, now ${sim.state.gold}`);
  check('Smelter списал руду', (sim.state.resources?.ore ?? 0) < 100);
}

// ── 12. Детерминизм ──
console.log('\n12. Детерминизм (один seed → тот же результат):');
{
  const a = run(true, 1337);
  const b = run(true, 1337);
  a.sim.applyInput({ tick: 0, userId: 't', action: { kind: 'cast-spell', spellId: 'gold-rush', col: 1, row: 1 } });
  b.sim.applyInput({ tick: 0, userId: 't', action: { kind: 'cast-spell', spellId: 'gold-rush', col: 1, row: 1 } });
  a.tick(120);
  b.tick(120);
  check('gold одинаковый', a.sim.state.gold === b.sim.state.gold, `${a.sim.state.gold} vs ${b.sim.state.gold}`);
  check('resources одинаковые', JSON.stringify(a.sim.state.resources) === JSON.stringify(b.sim.state.resources));
  check('commanderCooldowns одинаковые', JSON.stringify(a.sim.state.commanderCooldowns) === JSON.stringify(b.sim.state.commanderCooldowns));
}

console.log(`\n${failures === 0 ? '✅ ALL PASSED' : `❌ ${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
