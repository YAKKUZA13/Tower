/**
 * M8.2 smoke (voxel-migration-plan): прямой контроль юнитов (RTS-приказы).
 *
 * Проверяет order-unit-move / order-unit-attack / order-unit-stop (additive к AI):
 *  1. order-unit-move → юнит движется к клетке-цели (позиция приближается).
 *  2. Достижение цели → moveOrder снимается.
 *  3. order-unit-stop → движение прекращается.
 *  4. order-unit-attack → юнит движется к указанному врагу и наносит урон.
 *  5. Приказ атаки мёртвого врага → снимается автоматически.
 *
 * Additive к TD (не ломает): приказы работают только в RTS-режиме, override AI.
 * Запуск: npx tsx scripts/smoke-unit-orders.ts
 */
import { GameSim } from '../client/src/sim/game-sim';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import type { MapDocument, PlayerInput } from '@tower/shared';

function makeMap(): MapDocument {
  return {
    version: 2,
    grid: { cols: 16, rows: 10, cellSize: 1.5 },
    heightmap: Array.from({ length: 10 }, () => Array.from({ length: 16 }, () => 0)),
    path: { waypoints: [{ col: 0, row: 5 }, { col: 15, row: 5 }] },
    spawnPoint: { col: 0, row: 5 },
    base: { col: 15, row: 5, hp: 20 },
    startingGold: 1000,
    waves: [],
    rts: { enabled: true, startingResources: { wood: 200, stone: 100, ore: 0, gold: 0 }, startBuildings: [] }
  };
}

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

const sim = new GameSim({ map: makeMap(), catalog: DEFAULT_CATALOG, ownerId: 'tester', seed: 42 });
const tick = (n = 1) => { for (let i = 0; i < n; i++) sim.step(1 / 30); };
const apply = (action: PlayerInput['action']): void => sim.applyInput({ tick: sim.state.tick, userId: 'tester', action });

console.log('1. order-unit-move → unit moves toward target:');
{
  apply({ kind: 'train-unit', typeId: 'knight', col: 8, row: 5 });
  tick(2);
  const unit = sim.state.defenderUnits?.[0];
  check('unit trained', !!unit);
  if (!unit) { finish(); }
  if (unit) {
    const startX = unit.position.x;
    // приказ двигаться в (2,2)
    apply({ kind: 'order-unit-move', unitIds: [unit.id], col: 2, row: 2 });
    check('moveOrder set on unit', unit.moveOrderCol === 2 && unit.moveOrderRow === 2);
    tick(60); // 2 секунды
    const afterX = unit.position.x;
    check('unit moved (position changed)', Math.abs(afterX - startX) > 0.01, `(start ${startX.toFixed(2)} after ${afterX.toFixed(2)})`);
    // продолжить шагать к цели пока не достигнет
    for (let i = 0; i < 600 && unit.moveOrderCol !== undefined; i++) tick(1);
    const reachedTargetCell = unit.col === 2 && unit.row === 2;
    check('unit reached target cell', reachedTargetCell, `(col ${unit.col} row ${unit.row})`);
    check('moveOrder cleared after arrival', unit.moveOrderCol === undefined);
  }
}

console.log('2. order-unit-stop halts movement:');
{
  const unit = sim.state.defenderUnits?.[0];
  if (unit) {
    apply({ kind: 'order-unit-move', unitIds: [unit.id], col: 14, row: 8 });
    tick(5);
    const posA = { x: unit.position.x, z: unit.position.z };
    apply({ kind: 'order-unit-stop', unitIds: [unit.id] });
    check('moveOrder cleared on stop', unit.moveOrderCol === undefined);
    tick(10);
    const posB = { x: unit.position.x, z: unit.position.z };
    const moved = Math.abs(posB.x - posA.x) + Math.abs(posB.z - posA.z);
    check('unit stopped (no movement after stop)', moved < 0.05, `(moved ${moved.toFixed(3)})`);
  }
}

console.log('3. order-unit-attack → unit engages ordered enemy:');
{
  // заспавнить врага через волну? проще: добавим врага в state напрямую для теста.
  const unit = sim.state.defenderUnits?.[0];
  if (unit) {
    // разместим врага рядом через сим-волны не выйдет без start-wave; используем прямой state-inject.
    const enemyId = 'test-enemy-1';
    (sim.state as { enemies: unknown[] }).enemies = [{
      id: enemyId, typeId: 'skeleton', routeIndex: 0, pathProgress: 0,
      position: { x: unit.position.x + 0.2, y: 0, z: unit.position.z + 0.2 },
      hp: 100, maxHp: 100, speed: 0, alive: true,
      col: unit.col, row: unit.row, hitFlashUntilTick: 0, status: 'run'
    }];
    apply({ kind: 'order-unit-attack', unitIds: [unit.id], enemyId });
    check('attackOrder set', unit.attackOrderEnemyId === enemyId);
    const enemy = (sim.state as { enemies: { id: string; hp: number; alive: boolean }[] }).enemies.find((e) => e.id === enemyId)!;
    const hpBefore = enemy.hp;
    tick(120); // 4 сек — достаточно для нескольких ударов
    check('ordered enemy took damage', enemy.hp < hpBefore, `(hp ${hpBefore} → ${enemy.hp})`);
  }
}

console.log('4. order-unit-attack on dead enemy → auto-clears:');
{
  const unit = sim.state.defenderUnits?.[0];
  if (unit) {
    apply({ kind: 'order-unit-attack', unitIds: [unit.id], enemyId: 'nonexistent-dead' });
    tick(2);
    check('attackOrder cleared when target absent', unit.attackOrderEnemyId === null);
  }
}

function finish(): void { /* placeholder */ }

console.log('===');
if (failures === 0) {
  console.log('\u2705 ALL PASSED');
} else {
  console.error(`\u2717 ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
