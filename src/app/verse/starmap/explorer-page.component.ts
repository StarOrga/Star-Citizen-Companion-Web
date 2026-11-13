import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseComet, VerseExplorerPatch } from '../data/verse.models';
import { currentPatchName } from '../data/patch-alias';
import { StarmapMiniComponent } from './starmap-mini.component';
import { CometTrackComponent } from './comet-track.component';
import { KartographCrestComponent } from './kartograph-crest.component';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { GuessTrackComponent } from './guess-track.component';
import { StarDomeComponent } from './star-dome.component';
import { StarmapTourComponent } from './starmap-tour.component';
import { STARS_PER_PATCH, defaultPatch, hasRankNews, hasTierReward, patchMapView, rankNewsItems, rankProgress, readRankSeen } from './starmap.model';

export { wallpaperConstellations } from './wallpaper';

/** Patches offered in the patch switcher (newest first). */
const MAX_PATCH_OPTIONS = 12;
/** localStorage: patch lines whose completed constellation was already celebrated. */
export const CELEBRATED_KEY = 'sc.starmap.celebrated';

/** Patch lines already celebrated; an unreadable store counts as none (the page renders without it). */
export function celebratedLines(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function markCelebrated(line: string): void {
  try {
    const set = celebratedLines();
    set.add(line);
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...set].slice(-40)));
  } catch {
    /* private mode / quota: the celebration may repeat, nothing breaks */
  }
}

function isComplete(p: VerseExplorerPatch): boolean {
  return p.starCount >= STARS_PER_PATCH;
}

/**
 * The star map ("Sternkarte", Kuppel): one constellation per patch under a dome
 * sky, the comet tip as the main challenge under it and the constellation guess
 * beside it. The head matches the other Verse subpages (title + a plain "?" for
 * the tour, the rank crest on the right as a real anchor to the rank page); the
 * patch switcher sits quietly top left of the dome. Rank ladder, series, the
 * Logbuch extras and the 4K wallpaper live on the rank page.
 *
 * Completion: a constellation that was complete when the user ENTERED the page
 * and was never celebrated plays its celebration once (stored per patch line);
 * a star finished during the visit celebrates on the next visit, not mid-action.
 */
@Component({
  selector: 'sc-explorer-page',
  // Subpages sit in the page frame; only the hub runs edge to edge (concept 2026-10-28).
  host: { class: 'sc-track-page' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslatePipe,
    ScTooltipDirective,
    ScActionDirective,
    StarDomeComponent,
    CometTrackComponent,
    StarmapMiniComponent,
    GuessTrackComponent,
    StarmapTourComponent,
    VerseHeaderComponent,
    ScSelectComponent,
    KartographCrestComponent,
  ],
  template: `
    @if (!signedIn()) {
      <h1 class="sr-only">{{ 'starmap.title' | translate }}</h1>
      <section class="card note">
        <p>{{ 'starmap.signedOut' | translate }}</p>
        <a class="btn" routerLink="/login" [queryParams]="{ redirect: '/verse/explorer' }">{{ 'starmap.signIn' | translate }}</a>
      </section>
    } @else if (api.explorerState() === 'error') {
      <h1 class="sr-only">{{ 'starmap.title' | translate }}</h1>
      <section class="card note" role="alert">
        <p>{{ (api.explorerError() ?? 'errors.generic') | translate }}</p>
        <button type="button" class="btn" (click)="reload()">{{ 'errors.retry' | translate }}</button>
      </section>
    } @else if (!state()) {
      <h1 class="sr-only">{{ 'starmap.title' | translate }}</h1>
      <section class="card note" aria-busy="true"><p>{{ 'starmap.loading' | translate }}</p></section>
    } @else if (!selected()) {
      <h1 class="sr-only">{{ 'starmap.title' | translate }}</h1>
      <section class="card note"><p>{{ 'starmap.empty' | translate }}</p></section>
    } @else {
      @let st = state()!;
      @let p = selected()!;
      @let v = view()!;
      @let k = st.kartograph;
      @let ranked = k.unlocked && k.rank >= 1;
      <div #mapEl class="page" [attr.aria-label]="'starmap.stageAria' | translate: { patch: name(p.patchLine) }" role="region">
        <sc-verse-header planet="starmap" [title]="'verse.area.starmap' | translate"
                         [subtitle]="'starmap.map.subtitle' | translate: { total: total }">
          <sc-starmap-mini vhEmblem [points]="p.constellation?.points" [tasks]="v.tasks" [next]="v.next" />
          <button vhTitle #helpBtn type="button" scAction tier="tertiary" class="help" [attr.aria-expanded]="tourOpen()"
                  aria-controls="starmap-tour" [attr.aria-label]="'starmap.tour.open' | translate"
                  [scTooltip]="'starmap.tour.open' | translate" scTooltipTier="label" (click)="tourOpen.set(!tourOpen())">?</button>
          @let tierName = (ranked ? 'starmap.rankPage.tier.' + rankKey() + '.name' : 'starmap.rankPage.unranked') | translate;
          <a vhActions class="rank" [class.none]="!ranked" [class.news]="rankNews()" data-tour="rank" routerLink="/verse/explorer/rank"
             [attr.aria-label]="((ranked ? 'starmap.rank.link' : 'starmap.rank.none') | translate: { name: tierName }) + (rankNews() ? ' · ' + ('starmap.rank.news' | translate) : '')"
             [scTooltip]="(ranked ? 'starmap.rank.link' : 'starmap.rank.none') | translate: { name: tierName }" scTooltipTier="label">
            @if (rankNews()) { <span class="news-dot" aria-hidden="true"></span> }
            @if (ranked) {
              <sc-kartograph-crest [rank]="k.rank" [size]="40" state="current" [framed]="crestFramed()" [orbit]="crestOrbit()" />
            } @else {
              <svg class="rank-empty" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
                <path d="M20 4 33 9v10c0 8-5.6 14-13 17C12.6 33 7 27 7 19V9z" />
                <path class="q" d="M20 14.5 21.6 19.2 26.5 19.3 22.6 22.2 24 26.9 20 24.1 16 26.9 17.4 22.2 13.5 19.3 18.4 19.2z" />
              </svg>
            }
          </a>
        </sc-verse-header>

        <section class="map sc-enter-stagger">
          <div class="dome-wrap">
            <sc-star-dome class="stage" data-tour="stage" [points]="p.constellation?.points" [tasks]="v.tasks" [next]="v.next"
                          [patchLine]="p.patchLine" [celebrate]="celebrating() === p.patchLine" />
            <div class="corner" data-tour="patch">
              @if (patchOptions().length > 1) {
                <sc-select class="patch-pick compact quiet" [options]="patchOptions()" [value]="p.patchLine" [allowEmpty]="false"
                           [ariaLabel]="'starmap.map.patchesAria' | translate" (valueChange)="selectLine($event)" />
              } @else {
                <span class="patch-one">{{ 'starmap.map.patchLive' | translate: { patch: name(p.patchLine) } }}</span>
              }
            </div>
            @if (celebrating() === p.patchLine) {
              <p class="cele" role="status">
                <small>{{ 'starmap.celebrate.eyebrow' | translate }}</small>
                <b>{{ (shapeName() ? 'starmap.celebrate.named' : 'starmap.celebrate.done') | translate: { name: shapeName() } }}</b>
              </p>
            }
          </div>

          @if (shapeName(); as sn) {
            <p class="caption">{{ 'starmap.map.shape' | translate: { name: sn } }}</p>
          }

          <div class="tracks">
            @if (cometTarget(); as ct) {
              <sc-comet-track class="track comet" data-tour="comet" [patchLine]="ct.patchLine" [comet]="ct.comet" />
            }
            @if (p.guess.state !== 'unavailable') {
              <sc-guess-track class="track guess" data-tour="guess" [patchLine]="p.patchLine" [guess]="p.guess" />
            }
          </div>
        </section>

        @if (tourOpen()) {
          <sc-starmap-tour id="starmap-tour" [root]="mapEl" [returnTo]="helpBtn" (closed)="tourOpen.set(false)" />
        }
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 12px; padding: var(--sc-pad-3); }
      .note { display: flex; gap: var(--sc-gap-2); align-items: center; flex-wrap: wrap; }
      .note p { margin: 0; }
      .btn { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-pad-2); border-radius: 8px;
        border: 1px solid var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0);
        font: inherit; cursor: pointer; text-decoration: none; }
      .btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

      .page { position: relative; }
      /* The plain "?" right after the title: no frame, just the glyph. */
      .help { font: 600 1rem/1 var(--sc-font-display); color: var(--sc-fg-2); align-self: center; }
      .help:hover, .help[aria-expanded='true'] { color: var(--sc-accent); }
      /* The rank crest at the head's right end, a real anchor to the rank page. */
      .rank { display: inline-grid; place-items: center; min-width: var(--sc-tap-min, 44px); min-height: var(--sc-tap-min, 44px);
        color: var(--sc-accent); text-decoration: none; border-radius: 8px; transition: filter 0.15s ease; }
      .rank:hover { filter: brightness(1.2) drop-shadow(0 0 6px color-mix(in srgb, var(--sc-accent) 45%, transparent)); }
      .rank:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .rank-empty { width: 40px; height: 40px; overflow: visible; }
      /* Something new on the rank page: a game-style beacon (pulsing ring + dot) until the page is opened. */
      .rank { position: relative; }
      .rank.news::after { content: ''; position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
        box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-accent) 55%, transparent); animation: ex-beacon 2.2s ease-out infinite; }
      .rank.news { filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 55%, transparent)); }
      .news-dot { position: absolute; z-index: 1; top: 2px; right: 2px; width: 10px; height: 10px; border-radius: 50%;
        background: var(--sc-accent); box-shadow: 0 0 0 2px var(--sc-bg-0), 0 0 8px var(--sc-accent); }
      @keyframes ex-beacon { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--sc-accent) 55%, transparent); }
        70%, 100% { box-shadow: 0 0 0 14px color-mix(in srgb, var(--sc-accent) 0%, transparent); } }
      .rank-empty path { fill: none; stroke: color-mix(in srgb, var(--sc-fg-2) 80%, transparent); stroke-width: 1.4; stroke-dasharray: 3 3; }
      .rank-empty path.q { stroke-dasharray: none; stroke-width: 1; opacity: 0.7; }

      /* No box: the scene shows through. One viewport on desktop - the map takes what the head and shell leave. */
      .map { position: relative; display: grid; grid-template-rows: minmax(0, 1fr) auto auto; gap: 12px; box-sizing: border-box;
        height: calc(100dvh - var(--sc-topbar-h, 64px) - 2 * var(--sc-page-gutter, 24px) - 110px); min-height: 560px; max-height: 1000px; }
      .dome-wrap { position: relative; min-height: 0; }
      .stage { min-height: 0; height: 100%; }
      /* The patch switcher: quiet, top left of the dome, never competing with the map. */
      .corner { position: absolute; z-index: 5; left: 0; top: 0; opacity: 0.72; transition: opacity 0.2s ease; }
      .corner:hover, .corner:focus-within { opacity: 1; }
      .patch-pick { min-width: 132px; }
      .patch-one { display: inline-block; padding: 6px 2px; font: 0.78rem var(--sc-font-display); letter-spacing: 0.16em;
        text-transform: uppercase; color: var(--sc-fg-2); }
      .caption { margin: 0; text-align: center; font-size: 0.8rem; color: var(--sc-fg-1); letter-spacing: 0.04em; }

      /* The comet is the page's main challenge: the wider column, a faint glow under its rail. */
      .tracks { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); grid-template-rows: auto auto auto; column-gap: 6%;
        row-gap: 0; align-items: start; }
      .tracks .track { position: relative; display: grid; grid-row: span 3; grid-template-rows: subgrid; row-gap: 0; align-content: start; }
      .tracks .track:only-child { grid-column: 1 / -1; }
      .tracks .comet::before { content: ''; position: absolute; inset: -14px -18px -10px; z-index: -1; border-radius: 16px; pointer-events: none;
        background: radial-gradient(ellipse 70% 80% at 30% 40%, color-mix(in srgb, var(--sc-accent) 9%, transparent), transparent 75%); }

      /* The completion celebration (once per patch line, on the next visit): a caption over the dome. */
      .cele { position: absolute; z-index: 6; left: 50%; bottom: 6%; translate: -50% 0; margin: 0; padding: 10px 18px; text-align: center;
        border-radius: 12px; pointer-events: none; background: color-mix(in srgb, var(--sc-bg-0) 78%, transparent);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); animation: ex-cele 6.5s ease-out 1.6s both; }
      .cele small { display: block; font: 0.66rem var(--sc-font-display); letter-spacing: 0.22em; text-transform: uppercase; color: var(--sc-accent); }
      .cele b { display: block; margin-top: 4px; font: 600 1rem var(--sc-font-display); color: var(--sc-fg-0); }
      @keyframes ex-cele { 0% { opacity: 0; translate: -50% 8px; } 10%, 82% { opacity: 1; translate: -50% 0; } 100% { opacity: 0; translate: -50% 0; } }
      @keyframes ex-cele-still { 0%, 85% { opacity: 1; } 100% { opacity: 0; } }

      /* Phones / narrow: the page may scroll, the dome keeps a square stage. */
      @media (max-width: 900px), (max-height: 700px) {
        .map { height: auto; min-height: 0; max-height: none; }
        .stage { height: auto; aspect-ratio: 1; max-height: 70dvh; }
        .corner { position: static; margin-bottom: 6px; }
        .tracks { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 22px; }
        .tracks .track { display: block; grid-row: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .cele { animation: ex-cele-still 6.5s linear 0.2s both; }
        .rank { transition: none; }
        .rank.news::after { animation: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 50%, transparent); }
      }
    `,
  ],
})
export class ExplorerPageComponent {
  readonly api = inject(VerseApiService);
  private readonly auth = inject(AuthService);

  readonly total = STARS_PER_PATCH;
  readonly signedIn = this.auth.isAuthenticated;
  readonly state = this.api.explorer;
  private readonly fallback = computed(() => {
    const st = this.state();
    return st ? defaultPatch(st) : null;
  });
  private readonly picked = signal<string | null>(null);
  readonly selected = computed(() => {
    const st = this.state();
    if (!st) return null;
    return st.patches.find((p) => p.patchLine === this.picked()) ?? this.fallback();
  });
  readonly view = computed(() => {
    const p = this.selected();
    return p ? patchMapView(p) : null;
  });
  /** Patch switcher: the live patch first (marked), then the older maps. */
  readonly patchOptions = computed<ScSelectOption[]>(() => {
    const st = this.state();
    const up = st?.upcoming?.patchLine;
    const live = this.fallback();
    return (st?.patches ?? [])
      .filter((p) => p.patchLine !== up || p.liveAt)
      .slice(0, MAX_PATCH_OPTIONS)
      .map((p) => ({ value: p.patchLine, labelKey: p === live ? 'starmap.map.patchLive' : 'starmap.map.patchOld', labelParams: { patch: this.name(p.patchLine) } }));
  });
  /** Display name of a patch line (CIG renames: 4.11 became 5.0); the stored key stays. */
  readonly name = currentPatchName;

  /**
   * Where the comet flies: on the newest map the patch still in testing (the
   * tip is for its LIVE day; the server always names one, the PTU line or live
   * + 1); on an older map that patch's own, closed comet. Without an upcoming
   * patch the newest map must not headline its LIVE patch's closed comet, so
   * the rail is hidden (a tipped / hit / missed record still shows).
   */
  readonly cometTarget = computed<{ patchLine: string; comet: VerseComet } | null>(() => {
    const p = this.selected();
    if (!p) return null;
    const up = this.state()?.upcoming;
    if (p === this.fallback()) {
      if (up) return up;
      if (p.comet.state === 'none' && p.comet.locked) return null;
    }
    return { patchLine: p.patchLine, comet: p.comet };
  });
  /** The hull's name once the guess was made or the constellation is complete. */
  readonly shapeName = computed(() => {
    const p = this.selected();
    return p?.guess.answerName ?? p?.constellation?.name ?? null;
  });
  /** The rank tier of the head crest and its rank rewards (frame from tier 5, orbit at tier 7). */
  private readonly rankTier = computed(() => rankProgress(this.state()?.kartograph ?? { unlocked: false, rank: 0 }));
  readonly rankKey = computed(() => this.rankTier().key);
  readonly crestFramed = computed(() => hasTierReward(this.rankTier().tier, 'frame'));
  readonly crestOrbit = computed(() => hasTierReward(this.rankTier().tier, 'orbit'));
  /** Read once per visit: the rank page writes it when opened. */
  private readonly rankSeen = readRankSeen();
  /** Tier up, a rank reward or a series stop the reader has not seen on the rank page yet. */
  readonly rankNews = computed(() => {
    const st = this.state();
    return !!st && hasRankNews(rankNewsItems(st), this.rankSeen);
  });
  readonly tourOpen = signal(false);
  readonly helpBtn = viewChild<ElementRef<HTMLElement>>('helpBtn');

  /** Patch lines complete when the page was entered (snapshot): only those may celebrate on this visit. */
  private entryComplete: Set<string> | null = null;
  /** The patch line whose completion plays right now. */
  readonly celebrating = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.signedIn() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });
    effect(() => {
      const st = this.state();
      const p = this.selected();
      if (!st || !p) return;
      untracked(() => {
        this.entryComplete ??= new Set(st.patches.filter(isComplete).map((x) => x.patchLine));
        if (!this.entryComplete.has(p.patchLine) || celebratedLines().has(p.patchLine)) return;
        markCelebrated(p.patchLine);
        this.celebrating.set(p.patchLine);
      });
    });
  }

  reload(): void {
    void this.api.loadExplorer();
  }

  selectLine(line: string | null): void {
    if (line) this.picked.set(line);
  }
}
