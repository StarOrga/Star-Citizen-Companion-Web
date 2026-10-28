import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { BetaService } from '../../core/beta.service';
import { logWarn } from '../../core/log';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseComet, VerseExplorerPatch } from '../data/verse.models';
import { CometTrackComponent } from './comet-track.component';
import { downloadBlob, renderConstellationPng } from './constellation-render';
import { KartographCrestComponent, type CrestState } from './kartograph-crest.component';
import { OwnBadgeService } from './own-badge.service';
import { MyConstellationsComponent } from './my-constellations.component';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { GuessTrackComponent } from './guess-track.component';
import { SeriesStripComponent } from './series-strip.component';
import { StarDomeComponent } from './star-dome.component';
import { StarmapTourComponent } from './starmap-tour.component';
import { StarmapMoreComponent } from './starmap-more.component';
import { STARS_PER_PATCH, defaultPatch, patchMapView, sunState } from './starmap.model';
import { wallpaperConstellations } from './wallpaper';

export { wallpaperConstellations } from './wallpaper';

/** Patches offered in the head dropdown (newest first). */
const MAX_PATCH_OPTIONS = 12;
/** Ranks shown on each side of the current crest. */
const LADDER_SPAN = 3;

/**
 * The star map ("Sternkarte", Kuppel): one constellation per patch under a dome
 * sky, the sun top right, the two rim challenges (comet tip, constellation
 * guess) and the series in one line — all in one desktop viewport. Secondary
 * things (community, suns, Kartograph, rewards extras) live in the Logbuch sheet.
 */
@Component({
  selector: 'sc-explorer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    TranslatePipe,
    ScTooltipDirective,
    ScDialogDirective,
    StarDomeComponent,
    CometTrackComponent,
    GuessTrackComponent,
    SeriesStripComponent,
    StarmapMoreComponent,
    StarmapTourComponent,
    MyConstellationsComponent,
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
      <div #mapEl class="page" [attr.aria-label]="'starmap.stageAria' | translate: { patch: p.patchLine }" role="region">
        <sc-verse-header planet="starmap"
                         [title]="(mine() ? 'starmap.gallery.title' : 'starmap.map.title') | translate: { patch: p.patchLine }"
                         [subtitle]="mine() ? ('starmap.gallery.subtitle' | translate) : ('starmap.map.subtitle' | translate: { total: total })">
          @if (patchOptions().length > 1 && !mine()) {
            <sc-select vhActions class="patch-pick" [options]="patchOptions()" [value]="p.patchLine" [allowEmpty]="false"
                       [ariaLabel]="'starmap.map.patchesAria' | translate" (valueChange)="selectLine($event)" />
          }
          <div vhActions class="acts">
            @if (p.unlocks.wallpaper && !mine()) {
              <button type="button" class="act" [disabled]="exporting()" (click)="exportWallpaper(p)">
                {{ (exporting() ? 'starmap.export.busy' : 'starmap.export.wallpaper') | translate }}
              </button>
            }
            @if (shellOn()) {
              <button type="button" class="act ghost" [attr.aria-pressed]="mine()" (click)="toggleMine()">{{ 'starmap.map.mine' | translate }}</button>
            } @else {
              <a class="act ghost" routerLink="/verse/gallery/constellations">{{ 'starmap.map.mine' | translate }}</a>
            }
            <button type="button" class="act ghost" data-tour="more" [attr.aria-expanded]="moreOpen()" aria-controls="starmap-more"
                    (click)="moreOpen.set(!moreOpen())">{{ 'starmap.more.open' | translate }}</button>
            @if (shellOn()) {
              <button #helpBtn type="button" class="act ghost help" [attr.aria-expanded]="tourOpen()" aria-controls="starmap-tour"
                      [attr.aria-label]="'starmap.tour.open' | translate" [scTooltip]="'starmap.tour.open' | translate" scTooltipTier="label"
                      (click)="tourOpen.set(!tourOpen())">?</button>
            }
          </div>
          @if (exportError()) { <span vhActions class="err" role="alert">{{ exportError()! | translate }}</span> }
        </sc-verse-header>

        <section class="map sc-enter-stagger">
        @if (mine()) {
          <div class="mine"><sc-my-constellations [embedded]="true" /></div>
        } @else {
        <sc-star-dome class="stage" data-tour="stage" [points]="p.constellation?.points" [tasks]="v.tasks" [next]="v.next"
                      [sun]="sun()" [sunLine]="cometTarget()?.patchLine ?? p.patchLine" [patchLine]="p.patchLine" />

        <div class="meta" data-tour="count">
          <p class="caption">
            @if (shapeName(); as sn) { <span>{{ 'starmap.map.shape' | translate: { name: sn } }}</span> }
            @if (st.kartograph.unlocked) { <span>{{ 'starmap.kartograph.rank' | translate: { rank: st.kartograph.rank } }}</span> }
          </p>
          @if (st.kartograph.unlocked && ladder().length) {
            <nav class="ladder" [attr.aria-label]="'starmap.ladder.aria' | translate">
              @for (r of ladder(); track r.rank) {
                @if (r.state === 'current') {
                  <a class="rung current" [routerLink]="badge().commands" [queryParams]="badge().queryParams" aria-current="true"
                     [attr.aria-label]="'starmap.ladder.current' | translate: { rank: r.rank }"
                     [scTooltip]="'starmap.ladder.current' | translate: { rank: r.rank }">
                    <sc-kartograph-crest [rank]="r.rank" [size]="44" state="current" />
                    <small>{{ 'starmap.ladder.here' | translate }}</small>
                  </a>
                } @else {
                  <span class="rung" [class.locked]="r.state === 'locked'" role="img"
                        [attr.aria-label]="(r.state === 'locked' ? 'starmap.ladder.next' : 'starmap.ladder.earned') | translate: { rank: r.rank }"
                        [scTooltip]="(r.state === 'locked' ? 'starmap.ladder.next' : 'starmap.ladder.earned') | translate: { rank: r.rank }">
                    <sc-kartograph-crest [rank]="r.rank" [size]="32" [state]="r.state" />
                  </span>
                }
              }
            </nav>
          }
        </div>

        <div class="tracks" data-tour="tracks">
          @if (cometTarget(); as ct) {
            <sc-comet-track class="track" [patchLine]="ct.patchLine" [comet]="ct.comet" />
          }
          @if (p.guess.state !== 'unavailable') {
            <sc-guess-track class="track" [patchLine]="p.patchLine" [guess]="p.guess" />
          }
        </div>

        <sc-series-strip class="series" data-tour="series" [state]="st" />
        }
        </section>

        @if (moreOpen()) {
          <aside id="starmap-more" class="more" role="dialog" scDialog [scDialogModal]="false" (scDialogEscape)="moreOpen.set(false)"
                 [attr.aria-label]="'starmap.more.title' | translate">
            <div class="more-head">
              <h2>{{ 'starmap.more.title' | translate }}</h2>
              <button type="button" class="x" [attr.aria-label]="'starmap.card.close' | translate"
                      [scTooltip]="'starmap.card.close' | translate" scTooltipTier="label" (click)="moreOpen.set(false)">×</button>
            </div>
            <sc-starmap-more [state]="st" [patch]="p" />
          </aside>
        }
        @if (tourOpen() && shellOn()) {
          <sc-starmap-tour id="starmap-tour" [root]="mapEl" [returnTo]="helpBtn()?.nativeElement ?? null" (closed)="tourOpen.set(false)" />
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
      /* No box: the scene shows through. One viewport on desktop - the map takes what the head and shell leave. */
      .map { position: relative; display: grid; grid-template-rows: minmax(0, 1fr) auto auto auto; gap: 10px; box-sizing: border-box;
        height: calc(100dvh - var(--sc-topbar-h, 64px) - 2 * var(--sc-page-gutter, 24px) - 110px); min-height: 560px; max-height: 1000px; }
      .patch-pick { min-width: 120px; }

      /* Caption (shape + rank) bottom left, Kartograph crest ladder at the right end, directly under the map. */
      .meta { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sc-gap-3, 16px); flex-wrap: wrap; min-width: 0; }
      .caption { margin: 0; display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.8rem; color: var(--sc-fg-1); letter-spacing: 0.04em; }
      .caption span + span::before { content: ''; display: inline-block; width: 1px; height: 0.9em; margin-right: 14px; vertical-align: -0.1em;
        background: var(--sc-border); }
      .ladder { display: flex; align-items: center; gap: 8px; margin-left: auto; }
      .rung { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; border-radius: 8px; color: var(--sc-fg-2); text-decoration: none; }
      .rung.locked { opacity: 0.7; }
      .rung.current { padding: 4px 10px; border-left: 1px solid var(--sc-border); border-right: 1px solid var(--sc-border); border-radius: 0; color: var(--sc-fg-0); }
      .rung.current small { font: 0.62rem var(--sc-font-display); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-accent); }
      a.rung:hover, a.rung:focus-visible { color: var(--sc-fg-0); outline: none; }
      a.rung:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .acts { display: flex; gap: 6px; flex-wrap: wrap; }
      .act { display: inline-flex; align-items: center; min-height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid var(--sc-accent);
        background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0); font: 0.8rem inherit; cursor: pointer; text-decoration: none; }
      .act.ghost { background: transparent; border-color: var(--sc-border); color: var(--sc-fg-1); }
      .act:hover, .act:focus-visible { border-color: var(--sc-accent); color: var(--sc-fg-0); outline: none; }
      .act:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .act:disabled { opacity: 0.55; cursor: progress; }
      .err { color: var(--sc-danger); font-size: 0.8rem; }

      .stage { min-height: 0; height: 100%; }
      /* One grid for both challenges: heads share a row (one baseline), rails start at the same y, an optional error foot gets the third row. */
      .tracks { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: auto auto auto; column-gap: 8%; row-gap: 0; align-items: start; }
      .tracks .track { display: grid; grid-row: span 3; grid-template-rows: subgrid; row-gap: 0; align-content: start; }
      .tracks .track:only-child { grid-column: 1; }

      @keyframes ex-in { from { opacity: 0; } to { opacity: 1; } }
      .more { position: absolute; z-index: 10; top: 10px; right: 10px; bottom: 10px; width: min(380px, calc(100% - 20px)); overflow-y: auto;
        padding: var(--sc-pad-3); box-sizing: border-box; border-radius: 12px; outline: none;
        background: color-mix(in srgb, var(--sc-bg-0) 94%, transparent); border: 1px solid var(--sc-border); backdrop-filter: blur(10px);
        box-shadow: 0 16px 40px rgb(0 0 0 / 50%); animation: ex-in 0.2s ease-out both; }
      .more-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--sc-gap-2); }
      .more-head h2 { margin: 0; font: 600 1rem var(--sc-font-display); color: var(--sc-fg-0); }
      .x { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--sc-border); background: none; color: var(--sc-fg-2);
        font: 1rem/1 inherit; cursor: pointer; padding: 0; }
      .x:hover, .x:focus-visible { color: var(--sc-fg-0); border-color: var(--sc-accent); outline: none; }
      .act.help { min-width: 36px; justify-content: center; padding: 0; font-weight: 600; }
      /* Constellations toggle (shell beta): the dome dissolves, the list builds up in its place. */
      .mine { grid-row: 2 / -1; min-height: 0; overflow-y: auto; padding-right: 4px; }
      @media (pointer: coarse) { .act, .x { min-height: 44px; min-width: 44px; } }

      /* Phones / narrow: the page may scroll, the dome keeps a square stage. */
      @media (max-width: 900px), (max-height: 700px) {
        .map { height: auto; min-height: 0; max-height: none; }
        .ladder { margin-left: 0; }
        .stage { height: auto; aspect-ratio: 1; max-height: 70dvh; }
        .tracks { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 22px; }
        .tracks .track { display: block; grid-row: auto; }
        .more { position: fixed; inset: auto 8px var(--sc-float-bottom, 8px) 8px; top: 15dvh; width: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .more { animation: none; }
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
  /** Head dropdown: the live patch first (marked), then the older maps. */
  readonly patchOptions = computed<ScSelectOption[]>(() => {
    const st = this.state();
    const up = st?.upcoming?.patchLine;
    const live = this.fallback();
    return (st?.patches ?? [])
      .filter((p) => p.patchLine !== up || p.liveAt)
      .slice(0, MAX_PATCH_OPTIONS)
      .map((p) => (p === live ? { value: p.patchLine, labelKey: 'starmap.map.patchLive', labelParams: { patch: p.patchLine } } : { value: p.patchLine, labelKey: 'starmap.map.patchOld', labelParams: { patch: p.patchLine } }));
  });
  readonly badge = inject(OwnBadgeService).link;
  /** Kartograph ladder: up to three earned ranks before, the current one, three locked ones after. */
  readonly ladder = computed<{ rank: number; state: CrestState }[]>(() => {
    const k = this.state()?.kartograph;
    if (!k?.unlocked || k.rank < 1) return [];
    const out: { rank: number; state: CrestState }[] = [];
    for (let r = Math.max(1, k.rank - LADDER_SPAN); r < k.rank; r++) out.push({ rank: r, state: 'earned' });
    out.push({ rank: k.rank, state: 'current' });
    for (let r = k.rank + 1; r <= k.rank + LADDER_SPAN; r++) out.push({ rank: r, state: 'locked' });
    return out;
  });
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
  readonly sun = computed(() => {
    const p = this.selected();
    if (!p) return 'faded' as const;
    const target = this.cometTarget();
    return sunState(p.sun, !target || target.patchLine === p.patchLine ? p.comet : target.comet);
  });
  /** The hull's name once the guess was made or the constellation is complete. */
  readonly shapeName = computed(() => {
    const p = this.selected();
    return p?.guess.answerName ?? p?.constellation?.name ?? null;
  });
  readonly moreOpen = signal(false);
  readonly tourOpen = signal(false);
  readonly helpBtn = viewChild<ElementRef<HTMLElement>>('helpBtn');
  readonly shellOn = inject(BetaService).isEnabled('shell');
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  /** "Meine Sternbilder" as a state of this panel (shell beta); the old page route redirects here. */
  readonly mine = computed(() => this.shellOn() && this.query().get('view') === 'constellations');
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (this.signedIn() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });
  }

  toggleMine(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: this.mine() ? null : 'constellations' },
      queryParamsHandling: 'merge',
    });
  }

  reload(): void {
    void this.api.loadExplorer();
  }

  selectLine(line: string | null): void {
    if (line) this.picked.set(line);
  }

  async exportWallpaper(p: VerseExplorerPatch): Promise<void> {
    const st = this.state();
    if (!st) return;
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      const blob = await renderConstellationPng({
        seed: p.patchLine,
        constellations: wallpaperConstellations(st, p),
        nebula: st.rewards.nebula,
        road: st.rewards.road,
      });
      downloadBlob(blob, `sc-constellation-${p.patchLine}-4k.png`);
    } catch (err) {
      logWarn('starmap', 'export failed', err);
      this.exportError.set('starmap.export.failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
