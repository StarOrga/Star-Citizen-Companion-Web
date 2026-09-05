import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { isPlainLeftClick } from '../core/modified-click.util';
import { NewsService } from './news.service';
import { PatchCycleComponent } from './patch-cycle.component';
import { PatchEntryRowComponent } from './patch-entry-row.component';
import { matchNotesToCards } from './patch-match';
import { PatchNoteDetailComponent } from './patch-note-detail.component';
import { groupWaves, type PatchNoteEntry, type PatchWaveGroup } from './patch-notes';
import { filterSections, outlineMatchCount, outlineSections } from './patch-outline';
import { GENERAL_PREP_KEYS, extractPrep } from './patch-prep';
import { PatchStabilityService } from './patch-stability.service';
import { HighlightSegment, fuzzyTokens, highlightSegments, matchesFuzzy, tokenizeQuery } from './patch-search';
import { stackCardFor, type StackCard } from './patch-stack';
import { StabilityBadgeComponent } from './stability-badge.component';
import { groupCardsByCategory, roadmapCardUrl, type RoadmapCard } from './roadmap';
import { RoadmapService, threadSlugOf } from './roadmap.service';
import { relativeTime } from './relative-time';

type SectionId = 'prep' | 'contents' | 'fixed' | 'next';

/**
 * A patch has exactly two reading orders, and the line between them is whether
 * it is out yet.
 *
 * As long as the patch has not arrived (`next`, `evocati`, `ptu`), the
 * forward-looking questions lead: when does it come, and how do I get ready.
 * Once it has landed, what is in it and whether one's own bug is gone lead;
 * the preparation is done and slides to the end.
 */
export function sectionOrder(status: StackCard['status']): SectionId[] {
  switch (status) {
    case 'next':
    case 'evocati':
    case 'ptu':
      return ['next', 'prep', 'contents', 'fixed'];
    default:
      return ['contents', 'fixed', 'next', 'prep'];
  }
}

/** One bullet hit inside a note, with the headings it sits under. */
interface NoteHit {
  entry: PatchNoteEntry;
  path: string;
  text: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** The reading line sits a little below the sticky hero. */
const SPY_CLEARANCE_PX = 24;

/**
 * `/news/patches/:line` — one patch, opened (2026-09-04 rethink, design Ⓚ).
 *
 * A routed overlay over the board: own URL (deep-linkable, browser back
 * closes it), scrim behind, the board still visible. Everything the old band
 * stack showed about a patch lives here, arranged by the QUESTION the reader
 * came with, not by data source:
 *
 *   prep       what the note's "Important Build Info" says is kept or wiped,
 *              plus known issues / testing focus
 *   contents   RSI's roadmap items as picture cards, with the release note's
 *              matching bullets ON the card and the unmatched ones in a line
 *              below (or, without roadmap data, the note itself)
 *   fixed      search inside this patch across its loaded notes, honest
 *              coverage, load the rest on demand, every note of the line
 *              reachable underneath
 *   next       the cycle axis (sc-patch-cycle)
 *
 * Their ORDER follows `sectionOrder()` and has two shapes only: a patch that
 * is not out yet leads with `next, prep` (when does it come, how do I get
 * ready), a patch that has landed leads with `contents, fixed` (what is in it,
 * is my bug gone). Two of the headings also read differently per status —
 * see `sectionKey()`, which feeds the TOC link AND the `<h3>` so the two can
 * never drift apart.
 *
 * The navigation is the settings page's table of contents, reused as a
 * pattern: a quiet sticky rail with a 2 px marker and scroll-spy on desktop,
 * a sticky pill row on phones. Sections a patch has no data for are simply
 * absent — no empty states anywhere.
 *
 * `line` and `q` arrive through the router (`withComponentInputBinding`); `q`
 * is the board's query, carried in so a click on a search result lands on the
 * highlighted hits without retyping — and, since `fixed` can be the last
 * section, the dossier scrolls there on open when a query came along.
 */
@Component({
  selector: 'sc-patch-dossier',
  standalone: true,
  imports: [
    TranslateModule, RouterLink, PatchCycleComponent, PatchEntryRowComponent,
    PatchNoteDetailComponent, StabilityBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim" (click)="onScrim($event)">
      <div class="panel" role="dialog" aria-modal="true" [attr.aria-label]="title()" (click)="$event.stopPropagation()" #panel>
        @if (card(); as c) {
          <header class="hero" [attr.data-status]="c.status">
            <a class="close" [routerLink]="['/news/patches']" [queryParams]="closeParams()" [attr.aria-label]="'news.patch.dossier.close' | translate">✕</a>
            <div class="hero-row">
              <span class="status" [attr.data-status]="c.status">{{ ('news.patch.status.' + c.status) | translate }}</span>
              <h2>{{ title() }}</h2>
              <!-- Same corner, same picture as on the board card the reader
                   just came from (owner, 2026-09-05). -->
              @if (verdict(); as v) {
                <span class="stab"><sc-stability-badge [verdict]="v" size="lg" /></span>
              }
            </div>
            <p class="state">{{ stateLine() }}
              @if (sourceUrl(); as url) {
                <a class="src" [href]="url" target="_blank" rel="noopener noreferrer">{{ 'news.patch.detail.openOnRsi' | translate }}</a>
              }
            </p>
          </header>

          <div class="body" [class.no-toc]="sections().length < 2">
            @if (sections().length >= 2) {
              <nav class="toc" [attr.aria-label]="'news.patch.dossier.toc' | translate">
                <ul class="toc-list">
                  @for (s of sections(); track s) {
                    <li>
                      <a class="toc-link" [class.active]="active() === s" [href]="'#pd-' + s"
                         [attr.aria-current]="active() === s ? 'true' : null" (click)="onToc($event, s)">
                        <span class="toc-marker" aria-hidden="true"></span>
                        <span class="toc-text">{{ sectionKey(s) | translate }}</span>
                      </a>
                    </li>
                  }
                </ul>
              </nav>
            }

            <div class="col">
              @for (s of sections(); track s) { @switch (s) {
              @case ('prep') {
              <!-- ── How do I prepare? / on a superseded patch: what was
                   there to watch out for? (heading via sectionKey)
                   Unconditional since 2026-09-05: what RSI wrote about THIS
                   build when it wrote anything, and under it the advice that
                   holds for every patch — so the question is answered even on
                   the notes that carry no build-info block at all. ─────── -->
              <section id="pd-prep" class="sec" [class.flash]="flash() === 'prep'" [class.wipe]="prep()?.wipe">
                <h3>{{ sectionKey('prep') | translate }}
                  @if (prep(); as p) {
                    <small>{{ 'news.patch.prep.source' | translate }}</small>
                    @if (p.wipe) { <span class="wipe-tag">{{ 'news.patch.prep.wipe' | translate }}</span> }
                  }
                </h3>
                @if (prep(); as p) {
                  @if (p.items.length > 0) {
                    <ul class="prep">
                      @for (item of p.items; track item.label) {
                        <li [attr.data-tone]="item.tone">
                          <span class="pk-label">{{ item.label }}</span>
                          <span class="pk-value">{{ item.value }}</span>
                        </li>
                      }
                    </ul>
                  }
                  @if (p.testingFocus.length > 0) {
                    <h4>{{ 'news.patch.prep.focus' | translate }}</h4>
                    <ul class="lines">@for (l of p.testingFocus; track $index) { <li>{{ l }}</li> }</ul>
                  }
                  @if (p.knownIssues.length > 0) {
                    <h4>{{ 'news.patch.prep.known' | translate }} <span class="ct">{{ p.knownIssues.length }}</span></h4>
                    <ul class="lines">@for (l of p.knownIssues; track $index) { <li>{{ l }}</li> }</ul>
                  }
                } @else {
                  <p class="muted">{{ 'news.patch.prep.noBuildInfo' | translate }}</p>
                }
                <h4>{{ 'news.patch.prep.generalTitle' | translate }}</h4>
                <ul class="lines">
                  @for (key of generalKeys; track key) {
                    <li>{{ ('news.patch.prep.generalItem.' + key) | translate }}</li>
                  }
                </ul>
              </section>
              }

              @case ('contents') {
              <!-- ── What's in it? ─────────────────────────────────────── -->
              @if (hasContents()) {
                <section id="pd-contents" class="sec" [class.flash]="flash() === 'contents'">
                  <h3>{{ sectionKey('contents') | translate }}
                    @if (c.release; as r) {
                      <span class="ct">{{ r.cards.length }}</span>
                      <button type="button" class="pill-btn" [class.active]="allLong()" [attr.aria-pressed]="allLong()" (click)="toggleAllLong()">
                        {{ (allLong() ? 'news.patch.roadmap.collapseAll' : 'news.patch.roadmap.expandAll') | translate }}
                      </button>
                      @if (roadmap.roadmap()?.boardUrl; as burl) {
                        <a class="src" [href]="burl" target="_blank" rel="noopener noreferrer">{{ 'news.patch.roadmap.source' | translate }}</a>
                      }
                    }
                  </h3>
                  @if (c.release; as r) {
                    @for (group of categories(); track group.category) {
                      <h4>{{ group.category || ('news.patch.roadmap.uncategorized' | translate) }} <span class="ct">{{ group.cards.length }}</span></h4>
                      <ul class="cards">
                        @for (item of group.cards; track item.id; let ci = $index) {
                          <li class="fc" [class.open]="isLong(item.id)" [style.--in-delay]="ci * 45 + 'ms'">
                            <!-- The picture goes to RSI's Release View entry
                                 for exactly this card, which opens with its
                                 panel already expanded (owner, 2026-09-05).
                                 A real anchor, so middle click and "open in
                                 new tab" work; without a usable id it stays an
                                 <a> with no href, i.e. a plain picture. -->
                            <a class="img" [class.ph]="!item.thumbnail"
                               [attr.href]="cardUrl(item) || null"
                               [attr.target]="cardUrl(item) ? '_blank' : null"
                               [attr.rel]="cardUrl(item) ? 'noopener noreferrer' : null"
                               [attr.aria-label]="cardUrl(item) ? ('news.patch.roadmap.openCard' | translate:{ name: item.name }) : null">
                              @if (item.thumbnail) { <img [src]="item.thumbnail" alt="" loading="lazy" decoding="async" /> }
                              <span class="st" [attr.data-status]="item.status">{{ ('news.patch.roadmap.status.' + item.status) | translate }}</span>
                              @if (cardUrl(item)) { <span class="go" aria-hidden="true">↗</span> }
                            </a>
                            <div class="bd">
                              <span class="nm">
                                @for (seg of mark(item.name); track $index) { @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> } }
                              </span>
                              @if (item.description) { <p class="short">{{ item.description }}</p> }
                              @if (isLong(item.id) && item.body) { <p class="long">{{ item.body }}</p> }
                              @if (isLong(item.id) && !item.body && !item.description) { <p class="long muted">{{ 'news.patch.roadmap.noDetail' | translate }}</p> }
                              @if (bulletsFor(item); as lines) {
                                <ul class="notes">
                                  <span class="lb">{{ 'news.patch.contents.inNotes' | translate }}</span>
                                  @for (l of lines; track $index) {
                                    <li>@for (seg of mark(l); track $index) { @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> } }</li>
                                  }
                                </ul>
                              }
                              @if (item.body) {
                                <button type="button" class="more" [attr.aria-expanded]="isLong(item.id)" (click)="toggleLong(item.id)">
                                  {{ (isLong(item.id) ? 'news.patch.contents.less' : 'news.patch.contents.more') | translate }}
                                </button>
                              }
                            </div>
                          </li>
                        }
                      </ul>
                    }
                    @if (leftover().length > 0) {
                      <details class="leftover" [open]="tokens().length > 0">
                        <summary>{{ 'news.patch.contents.leftover' | translate:{ n: leftover().length } }}</summary>
                        <ul class="lines">
                          @for (l of leftover(); track $index) {
                            <li>@for (seg of mark(l); track $index) { @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> } }</li>
                          }
                        </ul>
                      </details>
                    }
                  } @else if (currentEntry(); as entry) {
                    <!-- No roadmap for this line: the note itself is what it holds. -->
                    <p class="muted">{{ 'news.patch.contents.noRoadmap' | translate:{ title: entry.item.title } }}</p>
                    <sc-patch-note-detail [slug]="slugOf(entry)" [url]="entry.item.url" [tokens]="tokens()" />
                  }
                </section>
              }
              }

              @case ('fixed') {
              <!-- ── Did they fix …? (the section a carried-in query
                   scrolls to, see focusOnQuery) ───────────────────────── -->
              @if (c.group; as g) {
                <section id="pd-fixed" class="sec" [class.flash]="flash() === 'fixed'">
                  <h3>{{ sectionKey('fixed') | translate }}</h3>
                  <div class="s-field">
                    <input type="search" class="s-input" autocomplete="off" spellcheck="false"
                           [attr.aria-label]="'news.patch.fixed.placeholder' | translate"
                           [attr.placeholder]="'news.patch.fixed.placeholder' | translate"
                           [value]="query()" (input)="onQuery($event)" (keydown.escape)="clearQuery()" />
                    @if (query()) {
                      <button type="button" class="s-clear" [attr.aria-label]="'news.patch.search.clear' | translate" (click)="clearQuery()">×</button>
                    }
                  </div>
                  <p class="coverage" role="status">
                    @if (tokens().length > 0) {
                      <b>{{ 'news.patch.fixed.hits' | translate:{ n: hits().length, notes: hitNotes() } }}</b>
                    }
                    <span>{{ 'news.patch.fixed.coverage' | translate:{ loaded: loadedCount(), total: g.entries.length } }}</span>
                    @if (loadedCount() < g.entries.length) {
                      <button type="button" class="pill-btn" (click)="loadAll()" [disabled]="pendingCount() > 0">
                        {{ (pendingCount() > 0 ? 'news.patch.fixed.loading' : 'news.patch.fixed.loadRest') | translate:{ n: pendingCount() } }}
                      </button>
                    }
                  </p>
                  @if (tokens().length > 0) {
                    @if (hits().length === 0) {
                      <p class="muted">{{ 'news.patch.fixed.noHits' | translate }}</p>
                    } @else {
                      <ul class="hits">
                        @for (h of hits(); track $index) {
                          <li>
                            <span class="w"><span class="tag" [attr.data-stage]="h.entry.facet">{{ ('news.patch.facet.' + h.entry.facet) | translate }}</span> {{ relTime(h.entry.item.publishedAt) }}</span>
                            <span class="c"><small>{{ h.path }}</small>
                              @for (seg of mark(h.text); track $index) { @if (seg.hit) { <mark>{{ seg.text }}</mark> } @else { <span>{{ seg.text }}</span> } }
                            </span>
                          </li>
                        }
                      </ul>
                    }
                  }
                  <!-- Every note of the line, folded: nothing is a scroll obstacle, nothing is unreachable. -->
                  <details class="all-notes" [open]="notesOpen()">
                    <summary>{{ 'news.patch.fixed.allNotes' | translate:{ n: g.entries.length } }}</summary>
                    <ul class="entries">
                      @for (wave of waves(); track wave.key) {
                        @if (wave.folded) {
                          <li class="wave">
                            <details [open]="tokens().length > 0">
                              <summary>
                                <span>{{ 'news.patch.waves.title' | translate:{ count: wave.entries.length } }}</span>
                                <span class="tag" [attr.data-stage]="wave.facet">{{ ('news.patch.facet.' + wave.facet) | translate }}</span>
                                <time>{{ relTime(wave.entries[0].item.publishedAt) }}</time>
                              </summary>
                              <ul class="entries">
                                @for (entry of wave.entries; track entry.item.id) {
                                  <li><sc-patch-entry-row [entry]="entry" [when]="relTime(entry.item.publishedAt)" [tokens]="tokens()" [open]="isOpen(entry)" [compact]="true" (toggled)="toggleEntry($event)" /></li>
                                }
                              </ul>
                            </details>
                          </li>
                        } @else {
                          @for (entry of wave.entries; track entry.item.id) {
                            <li><sc-patch-entry-row [entry]="entry" [when]="relTime(entry.item.publishedAt)" [tokens]="tokens()" [open]="isOpen(entry)" (toggled)="toggleEntry($event)" /></li>
                          }
                        }
                      }
                    </ul>
                  </details>
                </section>
              }
              }

              @case ('next') {
              <!-- ── When is the next one? / not out yet: when does THIS
                   one land? / superseded: what came next? (sectionKey) ─── -->
              @if (hasCycle()) {
                <section id="pd-next" class="sec" [class.flash]="flash() === 'next'">
                  <h3>{{ sectionKey('next') | translate }}</h3>
                  <sc-patch-cycle [card]="c" [groups]="svc.patchLines()" [now]="now()" />
                </section>
              }
              }
              } }
              <!-- Empty room at the bottom, so the LAST section can still be
                   scrolled to the top of the panel when its heading is picked
                   from the table of contents (owner, 2026-09-05: "ruhig unten
                   leerbereich, so das man durch klick auf das
                   inhaltsverzeichnis direkt oben den punkt immer hat"). Sized
                   in viewport height because that is what "scrolled to the
                   top" is measured against, and hidden from assistive tech —
                   it is scroll room, not content. -->
              <div class="tail" aria-hidden="true"></div>
            </div>
          </div>
        } @else {
          <header class="hero">
            <a class="close" routerLink="/news/patches" [attr.aria-label]="'news.patch.dossier.close' | translate">✕</a>
            <h2>{{ 'news.patch.line' | translate:{ version: line() } }}</h2>
            <p class="state">{{ 'news.patch.dossier.unknown' | translate:{ line: line() } }}</p>
          </header>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .scrim {
      position: fixed; inset: 0; z-index: 60; display: flex; justify-content: center; align-items: flex-start;
      padding: 24px 16px; background: color-mix(in srgb, var(--sc-bg-0) 78%, transparent);
      -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); overflow: hidden;
    }
    .panel {
      width: min(100%, 960px); max-height: calc(100vh - 48px); overflow-y: auto; overscroll-behavior: contain;
      border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5); scrollbar-width: thin;
    }
    .hero {
      position: sticky; top: 0; z-index: 2; padding: 16px 20px 12px;
      background: linear-gradient(160deg, var(--sc-bg-3) 0%, var(--sc-bg-1) 60%); border-bottom: 1px solid var(--sc-border);
    }
    .hero[data-status='live'] { background: linear-gradient(160deg, color-mix(in srgb, var(--sc-success) 16%, var(--sc-bg-1)), var(--sc-bg-1) 60%); }
    .hero[data-status='next'], .hero[data-status='ptu'], .hero[data-status='evocati'] { background: linear-gradient(160deg, color-mix(in srgb, var(--sc-accent) 16%, var(--sc-bg-1)), var(--sc-bg-1) 60%); }
    .hero-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding-right: 44px; }
    .stab { margin-left: auto; }
    .hero h2 { margin: 0; font-size: 1.6rem; line-height: 1; }
    .close {
      position: absolute; right: 8px; top: 8px; display: inline-flex; align-items: center; justify-content: center;
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min); color: var(--sc-fg-2); text-decoration: none; font-size: 1rem;
    }
    .close:hover { color: var(--sc-fg-0); }
    .close:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -3px; border-radius: 6px; }
    .status {
      display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 6px; font-family: var(--sc-font-display);
      font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; white-space: nowrap;
    }
    .status[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); }
    .status[data-status='next'], .status[data-status='ptu'] { color: var(--sc-accent); border: 1.5px solid var(--sc-accent); }
    .status[data-status='evocati'] { color: var(--sc-fg-1); border: 1.5px solid color-mix(in srgb, var(--sc-fg-1) 50%, transparent); }
    .status[data-status='superseded'], .status[data-status='other'] { color: var(--sc-fg-2); border: 1.5px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }
    .state { margin: 8px 0 0; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); line-height: 1.5; }
    .src { color: var(--sc-accent); text-decoration: none; font-size: max(0.72rem, var(--sc-fs-floor)); margin-left: 8px; white-space: nowrap; }
    .src:hover { text-decoration: underline; }

    .body { display: grid; grid-template-columns: 180px minmax(0, 1fr); }
    .body.no-toc { grid-template-columns: minmax(0, 1fr); }
    .col { min-width: 0; }
    .sec { padding: 16px 20px 18px; border-bottom: 1px solid var(--sc-border); scroll-margin-top: 96px; }
    .sec:last-child { border-bottom: 0; }
    /* Sections fly in from the side as the dossier opens — the panel is a
       document that assembles itself rather than one that is simply there. */
    .sec { animation: pd-in 0.4s cubic-bezier(0.22, 0.9, 0.3, 1) both; }
    .sec:nth-child(2) { animation-delay: 60ms; }
    .sec:nth-child(3) { animation-delay: 120ms; }
    .sec:nth-child(4) { animation-delay: 180ms; }
    @keyframes pd-in { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
    /* Picked from the table of contents: the section says "here I am" for a
       moment, because a smooth scroll that lands on a heading among four
       identical headings leaves the reader checking which one moved. */
    .sec.flash { animation: pd-flash 1.25s ease-out; }
    @keyframes pd-flash {
      0% { background: color-mix(in srgb, var(--sc-accent) 22%, transparent); box-shadow: inset 0 0 0 1px var(--sc-accent), 0 0 26px -6px var(--sc-accent); }
      60% { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 45%, transparent), 0 0 14px -8px var(--sc-accent); }
      100% { background: transparent; box-shadow: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      .sec, .sec.flash, .fc { animation: none; }
    }
    /* Scroll room under the last section — see the template comment. */
    .tail { height: 72vh; pointer-events: none; }
    .sec h3 {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 0 0 10px;
      font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-accent);
    }
    .sec h3 small { font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); font-weight: 400; }
    .sec h4 { display: flex; align-items: center; gap: 8px; margin: 12px 0 6px; font-size: max(0.68rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-1); }
    .ct { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); padding: 1px 8px; border-radius: 999px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); letter-spacing: 0; text-transform: none; }
    .muted { margin: 0 0 8px; color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    mark { background: color-mix(in srgb, var(--sc-accent) 32%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }

    /* Settings-page TOC, as a pattern: quiet links, one accent marker. */
    .toc { padding: 16px 8px 16px 16px; border-right: 1px solid var(--sc-border); }
    .toc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; position: sticky; top: 96px; }
    .toc-link {
      display: flex; align-items: center; gap: 10px; padding: 8px 4px; min-height: 36px; color: var(--sc-fg-2); text-decoration: none;
      font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; border-radius: 4px;
    }
    .toc-marker { flex: 0 0 auto; width: 2px; align-self: stretch; border-radius: 999px; background: var(--sc-border); }
    .toc-text { min-width: 0; overflow-wrap: anywhere; }
    .toc-link:hover { color: var(--sc-fg-0); }
    .toc-link.active { color: var(--sc-accent); }
    .toc-link.active .toc-marker { background: var(--sc-accent); }

    .prep { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); }
    .prep li { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; border: 1px solid var(--sc-border); border-radius: 6px; background: var(--sc-bg-1); }
    .pk-label { font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
    .pk-value { font-size: max(0.86rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-0); }
    .prep li[data-tone='kept'] .pk-value { color: var(--sc-success); }
    .prep li[data-tone='wiped'] { border-color: var(--sc-warning); }
    .prep li[data-tone='wiped'] .pk-value { color: var(--sc-warning); }
    .wipe-tag { padding: 2px 8px; border-radius: 4px; background: var(--sc-warning); color: var(--sc-bg-0); font-weight: 700; letter-spacing: 0.1em; }
    .lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .lines li { position: relative; padding-left: 14px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-1); line-height: 1.45; }
    .lines li::before { content: '▪'; position: absolute; left: 0; color: var(--sc-accent); font-size: 0.6em; top: 0.4em; }

    /* Roadmap cards read horizontal: the picture owns the left ~40 % at full
       card height, the text sits beside it. Owner feedback on the first
       signed-in look: "zu wenig Bildfläche … etwas horizontaler". Two cards
       per row at dossier width, one on phones. */
    .cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); }
    .fc {
      display: grid; grid-template-columns: minmax(150px, 40%) minmax(0, 1fr);
      border: 1px solid var(--sc-border); border-radius: 8px; overflow: hidden; background: var(--sc-bg-1);
      animation: pd-card-in 0.34s ease-out both; animation-delay: var(--in-delay, 0ms);
    }
    @keyframes pd-card-in { from { opacity: 0; transform: translateY(10px) scale(0.985); } to { opacity: 1; transform: none; } }
    .fc.open { grid-column: 1 / -1; grid-template-columns: minmax(200px, 34%) minmax(0, 1fr); border-color: color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); }
    .fc .img { position: relative; display: block; min-height: 150px; height: 100%; background: linear-gradient(135deg, var(--sc-bg-3), var(--sc-bg-0)); }
    .fc .img img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
    a.img[href]:hover img { transform: scale(1.04); }
    a.img[href]:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .fc .go {
      position: absolute; right: 6px; bottom: 6px; display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; border-radius: 4px; font-size: 0.72rem;
      background: color-mix(in srgb, var(--sc-bg-0) 78%, transparent); color: var(--sc-accent);
      opacity: 0; transition: opacity 0.2s ease;
    }
    a.img[href]:hover .go, a.img[href]:focus-visible .go { opacity: 1; }
    .fc .st { position: absolute; left: 8px; top: 8px; padding: 2px 6px; border-radius: 3px; background: color-mix(in srgb, var(--sc-bg-0) 80%, transparent); font-size: max(0.56rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); }
    .fc .st[data-status='released'] { color: var(--sc-success); }
    .fc .st[data-status='committed'] { color: var(--sc-accent); }
    .fc .bd { display: flex; flex-direction: column; gap: 5px; padding: 10px 12px 12px; min-width: 0; }
    .fc .nm { font-size: max(0.8rem, var(--sc-fs-floor)); font-weight: 600; color: var(--sc-fg-0); }
    .fc .short, .fc .long { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-1); line-height: 1.45; }
    .fc .long { border-top: 1px dashed var(--sc-border); padding-top: 6px; }
    .fc .notes { list-style: none; margin: 4px 0 0; padding: 6px 0 0; border-top: 1px solid var(--sc-border); display: flex; flex-direction: column; gap: 3px; }
    .fc .notes .lb { font-size: max(0.56rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-success); }
    .fc .notes li { position: relative; padding-left: 12px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
    .fc .notes li::before { content: '▪'; position: absolute; left: 0; color: var(--sc-success); font-size: 0.6em; top: 0.4em; }
    .fc .more { align-self: flex-start; margin-top: auto; padding: 4px 0; min-height: var(--sc-tap-min); border: 0; background: transparent; color: var(--sc-accent); font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer; }
    .fc .more:hover { text-decoration: underline; }
    .pill-btn {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min); padding: 4px 12px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-1); font: inherit;
      font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0; text-transform: none; cursor: pointer;
    }
    .pill-btn:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .pill-btn.active { background: color-mix(in srgb, var(--sc-accent) 18%, transparent); border-color: var(--sc-accent); }
    .pill-btn:disabled { opacity: 0.6; cursor: default; }
    .leftover { margin-top: 12px; }
    details summary { cursor: pointer; min-height: var(--sc-tap-min); display: flex; align-items: center; gap: 8px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    details summary:hover { color: var(--sc-accent); }
    details[open] > summary { color: var(--sc-fg-0); margin-bottom: 6px; }

    .s-field { position: relative; display: flex; max-width: 480px; }
    .s-input {
      flex: 1 1 auto; min-height: var(--sc-tap-min); padding: 8px 40px 8px 12px; border: 1px solid var(--sc-border); border-radius: 8px;
      background: var(--sc-bg-0); color: var(--sc-fg-0); font: inherit; font-size: max(0.86rem, var(--sc-fs-floor));
    }
    .s-input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .s-input::-webkit-search-cancel-button { display: none; }
    .s-clear { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); min-width: var(--sc-tap-min); min-height: var(--sc-tap-min); border: 0; background: transparent; color: var(--sc-fg-2); font-size: 1.2rem; cursor: pointer; }
    .coverage { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 8px 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .coverage b { color: var(--sc-fg-0); }
    .hits { list-style: none; margin: 0 0 10px; padding: 0; }
    .hits li { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 12px; padding: 7px 0; border-top: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .hits .w { font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
    .hits .c small { display: block; color: var(--sc-fg-2); font-size: max(0.62rem, var(--sc-fs-floor)); }
    .tag { display: inline-flex; padding: 1px 7px; border-radius: 999px; font-size: max(0.6rem, var(--sc-fs-floor)); font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; color: var(--sc-fg-2); border: 1px solid color-mix(in srgb, var(--sc-fg-2) 45%, transparent); }
    .tag[data-stage='live'] { color: var(--sc-success); border-color: color-mix(in srgb, var(--sc-success) 55%, transparent); }
    .tag[data-stage='ptu'] { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
    .tag[data-stage='hotfix'] { color: var(--sc-warning); border-color: color-mix(in srgb, var(--sc-warning) 55%, transparent); }
    .entries { list-style: none; margin: 0; padding: 0; }
    .wave > details > summary { gap: 8px; }
    .wave time { color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); }

    @media (max-width: 760px) {
      .scrim { padding: 0; align-items: flex-end; }
      .panel { max-height: 100vh; height: 100vh; border-radius: 0; border: 0; }
      .hero { padding: 14px 14px 10px; }
      .hero h2 { font-size: 1.3rem; }
      .body { grid-template-columns: minmax(0, 1fr); }
      /* Phone: the TOC becomes the settings page's pinned pill row. */
      .toc { position: sticky; top: 84px; z-index: 2; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--sc-border); background: color-mix(in srgb, var(--sc-bg-0) 86%, transparent); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
      .toc-list { position: static; flex-direction: row; gap: 6px; overflow-x: auto; scrollbar-width: none; }
      .toc-list::-webkit-scrollbar { display: none; }
      .toc-link { flex: 0 0 auto; gap: 0; padding: 9px 12px; min-height: 40px; white-space: nowrap; border-radius: 999px; background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent); color: var(--sc-fg-1); }
      .toc-marker { display: none; }
      .toc-link.active { background: var(--sc-accent); color: var(--sc-bg-0); }
      .sec { padding: 12px 14px 14px; scroll-margin-top: 140px; }
      .fc, .fc.open { grid-template-columns: minmax(0, 1fr); }
      .fc .img { min-height: 120px; height: 120px; }
      .hits li { grid-template-columns: 1fr; gap: 3px; }
    }
  `],
})
export class PatchDossierComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);
  readonly roadmap = inject(RoadmapService);
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly stability = inject(PatchStabilityService);

  /** Route params, bound by the router. */
  readonly line = input.required<string>();
  readonly q = input<string>('');

  readonly query = signal('');
  readonly tokens = computed(() => tokenizeQuery(this.query()));
  /**
   * True when the reader arrived from the board's search. Read from the route,
   * not from the field: typing in the section must never reshuffle the page,
   * and a routed overlay that is reused for another line has to notice.
   *
   * The router binds a MISSING query param as `undefined`, which overrides the
   * input's declared default — hence the guard, not `q().trim()`.
   */
  private readonly openedWithQuery = computed(() => (this.q() ?? '').trim().length > 0);
  /** What the reader last clicked or scrolled to; null while they have not chosen. */
  private readonly chosen = signal<SectionId | null>(null);
  /**
   * The highlighted entry: the reader's choice while it still exists, else the
   * first section of the current order. A section arriving late (an outline
   * loads and `prep` appears) must not throw the highlight back to the top.
   */
  readonly active = computed<SectionId>(() => {
    const secs = this.sections();
    const c = this.chosen();
    return c && secs.includes(c) ? c : (secs[0] ?? 'prep');
  });
  readonly allLong = signal(false);
  readonly notesOpen = signal(false);
  /** The section that was just jumped to; cleared when its glow has run. */
  readonly flash = signal<SectionId | null>(null);
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  readonly generalKeys = GENERAL_PREP_KEYS;
  private readonly longOverride = signal<ReadonlyMap<string, boolean>>(new Map());
  private readonly entryOverride = signal<ReadonlyMap<string, boolean>>(new Map());
  readonly now = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);
  private scrollListener?: () => void;
  private previousOverflow = '';
  /** The carried-in query focuses `fixed` once, not on every recompute. */

  readonly card = computed<StackCard | null>(() =>
    stackCardFor(this.line(), this.svc.patchLines(), this.roadmap.roadmap()),
  );
  readonly title = computed(() => {
    const c = this.card();
    return c && !c.line ? this.t.instant('news.patch.otherLine') : this.t.instant('news.patch.line', { version: this.line() });
  });

  /** The note that describes the patch right now: the earliest Live note, else the newest test wave. */
  readonly currentEntry = computed<PatchNoteEntry | null>(() => {
    const g = this.card()?.group;
    if (!g) return null;
    const live = g.entries.filter((e) => e.facet === 'live');
    if (live.length > 0) return live.reduce((a, b) => (Date.parse(b.item.publishedAt) < Date.parse(a.item.publishedAt) ? b : a));
    return g.entries[0] ?? null;
  });
  readonly currentOutline = computed(() => {
    const e = this.currentEntry();
    return e ? this.roadmap.outlineFor(threadSlugOf(e.item.url)) : null;
  });
  readonly sourceUrl = computed(() => this.currentEntry()?.item.url ?? null);

  readonly prep = computed(() => extractPrep(this.currentOutline()));
  /** The line's stability, for the hero badge — only once it has shipped. */
  readonly verdict = computed(() => {
    const c = this.card();
    return c && c.line && c.liveAt !== null ? this.stability.verdictFor(c.line) : null;
  });
  readonly categories = computed(() => groupCardsByCategory(this.card()?.release?.cards ?? []));
  readonly matches = computed(() => matchNotesToCards(this.card()?.release?.cards ?? [], this.currentOutline()));
  readonly leftover = computed(() => this.matches().leftover);
  readonly hasContents = computed(() => !!this.card()?.release || this.currentEntry() !== null);
  readonly hasCycle = computed(() => {
    const c = this.card();
    return !!c && (c.liveAt !== null || c.firstTestAt !== null || c.status === 'next');
  });
  /**
   * The sections in the order the patch's status makes them interesting —
   * `sectionOrder()` decides, this only drops the ones without data.
   *
   * One exception: a reader who arrived from the board's search came for the
   * hit list, so `fixed` leads for them. Putting it first beats scrolling to
   * it — the sections above load images and grow after the first render, and
   * a scroll aimed at the old layout lands in the wrong place. Latched at
   * open, so typing in the field later never reshuffles the page.
   */
  readonly sections = computed<SectionId[]>(() => {
    const c = this.card();
    const has: Record<SectionId, boolean> = {
      // Always: the general advice below the patch-specific facts holds for
      // every build, so this question is never unanswerable (2026-09-05).
      prep: true,
      contents: this.hasContents(),
      fixed: !!c?.group,
      next: this.hasCycle(),
    };
    const out = sectionOrder(c?.status ?? 'other').filter((id) => has[id]);
    if (!this.openedWithQuery() || !out.includes('fixed')) return out;
    return ['fixed', ...out.filter((id) => id !== 'fixed')];
  });

  readonly waves = computed<PatchWaveGroup[]>(() => groupWaves(this.card()?.group?.entries ?? []));
  readonly loadedCount = computed(() => {
    this.roadmap.outlines();
    return (this.card()?.group?.entries ?? []).filter((e) => this.roadmap.hasOutline(threadSlugOf(e.item.url))).length;
  });
  readonly pendingCount = computed(() => {
    this.roadmap.pending();
    return (this.card()?.group?.entries ?? []).filter((e) => this.roadmap.isPending(threadSlugOf(e.item.url))).length;
  });

  /** Bullet hits across the line's loaded notes, each with its heading path. */
  readonly hits = computed<NoteHit[]>(() => {
    const tokens = this.tokens();
    const entries = this.card()?.group?.entries ?? [];
    if (tokens.length === 0) return [];
    this.roadmap.outlines();
    const out: NoteHit[] = [];
    for (const entry of entries) {
      const outline = this.roadmap.outlineFor(threadSlugOf(entry.item.url));
      if (!outline || outlineMatchCount(outline, tokens) === 0) continue;
      for (const section of filterSections(outlineSections(outline.nodes), tokens)) {
        for (const group of section.groups) {
          for (const node of group.nodes) {
            if (!matchesFuzzy(node.text, tokens)) continue;
            out.push({ entry, path: [section.heading, group.label].filter(Boolean).join(' › '), text: node.text });
          }
        }
      }
    }
    return out;
  });
  readonly hitNotes = computed(() => new Set(this.hits().map((h) => h.entry.item.id)).size);

  /** The board's query arrives once via the route; the field takes over from there. */
  private readonly seedQuery = effect(() => {
    const q = this.q();
    untracked(() => {
      if (q && !this.query()) this.query.set(q);
    });
  });

  /** The current note's contents are what three of the four sections read from. */
  private readonly fetchCurrent = effect(() => {
    const e = this.currentEntry();
    if (e) untracked(() => this.roadmap.requestOutlines([threadSlugOf(e.item.url)]));
  });

  private readonly loadRoadmapOnce = effect(() => {
    void this.roadmap.loadRoadmap();
  });

  ngOnInit(): void {
    if (typeof document !== 'undefined') {
      this.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const panel = this.host.nativeElement.querySelector<HTMLElement>('.panel');
    if (panel) {
      this.scrollListener = () => this.syncActive(panel);
      panel.addEventListener('scroll', this.scrollListener, { passive: true });
    }
  }

  ngOnDestroy(): void {
    if (typeof document !== 'undefined') document.body.style.overflow = this.previousOverflow;
    clearInterval(this.clockTimer);
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    const panel = this.host.nativeElement.querySelector<HTMLElement>('.panel');
    if (panel && this.scrollListener) panel.removeEventListener('scroll', this.scrollListener);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    void this.router.navigate(['/news/patches'], { queryParams: this.closeParams() });
  }

  /** A click on the scrim (not the panel) closes — same as Esc and the ✕. */
  onScrim(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    this.onEscape();
  }

  /** Closing keeps the board's search as it was. */
  closeParams(): Record<string, string> | null {
    return this.q() ? { q: this.q() } : null;
  }

  /**
   * The i18n key for a section's TOC label AND its heading — one source, so
   * the two can never say different things. Two sections change with status:
   * "when is the NEXT one?" is the wrong question on a patch that has not
   * shipped yet (there it is "when does THIS one land?"), and on a superseded
   * patch both that and the preparation are past tense.
   */
  sectionKey(id: SectionId): string {
    const status = this.card()?.status ?? 'other';
    const unreleased = status === 'next' || status === 'evocati' || status === 'ptu';
    if (id === 'next' && unreleased) return 'news.patch.dossier.section.nextThis';
    if (id === 'next' && status === 'superseded') return 'news.patch.dossier.section.nextPast';
    if (id === 'prep' && status === 'superseded') return 'news.patch.dossier.section.prepPast';
    return 'news.patch.dossier.section.' + id;
  }

  onToc(ev: MouseEvent, id: SectionId): void {
    if (!isPlainLeftClick(ev)) return;
    const target = this.host.nativeElement.querySelector<HTMLElement>(`#pd-${id}`);
    if (!target) return;
    ev.preventDefault();
    this.chosen.set(id);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.glow(id);
  }

  /**
   * Light the jumped-to section for a moment. Re-triggering while a previous
   * glow runs has to clear the class first — a CSS animation does not restart
   * on an element that already carries it, so the second click on the same
   * entry would do nothing visible.
   */
  private glow(id: SectionId): void {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flash.set(null);
    if (typeof requestAnimationFrame === 'undefined') {
      this.flash.set(id);
    } else {
      requestAnimationFrame(() => this.flash.set(id));
    }
    this.flashTimer = setTimeout(() => this.flash.set(null), 1400);
  }

  /** Last section whose heading passed the reading line is the one being read. */
  private syncActive(panel: HTMLElement): void {
    const line = panel.getBoundingClientRect().top + (panel.querySelector<HTMLElement>('.hero')?.offsetHeight ?? 0) + SPY_CLEARANCE_PX;
    let next: SectionId = this.sections()[0] ?? 'prep';
    for (const id of this.sections()) {
      const el = panel.querySelector<HTMLElement>(`#pd-${id}`);
      if (el && el.getBoundingClientRect().top <= line) next = id;
    }
    if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) next = this.sections()[this.sections().length - 1] ?? next;
    if (next !== this.active()) this.chosen.set(next);
  }

  stateLine(): string {
    const c = this.card();
    if (!c) return '';
    const parts: string[] = [];
    if (c.status === 'live' && c.liveAt) parts.push(this.t.instant('news.patch.stack.liveSince', { date: this.date(c.liveAt) }));
    if ((c.status === 'ptu' || c.status === 'evocati') && c.firstTestAt) {
      parts.push(this.t.instant('news.patch.stack.inRing', { ring: this.t.instant('news.patch.stage.' + c.status), n: c.waveCount, ago: c.group ? relativeTime(c.group.latestAt, this.now(), (k, p) => this.t.instant(k, p)) : '' }));
    }
    if (c.status === 'superseded' && c.liveAt) parts.push(this.t.instant('news.patch.stack.liveSpan', { from: this.date(c.liveAt), to: c.supersededAt ? this.date(c.supersededAt) : '' }));
    if (c.status === 'next') parts.push(c.release?.quarter ? this.t.instant('news.patch.stack.plannedFor', { quarter: c.release.quarter }) : this.t.instant('news.patch.stack.noBuild'));
    if (c.hotfixCount > 0) {
      parts.push(c.hotfixCount === 1
        ? this.t.instant('news.patch.stack.hotfixOne', { date: c.lastHotfixAt ? this.date(c.lastHotfixAt) : '' })
        : this.t.instant('news.patch.stack.hotfixes', { n: c.hotfixCount, date: c.lastHotfixAt ? this.date(c.lastHotfixAt) : '' }));
    }
    if (c.noteCount > 0) parts.push(this.t.instant('news.patch.stack.notes', { n: c.noteCount }));
    if (c.plannedCount > 0) parts.push(this.t.instant('news.patch.stack.planned', { n: c.plannedCount }));
    return parts.join(' · ');
  }

  bulletsFor(item: RoadmapCard): string[] | null {
    const lines = this.matches().byCard.get(item.id);
    return lines && lines.length > 0 ? lines : null;
  }
  isLong(id: string): boolean {
    return this.longOverride().get(id) ?? this.allLong();
  }
  toggleLong(id: string): void {
    const next = new Map(this.longOverride());
    next.set(id, !this.isLong(id));
    this.longOverride.set(next);
  }
  toggleAllLong(): void {
    this.allLong.update((v) => !v);
    this.longOverride.set(new Map());
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
  clearQuery(): void {
    this.query.set('');
  }
  /** Fetch every note of the line — the "search the remaining waves" action, bounded by the service's concurrency. */
  loadAll(): void {
    const slugs = (this.card()?.group?.entries ?? []).map((e) => threadSlugOf(e.item.url)).filter(Boolean);
    this.roadmap.requestOutlines(slugs);
    this.notesOpen.set(true);
  }
  isOpen(entry: PatchNoteEntry): boolean {
    return this.entryOverride().get(entry.item.id) ?? false;
  }
  toggleEntry(id: string): void {
    const next = new Map(this.entryOverride());
    next.set(id, !(next.get(id) ?? false));
    this.entryOverride.set(next);
  }
  slugOf(entry: PatchNoteEntry): string {
    return threadSlugOf(entry.item.url);
  }
  /** Every spelling of the query — a British search still lights up American text. */
  private readonly marks = computed(() => fuzzyTokens(this.tokens()));

  mark(text: string): HighlightSegment[] {
    return highlightSegments(text, this.marks());
  }

  /** RSI's own Release View entry for a roadmap card; '' when it has no id. */
  cardUrl(item: RoadmapCard): string {
    return roadmapCardUrl(item);
  }
  relTime(iso: string): string {
    return relativeTime(iso, this.now(), (k, p) => this.t.instant(k, p));
  }
  private date(ms: number): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
}
