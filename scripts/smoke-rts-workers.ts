import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Logger } from '@babylonjs/core/Misc/logger.js';
import { RtsSceneryRenderer } from '../client/src/babylon/terrain/rts-scenery';
import { GameSim } from '../client/src/sim/game-sim';
import { RTS_MAPS } from '../shared/src/maps/rts-maps';
import { DEFAULT_CATALOG } from '../shared/src/catalogs/default';
import { GridNavigator, gridToWorldData, separateNavigationAgents } from '@voxkera/engine-terrain';

{
  const grid = { cols: 16, rows: 16, cellSize: 1.5 };
  const navigator = new GridNavigator(grid, () => false);
  const position = gridToWorldData(grid, 2, 4);
  for (let tick = 0; tick < 200; tick++) navigator.move('unit', position, { col: 10, row: 4 }, 0.1);
  Object.assign(position, gridToWorldData(grid, 2, 4));
  assert.equal(navigator.move('unit', position, { col: 10, row: 4 }, 0.1), 'moving', 'a completed path cannot report arrival after external displacement');

  const hallBlocked = (col: number, row: number) => Math.abs(col - 8) <= 1 && Math.abs(row - 8) <= 1;
  const interaction = new GridNavigator(grid, hallBlocked);
  const approach = gridToWorldData(grid, 10, 8);
  approach.x += grid.cellSize * 0.04;
  assert.equal(interaction.move('worker', approach, { col: 8, row: 8 }, 0.01, 2), 'arrived', 'a worker at the hall edge must not need an exact cell centre');

  for (const dt of [1 / 30, 1 / 60]) {
    const origin = gridToWorldData(grid, 4, 4);
    const crowd = Array.from({ length: 12 }, (_, i) => ({ id: `crowd-${i}`, position: { ...origin } }));
    separateNavigationAgents(grid, crowd, () => false, 0.55, dt);
    assert(crowd.every(agent => Math.hypot(agent.position.x - origin.x, agent.position.z - origin.z) <= grid.cellSize * dt + 1e-6),
      'crowd correction must remain bounded per unit, regardless of neighbour count');
  }
  console.log('✓ Interaction arrival, displaced paths and per-unit crowd correction stay consistent');
}

const engine = new NullEngine();
Logger.LogLevels = Logger.ErrorLogLevel;
try {
  for (const map of RTS_MAPS) {
    const scene = new Scene(engine);
    const scenery = new RtsSceneryRenderer(scene, map);
    const sim = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'workers', staticBlockedCells: scenery.getNavigationBlockedCells() });
    const deliveries = new Map(sim.state.defenderUnits!.map(unit => [unit.id, 0]));
    const lastDelivery = new Map(sim.state.defenderUnits!.map(unit => [unit.id, 0]));
    const samples: unknown[] = [];
    for (let tick = 0; tick < 60 * 30; tick++) {
      const before = new Map(sim.state.defenderUnits!.map(unit => [unit.id, unit.carry ?? 0]));
      sim.step(1 / 30);
      for (const unit of sim.state.defenderUnits!) {
        if (before.get(unit.id)! > 0 && unit.carry === 0) {
          deliveries.set(unit.id, deliveries.get(unit.id)! + 1);
          lastDelivery.set(unit.id, tick);
        }
      }
      if (tick % 300 === 0) samples.push({ second: tick / 30, units: sim.state.defenderUnits!.map(unit => ({
        id: unit.id, state: unit.gatherState, carry: unit.carry, col: unit.col, row: unit.row,
        x: Number(unit.position.x.toFixed(3)), z: Number(unit.position.z.toFixed(3)), navigation: unit.navigationStatus
      })) });
    }
    console.log(map.metadata?.name, Object.fromEntries(deliveries));
    assert([...deliveries.values()].every(count => count >= 10), `every worker must keep delivering: ${JSON.stringify(samples)}`);
    assert([...lastDelivery.values()].every(tick => tick >= 50 * 30), 'no worker may stop delivering during the last ten seconds');

    if (map === RTS_MAPS[0]) {
      const ordered = new GameSim({ map, catalog: DEFAULT_CATALOG, ownerId: 'orders', staticBlockedCells: scenery.getNavigationBlockedCells() });
      const ids = ordered.state.defenderUnits!.map(unit => unit.id);
      ordered.applyInput({ tick: ordered.state.tick, userId: 'orders', action: {
        kind: 'order-unit-move', unitIds: ids, col: 4, row: 8, formation: 'grid'
      } });
      for (let tick = 0; tick < 12 * 30; tick++) ordered.step(1 / 30);
      assert(ordered.state.defenderUnits!.every(unit => unit.moveOrderCol === undefined && unit.col < 7), 'the whole group must walk around the hall and complete the move order');
      const stone = ordered.map.resourceNodes!.find(node => node.id === 'rn-2p-s0')!;
      ordered.applyInput({ tick: ordered.state.tick, userId: 'orders', action: { kind: 'order-unit-gather', unitIds: ids, nodeId: stone.id } });
      const manualDeliveries = new Map(ids.map(id => [id, 0]));
      for (let tick = 0; tick < 22 * 30; tick++) {
        const before = new Map(ordered.state.defenderUnits!.map(unit => [unit.id, unit.carry ?? 0]));
        ordered.step(1 / 30);
        for (const unit of ordered.state.defenderUnits!) {
          if (before.get(unit.id)! > 0 && unit.carry === 0) manualDeliveries.set(unit.id, manualDeliveries.get(unit.id)! + 1);
        }
      }
      assert([...manualDeliveries.values()].every(count => count >= 2), `every selected worker must obey manual gathering after walking around the hall: ${JSON.stringify(Object.fromEntries(manualDeliveries))}`);
      console.log('✓ Three workers move around the hall, then repeatedly fulfil a manual stone-gathering order', Object.fromEntries(manualDeliveries));
    }
    scenery.dispose();
    scene.dispose();
  }
} finally {
  Logger.LogLevels = Logger.AllLogLevel;
  engine.dispose();
}
console.log('✓ Every worker repeatedly gathers and delivers resources on all maps, with real scenery blockers');
