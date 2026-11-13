import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { logWarn } from '../../core/log';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { LightboxComponent, type LightboxImage } from '../../shared/lightbox/lightbox.component';
import type { PageCrumb } from '../../shared/page-header/nav-origin.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseExplorerPatch, VerseExplorerState } from '../data/verse.models';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { type ConstellationRenderOptions, WALLPAPER_4K, downloadBlob, renderConstellationPng } from './constellation-render';
import { KartographCrestComponent } from './kartograph-crest.component';
import { MyConstellationsComponent } from './my-constellations.component';
import { SeriesStripComponent } from './series-strip.component';
import { StarmapMoreComponent } from './starmap-more.component';
import {
  RANK_TIER_AT,
  RANK_TIER_KEYS,
  TIER_REWARDS,
  WALLPAPER_PHONE,
  WALLPAPER_ULTRAWIDE,
  defaultPatch,
  hasTierReward,
  rankNewsItems,
  rankProgress,
  readRankSeen,
  tierState,
  writeRankSeen,
} from './starmap.model';
import { wallpaperConstellations } from './wallpaper';

/** Size of the in-page mini view (the lightbox and the downloads render their own). */
const PREVIEW = { width: 1280, height: 720 } as const;

export type WallpaperFormat = '4k' | 'phone' | 'ultrawide';
const FORMATS: Readonly<Record<WallpaperFormat, { readonly width: number; readonly height: number }>> = {
  '4k': WALLPAPER_4K,
  phone: WALLPAPER_PHONE,
  ultrawide: WALLPAPER_ULTRAWIDE,
};

/** The render options of the reader's star-map wallpaper (newest patch first, rank rewards applied). */
export function rankWallpaperOptions(st: VerseExplorerState, first: VerseExplorerPatch): Omit<ConstellationRenderOptions, 'width' | 'height'> {
  const tier = rankProgress(st.kartograph).tier;
  return {
    seed: first.patchLine,
    constellations: wallpaperConstellations(st, first),
    // Tier 6 (deep field) keeps the nebula on, the series nebula does the same.
    nebula: st.rewards.nebula || hasTierReward(tier, 'deepfield'),
    road: st.rewards.road,
  };
}

/**
 * `/verse/explorer/rank` - the reader's rank, rethought (note #3, 2026-11-13):
 *
 *   - head: the Verse subpage head with the star map as the parent crumb;
 *   - standing: the current tier big (crest, name, meaning, progress to the
 *     next tier) beside the reader's star map as a mini view - the gallery's
 *     own lightbox opens it large, with download; 4K, phone and ultrawide
 *     downloads sit under it. It renders from the live data, so it changes
 *     with every rank climbed;
 *   - the ladder: all 7 tiers, earned / current / locked, rising in turn;
 *   - rank rewards (cosmetic, from the tier; the late ones from tier 5), the
 *     series with its rewards, the former Logbuch extras and "Meine Sternbilder".
 *
 * Opening the page stores what it showed (`RANK_SEEN_KEY`): the star map's
 * rank crest stops signalling news until the next tier / reward / series stop.
 */
@Component({
  selector: 'sc-rank-page',
  // Subpages sit in the page frame; only the hub runs edge to edge (concept 2026-10-28).
  host: { class: 'sc-track-page' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslatePipe,
    ScActionDirective,
    VerseHeaderComponent,
    KartographCrestComponent,
    LightboxComponent,
    SeriesStripComponent,
    StarmapMoreComponent,
    MyConstellationsComponent,
  ],
  template: `
    <sc-verse-header planet="starmap" [title]="'starmap.rankPage.title' | translate"
                     [subtitle]="'starmap.rankPage.subtitle' | translate" [trail]="trail" />

    @if (!signedIn()) {
      <section class="card note">
        <p>{{ 'starmap.signedOut' | translate }}</p>
        <a scAction tier="primary" routerLink="/login" [queryParams]="{ redirect: '/verse/explorer/rank' }">{{ 'starmap.signIn' | translate }}</a>
      </section>
    } @else if (api.explorerState() === 'error') {
      <section class="card note" role="alert">
        <p>{{ (api.explorerError() ?? 'errors.generic') | translate }}</p>
        <button type="button" scAction tier="secondary" (click)="reload()">{{ 'errors.retry' | translate }}</button>
      </section>
    } @else if (!state()) {
      <section class="card note" aria-busy="true"><p>{{ 'starmap.loading' | translate }}</p></section>
    } @else {
      @let st = state()!;
      @let pr = progress();
      <section class="standing" [attr.aria-label]="'starmap.rankPage.standingAria' | translate">
        <div class="tier">
          @if (pr.tier > 0) {
            <sc-kartograph-crest class="big" [tier]="pr.tier" [size]="132" state="current" [framed]="framed()" [orbit]="orbit()" />
          } @else {
            <svg class="big empty" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
              <circle cx="20" cy="20" r="17.5" /><path d="M20 9 23 17 31 20 23 23 20 31 17 23 9 20 17 17z" />
            </svg>
          }
          <div class="who">
            <small class="eyebrow">{{ 'starmap.rankPage.current' | translate }}</small>
            <h2 class="name">{{ (pr.key ? 'starmap.rankPage.tier.' + pr.key + '.name' : 'starmap.rankPage.unranked') | translate }}</h2>
            <p class="meaning">{{ (pr.key ? 'starmap.rankPage.tier.' + pr.key + '.meaning' : 'starmap.rankPage.unrankedMeaning') | translate }}</p>
            <p class="count">{{ (pr.rank === 1 ? 'starmap.rankPage.countOne' : 'starmap.rankPage.count') | translate: { n: pr.rank } }}</p>
            @if (pr.next; as nx) {
              <div class="bar" role="progressbar" aria-valuemin="0" [attr.aria-valuemax]="nx.at" [attr.aria-valuenow]="pr.rank"
                   [attr.aria-label]="'starmap.rankPage.progressAria' | translate: { name: ('starmap.rankPage.tier.' + nx.key + '.name' | translate) }">
                <i [style.width.%]="pr.share * 100"></i>
              </div>
              <p class="to-next">{{ (pr.toNext === 1 ? 'starmap.rankPage.toNextOne' : 'starmap.rankPage.toNext') | translate: { n: pr.toNext, name: ('starmap.rankPage.tier.' + nx.key + '.name' | translate) } }}</p>
            } @else {
              <p class="to-next">{{ 'starmap.rankPage.top' | translate }}</p>
            }
            <p class="perks">{{ 'starmap.rankPage.perks' | translate }}</p>
          </div>
        </div>

        <figure class="mini">
          @if (previewUrl(); as url) {
            <a class="tile" [href]="url" target="_blank" rel="noopener noreferrer" (click)="openMap($event)"
               [attr.aria-label]="'starmap.rankPage.mapOpen' | translate">
              <img [src]="url" [alt]="'starmap.rankPage.mapAlt' | translate" />
              <span class="zoom" aria-hidden="true">⤢</span>
            </a>
          } @else if (first()) {
            <span class="tile skel" aria-busy="true"></span>
          } @else {
            <p class="tile none">{{ 'starmap.rankPage.mapNone' | translate }}</p>
          }
          <figcaption>
            <b>{{ 'starmap.rankPage.mapCaption' | translate }}</b>
            <small>{{ 'starmap.rankPage.mapUpdates' | translate }}</small>
          </figcaption>
          @if (first()) {
            <div class="dl">
              @if (pr.tier >= 1) {
                <button type="button" scAction tier="primary" [busy]="busy() === '4k'" [disabled]="!!busy()" (click)="download('4k')">
                  {{ 'starmap.export.wallpaper' | translate }}
                </button>
                @if (has('phone')) {
                  <button type="button" scAction tier="secondary" [busy]="busy() === 'phone'" [disabled]="!!busy()" (click)="download('phone')">
                    {{ 'starmap.rankPage.downloadPhone' | translate }}
                  </button>
                }
                @if (has('ultrawide')) {
                  <button type="button" scAction tier="secondary" [busy]="busy() === 'ultrawide'" [disabled]="!!busy()" (click)="download('ultrawide')">
                    {{ 'starmap.rankPage.downloadUltrawide' | translate }}
                  </button>
                }
              } @else {
                <small class="muted">{{ 'starmap.rankPage.downloadLocked' | translate }}</small>
              }
            </div>
          }
          @if (status()) { <p class="err" role="alert">{{ status()! | translate }}</p> }
        </figure>
      </section>

      <section class="block" aria-labelledby="rk-ladder">
        <h2 id="rk-ladder" class="sec">{{ 'starmap.rankPage.ladderTitle' | translate }}</h2>
        <ol class="ladder">
          @for (t of ladder(); track t.tier) {
            <li class="step" [class]="t.state" [class.fresh]="t.fresh" [style.--i]="t.tier - 1">
              <sc-kartograph-crest [tier]="t.tier" [size]="56" [state]="t.state" />
              <b>{{ 'starmap.rankPage.tier.' + t.key + '.name' | translate }}</b>
              <small>{{ (t.at === 1 ? 'starmap.rankPage.atOne' : 'starmap.rankPage.at') | translate: { n: t.at } }}</small>
              <span class="what">{{ 'starmap.rankPage.tier.' + t.key + '.meaning' | translate }}</span>
              @if (t.fresh) { <em class="new">{{ 'starmap.rankPage.new' | translate }}</em> }
              <span class="sr-only">{{ 'starmap.rankPage.state.' + t.state | translate }}</span>
            </li>
          }
        </ol>
      </section>

      <section class="block" aria-labelledby="rk-rewards">
        <h2 id="rk-rewards" class="sec">{{ 'starmap.rankPage.rewardsTitle' | translate }}</h2>
        <p class="lead">{{ 'starmap.rankPage.rewardsLead' | translate }}</p>
        <ul class="rewards">
          @for (r of rewards(); track r.key) {
            <li [class.on]="r.on" [class.fresh]="r.fresh">
              <sc-kartograph-crest [tier]="r.tier" [size]="30" [state]="r.on ? 'earned' : 'locked'" />
              <span class="txt">
                <b>{{ 'starmap.rankPage.reward.' + r.key + '.title' | translate }}</b>
                <span>{{ 'starmap.rankPage.reward.' + r.key + '.desc' | translate }}</span>
              </span>
              <small>{{ r.on ? ('starmap.reward.unlocked' | translate) : ('starmap.rankPage.rewardFrom' | translate: { name: ('starmap.rankPage.tier.' + r.tierKey + '.name' | translate) }) }}</small>
              @if (r.fresh) { <em class="new">{{ 'starmap.rankPage.new' | translate }}</em> }
            </li>
          }
        </ul>
      </section>

      <section class="block" aria-labelledby="rk-series">
        <h2 id="rk-series" class="sec">{{ 'starmap.rankPage.seriesTitle' | translate }}</h2>
        <sc-series-strip [state]="st" />
        @if (first(); as f) { <sc-starmap-more part="series" [state]="st" [patch]="f" /> }
      </section>

      @if (first(); as f) {
        <section class="block" aria-labelledby="rk-log">
          <h2 id="rk-log" class="sec">{{ 'starmap.more.title' | translate }}</h2>
          <sc-starmap-more part="logbook" [state]="st" [patch]="f" />
        </section>
      }

      <section class="block" aria-labelledby="rk-mine">
        <h2 id="rk-mine" class="sec">{{ 'starmap.gallery.title' | translate }}</h2>
        <sc-my-constellations />
      </section>

      @if (lightbox(); as img) {
        <sc-lightbox [image]="img" (closed)="lightboxOpen.set(false)" />
      }
    }
  `,
  styles: [
    `
      :host { display: block; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      .card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 12px; padding: var(--sc-pad-3); }
      .note { display: flex; gap: var(--sc-gap-2); align-items: center; flex-wrap: wrap; }
      .note p { margin: 0; }
      .muted { color: var(--sc-fg-2); }
      .err { margin: 0; color: var(--sc-danger); }

      /* The standing: current tier left, the star map right. */
      .standing { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: clamp(20px, 4vw, 56px); align-items: center;
        margin-bottom: clamp(28px, 5vw, 56px); }
      .tier { display: flex; gap: clamp(16px, 3vw, 32px); align-items: center; min-width: 0; }
      .big { flex: none; width: 132px; height: 132px; color: var(--sc-accent); animation: rk-glow 3.2s ease-in-out 1.2s infinite; }
      svg.big.empty { overflow: visible; animation: none; }
      svg.big.empty circle, svg.big.empty path { fill: none; stroke: color-mix(in srgb, var(--sc-fg-2) 80%, transparent); stroke-width: 1; stroke-dasharray: 2.5 2.5; }
      .who { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
      .eyebrow { font: 0.7rem var(--sc-font-display); letter-spacing: 0.22em; text-transform: uppercase; color: var(--sc-fg-2); }
      .name { margin: 0; font: 600 clamp(1.6rem, 3.4vw, 2.4rem)/1.1 var(--sc-font-display); letter-spacing: 0.04em; color: var(--sc-fg-0); }
      .meaning { margin: 0; color: var(--sc-fg-1); max-width: var(--sc-measure, 62ch); }
      .count { margin: 4px 0 0; font-size: 0.85rem; color: var(--sc-accent); }
      .bar { position: relative; height: 6px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); overflow: hidden; max-width: 360px; }
      .bar i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 55%, transparent), var(--sc-accent));
        transform-origin: left; animation: rk-fill 1.1s cubic-bezier(0.2, 0.7, 0.2, 1) 0.5s both; }
      .to-next { margin: 0; font-size: 0.85rem; color: var(--sc-fg-1); }
      .perks { margin: 6px 0 0; font-size: 0.8rem; color: var(--sc-fg-2); max-width: var(--sc-measure, 62ch); }

      /* The mini view: the gallery tile's look, the gallery's lightbox behind it. */
      .mini { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
      .tile { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: 12px; overflow: hidden; background: var(--sc-bg-0);
        border: 1px solid var(--sc-border); transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }
      a.tile:hover { transform: translateY(-2px); border-color: var(--sc-accent); box-shadow: 0 10px 30px -12px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      a.tile:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .tile img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .zoom { position: absolute; right: 10px; top: 10px; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px;
        background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); color: var(--sc-fg-0); opacity: 0; transition: opacity 0.2s ease; }
      a.tile:hover .zoom, a.tile:focus-visible .zoom { opacity: 1; }
      @media (hover: none) { .zoom { opacity: 1; } }
      .tile.skel { background: linear-gradient(100deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%) 0 0 / 300% 100%; animation: rk-skel 1.6s linear infinite; }
      .tile.none { display: grid; place-items: center; margin: 0; padding: var(--sc-pad-3); text-align: center; color: var(--sc-fg-2); }
      figcaption { display: flex; flex-direction: column; gap: 2px; }
      figcaption b { font: 600 0.95rem var(--sc-font-display); color: var(--sc-fg-0); }
      figcaption small { font-size: 0.75rem; color: var(--sc-fg-2); }
      .dl { display: flex; flex-wrap: wrap; gap: var(--sc-gap-2); align-items: center; }

      .block { margin-bottom: clamp(28px, 5vw, 48px); }
      .sec { margin: 0 0 14px; font: 400 0.8rem var(--sc-font-display); letter-spacing: 0.22em; text-transform: uppercase; color: var(--sc-fg-2); }
      .lead { margin: -6px 0 14px; color: var(--sc-fg-2); font-size: 0.85rem; max-width: var(--sc-measure, 62ch); }
      .new { position: absolute; top: 6px; right: 8px; padding: 1px 7px; border-radius: 999px; font: 600 0.62rem var(--sc-font-display); letter-spacing: 0.14em;
        text-transform: uppercase; font-style: normal; color: var(--sc-bg-0); background: var(--sc-accent); animation: rk-pop 0.5s ease-out 1s both; }

      /* The ladder: seven tiers on one rail, each rising in turn. */
      .ladder { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 10px; position: relative; }
      .step { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; padding: 14px 8px 12px;
        border-radius: 12px; border: 1px solid transparent; animation: rk-rise 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) calc(var(--i, 0) * 90ms) both; }
      .step + .step::before { content: ''; position: absolute; top: 41px; right: calc(50% + 34px); width: calc(100% - 58px); height: 2px;
        background: color-mix(in srgb, var(--sc-fg-2) 25%, transparent); }
      .step.earned + .step::before, .step.earned + .step.current::before { background: var(--sc-accent); }
      .step b { font: 600 0.9rem var(--sc-font-display); color: var(--sc-fg-1); }
      .step small { font-size: 0.72rem; color: var(--sc-fg-2); }
      .step .what { font-size: 0.72rem; color: var(--sc-fg-2); line-height: 1.35; }
      .step.current { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent);
        background: radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--sc-accent) 14%, transparent), transparent 70%); }
      .step.current b, .step.earned b { color: var(--sc-fg-0); }
      .step.locked { opacity: 0.7; }

      .rewards { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 10px; }
      .rewards li { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 12px; row-gap: 4px; align-items: start;
        padding: 12px 14px; border-radius: 12px; border: 1px solid var(--sc-border); background: color-mix(in srgb, var(--sc-bg-1) 70%, transparent); }
      .rewards li.on { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .rewards .txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
      .rewards b { font: 600 0.9rem var(--sc-font-display); color: var(--sc-fg-0); }
      .rewards .txt span { font-size: 0.8rem; color: var(--sc-fg-1); }
      .rewards small { grid-column: 2; font-size: 0.72rem; color: var(--sc-fg-2); }
      .rewards li.on small { color: var(--sc-accent); }
      .rewards li:not(.on) b { color: var(--sc-fg-1); }

      @keyframes rk-rise { from { opacity: 0; transform: translateY(14px) scale(0.96); } to { opacity: 1; transform: none; } }
      @keyframes rk-glow { 0%, 100% { filter: drop-shadow(0 0 6px color-mix(in srgb, var(--sc-accent) 35%, transparent)); }
        50% { filter: drop-shadow(0 0 18px color-mix(in srgb, var(--sc-accent) 65%, transparent)); } }
      @keyframes rk-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      @keyframes rk-pop { 0% { opacity: 0; transform: scale(0.6); } 70% { transform: scale(1.1); } 100% { opacity: 1; transform: none; } }
      @keyframes rk-skel { to { background-position: -300% 0; } }

      @media (max-width: 1000px) {
        .ladder { grid-template-columns: minmax(0, 1fr); gap: 4px; }
        .step { display: grid; grid-template-columns: 56px minmax(0, 1fr); column-gap: 14px; row-gap: 2px; text-align: left; align-items: center; padding: 10px 12px; }
        .step sc-kartograph-crest { grid-row: span 3; }
        .step + .step::before { top: -6px; left: 39px; right: auto; width: 2px; height: 14px; }
        .new { top: 10px; }
      }
      @media (max-width: 820px) {
        .standing { grid-template-columns: minmax(0, 1fr); }
        .big { width: 96px; height: 96px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .step, .bar i, .new, .big, .tile.skel { animation: none; }
        .tile { transition: none; }
      }
    `,
  ],
})
export class RankPageComponent {
  readonly api = inject(VerseApiService);
  private readonly auth = inject(AuthService);
  private readonly t = inject(TranslateService);

  readonly trail: readonly PageCrumb[] = [{ labelKey: 'verse.area.starmap', link: '/verse/explorer' }];
  readonly signedIn = this.auth.isAuthenticated;
  readonly state = this.api.explorer;
  readonly first = computed(() => {
    const st = this.state();
    return st ? defaultPatch(st) : null;
  });
  readonly progress = computed(() => rankProgress(this.state()?.kartograph ?? { unlocked: false, rank: 0 }));
  readonly framed = computed(() => hasTierReward(this.progress().tier, 'frame'));
  readonly orbit = computed(() => hasTierReward(this.progress().tier, 'orbit'));

  /** What the reader had seen before this visit: those items carry no "New" tag. */
  private readonly seenBefore = readRankSeen();

  readonly ladder = computed(() => {
    const tier = this.progress().tier;
    return RANK_TIER_KEYS.map((key, i) => {
      const n = i + 1;
      return { tier: n, key, at: RANK_TIER_AT[i], state: tierState(n, tier), fresh: n <= tier && !this.seenBefore.has(`tier:${n}`) };
    });
  });
  readonly rewards = computed(() => {
    const tier = this.progress().tier;
    return TIER_REWARDS.map((r) => ({
      ...r,
      tierKey: RANK_TIER_KEYS[r.tier - 1],
      on: tier >= r.tier,
      fresh: tier >= r.tier && !this.seenBefore.has(`reward:${r.key}`),
    }));
  });

  readonly previewUrl = signal<string | null>(null);
  private readonly fullUrl = signal<string | null>(null);
  readonly lightboxOpen = signal(false);
  readonly busy = signal<WallpaperFormat | null>(null);
  readonly status = signal<string | null>(null);

  readonly lightbox = computed<LightboxImage | null>(() => {
    const preview = this.previewUrl();
    const p = this.first();
    if (!this.lightboxOpen() || !preview || !p) return null;
    const full = this.fullUrl();
    return {
      title: this.t.instant('starmap.rankPage.mapCaption'),
      sourceUrl: full ?? preview,
      previewUrl: preview,
      articleUrl: null,
      downloadName: `sc-starmap-${p.patchLine}${full ? '-4k' : ''}.png`,
    };
  });

  constructor() {
    effect(() => {
      if (this.signedIn() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });
    // Opening the page clears the star map's "new on the rank page" marker.
    effect(() => {
      const st = this.state();
      if (st) untracked(() => writeRankSeen(rankNewsItems(st)));
    });
    // The mini view follows the live data: every new star / tier redraws it.
    let gen = 0;
    effect(() => {
      const st = this.state();
      const p = this.first();
      const run = ++gen;
      untracked(() => this.dropUrls());
      if (!st || !p) return;
      renderConstellationPng({ ...rankWallpaperOptions(st, p), ...PREVIEW })
        .then((blob) => {
          if (run === gen) this.previewUrl.set(URL.createObjectURL(blob));
        })
        .catch((err) => logWarn('starmap', 'rank preview render failed', err));
    });
    inject(DestroyRef).onDestroy(() => {
      gen++;
      this.dropUrls();
    });
  }

  reload(): void {
    void this.api.loadExplorer();
  }

  has(key: 'phone' | 'ultrawide'): boolean {
    return hasTierReward(this.progress().tier, key);
  }

  /** Plain left click opens the lightbox; modified clicks open the image in a new tab (real anchor). */
  openMap(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.lightboxOpen.set(true);
    if (this.fullUrl() || this.progress().tier < 1) return;
    const st = this.state();
    const p = this.first();
    if (!st || !p) return;
    void renderConstellationPng({ ...rankWallpaperOptions(st, p), ...WALLPAPER_4K })
      .then((blob) => {
        if (this.first() === p && !this.fullUrl()) this.fullUrl.set(URL.createObjectURL(blob));
      })
      .catch((err) => logWarn('starmap', 'rank 4k render failed', err));
  }

  async download(format: WallpaperFormat): Promise<void> {
    const st = this.state();
    const p = this.first();
    if (!st || !p || this.busy()) return;
    this.busy.set(format);
    this.status.set(null);
    try {
      const blob = await renderConstellationPng({ ...rankWallpaperOptions(st, p), ...FORMATS[format] });
      downloadBlob(blob, `sc-starmap-${p.patchLine}-${format}.png`);
    } catch (err) {
      logWarn('starmap', 'rank wallpaper export failed', err);
      this.status.set('starmap.export.failed');
    } finally {
      this.busy.set(null);
    }
  }

  private dropUrls(): void {
    for (const s of [this.previewUrl, this.fullUrl]) {
      const url = s();
      if (url) URL.revokeObjectURL(url);
      s.set(null);
    }
  }
}
