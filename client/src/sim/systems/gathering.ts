/**
 * M8.3 — Gathering system (worker FSM + resource depletion).
 * Источник: AoE/Warcraft worker-gathering.
 *
 * Worker-FSM:
 *  - to-node: двигается к resource-node.
 *  - gathering: копает (gatherTimer += dt; по достижении gatherTime → carry += 1).
 *  - to-base: возвращается к ближайшему town-hall; на arrival → +carry в resources игрока.
 *
 * Resource-node depletion: amount -= 1 каждый carry; когда amount = 0 → узел помечается
 * depleted (удаляется из списка активных). Workers, приписанные к depleted-узлу,
 * переходят в idle.
 *
 * Чистая функция (мутации только входящих коллекций). Детерминирована (без Math.random).
 * Tick вызывается из game-sim fixedStep (только для работников с gatherNodeId).
 */
import type { DefenderUnit, DefenderUnitType, ProductionBuilding } from '@tower/shared';
import type { ResourceNode } from '@tower/shared';
import type { GridData, ResourceId, ResourceKind } from '@tower/shared';
import { gridToWorldData } from '../../domain/grid-math';

export interface GatherDeps {
  units: DefenderUnit[];
  unitTypes: Map<string, DefenderUnitType>;
  nodes: ResourceNode[];
  buildings: ProductionBuilding[];
  /** Per-player resources bag (мутируем при drop-off). */
  bag: Record<ResourceId, number>;
  grid: GridData;
  dt: number;
}

export interface GatherOutcome {
  /** Сколько ресурсов добавлено в bag за этот tick (по kind). */
  gathered: Partial<Record<ResourceKind, number>>;
  /** Id depleted-узлов (amount достиг 0). */
  depletedNodeIds: string[];
}

/**
 * Прогоняет worker-FSM для всех юнитов с gatherNodeId.
 */
export function tickGathering(deps: GatherDeps): GatherOutcome {
  const { units, unitTypes, nodes, buildings, bag, grid, dt } = deps;
  const outcome: GatherOutcome = { gathered: {}, depletedNodeIds: [] };

  for (const unit of units) {
    if (!unit.gatherNodeId) continue;
    const type = unitTypes.get(unit.typeId);
    if (!type?.worker) continue;

    const node = nodes.find((n) => n.id === unit.gatherNodeId);
    if (!node || node.amount <= 0) {
      // depleted → worker idle
      unit.gatherNodeId = null;
      unit.gatherState = 'idle';
      continue;
    }

    const carryCap = type.carryCapacity ?? 5;
    const gatherTime = type.gatherTime ?? 1.5;
    unit.gatherTimer = (unit.gatherTimer ?? 0) + dt;

    switch (unit.gatherState) {
      case 'idle':
        unit.gatherState = 'to-node';
        unit.gatherTimer = 0;
        break;
      case 'to-node': {
        // двигаться к узлу
        const target = gridToWorldData(grid, node.col, node.row);
        const dx = target.x - unit.position.x;
        const dz = target.z - unit.position.z;
        const distSq = dx * dx + dz * dz;
        const eps = grid.cellSize * 0.4;
        if (distSq <= eps * eps) {
          unit.gatherState = 'gathering';
          unit.gatherTimer = 0;
        } else if (type.speed > 0) {
          const dist = Math.sqrt(distSq);
          const step = type.speed * grid.cellSize * dt;
          const k = Math.min(1, step / dist);
          unit.position.x += dx * k;
          unit.position.z += dz * k;
        }
        break;
      }
      case 'gathering': {
        if (unit.gatherTimer >= gatherTime) {
          // набрали carry → к базе
          unit.carry = Math.min(carryCap, (unit.carry ?? 0) + 1);
          unit.carryKind = node.kind;
          unit.gatherState = 'to-base';
          unit.gatherTimer = 0;
        }
        break;
      }
      case 'to-base': {
        // ближайший town-hall
        const townHalls = buildings.filter((b) => b.typeId === 'town-hall' || b.typeId === 'town-hall-l2');
        if (townHalls.length === 0) {
          // нет базы — ждём (worker не может сдать)
          break;
        }
        let best = townHalls[0]!;
        let bestDist = Infinity;
        for (const b of townHalls) {
          const t = gridToWorldData(grid, b.col, b.row);
          const dx = t.x - unit.position.x;
          const dz = t.z - unit.position.z;
          const d = dx * dx + dz * dz;
          if (d < bestDist) { bestDist = d; best = b; }
        }
        const t = gridToWorldData(grid, best.col, best.row);
        const dx = t.x - unit.position.x;
        const dz = t.z - unit.position.z;
        const distSq = dx * dx + dz * dz;
        const eps = grid.cellSize * 0.6;
        if (distSq <= eps * eps) {
          // drop-off: +carry в bag, исчерпаем узел
          const k = unit.carryKind ?? node.kind;
          bag[k] = (bag[k] ?? 0) + (unit.carry ?? 0);
          outcome.gathered[k] = (outcome.gathered[k] ?? 0) + (unit.carry ?? 0);
          node.amount = Math.max(0, node.amount - (unit.carry ?? 0));
          if (node.amount <= 0 && outcome.depletedNodeIds.indexOf(node.id) < 0) {
            outcome.depletedNodeIds.push(node.id);
          }
          unit.carry = 0;
          unit.gatherState = 'to-node';
          unit.gatherTimer = 0;
        } else if (type.speed > 0) {
          const dist = Math.sqrt(distSq);
          const step = type.speed * grid.cellSize * dt;
          const kk = Math.min(1, step / dist);
          unit.position.x += dx * kk;
          unit.position.z += dz * kk;
        }
        break;
      }
    }
  }

  return outcome;
}

/**
 * Удаляет depleted-узлы из массива map-resource-nodes.
 * (Чистая функция — caller сам мутирует map или нет.)
 */
export function pruneDepletedNodes(nodes: ResourceNode[], depletedIds: string[]): ResourceNode[] {
  if (depletedIds.length === 0) return nodes;
  const set = new Set(depletedIds);
  return nodes.filter((n) => !set.has(n.id));
}
