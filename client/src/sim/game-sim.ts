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
  Wave,
  Weather
} from '@tower/shared';
import { buildPath } from '../domain/path';
import type { BuiltPath } from '../domain/path';
import { mulberry32 } from './rng';
import { DEFAULT_SEED, FIXED_DT, DAY_LENGTH_SECONDS } from './constants';
import { allSpawned, createWaveState, tickSpawner } from './systems/spawner';
import type { WaveSpawnState } from './systems/spawner';
import { tickMovement } from './systems/movement';
import { tickTargeting } from './systems/targeting';
import { tickProjectiles } from './systems/projectiles';
import { tickRules } from './systems/rules';
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
  private readonly path: BuiltPath;
  private readonly enemyTypes: Map<string, import('@tower/shared').EnemyType>;
  private readonly towerTypes: Map<string, TowerType>;
  private readonly waves: Wave[];
  private readonly pathCells: Set<string>;
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
    this.path = buildPath(config.map.path.waypoints, config.map.grid, config.map.heightmap);
    this.pathCells = rasterizePath(config.map.path.waypoints, config.map.grid);

    const lives = Number(config.map.base.hp) || 20;
    this.state = {
      tick: 0,
      status: 'prep',
      waveIndex: -1,
      gold: Number(config.map.startingGold) || 0,
      lives,
      pathLength: this.path.totalLength,
      enemies: [],
      towers: [],
      projectiles: [],
      waveEnemiesRemaining: 0,
      timeOfDay: 0.5,
      weather: 'clear',
      ownerId: config.ownerId,
      players: [{ userId: config.ownerId, role: 'free', ready: true }]
    };
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

  /** Клетки, занятые путём (нельзя строить). */
  isPathCell(col: number, row: number): boolean {
    return this.pathCells.has(`${col}:${row}`);
  }

  // ── ввод ─────────────────────────────────────────────────────────

  private placeTower(typeId: string, col: number, row: number): void {
    if (this.state.status === 'lost' || this.state.status === 'won') return;
    const type = this.towerTypes.get(typeId);
    if (!type) return;
    if (!this.inBounds(col, row)) return;
    if (this.isPathCell(col, row)) return;
    if (this.state.towers.some((t) => t.col === col && t.row === row)) return;
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
        path: this.path,
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

    // 3. projectiles → damage + kills
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
        cellSize: this.map.grid.cellSize,
        dt,
        tick: state.tick
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
        path: this.path,
        cellSize: this.map.grid.cellSize,
        dt,
        tick: state.tick
      });
      reached = out.reached;
      damageToBase = out.damageToBase;
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

/** Растеризует сегменты пути в множество клеток "col:row" (запрет застройки). */
function rasterizePath(waypoints: MapDocument['path']['waypoints'], grid: MapDocument['grid']): Set<string> {
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
