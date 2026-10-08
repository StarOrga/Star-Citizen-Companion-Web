import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { HangarService } from '../hangar/hangar.service';
import {
  UpcomingShip,
  UpcomingShipsService,
  heroArtOrder,
  thumbnailCandidates,
  upcomingRoleLabel,
} from './upcoming-ships.service';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { NavOriginService, PageCrumb, originTrail } from '../shared/page-header/nav-origin.service';

/**
 * Detail page for one ANNOUNCED ship — `/codex/upcoming/:id`.
 *
 * Why this exists (feedback #130): every "Auf dem Reißbrett" tile used to be a
 * one-way door out of the app, straight onto robertsspaceindustries.com. The
 * Codex now gets first refusal: the tile lands here, this page shows everything
 * the RSI ship-matrix told us, offers "für die Flotte merken", and keeps the
 * RSI pledge page as a clearly labelled SECONDARY link rather than the only
 * destination.
 *
 * There is deliberately no catalog data here. These ships are exactly the ones
 * our datamined `codex_ships` has no row for — the honest page says so instead
 * of faking hardpoints and stats.
 *
 * "Merken" writes to `hangar_concept_ships` (the existing #135 wishlist), whose
 * only handle on a catalog-less hull is the NAME. No new table, no new schema.
 */
@Component({
  selector: 'sc-upcoming-detail',
  standalone: true,
  imports: [PageHeaderComponent, 
    NeuroFieldDirective,
    RouterLink,
    TranslatePipe,
    CodexCategoryIconComponent,
    FallbackImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <sc-page-header [crumbs]="crumbs()" [rememberAs]="ship()?.name ?? null" />

      @if (loading()) {
        <div class="sc-card skel-card sc-skel-field" scNeuroField></div>
      } @else if (ship(); as s) {
        <!-- The shared detail shape (styles.scss, DETAIL PAGE), with a wider
             art column: the RSI render is a landscape picture, not a glyph. -->
        <article class="hero sc-card sc-detail-hero">
          <figure class="hero-art sc-detail-hero__art" [class.icon-only]="art().length === 0">
            <sc-fallback-image [candidates]="art()" [alt]="s.name" [eager]="true">
              <sc-codex-icon kind="ship" />
            </sc-fallback-image>
          </figure>

          <div class="hero-text sc-detail-hero__body">
            <span class="sc-kind-tag">{{ 'codex.kindSingular.upcoming' | translate }}</span>
            <h1 class="entity-name">{{ s.name }}</h1>
            @if (s.manufacturer) {
              <p class="mfr sc-detail-mfr">{{ s.manufacturer }}</p>
            }

            <div class="badges">
              <span class="badge status" [class.concept]="isConcept()">
                {{ statusKey() | translate }}
              </span>
              @if (s.focus) { <span class="badge">{{ roleLabel(s.focus) }}</span> }
              @else if (s.type) { <span class="badge">{{ roleLabel(s.type) }}</span> }
            </div>

            <p class="notice">{{ noticeKey() | translate }}</p>

            <div class="actions">
              <button
                type="button"
                class="sc-btn watch"
                [class.sc-btn-primary]="!watched()"
                [disabled]="watchPending()"
                [attr.aria-pressed]="watched()"
                (click)="toggleWatch()"
              >
                <span class="watch-glyph" aria-hidden="true">{{ watched() ? '★' : '☆' }}</span>
                {{ (watched() ? 'codex.upcomingDetail.watch.on' : 'codex.upcomingDetail.watch.off') | translate }}
              </button>

              @if (s.rsiUrl) {
                <!-- Secondary, never the primary destination any more (#130). -->
                <a class="sc-btn ghost" [href]="s.rsiUrl" target="_blank" rel="noopener noreferrer">
                  {{ 'codex.upcomingDetail.rsiLink' | translate }}
                  <span class="ext" aria-hidden="true">↗</span>
                </a>
              }
            </div>

            <p class="watch-hint">
              @if (watched()) {
                <a class="hangar-link" routerLink="/hangar">{{ 'codex.upcomingDetail.watch.inHangar' | translate }}</a>
              } @else {
                {{ 'codex.upcomingDetail.watch.hint' | translate }}
              }
            </p>

            @if (hangar.error(); as err) {
              <p class="err" role="alert">{{ err | translate }}</p>
            }
          </div>
        </article>

        @if (facts().length > 0) {
          <section class="section sc-card sc-detail-block">
            <h2>{{ 'codex.upcomingDetail.facts' | translate }}</h2>
            <ul class="sc-detail-facts facts">
              @for (f of facts(); track f.label) {
                <li class="sc-detail-fact fact">
                  <span class="sc-detail-fact__label">{{ f.label }}</span>
                  <span class="sc-detail-fact__value">{{ f.value }}</span>
                </li>
              }
            </ul>
          </section>
        }

        <section class="section sc-card sc-detail-block">
          <h2>{{ 'codex.upcomingDetail.noData.title' | translate }}</h2>
          <p class="muted">{{ 'codex.upcomingDetail.noData.body' | translate }}</p>
          <a class="browse" routerLink="/codex/upcoming">
            {{ 'codex.upcomingDetail.noData.browse' | translate }} →
          </a>
        </section>
      } @else if (feedError(); as err) {
        <!-- The RSI feed could not be read: that is not "this ship is gone". -->
        <div class="sc-card load-err" role="alert">
          <span><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err | translate }}</span>
          <button type="button" class="retry" [disabled]="retrying()" (click)="retry()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else {
        <div class="sc-card empty">
          <strong>{{ 'codex.upcomingDetail.notFound.title' | translate }}</strong>
          <p class="muted">{{ 'codex.upcomingDetail.notFound.body' | translate }}</p>
          <a class="browse" routerLink="/codex/upcoming">
            {{ 'codex.upcomingDetail.noData.browse' | translate }} →
          </a>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* The full page frame (styles.scss, "PAGE FRAME") — no width of its own. */
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; }


    .skel-card { min-height: 260px; }
    /* The art column is wider than the glyph heroes': a landscape render, full bleed. */
    .hero.sc-detail-hero { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); align-items: stretch; }
    .hero-art { aspect-ratio: 16 / 10; min-height: 0; overflow: hidden;
      /* sc-fallback-image owns the <img>; sizing crosses the boundary as vars. */
      --sc-img-w: 100%; --sc-img-h: 100%; --sc-img-fit: cover; --sc-img-max-h: none; --sc-img-shadow: none; }
    .hero-art.icon-only sc-codex-icon { width: 34%; height: 34%; opacity: 0.55; color: var(--sc-accent); }
    .hero-text { align-self: center; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .badge { font-size: max(0.64rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase;
      padding: 3px 8px; border-radius: 6px; background: var(--sc-bg-2); color: var(--sc-fg-1);
      border: 1px solid var(--sc-border); }
    .badge.status.concept {
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      border-color: color-mix(in srgb, var(--sc-accent) 34%, transparent);
      color: var(--sc-accent);
    }

    .notice { margin: 4px 0 0; color: var(--sc-fg-2); font-size: 0.86rem; line-height: 1.5; }

    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
    .actions .sc-btn { cursor: pointer; text-decoration: none; }
    .actions .ghost { color: var(--sc-fg-1); border-color: var(--sc-border); }
    .actions .ghost:hover { background: var(--sc-bg-2); color: var(--sc-fg-0); box-shadow: none; }
    .watch-glyph { font-size: 1rem; line-height: 1; }
    .watch-hint { margin: 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .hangar-link { color: var(--sc-accent); text-decoration: none; }
    .hangar-link:hover { text-decoration: underline; }



    .browse { display: inline-block; margin-top: 10px; color: var(--sc-accent); text-decoration: none; font-size: 0.85rem; }
    .browse:hover { text-decoration: underline; }

    .muted { color: var(--sc-fg-2); margin: 0; line-height: 1.55; max-width: var(--sc-measure); }
    @media (max-width: 760px) {
      .hero.sc-detail-hero { grid-template-columns: minmax(0, 1fr); }
    }
    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .err { color: var(--sc-danger); margin: 4px 0 0; font-size: 0.84rem; }
    .load-err { color: var(--sc-danger); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .load-err .retry { margin-left: auto; min-height: max(36px, var(--sc-tap-min)); padding: 6px 14px; border-radius: 6px; background: transparent;
      border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }
    .load-err .retry:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .load-err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }
    .load-err .retry:disabled { opacity: 0.5; cursor: default; }

  `],
})
export class UpcomingDetailComponent implements OnInit {
  private readonly navOrigin = inject(NavOriginService);
  /** Codex › where the reader came from (hangar drawing board, index), else the upcoming index. */
  readonly crumbs = computed<PageCrumb[]>(() => {
    this.ship();
    return originTrail(this.navOrigin, {
      labelKey: 'codex.kinds.upcoming', link: '/codex/upcoming',
    });
  });
  private readonly route = inject(ActivatedRoute);
  private readonly rsi = inject(UpcomingShipsService);
  private readonly translate = inject(TranslateService);

  /** RSI role/type in the reader's language (see upcomingRoleLabel). */
  roleLabel(value: string | null): string {
    return upcomingRoleLabel(value, (k) => this.translate.instant(k));
  }
  readonly hangar = inject(HangarService);

  readonly loading = signal(true);
  readonly watchPending = signal(false);
  readonly retrying = signal(false);
  /** The feed failed and holds no ships: an error with a retry, never the not-found page. */
  readonly feedError = computed(() => (this.rsi.feed() ? null : this.rsi.error()));
  private readonly shipId = signal('');

  /**
   * Resolved from the live feed rather than a route resolver: the same feed
   * already backs the rail the user came from, so a same-session click never
   * refetches, and a cold deep link is one CDN-cached GET away.
   */
  readonly ship = computed<UpcomingShip | null>(() => this.rsi.shipById(this.shipId()));

  readonly art = computed(() => {
    const s = this.ship();
    return s ? heroArtOrder(thumbnailCandidates(s)) : [];
  });

  /** RSI still building it = not flyable. The other bucket is "flight-ready on RSI, missing in our data". */
  readonly isConcept = computed(() => !this.ship()?.flightReadyButMissing);

  readonly statusKey = computed(() =>
    this.isConcept() ? 'codex.upcoming.status.concept' : 'codex.upcoming.status.flightReady',
  );

  readonly noticeKey = computed(() =>
    this.isConcept()
      ? 'codex.upcomingDetail.notice.concept'
      : 'codex.upcomingDetail.notice.flightReady',
  );

  /** The wishlist row for this hull, or null — drives the toggle's two states. */
  readonly watchEntry = computed(() => this.hangar.conceptShipByName(this.ship()?.name));
  readonly watched = computed(() => this.watchEntry() !== null);

  readonly facts = computed(() => {
    const s = this.ship();
    if (!s) return [];
    const t = (key: string) => this.translate.instant(key);
    const out: { label: string; value: string }[] = [];
    if (s.manufacturer) out.push({ label: t('codex.upcomingDetail.fact.manufacturer'), value: s.manufacturer });
    if (s.type) out.push({ label: t('codex.upcomingDetail.fact.type'), value: upcomingRoleLabel(s.type, t) });
    if (s.focus) out.push({ label: t('codex.upcomingDetail.fact.focus'), value: upcomingRoleLabel(s.focus, t) });
    if (s.productionStatus) {
      out.push({ label: t('codex.upcomingDetail.fact.status'), value: t(this.statusKey()) });
    }
    return out;
  });

  /** Retry of the feed error card. */
  async retry(): Promise<void> {
    this.retrying.set(true);
    try {
      await this.rsi.refresh(true);
    } finally {
      this.retrying.set(false);
    }
  }

  async ngOnInit(): Promise<void> {
    this.shipId.set(this.route.snapshot.paramMap.get('id') ?? '');
    // Both are best-effort by contract: a dead RSI proxy renders the not-found
    // state, an unreadable wishlist renders "not watched". Neither throws here.
    await Promise.all([this.rsi.ensureLoaded(), this.hangar.ensureConceptShipsLoaded()]);
    this.loading.set(false);
  }

  /**
   * Add/remove this hull on the fleet wishlist. Guarded against a double click
   * because both directions are a round trip and the button reflects server
   * state, not an optimistic guess.
   */
  async toggleWatch(): Promise<void> {
    const s = this.ship();
    if (!s || this.watchPending()) return;
    this.watchPending.set(true);
    try {
      const entry = this.watchEntry();
      if (entry) {
        await this.hangar.removeConceptShip(entry.id);
      } else {
        await this.hangar.addConceptShip({
          name: s.name,
          manufacturer: s.manufacturer ?? undefined,
          // Stripped to null by the pledge-link allowlist unless it is an
          // official /pledge/ships/<slug>/<Name> url — see rsi-pledge-link.util.
          rsiUrl: s.rsiUrl ?? undefined,
        });
      }
    } finally {
      this.watchPending.set(false);
    }
  }
}
