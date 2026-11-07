import { Injectable, signal } from '@angular/core';

/** The newest patch's most important hit on the reader's ships and sets: the Start hero shows it. */
export interface HqPatchHit {
  /** The reader's set it touches, the hero's eyebrow. */
  plan: string | null;
  build: string | null;
  /** What changed, readable. */
  name: string;
  /** Size of the change in percent, always positive. */
  pct: number;
  weaker: boolean;
  /** The set it touches; rendered as a real anchor. */
  link?: string[];
  /** Query of the link (a ship variant opens with `?v=`). */
  linkQuery?: Record<string, string>;
}

/**
 * What the patch package feeds into the Start page: `patchHit` is null while the newest patch does
 * not touch the reader's ships or sets, and the hero then shows its plain title.
 */
@Injectable({ providedIn: 'root' })
export class HqStartFeedService {
  readonly patchHit = signal<HqPatchHit | null>(null);
}
