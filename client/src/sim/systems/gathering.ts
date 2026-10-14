import type { DefenderUnit, DefenderUnitType, ProductionBuilding, ResourceNode,
  GridData, ResourceId, ResourceKind } from '@tower/shared';
import { gridToWorldData } from '../../domain/grid-math';

export interface GatherDeps {
  units: DefenderUnit[];
  unitTypes: Map<string, DefenderUnitType>;
  nodes: ResourceNode[];
  buildings: ProductionBuilding[];
  bag: Record<ResourceId, number>;
  grid: GridData;
  dt: number;
  move?: (unit: DefenderUnit, col: number, row: number, distance: number, radius: number) => boolean;
}
export interface GatherOutcome {
  gathered: Partial<Record<ResourceKind, number>>;
  depletedNodeIds: string[];
}

/** Gathering owns worker locomotion. Reserve resources at pickup, not delivery,
 * so multiple workers cannot duplicate the last remaining resource. */
export function tickGathering(deps: GatherDeps): GatherOutcome {
  const { units, unitTypes, nodes, buildings, bag, grid, dt } = deps;
  const outcome: GatherOutcome = { gathered: {}, depletedNodeIds: [] };
  const move = (unit: DefenderUnit, col: number, row: number, speed: number, radius: number): boolean => {
    if (deps.move) return deps.move(unit, col, row, speed * grid.cellSize * dt, radius);
    const target = gridToWorldData(grid, col, row);
    const dx = target.x - unit.position.x, dz = target.z - unit.position.z;
    const dist = Math.hypot(dx, dz), stop = radius * grid.cellSize;
    if (dist <= stop + .01) return true;
    const step = Math.min(dist - stop, speed * grid.cellSize * dt);
    unit.position.x += dx / dist * step; unit.position.z += dz / dist * step;
    unit.col = Math.floor(unit.position.x / grid.cellSize + grid.cols / 2);
    unit.row = Math.floor(unit.position.z / grid.cellSize + grid.rows / 2);
    return dist - step <= stop + .01;
  };
  for (const unit of units) {
    if (unit.hp <= 0 || (!unit.gatherNodeId && !(unit.carry && unit.gatherState === 'to-base'))) continue;
    const type = unitTypes.get(unit.typeId);
    if (!type?.worker) continue;
    const node = nodes.find(n => n.id === unit.gatherNodeId);
    if ((!node || node.amount <= 0) && unit.gatherState !== 'to-base') {
      if ((unit.carry ?? 0) > 0) unit.gatherState = 'to-base';
      else { unit.gatherNodeId = null; unit.gatherState = 'idle'; continue; }
    }
    if (!unit.gatherState || unit.gatherState === 'idle') unit.gatherState = 'to-node';
    if (unit.gatherState === 'to-node' && node) {
      if (move(unit, node.col, node.row, type.speed, 1.5)) {
        unit.gatherState = 'gathering'; unit.gatherTimer = 0;
      }
    } else if (unit.gatherState === 'gathering' && node) {
      unit.gatherTimer = (unit.gatherTimer ?? 0) + dt;
      if (unit.gatherTimer >= (type.gatherTime ?? 1.5)) {
        unit.gatherTimer = 0;
        const amount = Math.min(node.amount, (type.carryCapacity ?? 5) - (unit.carry ?? 0));
        unit.carry = (unit.carry ?? 0) + amount;
        unit.carryKind = node.kind;
        node.amount -= amount;
        unit.gatherState = 'to-base';
        if (node.amount === 0) outcome.depletedNodeIds.push(node.id);
      }
    } else if (unit.gatherState === 'to-base') {
      const halls = buildings.filter(b => b.typeId === 'town-hall' || b.typeId === 'town-hall-l2');
      halls.sort((a, b) => {
        const p = gridToWorldData(grid, a.col, a.row), q = gridToWorldData(grid, b.col, b.row);
        return Math.hypot(p.x - unit.position.x, p.z - unit.position.z)
          - Math.hypot(q.x - unit.position.x, q.z - unit.position.z);
      });
      const hall = halls[0];
      if (!hall || !move(unit, hall.col, hall.row, type.speed, 2)) continue;
      const kind = unit.carryKind;
      if (kind) {
        bag[kind] = (bag[kind] ?? 0) + (unit.carry ?? 0);
        outcome.gathered[kind] = (outcome.gathered[kind] ?? 0) + (unit.carry ?? 0);
      }
      unit.carry = 0; unit.carryKind = null;
      unit.gatherState = node && node.amount > 0 ? 'to-node' : 'idle';
      if (unit.gatherState === 'idle') unit.gatherNodeId = null;
    }
  }
  return outcome;
}
export function pruneDepletedNodes(nodes: ResourceNode[], depletedIds: string[]): ResourceNode[] {
  const depleted = new Set(depletedIds);
  return nodes.filter(n => !depleted.has(n.id));
}
