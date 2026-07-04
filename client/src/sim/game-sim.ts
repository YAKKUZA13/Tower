/**
 * GameSim — авторитетный детерминированный сим TD (ADR-1, ADR-2).
 * Phase 1 задача 1.3. Чистый класс: applyInput + step(fixed) + serialize.
 * Оркестрирует системы (spawner/movement/targeting/projectiles/combat/economy/rules).
 *
 * Single-player: host=local, ввод применяется немедленно.
 * Co-op (Фаза 7): тот же класс, host считает, гости reconcile(snapshot).
 */

import type {
  Enemy,
  GameCatalog,
  GameSnapshot,
  MapDocument,
  PlayerInput,
  Tower,
  TowerType,
  Wall,
  WallMaterial,
  WallMaterialDef,
  Wave,
  Weather,
  Waypoint
} from '@tower/shared';
import { buildPath, positionAtProgress } from '../domain/path';
import type { BuiltPath } from '../domain/path';
import { findGridRoute } from '../domain/pathfinding';
import { canPlaceWall } from '../domain/placement';
import { mulberry32 } from './rng';
import { DEFAULT_SEED, FIXED_DT, DAY_LENGTH_SECONDS, BURN_DURATION } from './constants';
import { allSpawned, createWaveState, tickSpawner } from './systems/spawner';
import type { WaveSpawnState } from './systems/spawner';
import { tickMovement } from './systems/movement';
import { tickTargeting } from './systems/targeting';
import { tickProjectiles } from './systems/projectiles';
import { tickRules } from './systems/rules';
import { applyEnemyWallDamage, repairCost, tickWalls } from './systems/walls';
import { canAfford, spend, refund } from './systems/economy';

export interface GameSimConfig {
  map: MapDocument;
  catalog: GameCatalog;
  ownerId: string;
  seed?: number;
}

const MAX_STEPS_PER_FRAME = 6;

export class GameSim {
  readonly state: GameSnapshot;
  readonly catalog: GameCatalog;
  readonly map: MapDocument;
  private readonly enemyTypes: Map<string, import('@tower/shared').EnemyType>;
  private readonly towerTypes: Map<string, TowerType>;
  private readonly wallDefs: Map<WallMaterial, WallMaterialDef>;
  private readonly waves: Wave[];
  /** Текущий маршрут врагов (A* вокруг стен) как polyline клеток-центров. */
  private routePath: BuiltPath;
  private routeWaypoints: Waypoint[];
  private routeCells: Set<string>;
  private rng: () => number;
  private waveState: WaveSpawnState | null = null;
  private accumulator = 0;
  private idCounter = 1;
  private prevStatus: GameSnapshot['status'] = 'prep';

  constructor(config: GameSimConfig) {
    this.map = config.map;
    this.catalog = config.catalog;
    this.rng = mulberry32(config.seed ?? DEFAULT_SEED);

    this.waves = this.resolveWaves(config.map, config.catalog);
    this.enemyTypes = new Map(config.catalog.enemies.map((e) => [e.id, e]));
    this.towerTypes = new Map(config.catalog.towers.map((t) => [t.id, t]));
    this.wallDefs = new Map((config.catalog.walls ?? []).map((w) => [w.material, w]));
    this.routeWaypoints = [];
    this.routeCells = new Set();
    this.routePath = buildPath(config.map.path.waypoints, config.map.grid, config.map.heightmap);

    const lives = Number(config.map.base.hp) || 20;
    this.state = {
      tick: 0,
      status: 'prep',
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
      timeOfDay: 0.5,
      weather: 'clear',
      ownerId: config.ownerId,
      players: [{ userId: config.ownerId, role: 'free', ready: true }]
    };

    // начальный маршрут врагов — A* от spawn до base (стен ещё нет)
    this.recomputeRoute(false);
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

  getTowerType(id: string): TowerType | undefined {
    return this.towerTypes.get(id);
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
    const ctx = { grid: this.map.grid, spawn: this.map.spawnPoint, base: this.map.base, walls: this.state.walls, towers: this.state.towers };
    if (!canPlaceWall(ctx, col, row)) return;
    if (!canAfford(this.state, def.cost)) return;
    spend(this.state, def.cost);
    const wall: Wall = {
      id: this.nextId('wall'),
      col,
      row,
      hp: def.maxHp,
      maxHp: def.maxHp,
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
    const cost = repairCost(def, wall);
    if (!canAfford(this.state, cost)) return;
    spend(this.state, cost);
    wall.hp = wall.maxHp;
    wall.burning = false;
    wall.burningUntilTick = undefined;
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
        nextProjectileId: () => this.nextId('proj')
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
        burnTicks: Math.round(BURN_DURATION / FIXED_DT)
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
      totalWaves: this.waves.length
    });
    if (state.status !== 'wave') {
      this.waveState = null;
    }
    // Фаза 3: детерминированная смена погоды между волнами (волна зачищена → prep).
    if (this.prevStatus === 'wave' && state.status === 'prep') {
      state.weather = this.rollWeather();
    }
    this.prevStatus = state.status;
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
    const blocked = (c: number, r: number) => this.state.walls.some((w) => w.col === c && w.row === r);
    const route = findGridRoute(this.map.spawnPoint, this.map.base, grid, blocked);
    let wps: Waypoint[];
    if (route && route.length >= 1) {
      wps = route;
    } else {
      // defensively: прямая spawn→base (валидация установки не должна сюда пускать)
      wps = [this.map.spawnPoint, this.map.base];
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
