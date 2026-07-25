/**
 * M8.4 — Client prediction + server-rollback.
 * Источник: Source/Glenn Fiedler rollback; Valorant "netcode"; standard prediction.
 *
 * Модель:
 *  - Клиент выполняет приказы локально немедленно (prediction) на кадр `t`.
 *  - Отправляет `pvp:input{tick, action}` на сервер.
 *  - Сервер выполняет авторитативно → снапшот `t+latency`.
 *  - При рассинхроне (server state ≠ predicted) → rollback: откатить до последнего
 *    подтверждённого кадра, пере-выполнить входы → reconcile.
 *
 * Реализация: ClientPredictor держит:
 *  - inputBuffer: последние N кадров входов (FIFO).
 *  - stateCheckpoint: подтверждённый сервером state на кадре `confirmedTick`.
 *  - predictedState: локальный sim-state, шагающий вперёд с локальными input-ами.
 *  - reconcile(snapshot): если snapshot.tick > confirmedTick → принимаем как новый
 *    checkpoint и re-play'им inputBuffer с этого кадра до текущего.
 *
 * ВАЖНО: rollback требует детерминированного sim (см. M8.4-prep, ADR-2).
 * Если sim НЕ детерминирован (Math.random в hot path) — reconcile будет постоянно
 * "дребезжать". Поэтому перед prediction выполняется аудит детерминизма (см. M8-PLAN §Аудит).
 *
 * Здесь живёт только клиент-сторона; серверный sim-loop см. server/src/realtime/.
 */
import type { GameSnapshot, PlayerAction } from '@tower/shared';

export interface ClientPredictorOptions {
  /** Максимальный размер inputBuffer (кадры). */
  bufferSize?: number;
  /** Максимальная допустимая рассинхронизация tick (после — full reset). */
  maxTickDrift?: number;
}

export interface BufferedInput {
  tick: number;
  action: PlayerAction;
  /** Отправлен ли на сервер (для resend-логики). */
  sent: boolean;
}

export interface ReconcileResult {
  /** Был ли rollback выполнен. */
  rolledBack: boolean;
  /** Сколько кадров было пере-replayed. */
  replayedFrames: number;
  /** drift между predicted и authoritative (для UI-debug). */
  tickDrift: number;
}

/**
 * ClientPredictor: оборачивает детерминированный sim-state (тот же GameSnapshot-формат),
 * поддерживает:
 *  - applyLocalInput(action) — prediction немедленно + enqueue в buffer.
 *  - reconcile(authoritativeSnapshot) — принимает серверный state и при необходимости
 *    откатывается + пере-replays pending inputs.
 *
 * Сим-применение вводов: caller передаёт `apply(state, action)` — чистая функция,
 * которая выполняет действие на state (clone-safe). Сама ClientPredictor НЕ знает
 * про детали PlayerAction — только о тиках.
 *
 * NOT threadsafe, NOT reusable across matches.
 */
export class ClientPredictor<S extends { tick: number }> {
  private confirmedState: S;
  private predictedState: S;
  private readonly inputBuffer: BufferedInput[] = [];
  private readonly bufferSize: number;
  private readonly maxTickDrift: number;
  /** Кол-во rollbacks за сессию (для UI-debug). */
  rollbackCount = 0;

  constructor(initialState: S, options: ClientPredictorOptions = {}) {
    this.confirmedState = structuredClone(initialState);
    this.predictedState = structuredClone(initialState);
    this.bufferSize = options.bufferSize ?? 64;
    this.maxTickDrift = options.maxTickDrift ?? 30;
  }

  /** Текущий predicted-state для рендера. */
  getPredictedState(): S { return this.predictedState; }

  /** Последний подтверждённый сервером tick. */
  getConfirmedTick(): number { return this.confirmedState.tick; }

  /** Применяет локальный ввод (prediction): enqueue в buffer + immediate-apply к predicted. */
  applyLocalInput(action: PlayerAction, apply: (state: S, action: PlayerAction) => void): BufferedInput {
    const tick = this.predictedState.tick;
    const buffered: BufferedInput = { tick, action, sent: false };
    this.inputBuffer.push(buffered);
    if (this.inputBuffer.length > this.bufferSize) this.inputBuffer.shift();
    apply(this.predictedState, action);
    return buffered;
  }

  /** Помечает input как отправленный на сервер (после успешной send). */
  markSent(tick: number): void {
    for (const bi of this.inputBuffer) if (bi.tick === tick) bi.sent = true;
  }

  /** Получить unsent inputs (для resend при потере пакета). */
  getUnsent(): BufferedInput[] {
    return this.inputBuffer.filter((bi) => !bi.sent);
  }

  /**
   * Продвигает predicted-state на 1 кадр (для локального шагающего sim).
   * Передаётся чистая функция step(state, dt).
   */
  stepPredicted(dt: number, step: (state: S, dt: number) => void): void {
    step(this.predictedState, dt);
  }

  /**
   * Принимает авторитетный снапшот от сервера; при рассинхроне откатывается
   * к confirmed и пере-replays pending inputs. Возвращает результат операции.
   */
  reconcile(
    authoritative: S,
    apply: (state: S, action: PlayerAction) => void,
    step: (state: S, dt: number) => void,
    dt: number
  ): ReconcileResult {
    const newTick = authoritative.tick;
    const oldConfirmed = this.confirmedState.tick;
    if (newTick <= oldConfirmed) {
      // старый/дублирующий пакет — игнорируем
      return { rolledBack: false, replayedFrames: 0, tickDrift: 0 };
    }

    // обновляем confirmed
    this.confirmedState = structuredClone(authoritative);
    const tickDrift = this.predictedState.tick - newTick;

    // replay pending inputs (those with tick >= newTick; "confirmed at N" = all
    // inputs with tick < N have been processed)
    const toReplay = this.inputBuffer.filter((bi) => bi.tick >= newTick);
    if (toReplay.length > 0) {
      this.predictedState = structuredClone(this.confirmedState);
      let replayed = 0;
      // шагаем до текущего predicted.tick, применяя buffered inputs на их тиках
      while (this.predictedState.tick < this.predictedStateTickCap(tickDrift)) {
        const currentTick = this.predictedState.tick;
        const inputsAtTick = toReplay.filter((bi) => bi.tick === currentTick);
        for (const bi of inputsAtTick) apply(this.predictedState, bi.action);
        step(this.predictedState, dt);
        replayed++;
        if (replayed > this.maxTickDrift) break; // anti-loop
      }
      this.rollbackCount++;
      // remove confirmed inputs from buffer (tick < newTick; tick >= newTick ещё pending)
      for (let i = this.inputBuffer.length - 1; i >= 0; i--) {
        if (this.inputBuffer[i].tick < newTick) this.inputBuffer.splice(i, 1);
      }
      return { rolledBack: true, replayedFrames: replayed, tickDrift };
    }

    // drift = 0 (confirmed совпал с predicted) → просто sync predicted
    this.predictedState = structuredClone(this.confirmedState);
    for (let i = this.inputBuffer.length - 1; i >= 0; i--) {
      if (this.inputBuffer[i].tick < newTick) this.inputBuffer.splice(i, 1);
    }
    return { rolledBack: false, replayedFrames: 0, tickDrift };
  }

  /** Hard reset (при reconnect / match-start). */
  reset(initialState: S): void {
    this.confirmedState = structuredClone(initialState);
    this.predictedState = structuredClone(initialState);
    this.inputBuffer.length = 0;
    this.rollbackCount = 0;
  }

  private predictedStateTickCap(tickDrift: number): number {
    // cap replay до current predicted.tick (но не дальше maxTickDrift от confirmed)
    return this.confirmedState.tick + Math.min(this.maxTickDrift, tickDrift + 1);
  }
}

/**
 * Stub для GameSnapshot — клиент-сторона prediction обёртывает GameSim как apply/step.
 * Этот helper конвертирует GameSim instance → чистые функции для ClientPredictor.
 *
 * На PvP клиенте создаётся локальный GameSim (без рендера), через который prediction
 * прогоняет applyInput и step.
 */
export function makeGameSimApplyStep(sim: { applyInput: (i: { tick: number; userId: string; action: PlayerAction }) => void; step: (dt: number) => void; state: GameSnapshot; ownerId: string }): {
  apply: (state: GameSnapshot, action: PlayerAction) => void;
  step: (state: GameSnapshot, dt: number) => void;
} {
  return {
    apply(state, action) {
      // GameSim.applyInput mutates this._state. We emulate by directly mutating the passed state.
      // (В реальном интеграционном коде: создать GameSim на confirmed-state и применить.)
      // Здесь — упрощённо: sim.applyInput — это side-effect; настоящий prediction
      // потребует, чтобы GameSim.applyInput работал на cloned-state (см. TODO ниже).
      // Для smoke: просто копируем action в state (placeholder).
      void state; void action;
    },
    step(state, dt) {
      void state;
      sim.step(dt);
    }
  };
}
