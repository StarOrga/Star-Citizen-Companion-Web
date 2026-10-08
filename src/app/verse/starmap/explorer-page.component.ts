import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { logWarn } from '../../core/log';
import { VerseHeaderComponent } from '../shared/verse-header.component';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseExplorerPatch, VerseExplorerState } from '../data/verse.models';
import { ConstellationFigureComponent } from './constellation-figure.component';
import {
  RenderConstellation,
  animateConstellation,
  downloadBlob,
  renderConstellationPng,
} from './constellation-render';
import {
  FALLBACK_POINTS,
  STARS_PER_PATCH,
  STREAK_REWARDS,
  StreakRewardKey,
  starTask,
  supernovaPoints,
  taskLink,
} from './starmap.model';

/** Wallpaper inputs of the explorer state: selected patch first, then older ones. */
export function wallpaperConstellations(
  state: VerseExplorerState,
  first: VerseExplorerPatch,
): RenderConstellation[] {
  const rest = state.patches.filter((p) => p !== first && p.starCount > 0);
  return [first, ...rest].slice(0, 7).map((p) => ({
    patchLine: p.patchLine,
    points: p.constellation?.points?.length === 7 ? p.constellation.points : FALLBACK_POINTS,
    starCount: Math.min(STARS_PER_PATCH, p.starCount),
    sun: p.sun,
  }));
}

/** The Explorer star map: one constellation per patch, 7 stars, sun, streak rewards. */
@Component({
  selector: 'sc-explorer-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, VerseHeaderComponent, ConstellationFigureComponent],
  template: `
    <sc-verse-header
      [title]="'starmap.title' | translate"
      [eyebrow]="'starmap.eyebrow' | translate"
      [subtitle]="'starmap.subtitle' | translate" />

    @if (!signedIn()) {
      <section class="card note">
        <p>{{ 'starmap.signedOut' | translate }}</p>
        <a class="btn" routerLink="/login" [queryParams]="{ redirect: '/verse/explorer' }">{{ 'starmap.signIn' | translate }}</a>
      </section>
    } @else if (api.explorerState() === 'error') {
      <section class="card note" role="alert">
        <p>{{ (api.explorerError() ?? 'errors.generic') | translate }}</p>
        <button type="button" class="btn" (click)="reload()">{{ 'errors.retry' | translate }}</button>
      </section>
    } @else if (!state()) {
      <section class="card note" aria-busy="true"><p>{{ 'starmap.loading' | translate }}</p></section>
    } @else if (!selected()) {
      <section class="card note"><p>{{ 'starmap.empty' | translate }}</p></section>
    } @else {
      @let st = state()!;
      @let p = selected()!;
      <div class="grid">
        <section class="card stage" [attr.aria-label]="'starmap.stageAria' | translate: { patch: p.patchLine }">
          <div class="stage-head">
            <h2>{{ 'starmap.progress' | translate: { lit: lit(p), total: total } }}</h2>
            @if (p.constellation) {
              <span class="muted">{{ 'starmap.shapeFrom' | translate: { name: p.constellation.className } }}</span>
            }
          </div>
          <sc-constellation-figure class="figure" [points]="p.constellation?.points" [starCount]="lit(p)"
                                   [sun]="p.sun" [size]="p === current() ? 'large' : 'small'" [watermark]="p.patchLine" />
          <p class="muted sunline">
            {{ (p.sun ? 'starmap.sun.hit' : 'starmap.sun.how') | translate }}
          </p>
          <div class="actions">
            @if (p.unlocks.wallpaper) {
              <button type="button" class="btn" [disabled]="exporting()" (click)="exportWallpaper(p)">
                {{ (exporting() ? 'starmap.export.busy' : 'starmap.export.wallpaper') | translate }}
              </button>
              <a class="btn ghost" routerLink="/verse/gallery/constellations">{{ 'starmap.export.gallery' | translate }}</a>
            } @else {
              <span class="muted">{{ 'starmap.export.locked' | translate: { total: total } }}</span>
            }
            @if (exportError()) { <span class="err" role="alert">{{ exportError()! | translate }}</span> }
          </div>
        </section>

        <section class="card tasks">
          <h2>{{ 'starmap.tasksTitle' | translate }}</h2>
          @if (p.offered.length === 0) {
            <p class="muted">{{ 'starmap.noTasks' | translate }}</p>
          }
          <ul>
            @for (key of p.offered; track key) {
              @let task = taskOf(key);
              @let done = p.stars.includes(key);
              <li [class.done]="done">
                <span class="tick" aria-hidden="true">{{ done ? '★' : '☆' }}</span>
                <div class="tbody">
                  <strong>{{ 'starmap.task.' + task.i18nKey + '.title' | translate }}</strong>
                  <span class="muted">{{ 'starmap.task.' + task.i18nKey + '.how' | translate }}</span>
                  <span class="sr-only">{{ (done ? 'starmap.task.done' : 'starmap.task.open') | translate }}</span>
                </div>
                @if (p === current()) {
                  <a class="go" [routerLink]="linkOf(key, p)">{{ 'starmap.task.' + task.i18nKey + '.link' | translate }}</a>
                }
              </li>
            }
          </ul>
        </section>

        <section class="card log">
          <h2>{{ 'starmap.log.title' | translate }}</h2>
          <p class="muted">{{ 'starmap.log.summary' | translate: { patches: st.patches.length, stars: st.totalStars, suns: st.suns.length } }}</p>
          <ol class="log-row" [class.road]="st.rewards.road">
            @for (lp of st.patches; track lp.patchLine) {
              <li>
                <button type="button" class="log-item" [class.active]="lp === p" [attr.aria-pressed]="lp === p" (click)="select(lp)">
                  <sc-constellation-figure size="small" [points]="lp.constellation?.points" [starCount]="lit(lp)" [sun]="lp.sun" />
                  <span class="lp">{{ lp.patchLine }}</span>
                  <span class="muted small">{{ lit(lp) }}/{{ total }}</span>
                </button>
              </li>
            }
          </ol>
        </section>

        <section class="card streak">
          <h2>{{ 'starmap.streak.title' | translate }}</h2>
          <p>{{ 'starmap.streak.status' | translate: { current: st.streak.current, best: st.streak.best } }}</p>
          @if (st.rewards.reserve) {
            <p class="muted">{{ (st.streak.reserveAvailable ? 'starmap.streak.reserveReady' : 'starmap.streak.reserveUsed') | translate }}</p>
          }
          <ol class="rewards">
            @for (r of rewards; track r.key) {
              @let on = st.rewards[r.key];
              <li [class.on]="on">
                <span class="at">{{ r.at }}</span>
                <div class="tbody">
                  <strong>{{ 'starmap.reward.' + r.key + '.title' | translate }}</strong>
                  <span class="muted">{{ 'starmap.reward.' + r.key + '.desc' | translate }}</span>
                </div>
                <span class="state">{{ (on ? 'starmap.reward.unlocked' : 'starmap.reward.locked') | translate: { at: r.at } }}</span>
              </li>
            }
          </ol>
          @if (st.rewards.supernova) {
            <button type="button" class="btn" [disabled]="exporting()" (click)="exportSupernova(p)">
              {{ 'starmap.reward.supernova.download' | translate }}
            </button>
          }
          @if (st.rewards.live) {
            <canvas #live class="live" width="640" height="360" [attr.aria-label]="'starmap.reward.live.preview' | translate" role="img"></canvas>
          }
        </section>

        <section class="card side">
          <h2>{{ 'starmap.kartograph.title' | translate }}</h2>
          @if (st.kartograph.unlocked) {
            <p><strong>{{ 'starmap.kartograph.rank' | translate: { rank: st.kartograph.rank } }}</strong></p>
            <p class="muted">{{ 'starmap.kartograph.perks' | translate }}</p>
          } @else {
            <p class="muted">{{ 'starmap.kartograph.locked' | translate }}</p>
          }
          <h2>{{ 'starmap.community.title' | translate }}</h2>
          <p class="muted">{{ (p.unlocks.community ? 'starmap.community.on' : 'starmap.community.off') | translate }}</p>
          <h2>{{ 'starmap.suns.title' | translate }}</h2>
          @if (st.suns.length) {
            <ul class="suns">
              @for (s of st.suns; track s; let i = $index) {
                <li [class.big]="i === 0 && s === current()?.patchLine"><span class="sun-dot" aria-hidden="true"></span>{{ s }}</li>
              }
            </ul>
          } @else {
            <p class="muted">{{ 'starmap.suns.none' | translate }}</p>
          }
        </section>
      </div>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--sc-gap-3); }
      .card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 12px; padding: var(--sc-pad-3); min-width: 0; }
      .note { display: flex; gap: var(--sc-gap-2); align-items: center; flex-wrap: wrap; }
      h2 { font: 600 1rem var(--sc-font-display); margin: 0 0 var(--sc-gap-2); color: var(--sc-fg-0); }
      .side h2 + p, .side p + h2, .side ul + h2 { margin-top: var(--sc-gap-2); }
      .muted { color: var(--sc-fg-2); }
      .small { font-size: 0.75rem; }
      .err { color: var(--sc-danger); }
      .stage { background: radial-gradient(120% 90% at 40% 45%, color-mix(in srgb, var(--sc-accent) 9%, var(--sc-bg-0)), var(--sc-bg-0)); }
      .stage-head { display: flex; justify-content: space-between; gap: var(--sc-gap-2); flex-wrap: wrap; align-items: baseline; }
      .figure { max-width: 420px; margin: var(--sc-gap-2) auto; }
      .sunline { text-align: center; }
      .actions { display: flex; gap: var(--sc-gap-2); flex-wrap: wrap; align-items: center; justify-content: center; }
      .btn { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-pad-2); border-radius: 8px;
        border: 1px solid var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0);
        font: inherit; cursor: pointer; text-decoration: none; }
      .btn.ghost { background: transparent; }
      .btn:disabled { opacity: 0.55; cursor: progress; }
      .btn:focus-visible, .go:focus-visible, .log-item:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      ul, ol { list-style: none; margin: 0; padding: 0; }
      .tasks li, .rewards li { display: flex; gap: var(--sc-gap-2); align-items: center; padding: var(--sc-pad-1) 0; border-top: 1px solid var(--sc-border); }
      .tasks li:first-child, .rewards li:first-child { border-top: 0; }
      .tbody { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .tick { color: var(--sc-fg-2); width: 1.2em; text-align: center; }
      .done .tick { color: var(--sc-accent); }
      .go { color: var(--sc-accent); white-space: nowrap; min-height: var(--sc-tap-min, 44px); display: inline-flex; align-items: center; }
      .log { grid-column: 1 / -1; }
      .log-row { display: flex; gap: var(--sc-gap-2); overflow-x: auto; padding-bottom: var(--sc-pad-1); scroll-snap-type: x proximity; }
      .log-row.road { background: linear-gradient(transparent 38%, color-mix(in srgb, var(--sc-accent) 22%, transparent) 38% 39%, transparent 39%); }
      .log-item { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 88px; padding: var(--sc-pad-1); scroll-snap-align: start;
        background: var(--sc-bg-0); border: 1px solid var(--sc-border); border-radius: 10px; color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .log-item.active { border-color: var(--sc-accent); }
      .log-item sc-constellation-figure { width: 56px; }
      .lp { font: 600 0.85rem var(--sc-font-display); }
      .at { width: 2em; height: 2em; border-radius: 50%; display: inline-grid; place-items: center; border: 1px solid var(--sc-border); color: var(--sc-fg-2); flex: none; }
      .rewards li.on .at { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .rewards li:not(.on) .tbody { opacity: 0.6; }
      .state { font-size: 0.75rem; color: var(--sc-fg-2); white-space: nowrap; }
      .rewards li.on .state { color: var(--sc-success); }
      .live { display: block; width: 100%; height: auto; margin-top: var(--sc-gap-2); border-radius: 8px; }
      .suns { display: flex; flex-wrap: wrap; gap: var(--sc-gap-2); }
      .suns li { display: inline-flex; align-items: center; gap: 4px; }
      .sun-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-warning); box-shadow: 0 0 6px var(--sc-warning); }
      .suns li.big .sun-dot { width: 14px; height: 14px; }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
      @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    `,
  ],
})
export class ExplorerPageComponent {
  readonly api = inject(VerseApiService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  readonly total = STARS_PER_PATCH;
  readonly rewards: readonly { key: StreakRewardKey; at: number }[] = STREAK_REWARDS;
  readonly signedIn = this.auth.isAuthenticated;
  readonly state = this.api.explorer;
  readonly current = computed(() => this.state()?.patches[0] ?? null);
  private readonly picked = signal<string | null>(null);
  readonly selected = computed(() => {
    const st = this.state();
    if (!st) return null;
    return st.patches.find((p) => p.patchLine === this.picked()) ?? st.patches[0] ?? null;
  });
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  private readonly liveCanvas = viewChild<ElementRef<HTMLCanvasElement>>('live');

  constructor() {
    effect(() => {
      if (this.signedIn() && this.api.explorerState() === 'idle') void this.api.loadExplorer();
    });
    let stop: (() => void) | null = null;
    effect(() => {
      const canvas = this.liveCanvas()?.nativeElement;
      const st = this.state();
      const p = this.current();
      stop?.();
      stop = null;
      if (!canvas || !st || !p) return;
      stop = animateConstellation(canvas, {
        width: canvas.width,
        height: canvas.height,
        seed: p.patchLine,
        constellations: wallpaperConstellations(st, p),
        nebula: st.rewards.nebula,
        road: st.rewards.road,
        meteor: st.rewards.meteor,
      });
    });
    this.destroyRef.onDestroy(() => stop?.());
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

  taskOf = starTask;

  linkOf(key: VerseExplorerPatch['offered'][number], p: VerseExplorerPatch): string {
    return taskLink(starTask(key), p.patchLine, p.constellation?.className ?? null);
  }

  async exportWallpaper(p: VerseExplorerPatch): Promise<void> {
    const st = this.state();
    if (!st) return;
    await this.export(`sc-constellation-${p.patchLine}-4k.png`, {
      seed: p.patchLine,
      constellations: wallpaperConstellations(st, p),
      nebula: st.rewards.nebula,
      road: st.rewards.road,
    });
  }

  async exportSupernova(p: VerseExplorerPatch): Promise<void> {
    const st = this.state();
    if (!st) return;
    // Seed contract shared with the Starscape app: 'supernova:<newest line>'.
    const newest = st.patches[0]?.patchLine ?? p.patchLine;
    const nova: RenderConstellation = { patchLine: newest, points: supernovaPoints(newest), starCount: 7, sun: false };
    await this.export(`sc-supernova-${newest}-4k.png`, {
      seed: `supernova:${newest}`,
      constellations: [nova, ...wallpaperConstellations(st, p).slice(0, 6)],
      nebula: true,
      road: st.rewards.road,
      supernova: true,
    });
  }

  private async export(filename: string, opts: Parameters<typeof renderConstellationPng>[0]): Promise<void> {
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      downloadBlob(await renderConstellationPng(opts), filename);
    } catch (err) {
      logWarn('starmap', 'export failed', err);
      this.exportError.set('starmap.export.failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
