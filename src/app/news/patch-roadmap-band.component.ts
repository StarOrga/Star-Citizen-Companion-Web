import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RoadmapService } from './roadmap.service';
import {
  RoadmapCategoryGroup,
  RoadmapRelease,
  groupCardsByCategory,
} from './roadmap';
import { HighlightSegment, matchesTokens } from './patch-search';
import { highlightSegments } from './patch-search';

/** Which patch a panel is about. Two slots, in reading order. */
type RoadmapSlot = 'current' | 'next';

interface RoadmapPanel {
  slot: RoadmapSlot;
  release: RoadmapRelease;
  groups: RoadmapCategoryGroup[];
  /** Cards left after the page's search query — the panel's own hit count. */
  cardCount: number;
}

/**
 * "What is in this patch, and in the next one" — the roadmap band at the top of
 * the patch board (feedback 961ab0a5).
 *
 * The patch history could always tell you that 4.9 shipped and that 4.10 is in
 * PTU. It could never tell you WHAT either of them contains, because a patch
 * note is a title and a Spectrum link. RSI publishes exactly that missing half
 * on its roadmap Release View, so this band puts the two facts next to each
 * other: the release you are playing and the release you are waiting for, each
 * broken down by discipline.
 *
 * Two panels and no more. RSI's own board scrolls back to Alpha 3.1 and forward
 * to Star Citizen 1.0; the reader of a patch board is asking about now and next,
 * and everything after that is one line of footnote with a link to RSI.
 *
 * Collapsed by default, with one switch that opens everything (the
 * "kompakt / detail" toggle) and per-card overrides on top. That is the shape
 * the ask called for — a scannable list of what is coming, with the full
 * description one click away and never more than one click away.
 *
 * DEGRADES BY DISAPPEARING. `RoadmapService.unavailable` covers RSI being down,
 * a changed board shape and a cold cache alike; all three end with the band
 * simply not rendering, because a reader of the patch history can do nothing
 * with "the RSI roadmap API returned 502".
 */
@Component({
  selector: 'sc-patch-roadmap-band',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (panels().length > 0) {
      <section class="rm" [attr.aria-label]="'news.patch.roadmap.title' | translate">
        <div class="rm-head">
          <h3>{{ 'news.patch.roadmap.title' | translate }}</h3>
          <span class="rm-hint">{{ 'news.patch.roadmap.hint' | translate }}</span>
        </div>

        <div class="rm-toolbar">
          <!-- Expand/collapse is an action on the current view, not a
               navigation — a button, and a pressed state rather than a link. -->
          <button type="button" class="rm-density"
                  [class.active]="detailed()"
                  [attr.aria-pressed]="detailed()"
                  (click)="toggleDensity()">
            {{ (detailed() ? 'news.patch.roadmap.collapseAll' : 'news.patch.roadmap.expandAll') | translate }}
          </button>
          <a class="rm-source" [href]="boardUrl()" target="_blank" rel="noopener noreferrer">
            {{ 'news.patch.roadmap.source' | translate }}
          </a>
        </div>

        <div class="rm-panels">
          @for (panel of panels(); track panel.slot) {
            <article class="rm-panel" [attr.data-slot]="panel.slot">
              <header class="rm-panel-head">
                <span class="rm-slot">{{ ('news.patch.roadmap.slot.' + panel.slot) | translate }}</span>
                <span class="rm-version">{{ panel.release.name }}</span>
                <span class="tag" [attr.data-status]="panel.release.status">
                  {{ ('news.patch.roadmap.status.' + panel.release.status) | translate }}
                </span>
                @if (panel.release.quarter) {
                  <span class="rm-quarter">{{ panel.release.quarter }}</span>
                }
                <span class="bucket-ct">{{ panel.cardCount }}</span>
              </header>

              @if (panel.release.patchLine) {
                <!-- Ties the two halves of the page together: the roadmap says
                     what is planned, the history says what was published. -->
                <button type="button" class="rm-jump" (click)="showLine.emit(panel.release.patchLine)">
                  {{ 'news.patch.roadmap.showNotes' | translate:{ version: panel.release.patchLine } }}
                </button>
              }

              @if (panel.groups.length === 0) {
                <p class="rm-empty">{{ 'news.patch.roadmap.emptyRelease' | translate }}</p>
              }

              <ul class="rm-cats">
                @for (group of panel.groups; track group.category) {
                  <li class="rm-cat">
                    <h4>
                      <span>{{ group.category || ('news.patch.roadmap.uncategorized' | translate) }}</span>
                      <span class="bucket-ct">{{ group.cards.length }}</span>
                    </h4>
                    <ul class="rm-cards">
                      @for (card of group.cards; track card.id) {
                        <li class="rm-card" [class.open]="isCardOpen(card.id)">
                          <button type="button" class="rm-card-head"
                                  [attr.aria-expanded]="isCardOpen(card.id)"
                                  (click)="toggleCard(card.id)">
                            @if (card.thumbnail && !thumbFailed().has(card.id)) {
                              <img class="rm-thumb" [src]="card.thumbnail" alt=""
                                   loading="lazy" decoding="async"
                                   (error)="onThumbError(card.id)" />
                            } @else {
                              <span class="rm-thumb rm-thumb-ph" aria-hidden="true"></span>
                            }
                            <span class="rm-card-name">
                              @for (seg of mark(card.name); track $index) {
                                @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
                              }
                            </span>
                            <span class="tag" [attr.data-status]="card.status">
                              {{ ('news.patch.roadmap.status.' + card.status) | translate }}
                            </span>
                            <span class="caret" aria-hidden="true">›</span>
                          </button>
                          @if (isCardOpen(card.id)) {
                            <div class="rm-card-body">
                              @if (card.description) {
                                <p>
                                  @for (seg of mark(card.description); track $index) {
                                    @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
                                  }
                                </p>
                              }
                              @if (card.body) {
                                <p class="rm-card-more">
                                  @for (seg of mark(card.body); track $index) {
                                    @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> }
                                  }
                                </p>
                              }
                              @if (!card.description && !card.body) {
                                <p class="rm-card-more">{{ 'news.patch.roadmap.noDetail' | translate }}</p>
                              }
                            </div>
                          }
                        </li>
                      }
                    </ul>
                  </li>
                }
              </ul>
            </article>
          }
        </div>

        @if (later().length > 0) {
          <p class="rm-later">
            <span>{{ 'news.patch.roadmap.later' | translate }}</span>
            @for (item of later(); track item.name) {
              <span class="rm-later-item">
                {{ item.name }}
                <span class="tag" [attr.data-status]="item.status">
                  {{ ('news.patch.roadmap.status.' + item.status) | translate }}
                </span>
              </span>
            }
          </p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .rm { display: flex; flex-direction: column; gap: 10px; }
    .rm-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
    .rm-head h3 {
      margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); letter-spacing: 0.1em;
      text-transform: uppercase; color: var(--sc-fg-1);
    }
    .rm-hint { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .bucket-ct {
      font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
      padding: 1px 8px; border-radius: 999px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border);
    }

    .rm-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .rm-density, .rm-jump {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min);
      padding: 6px 12px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent;
      color: var(--sc-fg-1); font-family: inherit;
      font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .rm-density:hover, .rm-jump:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .rm-density:focus-visible, .rm-jump:focus-visible, .rm-source:focus-visible {
      outline: 2px solid var(--sc-accent); outline-offset: 2px;
    }
    .rm-density.active {
      background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      border-color: var(--sc-accent); color: var(--sc-fg-0); font-weight: 600;
    }
    .rm-source {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min);
      margin-left: auto; padding: 6px 4px; color: var(--sc-fg-2);
      font-size: max(0.72rem, var(--sc-fs-floor)); text-decoration: none;
    }
    .rm-source:hover { color: var(--sc-accent); }

    /* Two panels side by side where there is room, stacked below ~880px.
       auto-fit rather than a fixed pair: with only one panel (RSI has not
       opened the next release yet) it takes the full width instead of leaving
       a hole where the second used to be. */
    .rm-panels {
      display: grid; gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    }
    .rm-panel {
      display: flex; flex-direction: column; gap: 8px;
      padding: 12px; border-radius: 10px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1);
    }
    /* The patch you are playing gets the accent edge; the next one stays quiet. */
    .rm-panel[data-slot='current'] { border-color: color-mix(in srgb, var(--sc-success) 45%, var(--sc-border)); }
    .rm-panel[data-slot='next'] { border-color: color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border)); }

    .rm-panel-head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
    .rm-slot {
      font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.09em;
      text-transform: uppercase; color: var(--sc-fg-2);
    }
    .rm-version {
      font-family: var(--sc-font-display); font-size: 1.02rem;
      letter-spacing: 0.04em; color: var(--sc-fg-0);
    }
    .rm-quarter { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .rm-panel-head .bucket-ct { margin-left: auto; }
    .rm-jump { align-self: flex-start; }

    .rm-cats, .rm-cards { list-style: none; margin: 0; padding: 0; }
    .rm-cats { display: flex; flex-direction: column; gap: 10px; }
    .rm-cat h4 {
      display: flex; align-items: center; gap: 8px; margin: 0 0 4px;
      font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--sc-accent); font-weight: 700;
    }
    .rm-cards { display: flex; flex-direction: column; gap: 4px; }
    .rm-card {
      border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent);
      border-radius: 8px; overflow: hidden; background: var(--sc-bg-2);
    }
    .rm-card.open { border-color: color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); }
    .rm-card-head {
      display: flex; align-items: center; gap: 8px; width: 100%;
      min-height: var(--sc-tap-min); padding: 6px 10px 6px 6px;
      background: transparent; border: 0; color: var(--sc-fg-0);
      font-family: inherit; font-size: max(0.82rem, var(--sc-fs-floor));
      text-align: left; cursor: pointer;
    }
    .rm-card-head:hover { background: color-mix(in srgb, var(--sc-accent) 9%, transparent); }
    .rm-card-head:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; }
    .rm-thumb {
      flex: 0 0 auto; width: 46px; height: 34px; border-radius: 5px;
      object-fit: cover; background: var(--sc-bg-0);
    }
    .rm-thumb-ph { border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 35%, transparent); }
    .rm-card-name { flex: 1 1 auto; line-height: 1.3; }
    .rm-card-head .caret { flex: 0 0 auto; color: var(--sc-accent); transition: transform .16s ease; }
    .rm-card.open .rm-card-head .caret { transform: rotate(90deg); }
    .rm-card-body {
      padding: 2px 12px 10px 60px;
      border-top: 1px dashed color-mix(in srgb, var(--sc-border) 60%, transparent);
    }
    .rm-card-body p {
      margin: 8px 0 0; font-size: max(0.78rem, var(--sc-fs-floor));
      line-height: 1.5; color: var(--sc-fg-1);
    }
    .rm-card-more { color: var(--sc-fg-2); }
    .rm-empty { margin: 0; color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor)); }

    .rm-later {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0;
      font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2);
    }
    .rm-later-item { display: inline-flex; align-items: center; gap: 5px; }

    .tag {
      display: inline-flex; align-items: center;
      padding: 1px 7px; border-radius: 999px;
      font-size: max(0.62rem, var(--sc-fs-floor)); font-weight: 700;
      letter-spacing: 0.07em; text-transform: uppercase;
      color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 45%, transparent);
      white-space: nowrap;
    }
    /* Released = in the build, Committed = promised for it, Tentative = may move. */
    .tag[data-status='released'] { color: var(--sc-success); border-color: color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .tag[data-status='committed'] { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .tag[data-status='tentative'] { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }

    mark {
      background: color-mix(in srgb, var(--sc-accent) 32%, transparent);
      color: inherit; border-radius: 3px; padding: 0 1px;
    }

    @media (max-width: 480px) {
      .rm-card-body { padding-left: 12px; }
      .rm-thumb { width: 38px; height: 28px; }
    }
  `],
})
export class PatchRoadmapBandComponent {
  private readonly svc = inject(RoadmapService);

  /** The page's search tokens; empty = no filter. Shared with the history below. */
  readonly tokens = input<readonly string[]>([]);

  /** "Show me the patch notes for this line" — handled by the section above. */
  readonly showLine = output<string>();

  /** Compact (names only) vs. detail (every description open). */
  readonly detailed = signal(false);
  /** Per-card overrides on top of the density default. */
  private readonly cardOverride = signal<ReadonlyMap<string, boolean>>(new Map());
  /** Cards whose RSI render 404'd — the CDN advertises variants that do not exist. */
  readonly thumbFailed = signal<ReadonlySet<string>>(new Set());

  readonly boardUrl = computed(
    () => this.svc.roadmap()?.boardUrl ?? 'https://robertsspaceindustries.com/roadmap/board/1-Release-View',
  );
  readonly later = computed(() => this.svc.roadmap()?.later ?? []);

  /**
   * The two panels, already narrowed to the page's search query.
   *
   * A card matches on its name, its teaser or its long text, so searching
   * "orison" finds the Siege of Orison card even though the word only appears
   * in the description. A panel that keeps no cards still renders — an empty
   * "next patch" panel is the answer "nothing planned there matches", which is
   * information; silently dropping the panel would read as "there is no next
   * patch".
   */
  readonly panels = computed<RoadmapPanel[]>(() => {
    const payload = this.svc.roadmap();
    if (!payload) return [];
    const tokens = this.tokens();
    const out: RoadmapPanel[] = [];
    for (const slot of ['current', 'next'] as const) {
      const release = payload[slot];
      if (!release) continue;
      const cards = tokens.length === 0
        ? release.cards
        : release.cards.filter((c) => matchesTokens(`${c.name} ${c.description} ${c.body} ${c.category}`, tokens));
      out.push({ slot, release, groups: groupCardsByCategory(cards), cardCount: cards.length });
    }
    return out;
  });

  isCardOpen(id: string): boolean {
    return this.cardOverride().get(id) ?? this.detailed();
  }

  toggleCard(id: string): void {
    const next = new Map(this.cardOverride());
    next.set(id, !this.isCardOpen(id));
    this.cardOverride.set(next);
  }

  /**
   * Flip the whole band between compact and detail.
   *
   * Overrides are cleared, deliberately: "open everything" that leaves three
   * cards closed because they were toggled ten minutes ago is not what the
   * button says it does.
   */
  toggleDensity(): void {
    this.detailed.update((v) => !v);
    this.cardOverride.set(new Map());
  }

  onThumbError(id: string): void {
    this.thumbFailed.update((set) => {
      const next = new Set(set);
      next.add(id);
      return next;
    });
  }

  /** Search-term runs for `<mark>`; a no-op when nothing is being searched. */
  mark(text: string): HighlightSegment[] {
    return highlightSegments(text, this.tokens());
  }
}
