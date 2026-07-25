/**
 * M8.4 — Server-side authoritative sim-loop для PvP.
 * Источник: стандартный dedicated server RTS-netcode (StarCraft2 / AoE2:DE).
 *
 *  - Держит один GameSim на match (server-authoritative).
 *  - Тикает с фиксированной частотой PVP_TICK_HZ = 25 Гц (PVP_TICK_DT = 1/25).
 *  - Применяет полученные inputs на их тике (input-buffer per tick).
 *  - Каждый тик: computeVisibilityAll → per-player filtered snapshots → fan-out.
 *
 * ВАЖНО: эта реализация НЕ запускает собственную копию GameSim (он живёт в
 * client/src/sim/game-sim.ts — клиенсткий модуль, который сервер не должен
 * импортировать напрямую из-за import-graph). Для production нужен hoist sim → shared/.
 *
 * В этой версии: ServerSimLoop — это скелет, который caller (PvpRooms) использует
 * как интерфейс. Реальная sim-execution прокидывается через конструктор
 * (dependency injection), что позволяет тестировать без жёсткой связи с клиентским sim.
 */
import type { GameSnapshot, GridData, PlayerAction, PlayerInput } from '@tower/shared';
import { PVP_TICK_DT, PVP_TICK_HZ } from '@tower/shared';
import { computeAllVisibilities, filterSnapshotForViewer } from './visibility.js';

/**
 * Sim-интерфейс, который должен реализовать реальный authoritative sim.
 * (В production: GameSim hoisted to shared/src/sim/game-sim.ts).
 */
export interface AuthoritativeSim {
  readonly state: GameSnapshot;
  applyInput(input: PlayerInput): void;
  step(dt: number): void;
  serialize(): GameSnapshot;
}

export interface ServerSimLoopOptions {
  matchId: string;
  grid: GridData;
  slots: Array<{ slot: number; userId: string }>;
  /** Factory для sim (caller-injected — см. pvp-rooms). */
  simFactory: () => AuthoritativeSim;
  /** Callback: послать filtered-snapshot конкретному игроку. */
  onSnapshot: (slot: number, snapshot: GameSnapshot, confirmedTick: number) => void;
  /** Callback: матч завершён (победитель / все сдались). */
  onMatchEnded?: (winnerSlot: number | null) => void;
  /** Sight-range для fog of war (опц.). */
  unitSight?: number;
  buildingSight?: number;
}

export interface PendingInput {
  tick: number;
  slot: number;
  action: PlayerAction;
}

/**
 * Server-authoritative sim-loop. Запускается через setInterval; на каждом тике:
 *  1. Применяет все pending inputs, помеченные для этого тика.
 *  2. step(PVP_TICK_DT) — продвигает sim.
 *  3. computeAllVisibilities → для каждого слота filterSnapshotForViewer.
 *  4. onSnapshot(slot, filtered, currentTick) — fan-out.
 *  5. Check win-condition → onMatchEnded если есть победитель.
 */
export class ServerSimLoop {
  private readonly sim: AuthoritativeSim;
  private readonly pending = new Map<number, PendingInput[]>(); // tick → inputs
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly slotToUserId = new Map<number, string>();

  constructor(private readonly options: ServerSimLoopOptions) {
    this.sim = options.simFactory();
    for (const s of options.slots) this.slotToUserId.set(s.slot, s.userId);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const intervalMs = Math.round(1000 / PVP_TICK_HZ);
    this.timer = setInterval(() => this.tickOnce(), intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running = false;
  }

  isRunning(): boolean { return this.running; }

  /** Принимает input от клиента (от PvpRooms.handleMessage). */
  enqueueInput(tick: number, slot: number, action: PlayerAction): void {
    if (!this.pending.has(tick)) this.pending.set(tick, []);
    this.pending.get(tick)!.push({ tick, slot, action });
  }

  getSim(): AuthoritativeSim { return this.sim; }

  private tickOnce(): void {
    if (!this.running) return;
    const currentTick = this.sim.state.tick;

    // 1. apply pending inputs for currentTick
    const inputs = this.pending.get(currentTick);
    if (inputs) {
      for (const pi of inputs) {
        this.sim.applyInput({
          tick: currentTick,
          userId: this.slotToUserId.get(pi.slot) ?? '',
          action: pi.action
        });
      }
      this.pending.delete(currentTick);
    }

    // 2. step sim
    this.sim.step(PVP_TICK_DT);
    void PVP_TICK_DT;

    // 3. snapshot
    const snapshot = this.sim.serialize();

    // 4. compute per-slot visibility + filter + fan-out
    const players = snapshot.playersState ?? [];
    const visOptions: { unitSight?: number; buildingSight?: number } = {};
    if (this.options.unitSight !== undefined) visOptions.unitSight = this.options.unitSight;
    if (this.options.buildingSight !== undefined) visOptions.buildingSight = this.options.buildingSight;
    const vis = computeAllVisibilities(players, this.options.grid, visOptions);
    for (const slot of this.slotToUserId.keys()) {
      const visible = vis.get(slot) ?? new Set<string>();
      const filtered = filterSnapshotForViewer(snapshot, slot, visible);
      this.options.onSnapshot(slot, filtered, currentTick);
    }

    // 5. win condition:只剩 один не-defeated → победа
    const aliveSlots = players.filter((p) => !p.defeated).map((p) => p.slot);
    if (players.length > 1 && aliveSlots.length <= 1) {
      this.options.onMatchEnded?.(aliveSlots[0] ?? null);
      this.stop();
    }
  }
}
