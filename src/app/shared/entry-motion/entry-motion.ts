import { Directive, Injectable, OnInit, inject, input } from '@angular/core';
import { preferenceStorage } from '../../core/consent.service';

/**
 * How a page builds itself up (concept nachschub-hq, r4 screen note s9h: "cinematic on the first open, after that
 * animated too, but in a faster time").
 *  - `cine`  the first open of a page kind: slow, staggered, the focus order readable
 *  - `quick` every later open: the same order, a third of the time
 *  - `still` reduced motion: one short fade, no travel, no stagger
 */
export type EntryTempo = 'cine' | 'quick' | 'still';

const SEEN_KEY = 'sc.entry.seen';

/** Which page kinds were opened before: in memory always, in the browser when the preferences consent allows it. */
@Injectable({ providedIn: 'root' })
export class EntryMotionService {
  private readonly seen = new Set<string>(read());

  /** The tempo of this open of `key`; it marks the key as seen, so the next open is `quick`. */
  tempoFor(key: string): EntryTempo {
    if (reducedMotion()) return 'still';
    const first = !this.seen.has(key);
    if (first) {
      this.seen.add(key);
      write(this.seen);
    }
    return first ? 'cine' : 'quick';
  }
}

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function read(): string[] {
  try {
    const raw = preferenceStorage()?.getItem(SEEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function write(seen: ReadonlySet<string>): void {
  try {
    preferenceStorage()?.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch {
    /* quota / private mode */
  }
}

/**
 * `[scEntry]="'codex-detail'"` on a page root: sets `data-entry` to the tempo of this open. Children opt in with the
 * class `ce` and their place in the focus order as `--ce` (0 = what the eye lands on first, then 1, 2 ...); the CSS lives in
 * the block "CINEMATIC ENTRY" of styles.scss.
 */
@Directive({
  selector: '[scEntry]',
  standalone: true,
  host: { '[attr.data-entry]': 'tempo' },
})
export class ScEntryDirective implements OnInit {
  readonly scEntry = input.required<string>();
  protected tempo: EntryTempo = 'quick';
  private readonly motion = inject(EntryMotionService);

  ngOnInit(): void {
    this.tempo = this.motion.tempoFor(this.scEntry());
  }
}
