import { Injectable, signal } from '@angular/core';

/** How long an undoable action waits before it is committed (paused while the toast is hovered or focused). */
export const UNDO_TOAST_MS = 6000;

/** One undoable action: nothing is written until `commit` runs. */
export interface UndoOffer {
  /** i18n key of the toast line. */
  messageKey: string;
  messageParams?: Record<string, unknown>;
  /** The real write — runs once the window closes (timeout, a newer offer, or the host going away). */
  commit: () => void | Promise<void>;
  /** Reverts the optimistic client state. Nothing reached the backend yet. */
  onUndo: () => void;
}

interface Pending extends UndoOffer {
  id: number;
}

/**
 * Deferred commit with an undo window ("undo send"): an action is shown as
 * done at once, but its write only runs when the toast's window closes. Undo
 * inside the window cancels it, so nothing has to be taken back on the server
 * and a one-try action (the constellation guess) cannot leak its answer.
 * One offer at a time — a newer one commits the pending one first.
 */
@Injectable({ providedIn: 'root' })
export class UndoToastService {
  readonly current = signal<Pending | null>(null);
  readonly held = signal(false);
  readonly duration = UNDO_TOAST_MS;

  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private remaining = UNDO_TOAST_MS;
  private startedAt = 0;

  offer(o: UndoOffer): void {
    this.flush();
    this.current.set({ ...o, id: ++this.seq });
    this.remaining = UNDO_TOAST_MS;
    this.held.set(false);
    this.arm();
  }

  undo(): void {
    const p = this.current();
    if (!p) return;
    this.clear();
    p.onUndo();
  }

  /** Commits the pending action now (window closed, newer offer, host destroyed). */
  flush(): void {
    const p = this.current();
    if (!p) return;
    this.clear();
    void p.commit();
  }

  hold(on: boolean): void {
    if (!this.current() || on === this.held()) return;
    this.held.set(on);
    if (on) {
      this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
      this.stop();
    } else {
      this.arm();
    }
  }

  private arm(): void {
    this.stop();
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.flush(), this.remaining);
  }

  private clear(): void {
    this.stop();
    this.held.set(false);
    this.current.set(null);
  }

  private stop(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
  }
}
