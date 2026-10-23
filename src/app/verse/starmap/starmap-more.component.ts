import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RoleService } from '../../auth/role.service';
import { AnalyticsService } from '../../core/analytics.service';
import { logWarn } from '../../core/log';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { VerseApiService } from '../data/verse-api.service';
import type { VerseCommunityStars, VerseExplorerPatch, VerseExplorerState, VerseSuggestion } from '../data/verse.models';
import { ConstellationFigureComponent } from './constellation-figure.component';
import {
  RenderConstellation,
  animateConstellation,
  downloadBlob,
  renderConstellationPng,
  renderKartographBadgePng,
} from './constellation-render';
import { badgeCaption } from './kartograph-badge.component';
import { shareImage } from './share-image';
import { STARS_PER_PATCH, badgeQuery, communityLevels, isLiveDay, supernovaPoints } from './starmap.model';
import { wallpaperConstellations } from './wallpaper';

/**
 * The secondary side of the star map (the "Logbuch" sheet): community
 * constellation, suns, Kartograph rank + badge share + top-item suggestions,
 * the admin suggestion queue and the streak extras (supernova, live preview,
 * meteor shower). Kept out of the dome so the map fits one viewport.
 */
@Component({
  selector: 'sc-starmap-more',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ConstellationFigureComponent],
  template: `
    @let st = state();
    @let p = patch();
    <section class="block">
      <h3>{{ 'starmap.community.title' | translate }}</h3>
      @if (community(); as c) {
        <sc-constellation-figure class="community-fig" size="small" [points]="p.constellation?.points" [levels]="communityLevelsOf(p, c)" />
        <p class="muted small">{{ 'starmap.community.count' | translate: { explorers: c.explorers } }}</p>
      }
      <p class="muted">{{ (p.unlocks.community ? 'starmap.community.on' : 'starmap.community.off') | translate }}</p>
    </section>

    <section class="block">
      <h3>{{ 'starmap.suns.title' | translate }}</h3>
      @if (st.suns.length) {
        <ul class="suns">
          @for (s of st.suns; track s) { <li><span class="sun-dot" aria-hidden="true"></span>{{ s }}</li> }
        </ul>
      } @else {
        <p class="muted">{{ 'starmap.suns.none' | translate }}</p>
      }
      <a class="link" routerLink="/verse/gallery/constellations">{{ 'starmap.export.gallery' | translate }} ›</a>
    </section>

    @if (st.rewards.supernova || st.rewards.live || st.rewards.meteor) {
      <section class="block">
        <h3>{{ 'starmap.more.rewards' | translate }}</h3>
        @if (st.rewards.supernova) {
          <button type="button" class="btn" [disabled]="exporting()" (click)="exportSupernova()">
            {{ 'starmap.reward.supernova.download' | translate }}
          </button>
        }
        @if (st.rewards.live) {
          <canvas #live class="live" width="640" height="360" [attr.aria-label]="'starmap.reward.live.preview' | translate" role="img"></canvas>
        }
        @if (st.rewards.meteor) {
          <p class="muted small">{{ (meteorToday() ? 'starmap.reward.meteor.today' : 'starmap.reward.meteor.notToday') | translate }}</p>
        }
        @if (exportError()) { <p class="err" role="alert">{{ exportError()! | translate }}</p> }
      </section>
    }

    <section class="block side">
      <h3>{{ 'starmap.kartograph.title' | translate }}</h3>
      @if (st.kartograph.unlocked) {
        <p><strong>{{ 'starmap.kartograph.rank' | translate: { rank: st.kartograph.rank } }}</strong></p>
        <p class="muted">{{ 'starmap.kartograph.perks' | translate }}</p>
        <button type="button" class="btn ghost" [disabled]="sharing()" (click)="shareBadge()">
          <svg class="ico" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" />
            <path d="M8.3 10.8 15.7 6.3M8.3 13.2l7.4 4.5" />
          </svg>
          {{ 'starmap.badge.share' | translate }}
        </button>
        <form class="suggest" (submit)="$event.preventDefault(); submitSuggestion()">
          <h4>{{ 'starmap.suggest.title' | translate }}</h4>
          <label for="sg-url">{{ 'starmap.suggest.url' | translate }}</label>
          <input id="sg-url" type="text" inputmode="url" maxlength="500" autocomplete="off"
                 [value]="sgUrl()" (input)="sgUrl.set($any($event.target).value)"
                 [attr.aria-invalid]="sgUrl() !== '' && !sgUrlValid()" />
          <label for="sg-note">{{ 'starmap.suggest.note' | translate }}</label>
          <textarea id="sg-note" rows="2" maxlength="500" [value]="sgNote()" (input)="sgNote.set($any($event.target).value)"></textarea>
          <button type="submit" class="btn" [disabled]="!sgUrlValid() || sgBusy()">{{ 'starmap.suggest.submit' | translate }}</button>
          @if (sgStatus()) { <p class="small" [class.err]="sgStatusError()" role="status">{{ sgStatus()! | translate }}</p> }
        </form>
        @if (ownSuggestions().length) {
          <ul class="sg-list">
            @for (s of ownSuggestions(); track s.id) {
              <li><span class="sg-url">{{ s.itemUrl }}</span><span class="muted small">{{ 'starmap.suggest.status.' + s.status | translate }}</span></li>
            }
          </ul>
        }
      } @else {
        <p class="muted">{{ 'starmap.kartograph.locked' | translate }}</p>
      }
      @if (isAdmin()) {
        <section class="admin-queue" [attr.aria-label]="'starmap.suggest.admin.title' | translate">
          <h4>{{ 'starmap.suggest.admin.title' | translate }}</h4>
          @for (s of adminQueue(); track s.id) {
            <div class="sg-row">
              <a [href]="s.itemUrl" target="_blank" rel="noopener noreferrer" class="sg-url">{{ s.itemUrl }}</a>
              @if (s.note) { <span class="muted small">{{ s.note }}</span> }
              <span class="sg-actions">
                <button type="button" class="btn small-btn" (click)="promote(s)">{{ 'starmap.suggest.admin.promote' | translate }}</button>
                <button type="button" class="btn ghost small-btn" (click)="dismiss(s)">{{ 'starmap.suggest.admin.dismiss' | translate }}</button>
              </span>
            </div>
          } @empty {
            <p class="muted small">{{ 'starmap.suggest.admin.empty' | translate }}</p>
          }
        </section>
      }
    </section>
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-gap-3); }
      .block { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
      h3 { font: 600 0.95rem var(--sc-font-display); margin: 0; color: var(--sc-fg-0); }
      h4 { font: 600 0.85rem var(--sc-font-display); margin: var(--sc-gap-2) 0 2px; color: var(--sc-fg-0); }
      p { margin: 0; }
      .muted { color: var(--sc-fg-2); }
      .small { font-size: 0.75rem; }
      .err { color: var(--sc-danger); }
      .link { color: var(--sc-accent); min-height: 36px; display: inline-flex; align-items: center; }
      .link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .btn { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-pad-2); border-radius: 8px;
        border: 1px solid var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-fg-0);
        font: inherit; cursor: pointer; text-decoration: none; }
      .btn.ghost { background: transparent; }
      .btn:disabled { opacity: 0.55; cursor: progress; }
      .btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      ul { list-style: none; margin: 0; padding: 0; }
      .community-fig { width: 120px; }
      .suns { display: flex; flex-wrap: wrap; gap: var(--sc-gap-2); }
      .suns li { display: inline-flex; align-items: center; gap: 4px; }
      .sun-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--sc-warning); box-shadow: 0 0 6px var(--sc-warning); }
      .live { display: block; width: 100%; height: auto; border-radius: 8px; }
      .ico { fill: currentColor; stroke: currentColor; stroke-width: 1.6; margin-right: 6px; }
      .suggest { display: flex; flex-direction: column; gap: 4px; align-self: stretch; }
      .suggest label { font-size: 0.8rem; color: var(--sc-fg-2); }
      .suggest input, .suggest textarea { font: inherit; color: var(--sc-fg-0); background: var(--sc-bg-0); border: 1px solid var(--sc-border);
        border-radius: 8px; padding: var(--sc-pad-1); min-height: var(--sc-tap-min, 44px); resize: vertical; }
      .suggest input:focus-visible, .suggest textarea:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .suggest input[aria-invalid='true'] { border-color: var(--sc-warning); }
      .suggest .btn { align-self: flex-start; margin-top: 4px; }
      .sg-list { align-self: stretch; }
      .sg-list li, .sg-row { display: flex; gap: var(--sc-gap-2); align-items: center; flex-wrap: wrap; padding: 4px 0; }
      .sg-url { overflow-wrap: anywhere; color: var(--sc-fg-1); }
      .admin-queue { align-self: stretch; margin-top: var(--sc-gap-2); padding: var(--sc-pad-2); border: 1px solid var(--sc-accent-hot); border-radius: 10px; }
      .admin-queue h4 { color: var(--sc-accent-hot); margin-top: 0; }
      .sg-actions { display: inline-flex; gap: 6px; margin-left: auto; }
      .small-btn { min-height: 36px; font-size: 0.8rem; }
      @media (pointer: coarse) { .small-btn { min-height: var(--sc-tap-min, 44px); } }
    `,
  ],
})
export class StarmapMoreComponent {
  readonly state = input.required<VerseExplorerState>();
  /** The patch the map shows. */
  readonly patch = input.required<VerseExplorerPatch>();

  private readonly api = inject(VerseApiService);
  private readonly t = inject(TranslateService);
  private readonly roles = inject(RoleService);
  private readonly dialog = inject(ScConfirmService);
  private readonly analytics = inject(AnalyticsService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isAdmin = this.roles.isAdmin;
  private readonly current = computed(() => this.state().patches[0] ?? null);
  /** sr-meteor only on the newest patch's LIVE day (the Starscape app's rule). */
  readonly meteorToday = computed(() => isLiveDay(this.current()?.liveAt));
  readonly community = signal<VerseCommunityStars | null>(null);
  readonly exporting = signal(false);
  readonly exportError = signal<string | null>(null);
  readonly sharing = signal(false);
  readonly sgUrl = signal('');
  readonly sgNote = signal('');
  readonly sgBusy = signal(false);
  readonly sgStatus = signal<string | null>(null);
  readonly sgStatusError = signal(false);
  readonly sgUrlValid = computed(() => /^(https:\/\/\S+|\/\S*)$/.test(this.sgUrl().trim()));
  private readonly suggestionsList = signal<VerseSuggestion[]>([]);
  /** RLS returns a Kartograph only their own rows; an admin sees the queue instead. */
  readonly ownSuggestions = computed(() => (this.isAdmin() ? [] : this.suggestionsList().slice(0, 5)));
  readonly adminQueue = computed(() => this.suggestionsList().filter((s) => s.status === 'open'));
  private readonly liveCanvas = viewChild<ElementRef<HTMLCanvasElement>>('live');

  constructor() {
    effect(() => {
      const line = this.patch().patchLine;
      this.community.set(null);
      void this.api.communityStars(line).then((r) => {
        if (r.ok && this.patch().patchLine === line) this.community.set(r.data);
      });
    });
    effect(() => {
      if (this.state().kartograph.unlocked || this.isAdmin()) void this.loadSuggestions();
    });
    let stop: (() => void) | null = null;
    effect(() => {
      const canvas = this.liveCanvas()?.nativeElement;
      const st = this.state();
      const p = this.current();
      stop?.();
      stop = null;
      if (!canvas || !p) return;
      stop = animateConstellation(canvas, {
        width: canvas.width,
        height: canvas.height,
        seed: p.patchLine,
        constellations: wallpaperConstellations(st, p),
        nebula: st.rewards.nebula,
        road: st.rewards.road,
        meteor: st.rewards.meteor && isLiveDay(p.liveAt),
      });
    });
    this.destroyRef.onDestroy(() => stop?.());
  }

  communityLevelsOf(p: VerseExplorerPatch, c: VerseCommunityStars): number[] {
    return communityLevels(p.offered, c.stars, c.explorers);
  }

  private async loadSuggestions(): Promise<void> {
    const r = await this.api.suggestions();
    if (r.ok) this.suggestionsList.set(r.data);
  }

  async submitSuggestion(): Promise<void> {
    if (!this.sgUrlValid() || this.sgBusy()) return;
    this.sgBusy.set(true);
    this.sgStatus.set(null);
    const r = await this.api.suggest(this.sgUrl().trim(), this.sgNote().trim() || null);
    this.sgBusy.set(false);
    this.sgStatusError.set(!r.ok);
    if (r.ok) {
      this.sgUrl.set('');
      this.sgNote.set('');
      this.sgStatus.set('starmap.suggest.sent');
      void this.loadSuggestions();
    } else {
      this.sgStatus.set(r.errorKey);
    }
  }

  async promote(s: VerseSuggestion): Promise<void> {
    const title = await this.dialog.prompt({
      titleKey: 'starmap.suggest.admin.promoteTitle',
      messageKey: 'starmap.suggest.admin.promoteMessage',
      params: { url: s.itemUrl },
      inputLabelKey: 'starmap.suggest.admin.pinTitle',
      inputMaxLength: 200,
      confirmKey: 'starmap.suggest.admin.promote',
    });
    if (!title?.trim()) return;
    const r = await this.api.promoteSuggestion(s.id, title.trim());
    this.sgStatusError.set(!r.ok);
    this.sgStatus.set(r.ok ? 'starmap.suggest.admin.promoted' : r.errorKey);
    void this.loadSuggestions();
  }

  async dismiss(s: VerseSuggestion): Promise<void> {
    const r = await this.api.dismissSuggestion(s.id);
    if (!r.ok) {
      this.sgStatusError.set(true);
      this.sgStatus.set(r.errorKey);
    }
    void this.loadSuggestions();
  }

  /** Friend badge: rank + newest constellation as an image, link to the public badge page. */
  async shareBadge(): Promise<void> {
    const st = this.state();
    const p = this.current();
    if (!p || !st.kartograph.unlocked) return;
    this.sharing.set(true);
    const badge = { rank: st.kartograph.rank, patch: p.patchLine, stars: Math.min(STARS_PER_PATCH, p.starCount), sun: p.sun };
    const url = `${location.origin}/badge/kartograph?${new URLSearchParams(badgeQuery(badge)).toString()}`;
    try {
      const blob = await renderKartographBadgePng({
        ...badgeCaption(this.t, badge),
        constellation: wallpaperConstellations(st, p)[0],
      });
      const channel = await shareImage(blob, `sc-kartograph-${badge.rank}.png`, badgeCaption(this.t, badge).title, url);
      if (channel) this.analytics.captureVerse('starscape_share', { image_id: `kartograph-${badge.rank}-${badge.patch}`, channel });
      if (channel === 'copy') {
        this.sgStatusError.set(false);
        this.sgStatus.set('starmap.gallery.copied');
      }
    } catch (err) {
      logWarn('starmap', 'badge share failed', err);
    } finally {
      this.sharing.set(false);
    }
  }

  async exportSupernova(): Promise<void> {
    const st = this.state();
    const p = this.patch();
    // Seed contract shared with the Starscape app: 'supernova:<newest line>'.
    const newest = st.patches[0]?.patchLine ?? p.patchLine;
    const nova: RenderConstellation = { patchLine: newest, points: supernovaPoints(newest), starCount: 7, sun: false };
    this.exporting.set(true);
    this.exportError.set(null);
    try {
      const blob = await renderConstellationPng({
        seed: `supernova:${newest}`,
        constellations: [nova, ...wallpaperConstellations(st, p).slice(0, 6)],
        nebula: true,
        road: st.rewards.road,
        supernova: true,
      });
      downloadBlob(blob, `sc-supernova-${newest}-4k.png`);
    } catch (err) {
      logWarn('starmap', 'export failed', err);
      this.exportError.set('starmap.export.failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
