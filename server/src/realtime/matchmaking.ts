/**
 * M8.4 — Simple in-memory matchmaking queue (Redis-optional).
 *
 * PvpRooms уже делает in-process matchmaking (handleQueue). Этот модуль — обёртка
 * для future-Redis-backed distributed matchmaking (multi-server deployment).
 * Сейчас — local-in-memory; если нужен Redis, можно заменить реализацию без
 * изменения контракта (Matchmaker interface).
 */
import type { PvpMatchMode } from '@tower/shared';

export interface QueueEntry {
  userId: string;
  username: string;
  mode: PvpMatchMode;
  enqueuedAt: number;
}

export interface Matchmaker {
  enqueue(userId: string, username: string, mode: PvpMatchMode): QueueEntry | null;
  dequeue(userId: string): void;
  /** Если есть N готовых игроков для mode — возвращает их userIds, иначе null. */
  tryFormMatch(mode: PvpMatchMode, slotCount: number): string[] | null;
  queueSize(): number;
}

export class InMemoryMatchmaker implements Matchmaker {
  private readonly queue: QueueEntry[] = [];

  enqueue(userId: string, username: string, mode: PvpMatchMode): QueueEntry | null {
    // dedup — не позволяем дважды встать в очередь
    if (this.queue.some((e) => e.userId === userId)) return null;
    const entry: QueueEntry = { userId, username, mode, enqueuedAt: Date.now() };
    this.queue.push(entry);
    return entry;
  }

  dequeue(userId: string): void {
    const idx = this.queue.findIndex((e) => e.userId === userId);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  tryFormMatch(mode: PvpMatchMode, slotCount: number): string[] | null {
    const matching = this.queue.filter((e) => e.mode === mode);
    if (matching.length < slotCount) return null;
    // FIFO — самые старые
    matching.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    const chosen = matching.slice(0, slotCount);
    for (const e of chosen) this.dequeue(e.userId);
    return chosen.map((e) => e.userId);
  }

  queueSize(): number { return this.queue.length; }
}
