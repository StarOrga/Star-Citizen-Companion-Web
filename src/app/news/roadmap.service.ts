import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { RoadmapPayload, hasRoadmapContent } from './roadmap';
import { PatchOutline } from './patch-outline';

interface RoadmapResponse {
  roadmap: RoadmapPayload | null;
  outlines: PatchOutline[];
  error?: string;
}

/**
 * How many slugs one request may carry. Mirrors MAX_NOTES_PER_REQUEST in the
 * edge function — asking for more would silently drop the tail, and the client
 * would keep re-requesting notes it is never sent.
 */
const MAX_NOTES_PER_REQUEST = 12;

/** `…/forum/190048/thread/<slug>` → `<slug>`; '' when the url is not a thread. */
export function threadSlugOf(url: string): string {
  const m = /\/thread\/([a-z0-9-]{1,160})(?:[/?#]|$)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

/**
 * The patch board's RSI depth: the roadmap for the current and the next patch,
 * and the contents of individual patch notes (feedback 961ab0a5).
 *
 * Both come from the `rsi-roadmap` edge function — the client never calls RSI,
 * and no key ever reaches the bundle. See the function header for the sources.
 *
 * Two very different loading shapes live here on purpose:
 *
 *  - the ROADMAP is one document fetched once per visit;
 *  - an OUTLINE is fetched per note, on demand, because there are a hundred-odd
 *    notes in the history and nobody reads a hundred. Requesting them lazily is
 *    what keeps opening the board cheap; the trade is that a search can only
 *    see the bullet points of notes that have been loaded, which is why the
 *    board seeds the ones a reader is most likely to want (the newest per
 *    channel) up front and reports the distinction in the UI.
 *
 * Failures are quiet by design. `unavailable` flips and the roadmap band
 * removes itself; there is no error card, because "RSI's roadmap API is down"
 * is not something a reader of the patch board can act on.
 */
@Injectable({ providedIn: 'root' })
export class RoadmapService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/rsi-roadmap`;

  readonly roadmap = signal<RoadmapPayload | null>(null);
  readonly loading = signal(false);
  /** The roadmap could not be loaded (or holds nothing) → hide the band. */
  readonly unavailable = signal(false);

  /** Loaded outlines, keyed by RSI thread slug. */
  readonly outlines = signal<ReadonlyMap<string, PatchOutline>>(new Map());
  /** Slugs currently in flight — drives the per-row "loading" state. */
  readonly pending = signal<ReadonlySet<string>>(new Set());
  /**
   * Slugs the server had nothing for. Remembered so a note whose thread was
   * deleted or reshaped is not re-requested on every render — an unbounded
   * retry loop is the one failure mode a lazy loader must not have.
   */
  private readonly missing = signal<ReadonlySet<string>>(new Set());

  readonly hasRoadmap = computed(() => hasRoadmapContent(this.roadmap()));
  /** How many notes' contents the client currently holds — shown next to the search. */
  readonly loadedOutlineCount = computed(() => this.outlines().size);

  private roadmapInFlight: Promise<void> | null = null;

  /** Load the roadmap once. Concurrent callers share the one request. */
  loadRoadmap(): Promise<void> {
    if (this.roadmap() || this.unavailable()) return Promise.resolve();
    if (this.roadmapInFlight) return this.roadmapInFlight;
    const run = this.fetchRoadmap();
    this.roadmapInFlight = run;
    return run.finally(() => {
      if (this.roadmapInFlight === run) this.roadmapInFlight = null;
    });
  }

  private async fetchRoadmap(): Promise<void> {
    this.loading.set(true);
    try {
      const res = await firstValueFrom(this.http.get<RoadmapResponse>(this.endpoint));
      const payload = res?.roadmap ?? null;
      this.roadmap.set(payload);
      this.unavailable.set(!hasRoadmapContent(payload));
    } catch {
      this.unavailable.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  hasOutline(slug: string): boolean {
    return this.outlines().has(slug);
  }

  outlineFor(slug: string): PatchOutline | null {
    return this.outlines().get(slug) ?? null;
  }

  isPending(slug: string): boolean {
    return this.pending().has(slug);
  }

  /** True once we know the server has nothing for this note. */
  isMissing(slug: string): boolean {
    return this.missing().has(slug);
  }

  /**
   * Make sure the contents of these notes are loaded.
   *
   * Fire-and-forget: callers are templates and effects, and there is nothing to
   * await — the signals update when the answer lands. Already-loaded, in-flight
   * and known-missing slugs are filtered out first, so calling this on every
   * change detection pass is safe and costs one Set lookup per slug.
   */
  requestOutlines(slugs: readonly string[]): void {
    const loaded = this.outlines();
    const pending = this.pending();
    const missing = this.missing();
    const wanted: string[] = [];
    for (const slug of slugs) {
      if (!slug || loaded.has(slug) || pending.has(slug) || missing.has(slug)) continue;
      if (!wanted.includes(slug)) wanted.push(slug);
    }
    if (wanted.length === 0) return;

    for (let i = 0; i < wanted.length; i += MAX_NOTES_PER_REQUEST) {
      void this.fetchOutlines(wanted.slice(i, i + MAX_NOTES_PER_REQUEST));
    }
  }

  private async fetchOutlines(slugs: string[]): Promise<void> {
    this.pending.update((set) => {
      const next = new Set(set);
      for (const s of slugs) next.add(s);
      return next;
    });
    try {
      const url = `${this.endpoint}?notes=${encodeURIComponent(slugs.join(','))}`;
      const res = await firstValueFrom(this.http.get<RoadmapResponse>(url));
      const received = res?.outlines ?? [];
      if (received.length > 0) {
        this.outlines.update((map) => {
          const next = new Map(map);
          for (const outline of received) if (outline?.slug) next.set(outline.slug, outline);
          return next;
        });
      }
      // Anything asked for and not returned does not exist as far as we care.
      const got = new Set(received.map((o) => o?.slug));
      const absent = slugs.filter((s) => !got.has(s));
      if (absent.length > 0) {
        this.missing.update((set) => {
          const next = new Set(set);
          for (const s of absent) next.add(s);
          return next;
        });
      }
    } catch {
      // A transport error is not a verdict about the notes — mark them missing
      // for THIS visit so the row stops spinning, but do not cache it further.
      this.missing.update((set) => {
        const next = new Set(set);
        for (const s of slugs) next.add(s);
        return next;
      });
    } finally {
      this.pending.update((set) => {
        const next = new Set(set);
        for (const s of slugs) next.delete(s);
        return next;
      });
    }
  }
}
