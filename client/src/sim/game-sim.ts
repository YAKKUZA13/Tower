/**
 * GameSim — авторитетный детерминированный сим TD (ADR-1, ADR-2).
 * Phase 1 задача 1.3. Чистый класс: applyInput + step(fixed) + serialize.
 * Оркестрирует системы (spawner/movement/targeting/projectiles/combat/economy/rules).
 *
 * Single-player: host=local, ввод применяется немедленно.
 * Co-op (Фаза 7): тот же класс, host считает, гости reconcile(snapshot).
 */

import type {
  ActiveSpell,
  BaseDef,
  CommanderType,
  DefenderUnit,
  DefenderUnitType,
  Enemy,
  GameCatalog,
  GameSnapshot,
  MapDocument,
  PlayerInput,
  ProductionBuilding,
  ProductionBuildingType,
  RelicType,
  Spell,
  Tower,
  TowerType,
  Wall,
  WallMaterial,
  WallMaterialDef,
  Wave,
  Weather,
  Waypoint
} from '@tower/shared';
import type { ResourceId, ResourceKind, ResourceNode } from '@tower/shared';
import { buildPath, positionAtProgress } from '../domain/path';
import type { BuiltPath } from '../domain/path';
import { findGridRoute } from '../domain/pathfinding';
import { gridToWorldData } from '../domain/grid-math';
import { canPlaceWall, canPlaceRelic, canPlaceProductionBuilding, canTrainUnit } from '../domain/placement';
import { isTileBuildable, isTileBlocking } from '../domain/tiles';
import { mulberry32 } from './rng';
import { DEFAULT_SEED, FIXED_DT, DAY_LENGTH_SECONDS, BURN_DURATION } from './constants';
import { allSpawned, createWaveState, tickSpawner } from './systems/spawner';
import type { WaveSpawnState } from './systems/spawner';
import { tickMovement } from './systems/movement';
import { tickTargeting } from './systems/targeting';
import { tickProjectiles } from './systems/projectiles';
import { tickRules } from './systems/rules';
import { applyEnemyWallDamage, repairCost, tickWalls } from './systems/walls';
import {
  canAfford,
  spend,
  refund,
  award,
  ensureResources,
  canAffordCost,
  spendCost,
  tickProduction
} from './systems/economy';
import { computeRelicModifiers, rollRelicDraft, EMPTY_MODS } from './systems/relics';
import type { RelicModifiers } from './systems/relics';
import {
  castSpell,
  isSpellReady,
  tickActiveSpells,
  tickCommanderCooldowns,
  tickUnits
} from './systems/rts';
import { computeFormation } from './systems/formations';
import { tickGathering, pruneDepletedNodes } from './systems/gathering';

export interface GameSimConfig {
  map: MapDocument;
  catalog: GameCatalog;
  ownerId: string;
  seed?: number;
}

const MAX_STEPS_PER_FRAME = 6;

/**
 * M8 RTS-solo: HP town-hall игрока и AI. Enemy-units, дошедшие до town-hall игрока,
 * снимают HP из state.lives (= tdBase.hp). При 0 → 'lost'.
 * AI town-hall = stationary-Enemy с этим HP; при уничтожении → 'won'.
 */
const RTS_TOWN_HALL_HP = 1500;
/** Секунд до первой волны AI (даёт игроку развернуть экономику). */
const RTS_AI_FIRST_WAVE_DELAY = 35;
/** Секунд между волнами AI. */
const RTS_AI_WAVE_INTERVAL = 30;

export class GameSim {
  /**
   * Авторитетное состояние сима. Внешний код читает через геттер `state`
   * (immutable-семантика); внутренние методы и гостевой reconcile/applyRenderState
   * (Phase 7) мутируют через приватное `_state`.
   */
  private _state: GameSnapshot;
  get state(): GameSnapshot { return this._state; }
  readonly catalog: GameCatalog;
  readonly map: MapDocument;
  private readonly enemyTypes: Map<string, import('@tower/shared').EnemyType>;
  private readonly towerTypes: Map<string, TowerType>;
  private readonly wallDefs: Map<WallMaterial, WallMaterialDef>;
  private readonly relicTypes: Map<string, RelicType>;
  private readonly relicList: RelicType[];
  private readonly waves: Wave[];
  // M8: TD legacy path/spawn/base — defaults для back-compat с RTS-only картами
  private readonly tdSpawn: Waypoint;
  private readonly tdBase: BaseDef;
  // ── RTS (Фаза 6) ──
  private readonly productionTypes: Map<string, ProductionBuildingType>;
  private readonly unitTypes: Map<string, DefenderUnitType>;
  private readonly commander: CommanderType | null;
  private readonly rtsEnabled: boolean;
  /** Текущий маршрут врагов (A* вокруг стен) как polyline клеток-центров. */
  private routePath: BuiltPath;
  private routeWaypoints: Waypoint[];
  private routeCells: Set<string>;
  private rng: () => number;
  private waveState: WaveSpawnState | null = null;
  private accumulator = 0;
  private idCounter = 1;
  private prevStatus: GameSnapshot['status'] = 'prep';
  /** Кеш модификаторов размещённых реликвий (appliedRelicEffects). */
  private relicMods: RelicModifiers = EMPTY_MODS;
  /** Последний routeVersion, применённый в гостевом режиме (для recompute-гарда). */
  private lastAppliedRouteVersion = -1;
  // ── M8 RTS-solo: AI opponent state ──
  /** True, если карта — каноническая RTS (gameMode='rts' + playerStarts). */
  private readonly rtsSolo: boolean;
  /** Id stationary-Enemy = AI town-hall (мишень победы). */
  private aiTownHallId: string | null = null;
  /** Таймер до следующей волны AI-атаки (сек). */
  private aiAttackTimer = 0;
  /** Какой набор юнитов спавнить следующей волной (растёт со временем). */
  private aiWaveIndex = 0;

  constructor(config: GameSimConfig) {
    this.map = config.map;
    this.catalog = config.catalog;
    this.rng = mulberry32(config.seed ?? DEFAULT_SEED);

    this.waves = this.resolveWaves(config.map, config.catalog);
    this.enemyTypes = new Map(config.catalog.enemies.map((e) => [e.id, e]));
    this.towerTypes = new Map(config.catalog.towers.map((t) => [t.id, t]));
    this.wallDefs = new Map((config.catalog.walls ?? []).map((w) => [w.material, w]));
    this.relicList = config.catalog.relics ?? [];
    this.relicTypes = new Map(this.relicList.map((r) => [r.id, r]));
    this.productionTypes = new Map((config.catalog.productionBuildings ?? []).map((p) => [p.id, p]));
    this.unitTypes = new Map((config.catalog.defenderUnits ?? []).map((u) => [u.id, u]));
    this.commander = this.resolveCommander(config.map, config.catalog);
    // M8 RTS-solo: rts-режим включается либо явно (map.rts.enabled — legacy fortress),
    // либо по gameMode='rts' (канонические RTS-карты с playerStarts + resourceNodes).
    this.rtsEnabled = (!!config.map.rts?.enabled || config.map.gameMode === 'rts') && !!this.commander;

    this.routeWaypoints = [];
    this.routeCells = new Set();
    // M8 RTS-solo: на канонических RTS-картах (playerStarts) tdSpawn/tdBase берём из
    // стартовых позиций: враги (AI slot 1) идут от своего town-hall к town-hall игрока.
    // Для legacy TD/fortress-карт — прежние defaults из map.spawnPoint/base.
    this.rtsSolo = config.map.gameMode === 'rts' && (config.map.playerStarts?.length ?? 0) >= 2;
    const starts = config.map.playerStarts ?? [];
    const p0TownHall = this.rtsSolo && starts[0] ? starts[0].townHall : null;
    const p1TownHall = this.rtsSolo && starts[1] ? starts[1].townHall : null;
    const tdPath = config.map.path ?? { waypoints: [] };
    this.tdSpawn = p1TownHall ?? config.map.spawnPoint ?? { col: 0, row: 0 };
    this.tdBase = p0TownHall
      ? { col: p0TownHall.col, row: p0TownHall.row, hp: RTS_TOWN_HALL_HP }
      : (config.map.base ?? { col: Math.max(0, config.map.grid.cols - 1), row: Math.max(0, config.map.grid.rows - 1), hp: 20 });
    this.routePath = buildPath(tdPath.waypoints, config.map.grid, config.map.heightmap);

    const lives = Number(this.tdBase.hp) || 20;
    this._state = {
      tick: 0,
      // M8 RTS-solo: статус 'playing' сразу (нет TD-волн; AI сам спавнит врагов).
      status: this.rtsSolo ? 'wave' : 'prep',
      waveIndex: -1,
      gold: Number(config.map.startingGold) || 0,
      lives,
      pathLength: this.routePath.totalLength,
      enemies: [],
      towers: [],
      walls: [],
      projectiles: [],
      routeVersion: 0,
      waveEnemiesRemaining: 0,
      relics: [],
      pendingRelicChoices: [],
      timeOfDay: 0.5,
      weather: 'clear',
      ownerId: config.ownerId,
      players: [{ userId: config.ownerId, role: 'free', ready: true }]
    };

    // RTS: инициализировать ресурсы/здания/юниты/кулдауны, если режим включён
    if (this.rtsEnabled) {
      this.initRtsState(config.map);
    }

    // начальный маршрут врагов — A* от spawn до base (стен ещё нет)
    this.recomputeRoute(false);
  }

  /** Детерминированный выбор командира: map.rts.commanderTypeId → каталог → дефолт. */
  private resolveCommander(map: MapDocument, catalog: GameCatalog): CommanderType | null {
    const list = catalog.commanders ?? [];
    if (list.length === 0) return null;
    const wanted = map.rts?.commanderTypeId;
    if (wanted) {
      const found = list.find((c) => c.id === wanted);
      if (found) return found;
    }
    return list[0];
  }

  /** Инициализирует RTS-поля снапшота: стартовые ресурсы, здания, кулдауны. */
  private initRtsState(map: MapDocument): void {
    const rts = map.rts ?? { enabled: true };
    // gold живёт в state.gold; в bag — только wood/stone/ore
    const startBag = ensureResources({
      wood: rts.startingResources?.wood ?? 60,
      stone: rts.startingResources?.stone ?? 30,
      ore: rts.startingResources?.ore ?? 0
    });
    // стартовый gold из rts-конфига добавляем к state.gold (поверх startingGold карты)
    const startGold = rts.startingResources?.gold ?? 0;
    if (startGold > 0) this.state.gold += startGold;
    this.state.resources = startBag;

    const buildings: ProductionBuilding[] = [];
    for (const sb of rts.startBuildings ?? []) {
      if (!this.productionTypes.has(sb.typeId)) continue;
      buildings.push({
        id: this.nextId('pb'),
        typeId: sb.typeId,
        col: sb.col,
        row: sb.row,
        accum: {}
      });
    }

    // M8 RTS-solo: для канонических RTS-карт — стартовый town-hall игрока (slot 0) +
    // workers (из playerStarts[0]); AI town-hall (slot 1+) — stationary-Enemy как
    // мишень победы. tdSpawn/tdBase уже выставлены в конструкторе из playerStarts.
    if (this.rtsSolo) {
      const starts = map.playerStarts ?? [];
      const p0 = starts[0];
      if (p0) {
        // town-hall игрока
        if (this.productionTypes.has('town-hall')) {
          buildings.push({
            id: this.nextId('pb'),
            typeId: 'town-hall',
            col: p0.townHall.col,
            row: p0.townHall.row,
            accum: {}
          });
        }
        // workers игрока
        const workerType = this.unitTypes.get('worker');
        const units: DefenderUnit[] = [];
        // auto-gather: найдём ближайший к town-hall ресурсный узел (wood приоритет),
        // чтобы workers сразу начали приносить ресурсы без ручного приказа.
        const nodes = map.resourceNodes ?? [];
        const thPos = gridToWorldData(this.map.grid, p0.townHall.col, p0.townHall.row);
        const autoNode = this.pickAutoGatherNode(nodes, thPos);
        for (const w of p0.workers ?? []) {
          const pos = gridToWorldData(this.map.grid, w.col, w.row);
          units.push({
            id: this.nextId('unit'),
            typeId: 'worker',
            col: w.col,
            row: w.row,
            position: { x: pos.x, y: 0, z: pos.z },
            hp: workerType?.hp ?? 30,
            maxHp: workerType?.hp ?? 30,
            stance: 'guard',
            cooldown: 0,
            targetEnemyId: null,
            homeCol: w.col,
            homeRow: w.row,
            // auto-gather к ближайшему wood-узлу (детерминировано: фиксированный nodeId).
            gatherNodeId: autoNode?.id ?? null,
            gatherState: autoNode ? 'to-node' : 'idle',
            gatherTimer: 0,
            carry: 0,
            carryKind: null
          });
        }
        this.state.defenderUnits = units;
      }
      // AI town-hall (slot 1) — stationary boss-Enemy как мишень победы.
      // Если playerStarts > 2 (3p/4p карты) — добавляем по мишени на каждый слот.
      for (let i = 1; i < starts.length; i++) {
        const ps = starts[i];
        if (!ps) continue;
        const pos = gridToWorldData(this.map.grid, ps.townHall.col, ps.townHall.row);
        const aiTh: Enemy = {
          id: this.nextId('ai-th'),
          typeId: 'boss',
          hp: RTS_TOWN_HALL_HP,
          maxHp: RTS_TOWN_HALL_HP,
          pathProgress: 0,
          position: { x: pos.x, y: 0, z: pos.z },
          alive: true,
          stationary: true
        };
        this.state.enemies.push(aiTh);
        if (i === 1) this.aiTownHallId = aiTh.id;
      }
      this.aiAttackTimer = RTS_AI_FIRST_WAVE_DELAY;
      this.aiWaveIndex = 0;
    } else {
      this.state.defenderUnits = [];
    }

    this.state.productionBuildings = buildings;

    if (this.commander) {
      const cds: Record<string, number> = {};
      for (const s of this.commander.spells) cds[s.id] = 0;
      this.state.commanderCooldowns = cds;
    }
    this.state.activeSpells = [];
  }

  // ── публичный API ────────────────────────────────────────────────

  applyInput(input: PlayerInput): void {
    switch (input.action.kind) {
      case 'place-tower':
        this.placeTower(input.action.typeId, input.action.col, input.action.row);
        break;
      case 'sell-tower':
        this.sellTower(input.action.towerId);
        break;
      case 'start-wave':
        this.startWave();
        break;
      case 'set-targeting':
        this.setTargeting(input.action.towerId, input.action.mode);
        break;
      case 'place-wall':
        this.placeWall(input.action.material, input.action.col, input.action.row);
        break;
      case 'repair-wall':
        this.repairWall(input.action.wallId);
        break;
      case 'pick-relic':
        this.pickRelic(input.action.relicTypeId, input.action.col, input.action.row);
        break;
      case 'remove-relic':
        this.removeRelic(input.action.relicId);
        break;
      case 'skip-draft':
        this.skipDraft();
        break;
      case 'build-production':
        this.buildProduction(input.action.typeId, input.action.col, input.action.row);
        break;
      case 'train-unit':
        this.trainUnit(input.action.typeId, input.action.col, input.action.row);
        break;
      case 'set-unit-stance':
        this.setUnitStance(input.action.unitId, input.action.stance);
        break;
      case 'cast-spell':
        this.castCommanderSpell(input.action.spellId, input.action.col, input.action.row);
        break;
      case 'order-unit-move':
        this.orderUnitMove(input.action.unitIds, input.action.col, input.action.row, input.action.formation);
        break;
      case 'order-unit-attack':
        this.orderUnitAttack(input.action.unitIds, input.action.enemyId);
        break;
      case 'order-unit-stop':
        this.orderUnitStop(input.action.unitIds);
        break;
      case 'order-unit-attack-move':
        this.orderUnitAttackMove(input.action.unitIds, input.action.col, input.action.row);
        break;
      case 'order-unit-patrol':
        this.orderUnitPatrol(input.action.unitIds, input.action.waypoints);
        break;
      case 'order-unit-waypoint-queue':
        this.orderUnitWaypointQueue(input.action.unitIds, input.action.waypoints, input.action.append);
        break;
      case 'order-unit-gather':
        this.orderUnitGather(input.action.unitIds, input.action.nodeId);
        break;
      case 'research-upgrade':
        this.researchUpgrade(input.action.upgradeId, input.action.buildingId);
        break;
      case 'assign-control-group':
        // control-group — client-only state; server no-op (snapshot не меняется)
        break;
      case 'rts-slot-action': {
        // M8.4: reroute к конкретному slot (PvP); для single-player host — применяем как обычно.
        this.applyInput({ ...input, action: input.action.inner });
        break;
      }
    }
  }

  /** Продвигает сим на realDt секунд (детерминированными fixed-шагами). */
  step(realDt: number): void {
    if (this.state.status === 'won' || this.state.status === 'lost') return;
    this.accumulator += Math.min(0.25, Math.max(0, realDt));
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.fixedStep(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
  }

  /** Глубокая копия состояния (snapshot для UI/сети). */
  serialize(): GameSnapshot {
    return structuredClone(this.state);
  }

  /**
   * Заменяет внутреннее состояние авторитетным снапшотом хоста (Phase 7).
   * Используется гостем: он НЕ шагает сим, а рендерит reconcile-нутые состояния.
   * Маршрут врагов и кеш реликвий пересчитываются от новых стен/реликий,
   * чтобы `getRouteWaypoints()`/`getRelicMods()` оставались консистентны для рендера.
   */
  reconcile(snapshot: GameSnapshot): void {
    this._state = structuredClone(snapshot);
    // пересчитать маршрут от текущих стен (renderer overlay читает getRouteWaypoints)
    this.recomputeRoute(false);
    // установить кеш реликвий БЕЗ rescale стен (снапшот хоста уже содержит
    // корректные hp/maxHp с учётом его own relicMods)
    this.relicMods = computeRelicModifiers(this.state.relics, this.relicTypes, this.towerTypes);
    this.lastAppliedRouteVersion = snapshot.routeVersion;
  }

  /**
   * Покадровое обновление состояния для гостевого рендера (Phase 7).
   * В отличие от reconcile — НЕ клонирует (объект принадлежит GuestSync и каждый
   * кадр свежий) и пересчитывает маршрут только при смене routeVersion (A* дорогой).
   * relicMods НЕ пересчитывается (гость не запускает боевые системы).
   */
  applyRenderState(snapshot: GameSnapshot): void {
    this._state = snapshot;
    if (snapshot.routeVersion !== this.lastAppliedRouteVersion) {
      this.lastAppliedRouteVersion = snapshot.routeVersion;
      this.recomputeRoute(false);
    }
  }

  getTowerType(id: string): TowerType | undefined {
    return this.towerTypes.get(id);
  }

  /** Включён ли RTS-режим на карте (Фаза 6). */
  isRtsEnabled(): boolean {
    return this.rtsEnabled;
  }

  getCommander(): CommanderType | null {
    return this.commander;
  }

  getProductionType(id: string): ProductionBuildingType | undefined {
    return this.productionTypes.get(id);
  }

  getUnitType(id: string): DefenderUnitType | undefined {
    return this.unitTypes.get(id);
  }

  /** M8 RTS-solo: включён ли канонический RTS-режим (gameMode='rts' + playerStarts). */
  isRtsSolo(): boolean {
    return this.rtsSolo;
  }

  /**
   * Выбирает resource-node для auto-gather стартовых workers:
   * 优先 wood → stone → ore → gold, тай-брейк = ближайший к town-hall игрока.
   * Детерминировано (без rng).
   */
  private pickAutoGatherNode(
    nodes: ResourceNode[],
    thPos: { x: number; z: number }
  ): ResourceNode | null {
    if (nodes.length === 0) return null;
    const order: ResourceKind[] = ['wood', 'stone', 'ore', 'gold'];
    for (const kind of order) {
      const ofKind = nodes.filter((n) => n.kind === kind && n.amount > 0);
      if (ofKind.length === 0) continue;
      // ближайший к town-hall игрока
      let best = ofKind[0]!;
      let bestD = Infinity;
      for (const n of ofKind) {
        const np = gridToWorldData(this.map.grid, n.col, n.row);
        const d = (np.x - thPos.x) ** 2 + (np.z - thPos.z) ** 2;
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    }
    return null;
  }

  /** M8 RTS-solo: town-hall игрока (slot 0). Берётся из productionBuildings по typeId. */
  getPlayerTownHall(): ProductionBuilding | null {
    const list = this.state.productionBuildings ?? [];
    return list.find((b) => b.typeId === 'town-hall' || b.typeId === 'town-hall-l2') ?? null;
  }

  /** M8 RTS-solo: AI town-hall Enemy (мишень победы). null если уже уничтожен. */
  getAiTownHall(): Enemy | null {
    if (!this.aiTownHallId) return null;
    return this.state.enemies.find((e) => e.id === this.aiTownHallId && e.alive) ?? null;
  }

  /** Секунд до следующей волны AI (для UI-индикатора). */
  getAiNextWaveIn(): number {
    return Math.max(0, this.aiAttackTimer);
  }

  /** Клетки, занятые текущим маршрутом врагов (нельзя строить башни). */
  isPathCell(col: number, row: number): boolean {
    return this.routeCells.has(`${col}:${row}`);
  }

  /** Текущий маршрут врагов (клетки) — для рендера tube. */
  getRouteWaypoints(): Waypoint[] {
    return this.routeWaypoints;
  }

  // ── ввод ─────────────────────────────────────────────────────────

  private placeTower(typeId: string, col: number, row: number): void {
    if (this.state.status === 'lost' || this.state.status === 'won') return;
    const type = this.towerTypes.get(typeId);
    if (!type) return;
    if (!this.inBounds(col, row)) return;
    if (this.isPathCell(col, row)) return;
    if (this.state.towers.some((t) => t.col === col && t.row === row)) return;
    if (this.state.walls.some((w) => w.col === col && w.row === row)) return;
    if (this.state.relics.some((r) => r.col === col && r.row === row)) return;
    // Phase T: нельзя ставить башню на water/rock тайлах
    if (!isTileBuildable(this.map.tiles, this.map.grid, col, row)) return;
    if (!canAfford(this.state, type.cost)) return;
    spend(this.state, type.cost);
    const tower: Tower = {
      id: this.nextId('tower'),
      typeId,
      col,
      row,
      level: 0,
      upgradePathIndex: -1,
      cooldown: 0,
      rotationY: 0,
      targetingMode: type.targetingMode
    };
    this.state.towers.push(tower);
  }

  private sellTower(towerId: string): void {
    const idx = this.state.towers.findIndex((t) => t.id === towerId);
    if (idx < 0) return;
    const tower = this.state.towers[idx];
    const type = this.towerTypes.get(tower.typeId);
    if (type) refund(this.state, type);
    this.state.towers.splice(idx, 1);
  }

  private setTargeting(towerId: string, mode: TowerType['targetingMode']): void {
    const tower = this.state.towers.find((t) => t.id === towerId);
    if (tower) tower.targetingMode = mode;
  }

  private placeWall(material: WallMaterial, col: number, row: number): void {
    if (this.state.status === 'lost' || this.state.status === 'won') return;
    const def = this.wallDefs.get(material);
    if (!def) return;
    const ctx = {
      grid: this.map.grid,
      spawn: this.tdSpawn,
      base: this.tdBase,
      walls: this.state.walls,
      towers: this.state.towers,
      relics: this.state.relics,
      tiles: this.map.tiles
    };
    if (!canPlaceWall(ctx, col, row)) return;
    if (!canAfford(this.state, def.cost)) return;
    spend(this.state, def.cost);
    const maxHp = def.maxHp * this.relicMods.wallHpMult;
    const wall: Wall = {
      id: this.nextId('wall'),
      col,
      row,
      hp: maxHp,
      maxHp,
      material,
      burning: false
    };
    this.state.walls.push(wall);
    // стена меняет препятствия → пересчитать маршрут и ремапить врагов
    this.recomputeRoute(true);
  }

  private repairWall(wallId: string): void {
    const wall = this.state.walls.find((w) => w.id === wallId);
    if (!wall) return;
    const def = this.wallDefs.get(wall.material);
    if (!def) return;
    if (wall.hp >= wall.maxHp) return;
    // стоимость ремонта считается от эффективного maxHp (с учётом реликвий)
    const cost = repairCost({ ...def, maxHp: wall.maxHp }, wall);
    if (!canAfford(this.state, cost)) return;
    spend(this.state, cost);
    wall.hp = wall.maxHp;
    wall.burning = false;
    wall.burningUntilTick = undefined;
  }

  // ── реликвии (Фаза 5) ─────────────────────────────────────────────

  private pickRelic(relicTypeId: string, col: number, row: number): void {
    if (this.state.status !== 'draft') return;
    if (!this.state.pendingRelicChoices.includes(relicTypeId)) return;
    if (!this.relicTypes.has(relicTypeId)) return;
    if (!this.inBounds(col, row)) return;
    if (this.isPathCell(col, row)) return;
    const ctx = {
      grid: this.map.grid,
      spawn: this.tdSpawn,
      base: this.tdBase,
      walls: this.state.walls,
      towers: this.state.towers,
      relics: this.state.relics,
      tiles: this.map.tiles
    };
    if (!canPlaceRelic(ctx, col, row)) return;
    this.state.relics.push({ id: this.nextId('relic'), typeId: relicTypeId, col, row });
    this.state.pendingRelicChoices = [];
    this.recomputeRelicMods();
    this.state.status = 'prep';
  }

  private removeRelic(relicId: string): void {
    // разрешаем снимать только между волнами (prep/draft) — боевой дос не трогаем
    if (this.state.status !== 'prep' && this.state.status !== 'draft') return;
    const idx = this.state.relics.findIndex((r) => r.id === relicId);
    if (idx < 0) return;
    this.state.relics.splice(idx, 1);
    this.recomputeRelicMods();
  }

  private skipDraft(): void {
    if (this.state.status !== 'draft') return;
    this.state.pendingRelicChoices = [];
    this.state.status = 'prep';
  }

  // ── RTS: экономика, юниты, заклинания (Фаза 6) ──────────────────────

  private buildProduction(typeId: string, col: number, row: number): void {
    if (!this.rtsEnabled) return;
    if (this.state.status === 'lost' || this.state.status === 'won') return;
    const type = this.productionTypes.get(typeId);
    if (!type) return;
    if (!this.inBounds(col, row)) return;
    if (this.isPathCell(col, row)) return;
    if (!canAffordCost(this.state, type.cost)) return;
    const ctx = {
      grid: this.map.grid,
      spawn: this.tdSpawn,
      base: this.tdBase,
      walls: this.state.walls,
      towers: this.state.towers,
      relics: this.state.relics,
      tiles: this.map.tiles,
      productionBuildings: this.state.productionBuildings ?? []
    };
    if (!canPlaceProductionBuilding(ctx, col, row)) return;
    spendCost(this.state, type.cost);
    const b: ProductionBuilding = {
      id: this.nextId('pb'),
      typeId,
      col,
      row,
      accum: {}
    };
    this.state.productionBuildings ??= [];
    this.state.productionBuildings.push(b);
  }

  private trainUnit(typeId: string, col: number, row: number): void {
    if (!this.rtsEnabled) return;
    if (this.state.status === 'lost' || this.state.status === 'won') return;
    const type = this.unitTypes.get(typeId);
    if (!type) return;
    if (!this.inBounds(col, row)) return;
    if (!canAffordCost(this.state, type.cost)) return;
    const ctx = {
      grid: this.map.grid,
      spawn: this.tdSpawn,
      base: this.tdBase,
      walls: this.state.walls,
      towers: this.state.towers,
      relics: this.state.relics,
      tiles: this.map.tiles,
      productionBuildings: this.state.productionBuildings ?? []
    };
    if (!canTrainUnit(ctx, col, row)) return;
    spendCost(this.state, type.cost);
    const pos = gridToWorldData(this.map.grid, col, row);
    const unit: DefenderUnit = {
      id: this.nextId('unit'),
      typeId,
      col,
      row,
      position: { x: pos.x, y: 0, z: pos.z },
      hp: type.hp,
      maxHp: type.hp,
      stance: 'guard',
      cooldown: 0,
      targetEnemyId: null,
      homeCol: col,
      homeRow: row
    };
    this.state.defenderUnits ??= [];
    this.state.defenderUnits.push(unit);
  }

  private setUnitStance(unitId: string, stance: DefenderUnit['stance']): void {
    const unit = this.state.defenderUnits?.find((u) => u.id === unitId);
    if (unit) {
      unit.stance = stance;
      // при смене stance — обновляем home (anchor), чтобы guard/patrol держались новой точки
      unit.homeCol = unit.col;
      unit.homeRow = unit.row;
    }
  }

  // ── M8.2: прямой контроль юнитов (RTS-приказы, additive — override AI). ──

  private orderUnitMove(unitIds: string[], col: number, row: number, formation?: import('@tower/shared').FormationKind): void {
    if (!this.rtsEnabled) return;
    // M8.2: формация — распределяет target по выбранным юнитам
    if (formation && formation !== 'none' && unitIds.length > 1) {
      const positions = computeFormation(unitIds.length, { col, row }, formation, { spacing: 1.2 });
      for (let i = 0; i < unitIds.length; i++) {
        const p = positions[i] ?? { col, row };
        this.applyMoveOrder(unitIds[i], Math.round(p.col), Math.round(p.row));
      }
      return;
    }
    for (const id of unitIds) {
      this.applyMoveOrder(id, col, row);
    }
  }

  private applyMoveOrder(unitId: string, col: number, row: number): void {
    const unit = this.state.defenderUnits?.find((u) => u.id === unitId);
    if (!unit) return;
    unit.moveOrderCol = col;
    unit.moveOrderRow = row;
    unit.attackOrderEnemyId = null;
    unit.patrolLoop = false;
    unit.waypoints = undefined;
    // home сдвигаем к цели, чтобы guard/patrol после приказа держались новой точки
    unit.homeCol = col;
    unit.homeRow = row;
  }

  private orderUnitAttack(unitIds: string[], enemyId: string): void {
    if (!this.rtsEnabled) return;
    for (const id of unitIds) {
      const unit = this.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) continue;
      unit.attackOrderEnemyId = enemyId;
      unit.moveOrderCol = undefined;
      unit.moveOrderRow = undefined;
    }
  }

  private orderUnitStop(unitIds: string[]): void {
    if (!this.rtsEnabled) return;
    for (const id of unitIds) {
      const unit = this.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) continue;
      unit.moveOrderCol = undefined;
      unit.moveOrderRow = undefined;
      unit.attackOrderEnemyId = null;
      unit.targetEnemyId = null;
      unit.waypoints = undefined;
      unit.patrolLoop = false;
      unit.homeCol = unit.col;
      unit.homeRow = unit.row;
    }
  }

  /** M8.2: attack-move — двигаться к точке, по пути атакуя любых врагов. */
  private orderUnitAttackMove(unitIds: string[], col: number, row: number): void {
    if (!this.rtsEnabled) return;
    for (const id of unitIds) {
      const unit = this.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) continue;
      unit.moveOrderCol = col;
      unit.moveOrderRow = row;
      // attackOrderEnemyId = null = "любой ближайший враг" (агрессивный auto-target)
      unit.attackOrderEnemyId = null;
      unit.stance = 'aggressive';
      unit.homeCol = col;
      unit.homeRow = row;
    }
  }

  /** M8.2: patrol — циклический обход waypoints. */
  private orderUnitPatrol(unitIds: string[], waypoints: Array<{ col: number; row: number }>): void {
    if (!this.rtsEnabled) return;
    if (waypoints.length === 0) return;
    for (const id of unitIds) {
      const unit = this.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) continue;
      unit.waypoints = [...waypoints];
      unit.patrolLoop = true;
      const first = waypoints[0];
      unit.moveOrderCol = first.col;
      unit.moveOrderRow = first.row;
      unit.attackOrderEnemyId = null;
      unit.homeCol = first.col;
      unit.homeRow = first.row;
      unit.stance = 'aggressive';
    }
  }

  /** M8.2: waypoint-queue — накапливает shift-click точки после текущего приказа. */
  private orderUnitWaypointQueue(unitIds: string[], waypoints: Array<{ col: number; row: number }>, append?: boolean): void {
    if (!this.rtsEnabled) return;
    if (waypoints.length === 0) return;
    for (const id of unitIds) {
      const unit = this.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) continue;
      if (append && (unit.waypoints?.length ?? 0) > 0) {
        unit.waypoints = [...(unit.waypoints ?? []), ...waypoints];
      } else {
        unit.waypoints = [...waypoints];
      }
      // если активного приказа нет — начать выполнять первый waypoint сразу
      if (unit.moveOrderCol === undefined || unit.moveOrderRow === undefined) {
        const first = unit.waypoints.shift();
        if (first) {
          unit.moveOrderCol = first.col;
          unit.moveOrderRow = first.row;
        }
      }
    }
  }

  /** M8.3: order-gather — worker направляется к ресурсному узлу на добычу. */
  private orderUnitGather(unitIds: string[], nodeId: string): void {
    if (!this.rtsEnabled) return;
    for (const id of unitIds) {
      const unit = this.state.defenderUnits?.find((u) => u.id === id);
      if (!unit) continue;
      const type = this.unitTypes.get(unit.typeId);
      if (!type?.worker) continue; // gather могут только workers
      unit.gatherNodeId = nodeId;
      unit.gatherState = 'to-node';
      unit.gatherTimer = 0;
      // снимаем бой/движение
      unit.attackOrderEnemyId = null;
      unit.targetEnemyId = null;
    }
  }

  /** M8.3: research-upgrade — старт исследования в указанном здании. */
  private researchUpgrade(upgradeId: string, _buildingId: string): void {
    if (!this.rtsEnabled) return;
    const upgrades = this.catalog.upgrades ?? [];
    const up = upgrades.find((u) => u.id === upgradeId);
    if (!up) return;
    if (!canAffordCost(this.state, up.cost)) return;
    spendCost(this.state, up.cost);
    // single-player: researches хранятся прямо в state.ownerPlayer.researching (если есть)
    // (Для PvP — это per-player; см. playersState[].researching.)
    if (this.state.playersState && this.state.playersState.length > 0) {
      const p = this.state.playersState[0];
      p.researching = p.researching ?? [];
      p.researching.push({ upgradeId, remainingSec: up.researchTime });
    }
  }

  private castCommanderSpell(spellId: string, col: number, row: number): void {
    if (!this.rtsEnabled || !this.commander) return;
    if (this.state.status === 'lost' || this.state.status === 'won') return;
    const spell = this.commander.spells.find((s) => s.id === spellId);
    if (!spell) return;
    const cds = this.state.commanderCooldowns;
    if (!cds || !isSpellReady(cds, spellId)) return;
    if (!this.inBounds(col, row)) return;

    // gold-rush + economy- relics: gold-rush множится на goldMult
    let effectiveSpell: Spell = spell;
    if (spell.effect === 'gold-rush') {
      effectiveSpell = { ...spell, power: spell.power * this.relicMods.goldMult };
    }
    const result = castSpell({
      spell: effectiveSpell,
      col,
      row,
      grid: this.map.grid,
      enemies: this.state.enemies,
      walls: this.state.walls,
      gold: this.state,
      nextId: () => this.nextId('spell'),
      tick: this.state.tick
    });
    cds[spellId] = spell.cooldown;
    this.state.activeSpells ??= [];
    this.state.activeSpells.push(result.active);
  }

  /**
   * Пересчёт кеша модификаторов реликвий. При изменении wallHpMult пропорционально
   * масштабирует hp/maxHp существующих стен (сохраняя долю hp). Детерминировано.
   */
  private recomputeRelicMods(): void {
    const newMods = computeRelicModifiers(this.state.relics, this.relicTypes, this.towerTypes);
    const oldMult = this.relicMods.wallHpMult;
    const newMult = newMods.wallHpMult;
    if (newMult !== oldMult && this.state.walls.length > 0) {
      const ratio = newMult / oldMult;
      for (const w of this.state.walls) {
        const def = this.wallDefs.get(w.material);
        if (!def) continue;
        w.maxHp = def.maxHp * newMult;
        w.hp = Math.min(w.maxHp, w.hp * ratio);
      }
    }
    this.relicMods = newMods;
  }

  /** Текущие модификаторы реликвий (для отладки/UI при необходимости). */
  getRelicMods(): RelicModifiers {
    return this.relicMods;
  }

  private startWave(): void {
    if (this.state.status !== 'prep') return;
    const nextIndex = this.state.waveIndex + 1;
    if (nextIndex >= this.waves.length) return;
    const wave = this.waves[nextIndex];
    this.waveState = createWaveState(wave);
    this.state.waveIndex = nextIndex;
    this.state.status = 'wave';
    this.state.waveEnemiesRemaining = this.waveState.totalToSpawn;
  }

  /**
   * M8 RTS-solo: AI-opponent tick.
   * Каждые RTS_AI_WAVE_INTERVAL сек спавнит волну вражеских юнитов у AI town-hall
   * (slot 1+). Юниты идут по маршруту (tdSpawn→tdBase) к town-hall игрока.
   * Сложность растёт по aiWaveIndex: на каждой волне добавляются более тяжёлые типы.
   *
   * Не использует tickSpawner/waveState — те привязаны к TD-волнам с фиксированным
   * расписанием. Здесь — простой таймер + мгновенный спавн пачки.
   */
  private tickRtsAi(dt: number): void {
    this.aiAttackTimer -= dt;
    if (this.aiAttackTimer > 0) return;
    this.aiAttackTimer = RTS_AI_WAVE_INTERVAL;
    this.aiWaveIndex += 1;

    const state = this.state;
    // AI town-hall-ы = источники спавна (slot 1+).
    const aiTowns = state.enemies.filter((e) => e.stationary && e.alive);
    if (aiTowns.length === 0) return;

    // Рост сложности: первые волны — goblin/skeleton, дальше — zombie/demon.
    // Прогрессия: wave 1: 6 goblin; 2: 8 skeleton; 3: 5 goblin + 5 zombie;
    //             4: 6 zombie + 3 demon; 5+: +demon каждый раз.
    const w = this.aiWaveIndex;
    const groups: Array<{ typeId: string; count: number }> = [];
    if (w === 1) groups.push({ typeId: 'goblin', count: 6 });
    else if (w === 2) groups.push({ typeId: 'skeleton', count: 8 });
    else if (w === 3) groups.push({ typeId: 'goblin', count: 5 }, { typeId: 'zombie', count: 5 });
    else if (w === 4) groups.push({ typeId: 'zombie', count: 6 }, { typeId: 'demon', count: 3 });
    else {
      // w >= 5: мешаем всё с нарастающим количеством демонов
      const demonN = Math.min(12, 3 + (w - 5));
      groups.push({ typeId: 'skeleton', count: 6 }, { typeId: 'zombie', count: 6 }, { typeId: 'demon', count: demonN });
    }

    // Спавним у первого живого AI town-hall (slot 1). Каждый юнит стартует с pathProgress=0.
    const spawnAt = aiTowns[0]!.position;
    for (const g of groups) {
      const type = this.enemyTypes.get(g.typeId);
      if (!type) continue;
      for (let i = 0; i < g.count; i++) {
        // лёгкий разброс вокруг точки спавна (детерминированный — по индексу)
        const ang = (i * Math.PI * 2) / Math.max(1, g.count);
        const r = this.map.grid.cellSize * 0.8;
        state.enemies.push({
          id: this.nextId('ai-u'),
          typeId: g.typeId,
          hp: type.baseHp,
          maxHp: type.baseHp,
          pathProgress: 0,
          position: {
            x: spawnAt.x + Math.cos(ang) * r,
            y: 0,
            z: spawnAt.z + Math.sin(ang) * r
          },
          alive: true
        });
      }
    }
  }

  // ── fixed step ───────────────────────────────────────────────────

  private fixedStep(dt: number): void {
    const state = this.state;
    state.tick += 1;
    this.advanceTimeOfDay(dt);

    const wave = state.status === 'wave' && state.waveIndex >= 0 ? this.waves[state.waveIndex] : null;

    // 1. spawn
    if (wave && this.waveState) {
      const { spawned } = tickSpawner({
        wave,
        state: this.waveState,
        dt,
        enemyTypes: this.enemyTypes,
        path: this.routePath,
        nextId: () => this.nextId('enemy')
      });
      for (const e of spawned) state.enemies.push(e);
    }

    // 2. targeting → spawn projectiles
    if (state.enemies.length > 0) {
      const { projectiles } = tickTargeting({
        towers: state.towers,
        towerTypes: this.towerTypes,
        enemies: state.enemies,
        grid: this.map.grid,
        heightmap: this.map.heightmap,
        cellSize: this.map.grid.cellSize,
        dt,
        nextProjectileId: () => this.nextId('proj'),
        tick: state.tick,
        relicMods: this.relicMods
      });
      for (const p of projectiles) state.projectiles.push(p);
    }

    // 3. projectiles → damage + kills + поджог стен (cannon splash)
    const aliveEnemies = new Map<string, Enemy>();
    for (const e of state.enemies) if (e.alive) aliveEnemies.set(e.id, e);
    let killed = 0;
    let goldGained = 0;
    if (state.projectiles.length > 0) {
      const out = tickProjectiles({
        projectiles: state.projectiles,
        enemies: state.enemies,
        aliveEnemies,
        enemyTypes: this.enemyTypes,
        towerTypes: this.towerTypes,
        grid: this.map.grid,
        cellSize: this.map.grid.cellSize,
        dt,
        tick: state.tick,
        walls: state.walls,
        burnTicks: Math.round(BURN_DURATION / FIXED_DT),
        relicMods: this.relicMods
      });
      killed = out.killed;
      goldGained = out.goldGained;
    }
    state.gold += goldGained;

    // 4. movement
    let reached = 0;
    let damageToBase = 0;
    if (state.enemies.length > 0) {
      const out = tickMovement({
        enemies: state.enemies,
        enemyTypes: this.enemyTypes,
        path: this.routePath,
        cellSize: this.map.grid.cellSize,
        dt,
        tick: state.tick
      });
      reached = out.reached;
      damageToBase = out.damageToBase;
    }

    // 4a. RTS (Фаза 6): защитные юниты (AI + M8.2 приказы игрока) + production-тик + кулдауны
    if (this.rtsEnabled) {
      // M8.2: tickUnits запускается при наличии юнитов (приказы move работают и без врагов).
      if (state.defenderUnits && state.defenderUnits.length > 0) {
        const out = tickUnits({
          units: state.defenderUnits,
          unitTypes: this.unitTypes,
          enemies: state.enemies,
          grid: this.map.grid,
          dt,
          tick: state.tick
        });
        killed += out.killed;
        // удаляем павших юнитов (задел — пока враги не атакуют юнитов напрямую)
        if (out.deadUnits.length > 0 && state.defenderUnits.length > 0) {
          const dead = new Set(out.deadUnits);
          state.defenderUnits = state.defenderUnits.filter((u) => !dead.has(u.id));
        }
      }
      if (state.resources && state.productionBuildings && state.productionBuildings.length > 0) {
        const goldDelta = tickProduction({
          bag: state.resources,
          buildings: state.productionBuildings,
          buildingTypes: this.productionTypes,
          dt
        });
        // золото из RTS-добычи идёт в общий кошелёк
        if (goldDelta > 0) {
          state.gold += goldDelta;
        }
      }
      if (state.commanderCooldowns) {
        tickCommanderCooldowns(state.commanderCooldowns, dt);
      }
      if (state.activeSpells && state.activeSpells.length > 0) {
        state.activeSpells = tickActiveSpells(state.activeSpells);
      }
      // M8.3: workers gathering (worker FSM + resource depletion)
      if (state.defenderUnits && state.defenderUnits.some((u) => u.gatherNodeId)) {
        const nodes = this.map.resourceNodes ?? [];
        if (nodes.length > 0 && state.resources && state.productionBuildings) {
          const out = tickGathering({
            units: state.defenderUnits,
            unitTypes: this.unitTypes,
            nodes,
            buildings: state.productionBuildings,
            bag: state.resources,
            grid: this.map.grid,
            dt
          });
          // sync depletion обратно в map (если узлы закончились)
          if (out.depletedNodeIds.length > 0 && this.map.resourceNodes) {
            this.map.resourceNodes = pruneDepletedNodes(this.map.resourceNodes, out.depletedNodeIds);
          }
        }
      }
      // M8.3: research-progress (single-player: state.playersState[0])
      if (state.playersState && state.playersState.length > 0) {
        for (const p of state.playersState) {
          if (p.researching && p.researching.length > 0) {
            for (const r of p.researching) r.remainingSec -= dt;
            const finished = p.researching.filter((r) => r.remainingSec <= 0);
            p.researching = p.researching.filter((r) => r.remainingSec > 0);
            if (finished.length > 0) {
              p.researchedUpgrades = p.researchedUpgrades ?? [];
              for (const f of finished) p.researchedUpgrades.push(f.upgradeId);
            }
          }
        }
      }
      // M8 RTS-solo: AI-opponent — периодический спавн атакующих юнитов от AI town-hall
      // к player town-hall. Сложность растёт по aiWaveIndex (больше/тяжелее юнитов).
      if (this.rtsSolo && this.aiTownHallId) {
        this.tickRtsAi(dt);
      }
    }

    // 4b. стены: горение (DoT) + урон от врагов по соседним стенам (maze-bashing)
    let wallsChanged = false;
    if (state.walls.length > 0) {
      const burnOut = tickWalls({ walls: state.walls, tick: state.tick, dt });
      const bashOut = applyEnemyWallDamage({
        enemies: state.enemies,
        enemyTypes: this.enemyTypes,
        walls: state.walls,
        grid: this.map.grid,
        dt
      });
      const destroyed = new Set<string>([...burnOut.destroyed, ...bashOut.destroyed]);
      if (destroyed.size > 0) {
        state.walls = state.walls.filter((w) => !destroyed.has(w.id));
        wallsChanged = true;
      }
    }
    if (wallsChanged) {
      // упавшая стена могла открыть более короткий маршрут → пересчитать + ремап
      this.recomputeRoute(true);
    }

    // 5. resolved accounting
    if (this.waveState) {
      this.waveState.resolved += killed + reached;
      state.waveEnemiesRemaining = Math.max(0, this.waveState.totalToSpawn - this.waveState.resolved);
    }

    // M8 RTS-solo: победа — все AI town-hall-ы уничтожены. Поражение (lives=0) обработает
    // tickRules ниже; здесь мы лишь фиксируем 'won' если ни одного живого AI town-hall не осталось.
    if (this.rtsSolo && state.status !== 'lost' && state.status !== 'won') {
      const aiThreatsAlive = state.enemies.some((e) => e.stationary && e.alive);
      if (!aiThreatsAlive) {
        state.status = 'won';
      }
    }

    // 6. cleanup
    if (state.enemies.length > 0) {
      state.enemies = state.enemies.filter((e) => e.alive);
    }
    if (state.projectiles.length > 0) {
      state.projectiles = state.projectiles.filter((p) => p.alive);
    }

    // 7. rules
    const wf = this.waveState ? allSpawned(this.waveState) && this.waveState.resolved >= this.waveState.totalToSpawn : false;
    tickRules({
      state,
      wave,
      waveFinished: wf,
      damageToBaseThisStep: damageToBase,
      totalWaves: this.waves.length,
      relicMods: this.relicMods
    });
    if (state.status !== 'wave') {
      this.waveState = null;
    }
    // Фаза 3: детерминированная смена погоды между волнами (волна зачищена → draft).
    // Фаза 5: при переходе wave→draft генерируем pendingRelicChoices (seeded rng).
    if (this.prevStatus === 'wave' && state.status === 'draft') {
      state.weather = this.rollWeather();
      this.generateRelicDraft();
    }
    this.prevStatus = state.status;
  }

  /** Детерминированная генерация 3 реликвий для драфта (seeded rng, ADR-2). */
  private generateRelicDraft(): void {
    const choices = rollRelicDraft(this.rng, this.relicList, 3);
    if (choices.length === 0) {
      // каталог пуст — драфта нет, сразу к следующей волне (без тупика для игрока)
      this.state.pendingRelicChoices = [];
      this.state.status = 'prep';
      return;
    }
    this.state.pendingRelicChoices = choices;
  }

  private advanceTimeOfDay(dt: number): void {
    // Полный цикл день/ночь — DAY_LENGTH_SECONDS (Фаза 3). timeOfDay ∈ [0,1).
    let t = this.state.timeOfDay + dt / DAY_LENGTH_SECONDS;
    if (t >= 1) t -= 1;
    if (t < 0) t += 1;
    this.state.timeOfDay = t;
  }

  /** Детерминированный бросок погоды между волнами (ADR-2: seeded rng). */
  private rollWeather(): Weather {
    const r = this.rng();
    if (r < 0.55) return 'clear';
    if (r < 0.85) return 'rain';
    return 'storm';
  }

  /**
   * Пересчёт маршрута врагов A* вокруг стен. Если remap=true — переставляет
   * существующих врагов на ближайшие точки нового маршрута (без телепорта сквозь стены).
   * Вызывается при изменении стен (place/destroy) и на старте сима.
   */
  private recomputeRoute(remap: boolean): void {
    const grid = this.map.grid;
    const tiles = this.map.tiles;
    // blocked = стены И непроходимые тайлы (water/rock) — Phase T
    const blocked = (c: number, r: number) =>
      this.state.walls.some((w) => w.col === c && w.row === r) ||
      isTileBlocking(tiles, grid, c, r);
    const route = findGridRoute(this.tdSpawn, this.tdBase, grid, blocked);
    let wps: Waypoint[];
    if (route && route.length >= 1) {
      wps = route;
    } else {
      // defensively: прямая spawn→base (валидация установки не должна сюда пускать)
      wps = [this.tdSpawn, this.tdBase];
    }
    this.routeWaypoints = wps;
    this.routePath = buildPath(wps, grid, this.map.heightmap);
    this.routeCells = rasterizeRoute(wps, grid);
    this.state.pathLength = this.routePath.totalLength;
    this.state.routeVersion += 1;
    if (remap) this.remapEnemiesToRoute();
  }

  /** Переносит врагов на ближайшие точки текущего маршрута (сохраняет физическую позицию). */
  private remapEnemiesToRoute(): void {
    const path = this.routePath;
    if (path.segments.length === 0) return;
    for (const e of this.state.enemies) {
      if (!e.alive) continue;
      e.pathProgress = nearestProgressOnPath(path, e.position);
      e.position = positionAtProgress(path, e.pathProgress);
    }
  }

  // ── helpers ──────────────────────────────────────────────────────

  private resolveWaves(map: MapDocument, catalog: GameCatalog): Wave[] {
    const list = Array.isArray(map.waves) && map.waves.length > 0 ? map.waves : catalog.waves;
    return [...list].sort((a, b) => a.index - b.index);
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.map.grid.cols && row < this.map.grid.rows;
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }
}

/** Растеризует сегменты маршрута в множество клеток "col:row" (запрет застройки башен). */
function rasterizeRoute(waypoints: Waypoint[], grid: MapDocument['grid']): Set<string> {
  const cells = new Set<string>();
  if (waypoints.length === 0) return cells;
  const mark = (col: number, row: number) => {
    const c = Math.max(0, Math.min(grid.cols - 1, Math.round(col)));
    const r = Math.max(0, Math.min(grid.rows - 1, Math.round(row)));
    cells.add(`${c}:${r}`);
  };
  mark(waypoints[0].col, waypoints[0].row);
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1];
    const b = waypoints[i];
    bresenham(a.col, a.row, b.col, b.row, mark);
  }
  return cells;
}

function bresenham(x0: number, y0: number, x1: number, y1: number, plot: (x: number, y: number) => void): void {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let guard = 0;
  while (guard++ < 10000) {
    plot(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Прогресс (длина дуги от начала) ближайшей точки polyline к заданной world-позиции.
 * Используется при перестройке маршрута, чтобы сохранить физическое положение врагов.
 */
function nearestProgressOnPath(path: BuiltPath, pos: { x: number; y: number; z: number }): number {
  let best = 0;
  let bestDist = Infinity;
  let cumulative = 0;
  for (const seg of path.segments) {
    const dx = seg.end.x - seg.start.x;
    const dy = seg.end.y - seg.start.y;
    const dz = seg.end.z - seg.start.z;
    const lenSq = dx * dx + dy * dy + dz * dz;
    let t = 0;
    if (lenSq > 1e-8) {
      t = ((pos.x - seg.start.x) * dx + (pos.y - seg.start.y) * dy + (pos.z - seg.start.z) * dz) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }
    const px = seg.start.x + dx * t;
    const py = seg.start.y + dy * t;
    const pz = seg.start.z + dz * t;
    const ddx = pos.x - px;
    const ddy = pos.y - py;
    const ddz = pos.z - pz;
    const dist = ddx * ddx + ddy * ddy + ddz * ddz;
    const progress = cumulative + seg.length * t;
    if (dist < bestDist) {
      bestDist = dist;
      best = progress;
    }
    cumulative += seg.length;
  }
  return best;
}
