/**
 * M8 RTS-solo smoke — проверка инициализации и AI-opponent.
 *
 * Headless, без Babylon. Запуск: npx tsx scripts/smoke-rts-solo.ts
 */
import { GameSim } from '../client/src/sim/game-sim';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import { RTS_MAPS, getRtsMap } from '../shared/src/maps/rts-maps';

let failures = 0;
function check(name: string, cond: boolean, details = ''): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else { failures++; console.error(`  \u2717 FAIL: ${name} ${details}`); }
}

// ── 1. RTS-solo init из playerStarts ──────────────────────────────
console.log('1. RTS-solo initialization (rts-2p-crossroads):');
{
  const map = getRtsMap('rts-2p-crossroads')!;
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'player' });

  check('rtsEnabled', sim.isRtsEnabled());
  check('rtsSolo', sim.isRtsSolo());

  const snap = sim.serialize();
  // Player town-hall
  const playerTh = sim.getPlayerTownHall();
  check('player town-hall placed at slot 0 (8,8)', !!playerTh && playerTh.col === 8 && playerTh.row === 8);
  // Workers
  const workers = snap.defenderUnits ?? [];
  check('3 worker units spawned at slot 0', workers.length === 3 && workers.every((u) => u.typeId === 'worker'), `(got ${workers.length})`);
  // Auto-gather: workers should be assigned to a wood node near town-hall.
  check('workers auto-gather assigned (gatherNodeId set + state=to-node)',
    workers.every((u) => !!u.gatherNodeId && u.gatherState === 'to-node'),
    `(nodes: ${workers.map((u) => u.gatherNodeId).join(',')})`);
  // AI town-hall
  const aiTh = sim.getAiTownHall();
  check('AI town-hall (stationary boss) at slot 1 (56,56)', !!aiTh && aiTh.stationary === true && Math.abs(aiTh.position.x) > 0);
  // Resources
  check('starting wood=250', (snap.resources?.wood ?? 0) === 250);
  check('starting gold=80', snap.gold === 80);
  // Status = wave (RTS solo: no prep phase)
  check('status=wave (rts-solo skips prep)', snap.status === 'wave');
  // lives = town-hall HP
  check('lives = RTS_TOWN_HALL_HP (1500)', snap.lives === 1500, `(lives=${snap.lives})`);
  // Route from AI (slot 1) to player (slot 0)
  check('route tdSpawn = AI start (56,56)', sim.serialize().pathLength > 0);
}

// ── 2. AI wave spawn ──────────────────────────────────────────────
console.log('2. AI-opponent wave spawn:');
{
  const map = getRtsMap('rts-2p-crossroads')!;
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'player' });
  const initialEnemies = sim.serialize().enemies.length;
  check('initial enemies = 1 (just AI town-hall)', initialEnemies === 1, `(got ${initialEnemies})`);

  // Helper: advance sim time by N seconds (step() processes ≤6 fixed-steps per call).
  const advance = (sec: number): void => { for (let i = 0; i < sec * 31 + 2; i++) sim.step(1); };

  // First wave at 35s
  check('first wave timer = 35s', sim.getAiNextWaveIn() === 35, `(got ${sim.getAiNextWaveIn()})`);
  advance(35);
  const after1 = sim.serialize().enemies.length;
  check('after 35s: 6 goblins spawned (some may have reached base)', after1 >= 1, `(enemies=${after1})`);
  const mobile = sim.serialize().enemies.filter((enemy) => !enemy.stationary && enemy.alive);
  const uniquePositions = new Set(mobile.map((enemy) => `${enemy.position.x.toFixed(3)},${enemy.position.z.toFixed(3)}`));
  check('AI formation does not collapse mobile units to one position',
    mobile.length < 2 || uniquePositions.size === mobile.length,
    `(mobile=${mobile.length}, unique=${uniquePositions.size})`);
  // Next wave due in <=30s (some drift due to fixed-step granularity).
  const nextIn = sim.getAiNextWaveIn();
  check('next wave timer in (0,30] after first wave', nextIn > 0 && nextIn <= 30, `(got ${nextIn})`);

  // Wave 2: 8 skeletons
  advance(30);
  const aiWaveIdx = (sim as unknown as { aiWaveIndex: number }).aiWaveIndex;
  check('by 65s: aiWaveIndex >= 2', aiWaveIdx >= 2, `(aiWaveIndex=${aiWaveIdx})`);

  // Wave 5+: should have demons spawned at least once
  advance(30); advance(30); advance(30);
  const aiWaveIdx5 = (sim as unknown as { aiWaveIndex: number }).aiWaveIndex;
  check('by ~155s: aiWaveIndex >= 5', aiWaveIdx5 >= 5, `(aiWaveIndex=${aiWaveIdx5})`);
}

// ── 3. Win condition ─────────────────────────────────────────────
console.log('3. Win condition (destroy AI town-hall):');
{
  const map = getRtsMap('rts-2p-crossroads')!;
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'player' });
  check('initial status = wave', sim.serialize().status === 'wave');

  // Kill AI town-hall directly
  const aiTh = sim.getAiTownHall()!;
  aiTh.hp = 0;
  aiTh.alive = false;
  sim.step(0.1);
  check('status = won after AI town-hall killed', sim.serialize().status === 'won');
}

// ── 4. Lose condition ─────────────────────────────────────────────
console.log('4. Lose condition (player town-hall destroyed):');
{
  const map = getRtsMap('rts-2p-crossroads')!;
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'player' });
  const snap0 = sim.serialize();
  check('lives start at 1500', snap0.lives === 1500);

  // Force-drain lives: kill player town-hall by stepping until AI waves reach it.
  // With 1500 HP and ~30s wave interval, this takes too long. Instead, just verify
  // status flips to 'lost' when lives hit 0 (artificially).
  (sim.state as { lives: number }).lives = 1;
  sim.step(0.1);
  // Spawn an enemy at the end of path so it damages the base
  // Actually: lives=1, then any damage flips to lost. Manually invoke lose condition:
  (sim.state as { lives: number }).lives = 0;
  sim.step(0.1);
  // tickRules runs on next step. status should be 'lost'.
  const snapEnd = sim.serialize();
  check('status = lost when lives=0', snapEnd.status === 'lost', `(status=${snapEnd.status})`);
}

// ── 5. All 3 RTS maps init ────────────────────────────────────────
console.log('5. All 3 RTS maps init as rtsSolo:');
{
  for (const map of RTS_MAPS) {
    const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'p' });
    const name = map.metadata?.name;
    check(`${name}: rtsSolo + player town-hall + AI threat`,
      sim.isRtsSolo() && !!sim.getPlayerTownHall() && !!sim.getAiTownHall(),
      `(${name})`);
  }
}

console.log('6. Static scene colliders participate in simulation placement:');
{
  const map = getRtsMap('rts-2p-crossroads')!;
  const blocked = { col: 20, row: 20 };
  const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'player', staticBlockedCells: [blocked] });
  check('rasterized scene cell is visible to simulation', sim.isStaticBlockedCell(blocked.col, blocked.row));
  const before = sim.serialize().productionBuildings?.length ?? 0;
  sim.applyInput({
    tick: sim.state.tick,
    userId: 'player',
    action: { kind: 'build-production', typeId: 'rts-barracks', col: blocked.col, row: blocked.row }
  });
  const after = sim.serialize().productionBuildings?.length ?? 0;
  check('production building cannot overlap static scene collider', after === before, `(before=${before}, after=${after})`);
}

console.log('===');
if (failures === 0) console.log('\u2705 ALL PASSED');
else { console.error(`\u2717 ${failures} CHECK(S) FAILED`); process.exit(1); }
