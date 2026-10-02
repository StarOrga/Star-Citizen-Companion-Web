import { DestroyRef, NgZone, inject, signal } from '@angular/core';

import { logWarn } from '../../core/log';
import { HangarService } from '../../hangar/hangar.service';
import { RoleLoadoutItem } from '../../hangar/hangar.types';

/** How long "Undo" stays offered after a clear. */
export const UNDO_WINDOW_MS = 5000;

/**
 * Clear-with-undo for one set's slots — shared by the weapons hotbar
 * (`sc-codex-set-gear`) and the armour tiles on the stage
 * (`sc-codex-set-stage`), so both clear, conflict-check and undo the same way
 * and say so with the same `codex.set.gear.*` strings.
 *
 * Create it in an injection context (a component field initializer); it
 * reads the set id and items lazily, so it follows input changes.
 */
export class SetSlotClearer {
  private readonly hangar = inject(HangarService);
  private readonly zone = inject(NgZone);

  /** The slot whose clear/undo is in flight — one write at a time. */
  readonly busySlot = signal<string | null>(null);
  /** The slot whose last clear failed; its inline alert shows until the next attempt. */
  readonly failedSlot = signal<string | null>(null);
  /** The slot whose last clear met another tab's newer piece — that piece stays, and the tile says so. */
  readonly conflictSlot = signal<string | null>(null);
  /** The piece the last clear removed, re-equippable for {@link UNDO_WINDOW_MS}. */
  readonly undoable = signal<{ slot: string; className: string; kind: string } | null>(null);
  /** The slot whose undo could not put the piece back. */
  readonly undoFailedSlot = signal<string | null>(null);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly setId: () => string,
    private readonly items: () => readonly RoleLoadoutItem[],
  ) {
    inject(DestroyRef).onDestroy(() => this.dropUndo());
  }

  /**
   * Empty `slot` — but only while it still holds `shown`, the piece the tile
   * displays; a newer piece another tab put there stays (see setRoleLoadoutSlot).
   */
  async clear(slot: string, shown: string | null): Promise<void> {
    if (this.busySlot()) return;
    const kind = this.items().find((i) => i.slot === slot)?.kind ?? null;
    this.busySlot.set(slot);
    this.failedSlot.set(null);
    this.undoFailedSlot.set(null);
    this.conflictSlot.set(null);
    this.dropUndo();
    try {
      const saved = await this.hangar.setRoleLoadoutSlot(this.setId(), slot, null, shown ?? undefined);
      if (!saved) this.failedSlot.set(slot);
      else if (saved.items.some((i) => i.slot === slot && i.className)) this.conflictSlot.set(slot);
      else if (shown && kind) this.offerUndo({ slot, className: shown, kind });
    } catch (error) {
      logWarn('codex', 'set slot clear failed', { set: this.setId(), slot, error });
      this.failedSlot.set(slot);
    } finally {
      this.busySlot.set(null);
    }
  }

  /** Put back the piece the last clear removed. */
  async undo(): Promise<void> {
    const last = this.undoable();
    if (!last || this.busySlot()) return;
    this.dropUndo();
    this.busySlot.set(last.slot);
    try {
      const saved = await this.hangar.setRoleLoadoutSlot(this.setId(), last.slot, {
        className: last.className,
        kind: last.kind,
      });
      if (!saved) this.undoFailedSlot.set(last.slot);
    } catch (error) {
      logWarn('codex', 'set slot undo failed', { set: this.setId(), slot: last.slot, error });
      this.undoFailedSlot.set(last.slot);
    } finally {
      this.busySlot.set(null);
    }
  }

  private offerUndo(piece: { slot: string; className: string; kind: string }): void {
    this.undoable.set(piece);
    // Outside the zone: a pending 5 s timer would hold it unstable (whenStable,
    // hydration) for the whole undo window. The signal still re-renders the view.
    this.undoTimer = this.zone.runOutsideAngular(() => setTimeout(() => this.undoable.set(null), UNDO_WINDOW_MS));
  }

  private dropUndo(): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoTimer = null;
    this.undoable.set(null);
  }
}
