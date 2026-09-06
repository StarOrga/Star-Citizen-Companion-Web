import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LocaleService } from '../core/locale/locale.service';
import { NewsService } from './news.service';
import { findInStack, findTotal, type FindGroup } from './patch-find';
import { PatchFindResultsComponent } from './patch-find-results.component';
import { tokenizeQuery } from './patch-search';
import { PatchMonitorComponent } from './patch-monitor.component';
import type { StabilityVerdict } from './patch-stability';
import { PatchStabilityService } from './patch-stability.service';
import { buildPatchStack, stackCards, type StackCard } from './patch-stack';
import { computePatchForecast } from './patch-stats';
import { TEASER_BOX, TeaserStripDirective, teaserFit, type TeaserBox, type TeaserFit } from './patch-teaser';
import type { RoadmapCard } from './roadmap';
import { RoadmapService, threadSlugOf } from './roadmap.service';
import { relativeTime } from './relative-time';
import { StabilityBadgeComponent } from './stability-badge.component';
import { StabilityHistoryComponent } from './stability-history.component';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `/news/patches` — the patch board (2026-09-04 rethink, design Ⓚ).
 *
 * Four rounds of concept iterations replaced the band stack (search, roadmap
 * wall, cadence carousel, newest-per-channel, two chip rows, history) with
 * exactly two things: a search field and a TIME STACK — future on top, now in
 * the middle, past below, on one spine — with three cards open on arrival (the
 * next patch, the live one, the one it replaced) and everything older folded.
 * Status is a WORD in a colour on every card; the live card dominates.
 *
 * Nothing that used to be on the board is gone from the app: every detail
 * moved into the patch DOSSIER, a routed overlay one click away
 * (`/news/patches/:line`, rendered through the outlet below so the board stays
 * behind it). The two chip filters are the one deliberate removal — "die
 * Patch-Auswahl neben der Suche macht keinen Sinn, wir haben die Patches ja
 * schon übersichtlich unten" — the stack IS the selection.
 *
 * Search on this level finds PATCHES: cards get a hit count from their note
 * titles, the bullet points of loaded notes and their roadmap items, and the
 * query travels into the dossier (`?q=`) so a click lands on the highlighted
 * hits without retyping.
 */
@Component({
  selector: 'sc-patch-board',
  standalone: true,
  imports: [
    TranslateModule, RouterLink, RouterOutlet, PatchMonitorComponent,
    StabilityHistoryComponent, StabilityBadgeComponent, PatchFindResultsComponent,
    TeaserStripDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="board">
      <header class="head">
        <a class="back" routerLink="/news">← {{ 'news.patch.board.back' | translate }}</a>
        <h1>{{ 'news.patch.board.title' | translate }}</h1>
        <p class="sub">{{ 'news.patch.board.sub' | translate }}</p>
      </header>

      @if (svc.error(); as err) {
        <div class="sc-card err"><strong>{{ 'news.errorTitle' | translate }}:</strong> {{ err }}</div>
      } @else if (svc.loading() && !svc.feed()) {
        <!-- The feed takes a moment often enough to be worth a shape rather
             than a word (owner, 2026-09-05: "Die Patch notes laden manchmal").
             Three placeholders in the stack's own geometry, so the real cards
             land where the skeleton stood instead of shoving the page. -->
        <ol class="stack skeleton" aria-hidden="true">
          @for (n of [0, 1, 2]; track n) {
            <li class="row" [style.--in-delay]="n * 90 + 'ms'"><span class="card sk"></span></li>
          }
        </ol>
        <p class="loading" role="status">{{ 'news.loading' | translate }}</p>
      } @else {
        <!-- The question people arrive with, answered before the list starts
             (feedback 01df732d): a monitoring panel over search and stack.
             While a query is running both this and the all-time chart step
             aside — a search is a different question, and the reader asked for
             the answer, not for the dashboard above it (owner, 2026-09-05). -->
        @if (!searching()) {
          <sc-patch-monitor [stack]="stack()" [groups]="svc.patchLines()" [now]="now()" />

          @if (!stability.unavailable()) {
            <sc-stability-history [verdicts]="stability.allTime()" (showLine)="openLine($event)" />
          }
        }

        <!-- The ONE control on this level, and it stays reachable: stuck to the
             top, so a long result list never strands the reader away from the
             field that produced it. A label, not a placeholder, so the field
             keeps its description while you type. -->
        <div class="search" [class.active]="searching()">
          <label class="s-label" for="patch-board-search">{{ 'news.patch.search.label' | translate }}</label>
          <div class="s-field">
            <input id="patch-board-search" type="search" class="s-input"
                   autocomplete="off" spellcheck="false"
                   [attr.placeholder]="'news.patch.search.placeholder' | translate"
                   [value]="query()"
                   (input)="onQuery($event)"
                   (keydown.escape)="clearQuery()" />
            @if (query()) {
              <button type="button" class="s-clear"
                      [attr.aria-label]="'news.patch.search.clear' | translate"
                      (click)="clearQuery()">×</button>
            }
          </div>
          @if (searching()) {
            <p class="s-summary" role="status">
              {{ 'news.patch.find.summary' | translate:{ hits: findTotal(), patches: findGroups().length, loaded: roadmap.loadedOutlineCount(), total: noteTotal() } }}
              @if (unloadedCount() > 0) {
                <!-- Searching the notes that are not in memory yet is an ACTION
                     on this page → a button, not a link. -->
                <button type="button" class="s-more" (click)="loadAllNotes()" [disabled]="loadingNotes()">
                  {{ (loadingNotes() ? 'news.patch.find.loading' : 'news.patch.find.loadRest') | translate:{ n: unloadedCount() } }}
                </button>
              }
            </p>
          }
        </div>

        @if (searching()) {
          @if (findGroups().length === 0) {
            <p class="empty">{{ 'news.patch.search.noHits' | translate }}</p>
          } @else {
            <sc-patch-find-results [groups]="findGroups()" [query]="query()" [tokens]="tokens()" />
          }
        } @else {
          <ol class="stack" [attr.aria-label]="'news.patch.stack.aria' | translate">
            @for (card of visible(); track card.line; let i = $index) {
              <li class="row" [attr.data-status]="card.status" [class.hero]="card.status === 'live'"
                  [style.--in-delay]="i * 60 + 'ms'">
                <div class="card">
                  <!-- The whole card is the way into the dossier → a real
                       anchor, so middle click and "open in new tab" keep
                       working. It is STRETCHED over the card rather than
                       wrapping it, because the roadmap thumbnails inside are
                       links of their own now (feedback fdaad6b7) and an anchor
                       inside an anchor is not HTML. -->
                  <a class="card-link" [routerLink]="['/news/patches', card.line]"
                     [queryParams]="query() ? { q: query() } : null"
                     [attr.aria-label]="cardLabel(card)"></a>
                  <span class="status" [attr.data-status]="card.status">
                    {{ ('news.patch.status.' + card.status) | translate }}
                    @if (statusNote(card); as note) { <small>{{ note }}</small> }
                  </span>
                  <span class="ver">{{ card.line ? ('news.patch.line' | translate:{ version: card.line }) : ('news.patch.otherLine' | translate) }}</span>
                  <span class="sent">
                    <b>{{ sentence(card) }}</b>
                    @if (facts(card); as f) { <span class="facts">{{ f }}</span> }
                    @if (card.status === 'next' || card.status === 'ptu' || card.status === 'evocati') {
                      @if (teaserPool(card).length > 0) {
                        <!-- As many roadmap items as TWO rows of the measured
                             width hold, then "…" — and every one of them a
                             link to its own entry in the dossier. The names
                             that used to run along the strip are gone: they
                             were the thing that made room for three icons and
                             no more (feedback fdaad6b7). They survive as the
                             links' accessible names. -->
                        <span class="teaser" (scTeaserStrip)="onTeaserBox(card.line, $event)">
                          @for (item of teaser(card); track item.id) {
                            <a class="tz" [routerLink]="['/news/patches', card.line]"
                               [queryParams]="itemParams(item)"
                               [attr.aria-label]="'news.patch.stack.openItem' | translate:{ name: item.name }">
                              @if (item.thumbnail) {
                                <img [src]="item.thumbnail" alt="" loading="lazy" decoding="async" />
                              } @else {
                                <i aria-hidden="true"></i>
                              }
                            </a>
                          }
                          @if (teaserRest(card); as rest) {
                            <a class="tz rest" [routerLink]="['/news/patches', card.line]"
                               [queryParams]="itemParams(firstHidden(card))"
                               [attr.aria-label]="'news.patch.stack.moreItems' | translate:{ n: rest }">…</a>
                          }
                        </span>
                      }
                    }
                  </span>
                  <!-- No note count here any more: "die x notes in dieser
                       Übersicht ist auch unnötig" (feedback fdaad6b7). How
                       many notes a line has is a fact of the dossier, which
                       still states it; on the board it was a number nobody
                       chose a patch by. -->
                  <!-- How the patch RAN, as a picture in the corner — only on
                       lines that actually shipped (owner, 2026-09-05). -->
                  @if (verdictFor(card); as v) {
                    <span class="stab"><sc-stability-badge [verdict]="v" [size]="card.status === 'live' ? 'md' : 'sm'" /></span>
                  }
                </div>
              </li>
            }
            @if (stack().older.length > 0) {
              <li class="row fold">
                <!-- Folding older lines is an action on this page → button. -->
                <button type="button" class="fold-btn" [attr.aria-expanded]="olderOpen()" (click)="toggleOlder()">
                  <span class="caret" aria-hidden="true">›</span>
                  {{ (olderOpen() ? 'news.patch.stack.olderHide' : 'news.patch.stack.older') | translate:{ n: stack().older.length, lines: olderLines() } }}
                </button>
              </li>
            }
          </ol>
        }
      }
    </section>

    <!-- The dossier: /news/patches/:line renders here, over the board. -->
    <router-outlet />
  `,
  styles: [`
    :host { display: block; }
    .board { display: flex; flex-direction: column; gap: 14px; }
    .head { padding-left: 6px; }
    .back {
      display: inline-block; margin-bottom: 10px; min-height: var(--sc-tap-min);
      color: var(--sc-fg-2); text-decoration: none; font-size: max(0.76rem, var(--sc-fs-floor));
    }
    .back:hover { color: var(--sc-accent); }
    .back:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 3px; border-radius: 4px; }
    h1 { margin: 0; }
    .sub { margin: 4px 0 0; color: var(--sc-fg-2); }
    .loading, .err, .empty { padding: 16px; margin: 0; }
    .skeleton .card {
      display: block; min-height: 128px;
      background: linear-gradient(100deg, var(--sc-bg-1) 30%, color-mix(in srgb, var(--sc-fg-2) 12%, var(--sc-bg-1)) 50%, var(--sc-bg-1) 70%);
      background-size: 240% 100%; animation: pb-shimmer 1.5s linear infinite;
    }
    .skeleton .row:nth-child(2) .card { min-height: 132px; }
    @keyframes pb-shimmer { from { background-position: 140% 0; } to { background-position: -40% 0; } }
    @media (prefers-reduced-motion: reduce) { .skeleton .card { animation: none; } }
    .err { color: var(--sc-danger); }
    .empty { color: var(--sc-fg-2); }

    /* Sticky, because the field IS the page while a query runs: the results
       below it can be hundreds of lines and scrolling back up to correct a
       typo should not be a journey (owner, 2026-09-05). The backdrop is
       opaque enough that result cards passing underneath stay unreadable
       rather than showing through as noise. */
    .search {
      position: sticky; top: 0; z-index: 5;
      display: flex; flex-direction: column; gap: 5px;
      padding: 8px 0 10px; margin-top: -8px;
      background: linear-gradient(180deg, var(--sc-bg-0) 78%, transparent);
    }
    .search.active {
      background: color-mix(in srgb, var(--sc-bg-0) 94%, transparent);
      -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
      border-bottom: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
    }
    .s-label { font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .s-field { position: relative; display: flex; }
    .s-input {
      flex: 1 1 auto; min-height: var(--sc-tap-min); padding: 10px 40px 10px 12px;
      border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0);
      color: var(--sc-fg-0); font: inherit; font-size: max(0.9rem, var(--sc-fs-floor));
    }
    .s-input::placeholder { color: var(--sc-fg-2); }
    .s-input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .s-input::-webkit-search-cancel-button { display: none; }
    .s-clear {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      min-width: var(--sc-tap-min); min-height: var(--sc-tap-min);
      border: 0; background: transparent; color: var(--sc-fg-2); font-size: 1.2rem; cursor: pointer;
    }
    .s-clear:hover { color: var(--sc-fg-0); }
    .s-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .s-more {
      display: inline-flex; align-items: center; min-height: var(--sc-tap-min);
      padding: 2px 10px; border-radius: 999px; border: 1px solid var(--sc-border);
      background: transparent; color: var(--sc-fg-1); font: inherit;
      font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer;
    }
    .s-more:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); }
    .s-more:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .s-more:disabled { opacity: 0.6; cursor: default; }

    /* The stack: one spine on the left, future → past top to bottom. */
    .stack { list-style: none; margin: 0; padding: 0 0 0 24px; position: relative; display: flex; flex-direction: column; gap: 10px; }
    .stack::before {
      content: ''; position: absolute; left: 9px; top: 14px; bottom: 14px; width: 2px;
      background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 55%, transparent), var(--sc-success) 45%, color-mix(in srgb, var(--sc-fg-2) 35%, transparent));
    }
    .row { position: relative; }
    .row::before {
      content: ''; position: absolute; left: -20px; top: 50%; width: 10px; height: 10px; border-radius: 50%;
      transform: translateY(-50%); background: var(--sc-fg-2); border: 2px solid var(--sc-bg-0);
    }
    .row[data-status='live']::before { width: 14px; height: 14px; left: -22px; background: var(--sc-success); box-shadow: var(--sc-glow); }
    .row[data-status='next']::before, .row[data-status='ptu']::before, .row[data-status='evocati']::before { background: var(--sc-accent); }
    /* ONE geometry for every card (owner, 2026-09-05: "Die Labels live etc.
       darin sollten immer gleich breit sein. Die Patch zahl auch immer an der
       gleichen stelle horizontal anfangen"). The columns used to widen with
       importance — 150 / 170 / 190 px — which moved the status word and the
       version number by 40 px between neighbouring rows and made the stack
       look like three different lists. Status and version now sit in the same
       two columns on every row, and the live card is louder through colour,
       type size and breathing room instead of through geometry. The last
       column collapses to 0 when the card carries no stability badge, so
       nothing reserves space for an absent thing. */
    .card {
      position: relative;
      display: grid; grid-template-columns: 116px 150px minmax(0, 1fr) auto;
      align-items: center; gap: 10px 18px;
      padding: 14px 16px; min-height: var(--row-h); overflow: hidden;
      border: 1px solid var(--sc-border); border-radius: 10px;
      background: var(--sc-bg-1); color: var(--sc-fg-0); text-decoration: none;
    }
    /* One height for every ordinary row (owner: "abgelöst und nächster gleich
       hoch"). A min-height cannot deliver that on its own — the "next" card
       carries a roadmap teaser its neighbour does not, which pushed it 60 px
       taller. So the ordinary rows get a FIXED height and their contents are
       kept inside it: the teaser is a clipped block of at most two rows, the
       sentence clamps to two lines.

       That fixed height grew with the thumbnails (feedback fdaad6b7 round 2:
       double the icons, two rows). The whole stack pays for the teaser card,
       which is the price of the shared height — and the hero grows with it,
       because a LIVE card shorter than the rows around it would be the loudest
       thing on the page rendered as the smallest. */
    .stack { --row-h: 220px; }
    .row:not(.hero) .card { height: var(--row-h); }
    .sent b {
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;
      overflow: hidden;
    }
    .card:hover { border-color: var(--sc-accent); }
    /* The stretched link: it covers the card, so a click anywhere that is not
       one of the roadmap thumbnails opens the dossier — the behaviour the
       wrapping anchor had, without nesting anchors. Absolutely positioned, so
       it claims no grid track. */
    .card-link { position: absolute; inset: 0; border-radius: 10px; }
    .card:has(.card-link:focus-visible) { border-color: var(--sc-accent); }
    .card-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .row.hero .card {
      padding: 22px 16px; min-height: var(--row-h);
      border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border));
      background: linear-gradient(135deg, color-mix(in srgb, var(--sc-success) 10%, var(--sc-bg-1)), var(--sc-bg-1) 60%);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--sc-success) 18%, transparent);
    }
    .row[data-status='next'] .card, .row[data-status='ptu'] .card, .row[data-status='evocati'] .card {
      border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
      background: linear-gradient(135deg, color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-1)), var(--sc-bg-1) 60%);
    }
    .row[data-status='superseded'] .card, .row[data-status='other'] .card { opacity: 0.78; }

    /* Cards arrive rather than appear: the stack is a time axis, so the rows
       fly in along it, staggered by their position (--in-delay). Purely
       decorative — reduced motion drops it entirely. */
    .row { animation: pb-in 0.42s cubic-bezier(0.22, 0.9, 0.3, 1) both; animation-delay: var(--in-delay, 0ms); }
    @keyframes pb-in { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }

    /* Status = a WORD in a colour; LIVE filled and glowing. */
    /* Fixed width, centred: LIVE, PTU and ABGELÖST are 3 to 9 characters and
       used to make three differently-sized boxes down the left edge. */
    .status {
      display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
      width: 100%; padding: 5px 8px; border-radius: 6px;
      font-family: var(--sc-font-display); font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; text-align: center;
      justify-self: start;
    }
    .status small { font-family: var(--sc-font-body); font-weight: 400; letter-spacing: 0; text-transform: none; font-size: max(0.64rem, var(--sc-fs-floor)); opacity: 0.85; white-space: nowrap; }
    .status[data-status='live'] { color: var(--sc-bg-0); background: var(--sc-success); box-shadow: 0 0 18px color-mix(in srgb, var(--sc-success) 35%, transparent); }
    .status[data-status='next'] { color: var(--sc-accent); border: 1.5px solid var(--sc-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
    .status[data-status='ptu'] { color: var(--sc-accent); border: 1.5px solid var(--sc-accent); }
    .status[data-status='evocati'] { color: var(--sc-fg-1); border: 1.5px solid color-mix(in srgb, var(--sc-fg-1) 50%, transparent); }
    .status[data-status='superseded'], .status[data-status='other'] { color: var(--sc-fg-2); border: 1.5px solid color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }

    .ver { font-family: var(--sc-font-display); font-size: 1.15rem; font-weight: 600; letter-spacing: 0.02em; }
    .row.hero .ver { font-size: 2rem; }
    .row[data-status='next'] .ver, .row[data-status='ptu'] .ver, .row[data-status='evocati'] .ver { font-size: 1.5rem; }
    .sent { display: flex; flex-direction: column; gap: 4px; min-width: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sent b { color: var(--sc-fg-0); font-weight: 500; }
    .row.hero .sent { font-size: max(0.84rem, var(--sc-fs-floor)); }
    /* Two rows, never three: the wrap is capped by a max-height derived from
       the same custom properties the strip is drawn with, which is what keeps
       the card's height independent of how many items the roadmap lists. The
       properties ARE the strip's geometry — TeaserStripDirective reads them
       back out of the computed style, so the phone breakpoint below is the
       ONLY place the smaller thumbnail is written down.

       The thumbnails are double their round-1 size (48 → 96 px wide, 30 → 60
       tall) at the admin's request. A welcome side effect: at 96 × 60 every
       thumbnail clears the 48 px tap target that the round-1 strip missed on
       both breakpoints. */
    .teaser {
      --tz-w: 96px; --tz-h: 60px; --tz-rest: 40px; --tz-gap: 6px; --tz-rows: 2;
      display: flex; align-items: center; align-content: flex-start;
      gap: var(--tz-gap); margin-top: 4px; flex-wrap: wrap; min-width: 0;
      max-height: calc(var(--tz-rows) * var(--tz-h) + (var(--tz-rows) - 1) * var(--tz-gap));
      overflow: hidden;
    }
    /* Each thumbnail is its own link into its own roadmap entry, so it has to
       sit ABOVE the stretched card link (feedback fdaad6b7). */
    .teaser .tz {
      position: relative; z-index: 1; display: block; flex: none;
      width: var(--tz-w); height: var(--tz-h); border-radius: 6px; overflow: hidden;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); background: var(--sc-bg-2);
    }
    .teaser .tz img, .teaser .tz i { display: block; width: 100%; height: 100%; object-fit: cover; }
    .teaser .tz:hover { border-color: var(--sc-accent); box-shadow: 0 0 10px -2px var(--sc-accent); }
    .teaser .tz:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    /* "… and more" — the same height as a thumbnail so it sits on the strip's
       last row, narrower because it is a sign, not a tile. */
    .teaser .rest {
      width: var(--tz-rest); display: flex; align-items: center; justify-content: center;
      border-style: dashed; background: transparent; color: var(--sc-fg-2); text-decoration: none;
      font-size: max(1rem, var(--sc-fs-floor)); line-height: 1;
    }
    .teaser .rest:hover { color: var(--sc-fg-0); }
    /* Top-right corner of the card, in its own column so it can never land on
       top of the sentence the way an absolutely positioned badge would. */
    .stab { display: inline-flex; align-self: start; }

    .fold::before { width: 8px; height: 8px; left: -19px; opacity: 0.6; }
    .fold-btn {
      display: flex; align-items: center; gap: 8px; width: 100%; min-height: var(--sc-tap-min);
      padding: 10px 16px; border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 40%, transparent); border-radius: 10px;
      background: transparent; color: var(--sc-fg-2); font: inherit; font-size: max(0.76rem, var(--sc-fs-floor));
      text-align: left; cursor: pointer;
    }
    .fold-btn:hover { color: var(--sc-fg-0); border-color: var(--sc-accent); }
    .fold-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .fold-btn .caret { color: var(--sc-accent); transition: transform .16s ease; }
    .fold-btn[aria-expanded='true'] .caret { transform: rotate(90deg); }

    @media (max-width: 760px) {
      .stack { padding-left: 18px; }
      .stack::before { left: 5px; }
      .row::before { left: -17px; }
      .row[data-status='live']::before { left: -19px; }
      .fold::before { left: -16px; }
      /* Phones stack the cells into two rows, so the shared height is a
         bigger number here — but it stays SHARED: "abgelöst und nächster
         gleich hoch" is not a desktop-only promise. */
      .stack { --row-h: 248px; }
      .card, .row.hero .card {
        grid-template-columns: 104px minmax(0, 1fr) auto; gap: 8px 10px; padding: 12px;
      }
      .teaser { --tz-w: 84px; --tz-h: 52px; --tz-rest: 34px; }
      .sent { grid-column: 1 / -1; }
      .row.hero .ver { font-size: 1.6rem; }
      .stab { grid-row: 1; grid-column: 3; }
    }
  `],
})
export class PatchBoardComponent implements OnInit, OnDestroy {
  readonly svc = inject(NewsService);
  readonly roadmap = inject(RoadmapService);
  readonly stability = inject(PatchStabilityService);
  private readonly t = inject(TranslateService);
  private readonly locale = inject(LocaleService);
  private readonly router = inject(Router);

  readonly query = signal('');
  readonly tokens = computed(() => tokenizeQuery(this.query()));
  readonly olderOpen = signal(false);

  readonly stack = computed(() => buildPatchStack(this.svc.patchLines(), this.roadmap.roadmap()));
  readonly forecast = computed(() => computePatchForecast(this.svc.patchLines()));

  /** True once the reader has typed something the search can act on. */
  readonly searching = computed(() => this.tokens().length > 0);

  /** Cards on screen: three by default, older ones when unfolded. */
  readonly visible = computed<StackCard[]>(() => {
    const s = this.stack();
    const top = [s.next, s.live, s.last].filter((c): c is StackCard => c !== null);
    return this.olderOpen() ? [...top, ...s.older] : top;
  });

  /**
   * The search result: the matching CONTENT, grouped by patch.
   *
   * The board used to answer a query with its own cards plus a hit count, so
   * finding something still cost a click into the dossier and a second search
   * there. Now the answer is the roadmap items and note bullets themselves —
   * `patch-find` builds them, `sc-patch-find-results` renders them (owner,
   * 2026-09-05). Reading `roadmap.outlines()` here is what makes the list grow
   * as notes stream in.
   */
  readonly findGroups = computed<FindGroup[]>(() => {
    if (!this.searching()) return [];
    const outlines = this.roadmap.outlines();
    return findInStack(stackCards(this.stack()), (slug) => outlines.get(slug) ?? null, this.tokens());
  });

  readonly findTotal = computed(() => findTotal(this.findGroups()));

  /** Every note slug of every line in the stack — what a full search covers. */
  private readonly allSlugs = computed<string[]>(() => {
    const out: string[] = [];
    for (const card of stackCards(this.stack())) {
      for (const entry of card.group?.entries ?? []) {
        const slug = threadSlugOf(entry.item.url);
        if (slug && !out.includes(slug)) out.push(slug);
      }
    }
    return out;
  });

  readonly noteTotal = computed(() => this.allSlugs().length);
  /**
   * Notes the search has not seen yet. `hasOutline` is the only honest test:
   * a note that came back empty is searched, not pending, and must not keep
   * offering a button that would fetch nothing.
   */
  readonly unloadedCount = computed(() => {
    this.roadmap.outlines();
    this.roadmap.pending();
    return this.allSlugs().filter((slug) => !this.roadmap.hasOutline(slug) && !this.roadmap.isMissing(slug)).length;
  });
  readonly loadingNotes = computed(() => this.roadmap.pending().size > 0);

  readonly olderLines = computed(() => this.stack().older.map((c) => c.line || '…').join(' · '));

  readonly now = signal(Date.now());
  private readonly clockTimer = setInterval(() => this.now.set(Date.now()), 30_000);

  /** The roadmap is what names the "next" card, so it belongs to the board now. */
  private readonly loadRoadmapOnce = effect(() => {
    void this.roadmap.loadRoadmap();
  });

  /** The all-time chart needs its own tables; quiet-fail like everything else here. */
  private readonly loadStabilityOnce = effect(() => {
    void this.stability.load();
  });

  /**
   * Seed the newest note of each open card — the build in testing, the live
   * one and the one it replaced — so the search can see their bullet points
   * from the first keystroke. Same trade-off as before: a handful of outlines,
   * one request, and the summary line says how many of the history's notes
   * that actually covers, with a button for the rest.
   */
  private readonly seedOutlines = effect(() => {
    const s = this.stack();
    const slugs = [s.next, s.live, s.last]
      .filter((c): c is StackCard => c !== null && c.group !== null)
      .map((c) => threadSlugOf(c.group!.entries[0]?.item.url ?? ''))
      .filter(Boolean);
    if (slugs.length > 0) untracked(() => this.roadmap.requestOutlines(slugs));
  });

  ngOnInit(): void {
    void this.svc.refresh();
    this.svc.startPolling();
  }

  ngOnDestroy(): void {
    this.svc.stopPolling();
    clearInterval(this.clockTimer);
  }

  onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }
  clearQuery(): void {
    this.query.set('');
  }
  toggleOlder(): void {
    this.olderOpen.update((v) => !v);
  }

  /** A chart column picks a line the same way a card does: into its dossier, query preserved. */
  openLine(line: string): void {
    void this.router.navigate(['/news/patches', line], this.query() ? { queryParams: { q: this.query() } } : {});
  }

  /**
   * The stability verdict for a card's corner badge — only for lines that
   * actually reached players. A patch still in a test ring has no stability to
   * report (nobody is living in it yet), and the badge component hides itself
   * for lines the sampler has no verdict on.
   */
  verdictFor(card: StackCard): StabilityVerdict | null {
    if (!card.line || card.liveAt === null) return null;
    return this.stability.verdictFor(card.line);
  }

  /** Pull in every note of the stack so the search covers the whole history. */
  loadAllNotes(): void {
    this.roadmap.requestOutlines(this.allSlugs());
  }

  /** The small word after the status: "seit 8 Tagen", "Q3 2026", "durch 4.10". */
  statusNote(card: StackCard): string {
    switch (card.status) {
      case 'live':
        return card.liveAt ? this.t.instant('news.patch.stack.sinceDays', { n: this.daysSince(card.liveAt) }) : '';
      case 'next':
        return card.release?.quarter ?? '';
      case 'ptu':
      case 'evocati':
        return card.firstTestAt ? this.t.instant('news.patch.stack.sinceDays', { n: this.daysSince(card.firstTestAt) }) : '';
      case 'superseded':
        return card.supersededAt ? this.t.instant('news.patch.stack.replaced', { date: this.date(card.supersededAt) }) : '';
      default:
        return '';
    }
  }

  /** The one bold statement per card. */
  sentence(card: StackCard): string {
    switch (card.status) {
      case 'live':
        return card.liveAt ? this.t.instant('news.patch.stack.liveSince', { date: this.date(card.liveAt) }) : '';
      case 'next': {
        const ptu = this.forecast().find((r) => r.key === 'ptu');
        return ptu
          ? this.t.instant('news.patch.stack.ptuExpected', { when: this.until(Date.parse(ptu.at)) })
          : this.t.instant('news.patch.stack.noBuild');
      }
      case 'ptu':
      case 'evocati':
        return this.t.instant('news.patch.stack.inRing', {
          ring: this.t.instant('news.patch.stage.' + card.status),
          n: card.waveCount,
          ago: card.group ? relativeTime(card.group.latestAt, this.now(), (k, p) => this.t.instant(k, p)) : '',
        });
      case 'superseded':
        return card.liveAt
          ? this.t.instant('news.patch.stack.liveSpan', { from: this.date(card.liveAt), to: card.supersededAt ? this.date(card.supersededAt) : '' })
          : this.t.instant('news.patch.stack.neverLive');
      default:
        return this.t.instant('news.patch.otherLine');
    }
  }

  /** The quiet second line: hotfixes, the next-Live estimate, planned items. */
  facts(card: StackCard): string {
    const parts: string[] = [];
    if (card.hotfixCount > 0) {
      parts.push(
        card.hotfixCount === 1
          ? this.t.instant('news.patch.stack.hotfixOne', { date: card.lastHotfixAt ? this.date(card.lastHotfixAt) : '' })
          : this.t.instant('news.patch.stack.hotfixes', { n: card.hotfixCount, date: card.lastHotfixAt ? this.date(card.lastHotfixAt) : '' }),
      );
    }
    if (card.status === 'live') {
      const live = this.forecast().find((r) => r.key === 'live');
      if (live) parts.push(this.t.instant('news.patch.stack.nextLive', { when: this.until(Date.parse(live.at)) }));
    }
    return parts.join(' · ');
  }

  /**
   * The accessible name of the stretched card link.
   *
   * A wrapping anchor took its name from the card's own text; a stretched one
   * is empty and has to be told. "Dossier zu Alpha 4.11 öffnen" — the version
   * is what the reader is choosing between, everything else on the card is
   * detail they can read for themselves.
   */
  cardLabel(card: StackCard): string {
    const name = card.line
      ? this.t.instant('news.patch.line', { version: card.line })
      : this.t.instant('news.patch.otherLine');
    return this.t.instant('news.patch.stack.openDossier', { name });
  }

  /**
   * Measured geometry per row, keyed by patch line.
   *
   * Per ROW, not per board: the cards differ in what else sits beside the
   * strip (a stability badge, a longer version number), so the width they
   * leave it is not the same number — and a shared one would be wrong on
   * whichever row was not measured.
   */
  private readonly teaserBoxes = signal<ReadonlyMap<string, TeaserBox>>(new Map());

  onTeaserBox(line: string, box: TeaserBox): void {
    const current = this.teaserBoxes().get(line);
    if (current && current.width === box.width && current.item === box.item && current.gap === box.gap && current.rest === box.rest) return;
    this.teaserBoxes.update((map) => new Map(map).set(line, box));
  }

  /**
   * Every roadmap item of an upcoming patch, the ones with a picture first —
   * "die sind ja die spannenden" (feedback fdaad6b7). The itemless ones keep
   * their place in the strip as placeholders rather than vanishing, so the
   * count under the "…" is the release's real count.
   */
  teaserPool(card: StackCard): readonly RoadmapCard[] {
    const cards = card.release?.cards ?? [];
    if (cards.length === 0) return cards;
    const withImage = cards.filter((c) => c.thumbnail);
    if (withImage.length === 0 || withImage.length === cards.length) return cards;
    return [...withImage, ...cards.filter((c) => !c.thumbnail)];
  }

  private fit(card: StackCard): TeaserFit {
    return teaserFit(this.teaserPool(card).length, this.teaserBoxes().get(card.line) ?? TEASER_BOX);
  }

  /** The thumbnails this row has room for. */
  teaser(card: StackCard): readonly RoadmapCard[] {
    return this.teaserPool(card).slice(0, this.fit(card).visible);
  }
  /** How many roadmap items did not fit — 0 when everything is on the strip. */
  teaserRest(card: StackCard): number {
    return this.fit(card).rest;
  }
  /** Where the "…" leads: the first item the strip could not show. */
  firstHidden(card: StackCard): RoadmapCard | null {
    const pool = this.teaserPool(card);
    return pool[this.fit(card).visible] ?? pool[pool.length - 1] ?? null;
  }
  /** A link into ONE roadmap entry of the dossier, carrying the board's query along. */
  itemParams(item: RoadmapCard | null): Record<string, string> {
    const params: Record<string, string> = item ? { focus: item.id } : {};
    const q = this.query();
    return q ? { ...params, q } : params;
  }

  private daysSince(ms: number): number {
    return Math.max(0, Math.floor((this.now() - ms) / DAY_MS));
  }

  private date(ms: number): string {
    try {
      return new Intl.DateTimeFormat(this.locale.intlLocale(), { day: 'numeric', month: 'short' }).format(ms);
    } catch {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /** "in ~6 Wochen" / "2 Wo. überfällig" — the forecast grammar the app already speaks. */
  private until(atMs: number): string {
    const days = Math.round((atMs - this.now()) / DAY_MS);
    if (days === 0) return this.t.instant('news.patch.forecast.today');
    const overdue = days < 0;
    const n = Math.abs(days);
    if (n < 14) return this.t.instant(overdue ? 'news.patch.forecast.overdueDays' : 'news.patch.forecast.inDays', { n });
    const weeks = Math.round(n / 7);
    return this.t.instant(overdue ? 'news.patch.forecast.overdueWeeks' : 'news.patch.forecast.inWeeks', { n: weeks });
  }
}
