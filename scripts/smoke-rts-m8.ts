/**
 * M8 smoke — RTS sim additions (formations, visibility, gathering, prediction).
 *
 * Headless: чистая логика, без Babylon.
 *
 * Run: npx tsx scripts/smoke-rts-m8.ts
 */
import type { GameSnapshot, PlayerState, DefenderUnit, GridData, ResourceNode, MapDocument, PlayerAction } from '@tower/shared';
import { computeFormation, formationToOrders } from '../client/src/sim/systems/formations';
import {
  computeVisibilityForPlayer, computeVisibilityAll, filterSnapshotForPlayer, computeExploredCells
} from '../client/src/sim/visibility';
import { tickGathering, pruneDepletedNodes } from '../client/src/sim/systems/gathering';
import { ClientPredictor } from '../client/src/sim/prediction';
import { rtsCameraBasis } from '../client/src/babylon/rtscam';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

// ── 1. Formations ──────────────────────────────────────────────────────
console.log('1. Formations:');
{
  // grid formation: 9 units around (5,5)
  const f = computeFormation(9, { col: 5, row: 5 }, 'grid', { spacing: 1 });
  check('grid returns 9 positions', f.length === 9);
  check('grid center is target', f.some((p) => p.col === 5 && p.row === 5), `(positions: ${JSON.stringify(f.slice(0, 3))})`);

  // wedge: leader впереди
  const w = computeFormation(7, { col: 10, row: 10 }, 'wedge');
  check('wedge returns 7 positions', w.length === 7);
  check('wedge leader at target', w[0]!.col === 10 && w[0]!.row === 10);

  // line: все на target.row
  const l = computeFormation(5, { col: 0, row: 0 }, 'line');
  check('line all same row', l.every((p) => p.row === 0));

  // column: все на target.col
  const c = computeFormation(4, { col: 3, row: 3 }, 'column');
  check('column all same col', c.every((p) => p.col === 3));

  // formationToOrders
  const orders = formationToOrders(['u1', 'u2', 'u3'], { col: 5, row: 5 }, 'grid');
  check('formationToOrders 3 orders', orders.length === 3);
  check('orders carry unitIds', orders[0]!.unitId === 'u1' && orders[2]!.unitId === 'u3');
}

// ── 2. Visibility ──────────────────────────────────────────────────────
console.log('2. Fog of War visibility:');
{
  const grid: GridData = { cols: 32, rows: 32, cellSize: 1 };
  const p0: PlayerState = {
    slot: 0, userId: 'u0', color: '2E86DE', defeated: false,
    resources: { wood: 0, stone: 0, ore: 0, gold: 0 },
    units: [{ id: 'u-a', typeId: 'worker', col: 5, row: 5, position: { x: 5, y: 0, z: 5 }, hp: 30, maxHp: 30, stance: 'guard', cooldown: 0, targetEnemyId: null, homeCol: 5, homeRow: 5 }],
    buildings: [{ id: 'b-th', typeId: 'town-hall', col: 6, row: 6, accum: {} }]
  };
  const p1: PlayerState = {
    slot: 1, userId: 'u1', color: 'E74C3C', defeated: false,
    resources: { wood: 0, stone: 0, ore: 0, gold: 0 },
    units: [{ id: 'u-b', typeId: 'knight', col: 20, row: 20, position: { x: 20, y: 0, z: 20 }, hp: 60, maxHp: 60, stance: 'guard', cooldown: 0, targetEnemyId: null, homeCol: 20, homeRow: 20 }],
    buildings: [{ id: 'b-th2', typeId: 'town-hall', col: 25, row: 25, accum: {} }]
  };

  const vis0 = computeVisibilityForPlayer(p0, grid, { unitSight: 3, buildingSight: 5 });
  check('player0 sees own area', vis0.size > 0);
  check('player0 does NOT see player1 at (20,20)', !vis0.has('20:20'));
  check('player0 sees own unit area (5,5)', vis0.has('5:5'));

  const allVis = computeVisibilityAll({ grid, players: [p0, p1] });
  check('allVis has both slots', allVis.has(0) && allVis.has(1));
  const v1 = allVis.get(1)!;
  check('player1 sees (20,20)', v1.has('20:20'));

  // filter snapshot
  const snapshot: GameSnapshot = {
    tick: 1,
    status: 'prep',
    waveIndex: -1,
    gold: 0,
    lives: 1,
    pathLength: 0,
    enemies: [],
    towers: [],
    projectiles: [],
    walls: [],
    routeVersion: 0,
    waveEnemiesRemaining: 0,
    relics: [],
    pendingRelicChoices: [],
    timeOfDay: 0.5,
    weather: 'clear',
    ownerId: 'u0',
    players: [{ userId: 'u0', role: 'free', ready: true }],
    playersState: [p0, p1]
  };
  const filtered = filterSnapshotForPlayer(snapshot, 0, vis0);
  const fp1 = filtered.playersState!.find((p) => p.slot === 1)!;
  check('filtered: p1 has 0 visible units (p0 cannot see them)', fp1.units.length === 0, `(got ${fp1.units.length})`);
  check('filtered: p0 has all own units', filtered.playersState!.find((p) => p.slot === 0)!.units.length === 1);

  // explored cells
  const explored = computeExploredCells([p0], grid);
  check('explored contains own area', explored.has('5:5'));
  check('explored does NOT contain p1 area', !explored.has('20:20'));
}

// ── 3. Gathering ───────────────────────────────────────────────────────
console.log('3. Gathering (worker FSM):');
{
  const grid: GridData = { cols: 32, rows: 32, cellSize: 1 };
  // Convert grid coords to world coords (centered)
  const halfW = (32 * 1) / 2;
  const halfH = (32 * 1) / 2;
  const wToWorld = (col: number, row: number) => ({ x: col - halfW + 0.5, z: row - halfH + 0.5 });
  const startPos = wToWorld(4, 4);
  const worker: DefenderUnit = {
    id: 'w1', typeId: 'worker', col: 4, row: 4,
    position: { x: startPos.x, y: 0, z: startPos.z },
    hp: 30, maxHp: 30, stance: 'guard', cooldown: 0, targetEnemyId: null,
    homeCol: 4, homeRow: 4,
    gatherNodeId: 'n1', gatherState: 'to-node', gatherTimer: 0, carry: 0, carryKind: null
  };
  const node: ResourceNode = { id: 'n1', col: 6, row: 4, kind: 'wood', amount: 100 };
  const townHall = { id: 'b1', typeId: 'town-hall', col: 4, row: 4, accum: {} };
  const bag = { wood: 0, stone: 0, ore: 0, gold: 0 };
  const unitTypes = new Map([['worker', {
    id: 'worker', name: 'Worker', cost: {}, hp: 30, damage: 2, range: 1, speed: 4, fireRate: 0.5,
    modelRef: { catalogId: 'unit:worker', scale: 1 }, description: '', worker: true, carryCapacity: 5, gatherTime: 0.05
  }]]);

  // node is at col=6 → world x = 6-16+0.5 = -9.5; worker starts at col=4 → -11.5
  const nodeWorldX = wToWorld(6, 4).x;
  const distBefore = Math.abs(nodeWorldX - startPos.x);
  // Step 1: worker moves toward node
  let out = tickGathering({ units: [worker], unitTypes, nodes: [node], buildings: [townHall], bag, grid, dt: 0.5 });
  const distAfter = Math.abs(nodeWorldX - worker.position.x);
  check('worker moved closer to node', distAfter < distBefore, `(before=${distBefore.toFixed(2)}, after=${distAfter.toFixed(2)})`);
  void out;

  // Step many ticks to reach node and gather
  for (let i = 0; i < 20; i++) {
    out = tickGathering({ units: [worker], unitTypes, nodes: [node], buildings: [townHall], bag, grid, dt: 0.5 });
  }
  check('worker eventually gathers (carry > 0 or bag > 0)', worker.carry! > 0 || bag.wood > 0, `(carry=${worker.carry}, wood=${bag.wood})`);

  // Continue until drop-off
  for (let i = 0; i < 60; i++) {
    tickGathering({ units: [worker], unitTypes, nodes: [node], buildings: [townHall], bag, grid, dt: 0.5 });
  }
  check('bag has wood eventually', bag.wood > 0, `(wood=${bag.wood})`);
  check('node amount decreases', node.amount < 100, `(amount=${node.amount})`);

  // Depletion happens at pickup, not delivery; the final cargo survives node removal.
  node.amount = 1;
  worker.carry = 0;
  worker.gatherNodeId = 'n1';
  worker.gatherState = 'gathering';
  worker.gatherTimer = 0;
  const depleted = tickGathering({units:[worker],unitTypes,nodes:[node],buildings:[townHall],bag,grid,dt:1});
  const thPos = wToWorld(4, 4);
  worker.position = { x: thPos.x, y: 0, z: thPos.z };
  const beforeDelivery=bag.wood;
  tickGathering({units:[worker],unitTypes,nodes:[],buildings:[townHall],bag,grid,dt:1});
  check('last cargo is delivered after node removal',bag.wood===beforeDelivery+1);
  check('depleted node detected', depleted.depletedNodeIds.indexOf('n1') >= 0, `(depleted: ${JSON.stringify(depleted.depletedNodeIds)})`);
  check('pruneDepletedNodes removes', pruneDepletedNodes([node], ['n1']).length === 0);
}

// ── 4. Prediction ──────────────────────────────────────────────────────
console.log('4. Client prediction + rollback:');
{
  interface TestState { tick: number; counter: number; }
  const apply = (s: TestState, action: PlayerAction): void => {
    if (action.kind === 'order-unit-stop') s.counter += 1;
  };
  const step = (s: TestState, dt: number): void => { s.tick += 1; void dt; };

  const initial: TestState = { tick: 0, counter: 0 };
  const predictor = new ClientPredictor(initial);

  // local input
  predictor.applyLocalInput({ kind: 'order-unit-stop', unitIds: ['u1'] }, apply);
  check('predicted counter advanced', predictor.getPredictedState().counter === 1);

  // step forward
  predictor.stepPredicted(1, step);
  check('predicted tick advanced', predictor.getPredictedState().tick === 1);

  // server authoritative (no inputs buffered) — matches predicted
  const authoritative: TestState = { tick: 1, counter: 1 };
  const r1 = predictor.reconcile(authoritative, apply, step, 1);
  check('no rollback when matches', !r1.rolledBack);
  check('predicted state unchanged', predictor.getPredictedState().counter === 1);

  // server authoritative with pending inputs → rollback + replay.
  // Realistic scenario:
  //  - new ClientPredictor (fresh, no prior reconcile)
  //  - step predicted to tick=1 (no inputs applied yet)
  //  - apply input A at tick=1 (counter 0→1, buffer=[{1,A}])
  //  - step predicted to tick=3 (counter still 1)
  //  - server authoritative arrives at tick=1 with counter=0 (A still in flight)
  //    Convention: inputs at tick >= newTick are pending → A is replayed.
  //  - Expected: predicted counter = 0 (server) + 1 (replayed A) = 1.
  const predictor2 = new ClientPredictor<TestState>(initial);
  predictor2.stepPredicted(1, step);          // tick 0→1
  predictor2.applyLocalInput({ kind: 'order-unit-stop', unitIds: ['u1'] }, apply); // tick=1, counter 1
  predictor2.stepPredicted(1, step);          // tick 1→2
  predictor2.stepPredicted(1, step);          // tick 2→3 (predicted.tick=3, counter=1)
  const authoritative2: TestState = { tick: 1, counter: 0 };
  const r2 = predictor2.reconcile(authoritative2, apply, step, 1);
  check('rollback fired when pending inputs', r2.rolledBack);
  check('replayed frames > 0', r2.replayedFrames > 0);
  check('predicted counter = 1 after replay (server 0 + 1 replayed input)',
    predictor2.getPredictedState().counter === 1, `(got ${predictor2.getPredictedState().counter})`);
}

console.log('===');
console.log('5. RTS camera basis:');
{
  const zero = rtsCameraBasis(0);
  check('alpha 0 looks towards negative X', zero.forwardX === -1 && zero.forwardZ === 0);
  check('alpha 0 screen-right points towards positive Z', zero.rightX === 0 && zero.rightZ === 1);

  const iso = rtsCameraBasis(-Math.PI / 4);
  const forwardLength = Math.hypot(iso.forwardX, iso.forwardZ);
  const rightLength = Math.hypot(iso.rightX, iso.rightZ);
  const dot = iso.forwardX * iso.rightX + iso.forwardZ * iso.rightZ;
  check('isometric movement axes stay normalized', Math.abs(forwardLength - 1) < 1e-10 && Math.abs(rightLength - 1) < 1e-10);
  check('isometric movement axes stay orthogonal', Math.abs(dot) < 1e-10);
}

console.log('===');
if (failures === 0) console.log('\u2705 ALL PASSED');
else { console.error(`\u2717 ${failures} CHECK(S) FAILED`); process.exit(1); }

void ({} as MapDocument);
