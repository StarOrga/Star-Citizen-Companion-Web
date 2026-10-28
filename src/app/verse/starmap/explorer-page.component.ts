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
import { MyConstellationsComponent } from './my-constellations.component';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { GuessTrackComponent } from './guess-track.component';
import { SeriesStripComponent } from './series-strip.component';
import { StarDomeComponent } from './star-dome.component';
import { StarmapTourComponent } from './starmap-tour.component';
import { StarmapMoreComponent } from './starmap-more.component';
import { STARS_PER_PATCH, defaultPatch, patchMapView, sunState } from './starmap.model';
import { wallpaperConstellations } from './wallpaper';

export { wallpaperConstellations } from './wallpaper';

/** Patch chips in the map bar (newest first). */
const MAX_PATCH_CHIPS = 6;

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
      <section #mapEl class="map" [class.nebula]="st.rewards.nebula" [attr.aria-label]="'starmap.stageAria' | translate: { patch: p.patchLine }">
        <div class="sky" aria-hidden="true"><i class="neb"></i><i class="field"></i><i class="field near"></i></div>
        <div class="dome" aria-hidden="true"></div>

        <sc-verse-header planet="starmap"
                         [title]="(mine() ? 'starmap.gallery.title' : 'starmap.map.title') | translate: { patch: p.patchLine }"
                         [subtitle]="mine() ? ('starmap.gallery.subtitle' | translate)
                           : shapeName() ? ('starmap.map.shape' | translate: { name: shapeName() })
                           : ('starmap.map.subtitle' | translate: { total: total })">
          @if (chips().length > 1 && !mine()) {
            <div vhActions class="chips" role="group" [attr.aria-label]="'starmap.map.patchesAria' | translate">
              @for (lp of chips(); track lp.patchLine) {
                <button type="button" class="chip" [attr.aria-pressed]="lp === p" (click)="select(lp)"
                        [scTooltip]="'starmap.map.chipTip' | translate: { patch: lp.patchLine, lit: lit(lp), total: total }">{{ lp.patchLine }}</button>
              }
            </div>
          }
          <span vhActions class="count" data-tour="count" [attr.aria-label]="'starmap.progress' | translate: { lit: v.lit, total: total }"><b>{{ v.lit }}</b>/ {{ total }}</span>
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

        @if (mine()) {
          <div class="mine" animate.enter="ex-build"><sc-my-constellations [embedded]="true" /></div>
        } @else {
        <sc-star-dome class="stage" data-tour="stage" animate.enter="ex-build" [points]="p.constellation?.points" [tasks]="v.tasks" [next]="v.next"
                      [sun]="sun()" [sunLine]="cometTarget()?.patchLine ?? p.patchLine" [patchLine]="p.patchLine" />

        <div class="tracks" data-tour="tracks" animate.enter="ex-build">
          @if (cometTarget(); as ct) {
            <sc-comet-track class="track" [patchLine]="ct.patchLine" [comet]="ct.comet" />
          }
          @if (p.guess.state !== 'unavailable') {
            <sc-guess-track class="track" [patchLine]="p.patchLine" [guess]="p.guess" />
          }
        </div>

        <sc-series-strip class="series" data-tour="series" animate.enter="ex-build" [state]="st" />
        }

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
      </section>
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

      /* One viewport on desktop: the map takes what the shell leaves, never less than 640px. */
      .map { position: relative; isolation: isolate; overflow: hidden; border-radius: 14px; border: 1px solid var(--sc-border);
        background: color-mix(in srgb, var(--sc-bg-0) 92%, #000);
        height: calc(100dvh - var(--sc-topbar-h, 64px) - 2 * var(--sc-page-gutter, 24px)); min-height: 640px; max-height: 1100px;
        display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; gap: 10px; padding: 14px 24px 14px; box-sizing: border-box; }
      .sky, .dome { position: absolute; pointer-events: none; z-index: -1; }
      .sky { inset: 0; animation: ex-in 0.7s ease-out both; }
      .sky i { position: absolute; inset: 0; }
      .neb { background:
          radial-gradient(ellipse 40% 30% at 30% 28%, color-mix(in srgb, var(--sc-accent) 10%, transparent), transparent 70%),
          radial-gradient(ellipse 34% 26% at 72% 40%, color-mix(in srgb, var(--sc-accent-hot, var(--sc-accent)) 6%, transparent), transparent 70%),
          radial-gradient(ellipse 60% 40% at 50% 100%, color-mix(in srgb, var(--sc-accent) 8%, transparent), transparent 70%); }
      .map.nebula .neb { filter: saturate(1.4) brightness(1.3); }
      .field { opacity: 0.55; background-image:
          radial-gradient(1px 1px at 12% 18%, #fff, transparent), radial-gradient(1px 1px at 34% 62%, #fff, transparent),
          radial-gradient(1px 1px at 58% 12%, #fff, transparent), radial-gradient(1px 1px at 78% 72%, #fff, transparent),
          radial-gradient(1px 1px at 88% 28%, #fff, transparent), radial-gradient(1px 1px at 22% 84%, #fff, transparent);
        background-size: 260px 220px; }
      .field.near { background-size: 410px 330px; background-position: 70px 40px; opacity: 0.35; animation: ex-twinkle 6s ease-in-out infinite; }
      .dome { left: -8%; right: -8%; top: 52px; height: 1400px; border-radius: 50%; animation: ex-in 0.7s ease-out both;
        background: radial-gradient(ellipse 46% 26% at 50% 20%, color-mix(in srgb, var(--sc-accent) 12%, transparent), transparent 70%);
        border-top: 1px solid color-mix(in srgb, var(--sc-accent) 18%, transparent);
        box-shadow: inset 0 40px 70px -40px color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      @keyframes ex-in { from { opacity: 0; } to { opacity: 1; } }
      @keyframes ex-twinkle { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.12; } }

      .bar { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; min-width: 0; }
      .ttl h1 { margin: 0; font: 400 1.375rem/1.15 var(--sc-font-display); letter-spacing: 0.08em; color: var(--sc-fg-0); }
      .ttl span { font-size: 0.8rem; color: var(--sc-fg-2); }
      .chips { display: flex; gap: 4px; flex-wrap: wrap; }
      .chip { min-height: 32px; padding: 0 10px; border-radius: 16px; border: 1px solid var(--sc-border); background: none; color: var(--sc-fg-2);
        font: 0.8rem var(--sc-font-display); cursor: pointer; }
      .chip:hover, .chip:focus-visible { color: var(--sc-fg-0); border-color: var(--sc-accent); outline: none; }
      .chip[aria-pressed='true'] { color: var(--sc-fg-0); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .count { margin-left: auto; font-size: 0.95rem; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .count b { font: 400 1.5rem var(--sc-font-display); color: var(--sc-fg-0); margin-right: 3px; }
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
      .ex-build { animation: ex-build 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both; transform-origin: 50% 0; }
      @keyframes ex-build { from { opacity: 0; transform: perspective(900px) rotateX(14deg) scale(0.96); filter: blur(6px); } to { opacity: 1; transform: none; filter: none; } }
      @media (pointer: coarse) { .chip, .act, .x { min-height: 44px; min-width: 44px; } }

      /* Phones / narrow: the page may scroll, the dome keeps a square stage. */
      @media (max-width: 900px), (max-height: 700px) {
        .map { height: auto; min-height: 0; max-height: none; padding: 12px; }
        .stage { height: auto; aspect-ratio: 1; max-height: 70dvh; }
        .tracks { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; row-gap: 22px; }
        .tracks .track { display: block; grid-row: auto; }
        .more { position: fixed; inset: auto 8px var(--sc-float-bottom, 8px) 8px; top: 15dvh; width: auto; }
      }
      @media (prefers-reduced-motion: reduce) {
        .sky, .dome, .field.near, .more { animation: none; }
        .ex-build { animation: ex-in 0.2s ease-out both; }
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
  readonly chips = computed(() => {
    const st = this.state();
    const up = st?.upcoming?.patchLine;
    return (st?.patches ?? []).filter((p) => p.patchLine !== up || p.liveAt).slice(0, MAX_PATCH_CHIPS);
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

  select(p: VerseExplorerPatch): void {
    this.picked.set(p.patchLine);
  }

  lit(p: VerseExplorerPatch): number {
    return Math.min(STARS_PER_PATCH, p.starCount);
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
