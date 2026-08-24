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
  PatchNoteEntry,
  PatchWaveGroup,
  facetCounts,
  filterPatchLines,
  filterPatchLinesByQuery,
  groupWaves,
  latestPerFacet,
} from './patch-notes';
import { PatchCadenceComponent } from './patch-cadence.component';
import { PatchRoadmapBandComponent } from './patch-roadmap-band.component';
import { PatchEntryRowComponent } from './patch-entry-row.component';
import { RoadmapService, threadSlugOf } from './roadmap.service';
import { outlineHaystack } from './patch-outline';
import { matchesTokens, tokenizeQuery } from './patch-search';
import { relativeTime } from './relative-time';

/** Add/remove one member of a multi-select filter set, returning a new set. */
function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/**
 * The patch-notes surface (feedback 44e90e30, its follow-up, and 961ab0a5).
 *
 * Reading order top to bottom, which is the order the questions get asked:
 *   0. find one specific thing     → the search box, which narrows EVERYTHING
 *   1. what is in the patch I play,
 *      and in the next one         → the roadmap band (RSI Release View)
 *   2. how is CIG doing right now  → the rotating cadence KPIs
 *   3. what is the newest thing    → one card per channel, at most one each
 *   4. what happened before        → the full history, grouped by patch line,
 *                                    every note expandable to its bullet points
 * with the two chip filters (version, channel) sitting between 3 and 4, because
 * they narrow the history — and, with it, the at-a-glance row, so the two can
 * never contradict each other.
 *
 * 961ab0a5 added the two ends of that list. The board used to be able to say
 * that 4.9 shipped and that 4.10 is in PTU, and nothing at all about what
 * either of them contains — every note was a title and a link off to Spectrum.
 * Now the roadmap says what is planned and an expanded row says what actually
 * shipped, and one query box searches across both.
 *
 * THREE FILTER AXES, ONE MEANING EACH. The version chips ask "which patch
 * line", the channel chips ask "which ring", the query asks "where is the thing
 * I remember reading". They compose, and each can be dropped on its own — which
 * is why the query is a separate pass over the already-chip-filtered groups
 * rather than another term folded into `PatchFilter`.
 *
 * WHAT THE SEARCH CAN SEE. Titles, always — they arrive with the feed. Bullet
 * points, for the notes whose contents have been loaded: the newest note per
 * channel is seeded on arrival and any note is loaded the moment it is
 * expanded. That asymmetry is stated in the UI rather than hidden, because the
 * alternative is fetching a hundred Spectrum threads to open a page.
 *
 * Its own component rather than more of `news-list`: the section owns six
 * pieces of state now, and its stylesheet was pushing the list component over
 * the per-component CSS budget.
 */
@Component({
  selector: 'sc-patch-notes-section',
  standalone: true,
  imports: [
    TranslateModule,
    PatchCadenceComponent,
    PatchRoadmapBandComponent,
    PatchEntryRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="patch-notes" [attr.aria-label]="'news.patch.title' | translate">
      <div class="bucket-head">
        <h2>{{ 'news.patch.title' | translate }}</h2>
        <span class="bucket-ct">{{ svc.patchCount() }}</span>
        <span class="rail-note">{{ 'news.patch.hint' | translate }}</span>
      </div>

      <!-- One query box for the whole page: it narrows the roadmap band, the
           at-a-glance row and the history alike, and marks its hits inside an
           expanded note. A label, not a placeholder — a placeholder disappears
           the moment you type, taking the only description of the field with
           it. Escape clears, which is what every reader tries first. -->
      <div class="patch-search">
        <label class="ps-label" for="patch-search-input">
          {{ 'news.patch.search.label' | translate }}
        </label>
        <div class="ps-field">
          <input id="patch-search-input" type="search" class="ps-input"
                 autocomplete="off" spellcheck="false"
                 [attr.placeholder]="'news.patch.search.placeholder' | translate"
                 [value]="query()"
                 (input)="onQuery($event)"
                 (keydown.escape)="clearQuery()" />
          @if (query()) {
            <button type="button" class="ps-clear"
                    [attr.aria-label]="'news.patch.search.clear' | translate"
                    (click)="clearQuery()">×</button>
          }
        </div>
        @if (tokens().length > 0) {
          <p class="ps-summary" role="status">
            {{ 'news.patch.search.summary' | translate:{ notes: filteredCount(), lines: groups().length } }}
            <span class="ps-scope">{{ 'news.patch.search.scope' | translate:{ loaded: roadmap.loadedOutlineCount() } }}</span>
          </p>
        }
      </div>

      <!-- What RSI says is IN the current and the next patch. Hides itself when
           the roadmap cannot be reached — see PatchRoadmapBandComponent. -->
      <sc-patch-roadmap-band [tokens]="tokens()" (showLine)="focusLine($event)" />

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
        <!-- The collapsed/expanded switch for the notes themselves. Separate
             from the per-line folds above it: a line groups notes, this opens
             their contents, and conflating the two would make "alles
             ausklappen" mean two different things depending on where you are. -->
        <button type="button" class="expand-all"
                [class.active]="expandAll()"
                [attr.aria-pressed]="expandAll()"
                (click)="toggleExpandAll()">
          {{ (expandAll() ? 'news.patch.detail.collapseAll' : 'news.patch.detail.expandAll') | translate }}
        </button>
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
                  @for (wave of wavesOf(group); track wave.key) {
                    @if (wave.folded) {
                      <!-- One announcement, many build waves. RSI publishes a
                           note per internal wave, so this used to render as up
                           to twenty near-identical rows — measured at 1,215 px
                           for the open 4.10 line alone. Native <details>: the
                           run costs one row until someone wants all of it, and
                           it keeps keyboard + find-in-page behaviour for free.
                           Force-opened while a query is active, because a
                           collapsed run would hide the very hit it contains. -->
                      <li class="patch-entry wave">
                        <details [open]="tokens().length > 0">
                          <summary>
                            <span class="entry-title">
                              {{ 'news.patch.waves.title' | translate:{ count: wave.entries.length } }}
                            </span>
                            <span class="entry-meta">
                              @if (wave.version) {
                                <span class="tag ver">{{ wave.version }}</span>
                              }
                              <span class="tag" [attr.data-stage]="wave.facet">{{ ('news.patch.facet.' + wave.facet) | translate }}</span>
                              <time>{{ relTime(wave.entries[0].item.publishedAt) }}</time>
                            </span>
                          </summary>
                          <ul class="wave-entries">
                            @for (entry of wave.entries; track entry.item.id) {
                              <li>
                                <sc-patch-entry-row
                                  [entry]="entry"
                                  [when]="relTime(entry.item.publishedAt)"
                                  [tokens]="tokens()"
                                  [open]="isEntryOpen(entry)"
                                  [compact]="true"
                                  (toggled)="toggleEntry($event)" />
                              </li>
                            }
                          </ul>
                        </details>
                      </li>
                    } @else {
                      @for (entry of wave.entries; track entry.item.id) {
                        <li class="patch-entry">
                          <sc-patch-entry-row
                            [entry]="entry"
                            [when]="relTime(entry.item.publishedAt)"
                            [tokens]="tokens()"
                            [open]="isEntryOpen(entry)"
                            (toggled)="toggleEntry($event)" />
                        </li>
                      }
                    }
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

    /* ---------- Search (961ab0a5) ----------
       Full width and above everything it filters, so its scope reads as "this
       page" rather than "the list underneath". */
    .patch-search { display: flex; flex-direction: column; gap: 5px; }
    .ps-label {
      font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sc-fg-2);
    }
    .ps-field { position: relative; display: flex; }
    .ps-input {
      flex: 1 1 auto; min-width: 0; min-height: var(--sc-tap-min);
      padding: 8px 40px 8px 12px; border-radius: 8px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-0); font-family: inherit;
      font-size: max(0.86rem, var(--sc-fs-floor));
    }
    .ps-input::placeholder { color: var(--sc-fg-2); }
    .ps-input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    /* The UA's own clear affordance would sit under ours on WebKit. */
    .ps-input::-webkit-search-cancel-button { display: none; }
    .ps-clear {
      position: absolute; right: 2px; top: 50%; transform: translateY(-50%);
      display: inline-flex; align-items: center; justify-content: center;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      background: transparent; border: 0; color: var(--sc-fg-2);
      font-size: 1.25rem; line-height: 1; cursor: pointer;
    }
    .ps-clear:hover { color: var(--sc-accent); }
    .ps-clear:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -4px; border-radius: 6px; }
    .ps-summary {
      display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0;
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .ps-scope { color: color-mix(in srgb, var(--sc-fg-2) 80%, transparent); }

    .expand-all {
      margin-left: auto; padding: 5px 11px; min-height: var(--sc-tap-min);
      background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); border-radius: 999px;
      font-family: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .expand-all:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .expand-all:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .expand-all.active {
      background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      border-color: var(--sc-accent); color: var(--sc-fg-0);
    }

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
    .line-head { min-height: var(--sc-tap-min); text-align: left; }
    .line-head:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }
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

    /* ---------- Folded build waves ----------
       One announcement published as a run of near-identical build notes. The
       summary row is the fold; expanding it lists the individual builds with
       nothing but their timestamp, because the title is what they all share. */
    .patch-entry.wave > details > summary {
      display: flex; flex-direction: column; gap: 4px;
      padding: 9px 12px 9px 34px; cursor: pointer;
      min-height: var(--sc-tap-min); list-style: none;
      color: var(--sc-fg-1);
    }
    .patch-entry.wave > details > summary::-webkit-details-marker { display: none; }
    .patch-entry.wave > details > summary::before {
      content: '▸'; position: absolute; margin-left: -16px;
      color: var(--sc-fg-2); transition: transform 0.16s ease;
    }
    .patch-entry.wave > details[open] > summary::before { content: '▾'; }
    .patch-entry.wave > details > summary:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .patch-entry.wave > details > summary:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }
    .wave-entries { list-style: none; margin: 0; padding: 0 0 4px; }
    .wave-entries sc-patch-entry-row { padding-left: 18px; display: block; }
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
  readonly roadmap = inject(RoadmapService);
  private readonly t = inject(TranslateService);

  // ── Free-text search (961ab0a5) ──────────────────────────────────────────
  /** Raw query as typed; `tokens()` is the normalized form everything uses. */
  readonly query = signal('');
  readonly tokens = computed(() => tokenizeQuery(this.query()));

  /** Notes the reader has opened, by feed-item id. */
  private readonly entryOverride = signal<ReadonlyMap<string, boolean>>(new Map());
  /** The "open every note" switch; per-note overrides sit on top of it. */
  readonly expandAll = signal(false);

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

  /**
   * The history, narrowed to the current selection: chips first, then the
   * query. Two passes rather than one combined predicate, so a reader can
   * clear either axis and get exactly the other one back.
   */
  readonly groups = computed(() => {
    const chipped = filterPatchLines(
      this.svc.patchLines(),
      { lines: this.lineFilter(), facets: this.facetFilter() },
    );
    return filterPatchLinesByQuery(chipped, this.tokens(), (e) => this.haystackOf(e), matchesTokens);
  });
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

  // Any filter change here is a new view of the section, so the manually
  // collapsed/expanded lines of the previous view go and the "newest line open"
  // default applies to whatever is left. (It used to also watch the page's
  // channel bar; that bar went with the 2026-08-20 rethink, and this section
  // now owns a page of its own.)
  private readonly resetFolds = effect(() => {
    this.lineFilter();
    this.facetFilter();
    untracked(() => {
      if (this.lineOverride().size > 0) this.lineOverride.set(new Map());
    });
  });

  /**
   * Pull the RSI roadmap once the section exists. Not in the board component:
   * this section is what renders the band, and the service coalesces concurrent
   * callers, so the request belongs to the thing that needs it.
   */
  private readonly loadRoadmapOnce = effect(() => {
    void this.roadmap.loadRoadmap();
  });

  /**
   * Seed the contents of the notes a reader is most likely to search for: the
   * newest one per channel — the same handful the "Neueste je Kanal" row shows.
   *
   * The alternative was fetching all hundred-odd notes to open the page, or
   * shipping a search that finds nothing until something is expanded. Five
   * cached outlines cost one request and a few kilobytes, and they cover the
   * LIVE notes and the current PTU wave, which is what "search the patch notes"
   * means in practice. The count of loaded notes is shown next to the box, so
   * the boundary is stated rather than implied.
   */
  private readonly seedNewestOutlines = effect(() => {
    const slugs = latestPerFacet(this.svc.patchLines())
      .map((h) => threadSlugOf(h.entry.item.url))
      .filter(Boolean);
    if (slugs.length > 0) untracked(() => this.roadmap.requestOutlines(slugs));
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
    // The empty-state button says "reset the filter"; leaving the query in
    // place would keep the list empty and make the button look broken.
    this.clearQuery();
  }

  /**
   * Fold a line's notes into wave groups. Cheap enough to call from the
   * template: a line holds tens of entries, and it only runs for the lines the
   * reader actually expanded.
   */
  wavesOf(group: PatchLineGroup): PatchWaveGroup[] {
    return groupWaves(group.entries);
  }

  relTime(iso: string): string {
    return relativeTime(iso, this.now(), (k, p) => this.t.instant(k, p));
  }

  // ── Search ────────────────────────────────────────────────────────────────

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  clearQuery(): void {
    this.query.set('');
  }

  /**
   * Everything one note can be found by: its title always, plus its bullet
   * points once they are loaded.
   *
   * Title-only for an unloaded note is a deliberate floor, not a gap — it means
   * a note is never invisible to the search, and the count of notes whose
   * contents ARE searchable is stated next to the box rather than left for the
   * reader to guess.
   */
  private haystackOf(entry: PatchNoteEntry): string {
    const outline = this.roadmap.outlineFor(threadSlugOf(entry.item.url));
    return outline ? `${entry.item.title}
${outlineHaystack(outline)}` : entry.item.title;
  }

  // ── Expanded notes ───────────────────────────────────────────────────────

  isEntryOpen(entry: PatchNoteEntry): boolean {
    return this.entryOverride().get(entry.item.id) ?? this.expandAll();
  }

  toggleEntry(id: string): void {
    const next = new Map(this.entryOverride());
    const current = next.get(id) ?? this.expandAll();
    next.set(id, !current);
    this.entryOverride.set(next);
  }

  /**
   * Open or close every note at once.
   *
   * Per-note overrides are dropped, deliberately: "alles ausklappen" that
   * leaves three notes closed because they were toggled earlier does not do
   * what it says. Expanding all is bounded by what is on screen — the chip
   * filters and the query decide how many notes that is — and each newly
   * visible note requests its own contents, which the service batches.
   */
  toggleExpandAll(): void {
    this.expandAll.update((v) => !v);
    this.entryOverride.set(new Map());
  }

  /**
   * "Show me the patch notes for this line", from the roadmap band.
   *
   * Sets the version chip rather than scrolling somewhere: the chips ARE the
   * page's idea of "show me this line", and reusing them means the reader can
   * see what happened and undo it with the same control they would have used
   * themselves.
   */
  focusLine(line: string): void {
    this.lineFilter.set(new Set([line]));
    this.facetFilter.set(new Set());
  }
}
