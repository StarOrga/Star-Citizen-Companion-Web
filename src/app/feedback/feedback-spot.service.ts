import { Injectable, Signal, computed, inject, signal, untracked } from '@angular/core';
import { FeedbackComposerSeedService } from './feedback-composer-seed.service';
import { draftScopes } from './feedback-draft.types';

/**
 * How a marked page section is named in a reference line.
 */
export interface FeedbackSpotLabel {
  /** i18n key of the section's name ("Headline", "Loadout", "Einordnung"). */
  key: string;
  /** Optional second i18n key, appended with a space ("Loadout" + "Bewaffnung"). */
  subKey: string | null;
  /** Optional raw text (a page title), quoted behind the label. */
  text: string | null;
}

export interface FeedbackSpot {
  readonly el: HTMLElement;
  readonly label: Signal<FeedbackSpotLabel>;
}

/** A composer that can take a reference line — `FeedbackComposerComponent`. */
export interface FeedbackLineTarget {
  insertReferenceLine(line: string): void;
}

/** Which launcher's panel is open: the admin board (hot accent) or a user's own. */
export type FeedbackPanelOwner = 'admin' | 'user';

interface OpenPanel {
  /** The launcher's root — panel and button. */
  readonly el: HTMLElement;
  /** Draft scope of that panel's new-topic box, for when no composer is mounted. */
  readonly fallbackScope: string;
}

/**
 * Reference lines (feedback #243): an admin's Alt+click anywhere on the page
 * puts "<where> › <element>" as the first line of the text being written,
 * with the panel open or shut. Pages name their sections with
 * `[scFeedbackSpot]`; the click capture (`sc-feedback-capture`) reads them.
 *
 * Three parties that do not know each other meet here:
 *   - pages mark sections with `[scFeedbackSpot]` → `register`
 *   - the two launchers report their panel open/closed → `setPanel`
 *   - every mounted composer offers itself as a target → `attachTarget`/`touch`
 *
 * TARGET CHOICE
 *   The composer the writer last focused, else the one mounted last. With
 *   none mounted — the docked admin panel folds its new-topic box to a bar —
 *   the line is parked as a seed for the open panel's new-topic scope and the
 *   panel is asked to unfold it, the same road the telemetry page's "report
 *   as topic" takes.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackSpotService {
  private readonly seeds = inject(FeedbackComposerSeedService);

  private readonly _spots = signal<readonly FeedbackSpot[]>([]);
  private readonly _panels = signal<ReadonlyMap<FeedbackPanelOwner, OpenPanel>>(new Map());
  private targets: FeedbackLineTarget[] = [];
  private lastTouched: FeedbackLineTarget | null = null;

  /** Every marked section currently in the DOM, in registration order. */
  readonly spots = this._spots.asReadonly();
  /** A feedback panel is open. */
  readonly open = computed(() => this._panels().size > 0);
  /** The admin click capture is armed (admin signed in) — the composer shows its hint. */
  readonly captureActive = signal(false);

  /** Admin panel wins. */
  readonly owner = computed<FeedbackPanelOwner | null>(() => {
    const panels = this._panels();
    if (panels.has('admin')) return 'admin';
    return panels.has('user') ? 'user' : null;
  });
  /** The launcher roots a spot must stay clear of. */
  readonly occluders = computed(() => [...this._panels().values()].map((p) => p.el));

  /** Mark a section. Returns the unregister function. */
  register(spot: FeedbackSpot): () => void {
    this._spots.update((list) => [...list, spot]);
    return () => this._spots.update((list) => list.filter((s) => s !== spot));
  }

  /** A launcher's panel opened (`el` = its root) or closed (`null`). */
  setPanel(owner: FeedbackPanelOwner, el: HTMLElement | null, fallbackScope: string): void {
    // The launchers call this from an effect: a tracked read here would make
    // that effect depend on the signal it writes, and its cleanup + re-run
    // would flip the panel off and on forever (the frozen phone sheet).
    const panels = untracked(this._panels);
    const current = panels.get(owner);
    if (el ? current?.el === el : !current) return;
    const next = new Map(panels);
    if (el) next.set(owner, { el, fallbackScope });
    else next.delete(owner);
    this._panels.set(next);
  }

  /** A composer mounted. Returns the detach function. */
  attachTarget(target: FeedbackLineTarget): () => void {
    this.targets.push(target);
    return () => {
      this.targets = this.targets.filter((t) => t !== target);
      if (this.lastTouched === target) this.lastTouched = null;
    };
  }

  /** The writer is in this composer — it receives the next line. */
  touch(target: FeedbackLineTarget): void {
    if (this.targets.includes(target)) this.lastTouched = target;
  }

  /**
   * Put `line` at the top of the composer the writer means. A closed (or
   * minimized) admin panel is asked to open — the capture works with the
   * panel shut — and with no composer mounted the line travels as a seed for
   * the admin new-topic box.
   */
  insert(line: string): void {
    const wasOpen = this.open();
    const target = this.lastTouched ?? this.targets[this.targets.length - 1] ?? null;
    if (target) {
      target.insertReferenceLine(line);
      if (!wasOpen) this.seeds.requestOpen();
      return;
    }
    const owner = this.owner();
    const panel = owner ? this._panels().get(owner) : undefined;
    this.seeds.plant(panel?.fallbackScope ?? draftScopes.adminNew, { body: line });
    this.seeds.requestOpen();
  }
}

/**
 * Put a reference line at the top of `text`. A line this composer inserted
 * before (`previous`) that is still the first line is REPLACED rather than
 * stacked — clicking a second spot corrects the reference, it does not
 * collect them. The caret keeps its place in the writer's own text; in an
 * empty box it lands on the line below the reference.
 */
export function withReferenceLine(
  text: string,
  line: string,
  previous: string | null,
  caret: number,
): { text: string; caret: number } {
  const newline = text.indexOf('\n');
  const first = newline === -1 ? text : text.slice(0, newline);
  const replacing = previous !== null && first === previous;
  const rest = replacing ? (newline === -1 ? '' : text.slice(newline + 1)) : text;
  if (!rest.trim()) return { text: `${line}\n`, caret: line.length + 1 };
  const removed = text.length - rest.length;
  const inRest = Math.max(0, Math.min(caret - removed, rest.length));
  return { text: `${line}\n${rest}`, caret: line.length + 1 + inRest };
}
