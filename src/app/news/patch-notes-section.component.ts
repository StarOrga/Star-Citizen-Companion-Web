import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { NewsService } from './news.service';
import {
  PATCH_FACETS,
  PatchFacet,
  PatchLineGroup,
  facetCounts,
  filterPatchLines,
  latestPerFacet,
} from './patch-notes';
import { PatchCadenceComponent } from './patch-cadence.component';
import { relativeTime } from './relative-time';

/** Add/remove one member of a multi-select filter set, returning a new set. */
function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * The patch-notes surface of Verse News (feedback 44e90e30 and its follow-up).
 *
 * Reading order top to bottom, which is the order the questions get asked:
 *   1. how is CIG doing right now  → the rotating cadence KPIs
 *   2. what is the newest thing    → one card per channel, at most one each
 *   3. what happened before        → the full history, grouped by patch line
 * with the two filters (version, channel) sitting between 2 and 3, because they
 * narrow the history — and, with it, the at-a-glance row, so the two can never
 * contradict each other.
 *
 * Its own component rather than more of `news-list`: the section owns four
 * pieces of state now, and its stylesheet was pushing the list component over
 * the per-component CSS budget.
 */
@Component({
  selector: 'sc-patch-notes-section',
  standalone: true,
  imports: [TranslateModule, PatchCadenceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="patch-notes" [attr.aria-label]="'news.patch.title' | translate">
      <div class="bucket-head">
        <h2>{{ 'news.patch.title' | translate }}</h2>
        <span class="bucket-ct">{{ svc.channelCount('patch') }}</span>
        <span class="rail-note">{{ 'news.patch.hint' | translate }}</span>
      </div>

      <!-- Patch performance, rotating. Always fed the FULL, unfiltered patch
           lines, never the filtered view: it answers "how is CIG doing", which a
           chip selection must not be able to rewrite. The panel owns its own
           six-months-vs-all-time window and derives its charts and forecast. -->
      <sc-patch-cadence [groups]="svc.patchLines()" />

      <!-- At a glance: the newest note per channel, at most one each. -->
      @if (highlights().length > 0) {
        <div class="patch-sub-head">
          <h3>{{ 'news.patch.latest.title' | translate }}</h3>
          <span class="rail-note">{{ 'news.patch.latest.hint' | translate }}</span>
        </div>
        <ul class="patch-latest">
          @for (h of highlights(); track h.facet) {
            <li>
              <!-- The notes live on RSI → real anchor, new tab. -->
              <a class="latest-card" [href]="h.entry.item.url" target="_blank" rel="noopener noreferrer">
                <span class="latest-top">
                  <span class="tag" [attr.data-stage]="h.facet">{{ ('news.patch.facet.' + h.facet) | translate }}</span>
                  @if (h.entry.version) {
                    <span class="tag ver">{{ h.entry.version }}</span>
                  }
                </span>
                <span class="latest-title">{{ h.entry.item.title }}</span>
                <time class="rail-note">{{ relTime(h.entry.item.publishedAt) }}</time>
              </a>
            </li>
          }
        </ul>
      }

      <!-- Two filter axes, both multi-select, both "empty = Alle" — the same chip
           grammar as the channel bar at the top of the page, because inventing a
           second filter idiom on one page teaches the reader nothing. -->
      <div class="patch-filter" role="group" [attr.aria-label]="'news.patch.filter.versionAria' | translate">
        <span class="pf-label">{{ 'news.patch.filter.version' | translate }}</span>
        <button class="chip" type="button"
                [class.active]="lineFilter().size === 0"
                [attr.aria-pressed]="lineFilter().size === 0"
                (click)="clearLines()">{{ 'news.patch.filter.all' | translate }}</button>
        @for (opt of lineOptions(); track opt.line) {
          <button class="chip" type="button"
                  [class.active]="lineFilter().has(opt.line)"
                  [attr.aria-pressed]="lineFilter().has(opt.line)"
                  (click)="toggleLineFilter(opt.line)">
            <span>{{
              opt.line
                ? ('news.patch.line' | translate:{ version: opt.line })
                : ('news.patch.otherLine' | translate)
            }}</span>
            <span class="ct">{{ opt.count }}</span>
          </button>
        }
      </div>
      <div class="patch-filter" role="group" [attr.aria-label]="'news.patch.filter.channelAria' | translate">
        <span class="pf-label">{{ 'news.patch.filter.channel' | translate }}</span>
        <button class="chip" type="button"
                [class.active]="facetFilter().size === 0"
                [attr.aria-pressed]="facetFilter().size === 0"
                (click)="clearFacets()">{{ 'news.patch.filter.all' | translate }}</button>
        @for (opt of facetOptions(); track opt.facet) {
          <button class="chip" type="button"
                  [class.active]="facetFilter().has(opt.facet)"
                  [attr.aria-pressed]="facetFilter().has(opt.facet)"
                  [attr.data-stage]="opt.facet"
                  (click)="toggleFacetFilter(opt.facet)">
            <span>{{ ('news.patch.facet.' + opt.facet) | translate }}</span>
            <span class="ct">{{ opt.count }}</span>
          </button>
        }
      </div>

      <div class="patch-sub-head">
        <h3>{{ 'news.patch.history.title' | translate }}</h3>
        <span class="bucket-ct">{{ filteredCount() }}</span>
      </div>

      @if (groups().length === 0) {
        <p class="patch-empty">
          <span>{{ 'news.patch.filter.empty' | translate }}</span>
          <button type="button" class="reset" (click)="resetFilter()">
            {{ 'news.patch.filter.reset' | translate }}
          </button>
        </p>
      } @else {
        <ol class="patch-lines">
          @for (group of groups(); track group.line) {
            <li class="patch-line" [class.open]="isLineOpen(group)">
              <!-- Expand/collapse is an action, not a navigation → button. -->
              <button type="button" class="line-head"
                      [attr.aria-expanded]="isLineOpen(group)"
                      (click)="toggleLine(group)">
                <span class="caret" aria-hidden="true">›</span>
                <span class="line-name">{{
                  group.line
                    ? ('news.patch.line' | translate:{ version: group.line })
                    : ('news.patch.otherLine' | translate)
                }}</span>
                <!-- Only the newest line that reached LIVE — that is the build
                     you can play right now. -->
                @if (group.isCurrentLive) {
                  <span class="tag" data-stage="live">{{ 'news.patch.current' | translate }}</span>
                }
                <span class="bucket-ct">{{ group.entries.length }}</span>
                <time class="rail-note">{{ relTime(group.latestAt) }}</time>
              </button>
              @if (isLineOpen(group)) {
                <ul class="patch-entries">
                  @for (entry of group.entries; track entry.item.id) {
                    <li class="patch-entry">
                      <!-- Real anchor: the notes live on RSI, so middle click and
                           "open in new tab" must just work. -->
                      <a class="entry-link" [href]="entry.item.url"
                         target="_blank" rel="noopener noreferrer">
                        <span class="entry-title">{{ entry.item.title }}</span>
                        <span class="entry-meta">
                          @if (entry.version) {
                            <span class="tag ver">{{ entry.version }}</span>
                          }
                          @if (entry.stage) {
                            <span class="tag" [attr.data-stage]="entry.stage">{{ ('news.patch.stage.' + entry.stage) | translate }}</span>
                          }
                          @if (entry.hotfix) {
                            <span class="tag hotfix">{{ 'news.patch.hotfix' | translate }}</span>
                          }
                          <time>{{ relTime(entry.item.publishedAt) }}</time>
                        </span>
                      </a>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* Same band chrome as the video rail above it (both are full-width sections
       inside the stream card), repeated here because view encapsulation keeps
       the list component's copy to itself. */
    .patch-notes {
      display: flex; flex-direction: column; gap: 10px;
      padding: 14px 16px;
      border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent);
    }
    .bucket-head { display: flex; align-items: baseline; gap: 12px; }
    .bucket-head h2 {
      margin: 0; font-size: 0.82rem; letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-accent);
    }
    .bucket-ct {
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      padding: 1px 8px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }
    .rail-note { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); margin-left: auto; }

    /* ---------- Filters ---------- */
    .patch-filter { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .pf-label {
      font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sc-fg-2);
    }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 999px; min-height: var(--sc-tap-min);
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: inherit; font-size: max(0.78rem, var(--sc-fs-floor));
      cursor: pointer; transition: all 0.16s;
    }
    .chip:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .chip.active {
      background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      border-color: var(--sc-accent); color: var(--sc-fg-0); font-weight: 600;
    }
    .chip .ct {
      font-size: max(0.68rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px;
      background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2);
    }
    .chip.active .ct { background: color-mix(in srgb, var(--sc-accent) 25%, transparent); color: var(--sc-bg-0); }
    /* An active channel chip carries that ring's colour, so filter and tags
       speak the same language. */
    .chip[data-stage='live'].active { border-color: var(--sc-success); background: color-mix(in srgb, var(--sc-success) 16%, transparent); }
    .chip[data-stage='hotfix'].active { border-color: var(--sc-warning); background: color-mix(in srgb, var(--sc-warning) 16%, transparent); }

    .patch-empty {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
      margin: 0; padding: 10px 2px; color: var(--sc-fg-2);
      font-size: max(0.78rem, var(--sc-fs-floor));
    }
    .reset {
      padding: 4px 10px; min-height: var(--sc-tap-min);
      background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); border-radius: 6px;
      font-family: inherit; font-size: max(0.74rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .reset:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    /* ---------- "Newest per channel" ----------
       A compact grid, not the article tiles: these are one-line facts
       ("4.10 PTU, 2 days ago"), not stories with artwork. */
    .patch-sub-head { display: flex; align-items: baseline; gap: 10px; }
    .patch-sub-head h3 {
      margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-fg-1);
    }
    .patch-latest {
      list-style: none; margin: 0; padding: 0;
      display: grid; gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr));
    }
    .latest-card {
      display: flex; flex-direction: column; gap: 5px; height: 100%;
      min-height: var(--sc-tap-min); padding: 9px 11px; border-radius: 8px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: inherit; text-decoration: none;
      transition: border-color .15s ease, background .15s ease;
    }
    .latest-card:hover { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .latest-card:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }
    .latest-top { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
    .latest-title {
      font-size: 0.84rem; line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .latest-card .rail-note { margin-left: 0; margin-top: auto; }

    /* ---------- History, grouped by patch line (44e90e30) ----------
       Deliberately a list, not a card grid: these entries have no artwork and no
       teaser text, and what the reader scans for is "which line, which ring, how
       recent" — three short facts per row. */
    .patch-lines, .patch-entries { list-style: none; margin: 0; padding: 0; }
    .patch-lines { display: flex; flex-direction: column; gap: 8px; }
    .patch-line {
      border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-1); overflow: hidden;
    }
    .patch-line.open { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
    .line-head, .entry-link { min-height: var(--sc-tap-min); text-align: left; }
    .line-head:focus-visible, .entry-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }
    .line-head {
      display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px;
      background: transparent; border: 0; color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.9rem; cursor: pointer;
    }
    .line-head:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .caret { display: inline-flex; width: 12px; justify-content: center; color: var(--sc-accent); }
    .patch-line.open .caret { transform: rotate(90deg); }
    .line-name { font-family: var(--sc-font-display); letter-spacing: 0.04em; }

    .patch-entries { border-top: 1px dashed color-mix(in srgb, var(--sc-border) 70%, transparent); }
    .patch-entry + .patch-entry { border-top: 1px solid color-mix(in srgb, var(--sc-border) 40%, transparent); }
    .entry-link {
      display: flex; flex-direction: column; gap: 4px;
      padding: 9px 12px 9px 34px; color: inherit; text-decoration: none;
    }
    .entry-link:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .entry-title { font-size: 0.86rem; line-height: 1.35; }
    .entry-meta {
      display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    /* An Evocati tag needs no colour of its own: the muted default is exactly
       right for the ring nobody here can open. */
    .tag {
      display: inline-flex; align-items: center;
      padding: 1px 7px; border-radius: 999px;
      font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 700;
      letter-spacing: 0.07em; text-transform: uppercase;
      color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 45%, transparent);
    }
    .tag.ver { color: var(--sc-fg-1); text-transform: none; }
    /* LIVE = what you can play right now, PTU = test build. */
    .tag[data-stage='live'] { color: var(--sc-success); border-color: color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .tag[data-stage='ptu'] { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .tag.hotfix, .tag[data-stage='hotfix'] { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }
  `],
})
export class PatchNotesSectionComponent implements OnDestroy {
  readonly svc = inject(NewsService);
  private readonly t = inject(TranslateService);

  // ── Filters (44e90e30 follow-up) ─────────────────────────────────────────
  // Two independent axes: which patch LINE (4.10, 4.9 …) and which CHANNEL
  // (Live, Hotfix, PTU, Evocati). Empty set = no restriction, i.e. "Alle".
  //
  // Deliberately NOT persisted: the channel bar at the top of the page is how
  // you set the page up, this is how you dig through one section. Returning to
  // /news to find the patch history silently narrowed to "Evocati only" from
  // last week would look like missing data, not like a saved preference.
  readonly lineFilter = signal<ReadonlySet<string>>(new Set());
  readonly facetFilter = signal<ReadonlySet<PatchFacet>>(new Set());

  /** The history, narrowed to the current selection. */
  readonly groups = computed(() =>
    filterPatchLines(this.svc.patchLines(), { lines: this.lineFilter(), facets: this.facetFilter() }),
  );
  readonly filteredCount = computed(() =>
    this.groups().reduce((n, g) => n + g.entries.length, 0),
  );

  /**
   * "At a glance": newest note per channel, at most one each. Derived from the
   * FILTERED set, so narrowing to 4.9 shows 4.9's newest Live/PTU/Hotfix instead
   * of a header that ignores the filter right above a list that obeys it.
   */
  readonly highlights = computed(() => latestPerFacet(this.groups()));

  // Chip options come from the UNFILTERED groups: a chip that disappears the
  // moment you press it leaves no way back except "Alle".
  readonly lineOptions = computed(() =>
    this.svc.patchLines().map((g) => ({ line: g.line, count: g.entries.length })),
  );
  readonly facetOptions = computed(() => {
    const counts = facetCounts(this.svc.patchLines());
    return PATCH_FACETS
      .filter((f) => (counts.get(f) ?? 0) > 0)
      .map((facet) => ({ facet, count: counts.get(facet) ?? 0 }));
  });

  // Only the lines the user explicitly toggled are recorded. Everything else
  // follows the default "newest line open", which is what keeps 4.10 expanded on
  // the day it replaces 4.9 as the newest line — no state to migrate.
  private readonly lineOverride = signal<ReadonlyMap<string, boolean>>(new Map());

  // Ticking clock so the relative timestamps stay live between feed refreshes.
  private readonly now = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);

  // Any filter change — the page's channel bar (1bc19cdc) or one of the two
  // filters here — is a new view of the section, so the manually
  // collapsed/expanded lines of the previous view go and the "newest line open"
  // default applies to whatever is left.
  private readonly resetFolds = effect(() => {
    this.lineFilter();
    this.facetFilter();
    this.svc.activeChannels();
    this.svc.favoritesOnly();
    untracked(() => {
      if (this.lineOverride().size > 0) this.lineOverride.set(new Map());
    });
  });

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
  }

  isLineOpen(group: PatchLineGroup): boolean {
    const explicit = this.lineOverride().get(group.line);
    if (explicit !== undefined) return explicit;
    // Newest line of the CURRENT view: filtering down to 4.8 must open 4.8, not
    // leave the reader with one collapsed row and nothing on screen.
    return group.line === this.groups()[0]?.line;
  }

  toggleLine(group: PatchLineGroup): void {
    const next = new Map(this.lineOverride());
    next.set(group.line, !this.isLineOpen(group));
    this.lineOverride.set(next);
  }

  toggleLineFilter(line: string): void {
    this.lineFilter.set(toggled(this.lineFilter(), line));
  }
  toggleFacetFilter(facet: PatchFacet): void {
    this.facetFilter.set(toggled(this.facetFilter(), facet));
  }
  clearLines(): void { this.lineFilter.set(new Set()); }
  clearFacets(): void { this.facetFilter.set(new Set()); }
  resetFilter(): void {
    this.clearLines();
    this.clearFacets();
  }

  relTime(iso: string): string {
    return relativeTime(iso, this.now(), (k, p) => this.t.instant(k, p));
  }
}
