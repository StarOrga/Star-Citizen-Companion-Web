import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { HangarService } from '../hangar/hangar.service';
import {
  UpcomingShip,
  UpcomingShipsService,
  heroArtOrder,
  thumbnailCandidates,
} from './upcoming-ships.service';

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
  imports: [
    NeuroFieldDirective,
    RouterLink,
    TranslateModule,
    CodexCategoryIconComponent,
    FallbackImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <a class="back" routerLink="/codex">← {{ 'codex.upcomingDetail.back' | translate }}</a>

      @if (loading()) {
        <div class="sc-card skel-card sc-skel-field" scNeuroField></div>
      } @else if (ship(); as s) {
        <article class="hero sc-card">
          <div class="hero-art" [class.icon-only]="art().length === 0">
            <sc-fallback-image [candidates]="art()" [alt]="s.name" [eager]="true">
              <sc-codex-icon kind="ship" />
            </sc-fallback-image>
          </div>

          <div class="hero-text">
            @if (s.manufacturer) {
              <span class="mfr">{{ s.manufacturer }}</span>
            }
            <h1 class="entity-name">{{ s.name }}</h1>

            <div class="badges">
              <span class="badge status" [class.concept]="isConcept()">
                {{ statusKey() | translate }}
              </span>
              @if (s.focus) { <span class="badge">{{ s.focus }}</span> }
              @else if (s.type) { <span class="badge">{{ s.type }}</span> }
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
              <p class="err" role="alert">{{ err }}</p>
            }
          </div>
        </article>

        @if (facts().length > 0) {
          <div class="section sc-card">
            <h2 class="section-title">{{ 'codex.upcomingDetail.facts' | translate }}</h2>
            <div class="facts">
              @for (f of facts(); track f.label) {
                <div class="fact">
                  <span class="fact-label">{{ f.label }}</span>
                  <span class="fact-val">{{ f.value }}</span>
                </div>
              }
            </div>
          </div>
        }

        <div class="section sc-card">
          <h2 class="section-title">{{ 'codex.upcomingDetail.noData.title' | translate }}</h2>
          <p class="muted">{{ 'codex.upcomingDetail.noData.body' | translate }}</p>
          <a class="browse" routerLink="/codex/upcoming">
            {{ 'codex.upcomingDetail.noData.browse' | translate }} →
          </a>
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
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 80px; max-width: 900px; margin: 0 auto; }

    .back { font-size: 0.82rem; color: var(--sc-fg-2); text-decoration: none; }
    .back:hover { color: var(--sc-accent); }

    .sc-card { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 10px; padding: 20px 24px; }
    .skel-card { min-height: 260px; }

    .hero { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 22px; align-items: center; }
    .hero-art {
      display: flex; align-items: center; justify-content: center;
      aspect-ratio: 16 / 10; border-radius: 8px; overflow: hidden;
      background: radial-gradient(circle at 50% 44%, var(--sc-bg-2), var(--sc-bg-0));
      /* sc-fallback-image owns the <img>; sizing crosses the boundary as vars. */
      --sc-img-w: 100%; --sc-img-h: 100%; --sc-img-fit: cover;
    }
    .hero-art.icon-only sc-codex-icon { width: 34%; height: 34%; opacity: 0.55; color: var(--sc-accent); }

    .hero-text { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .mfr { font-family: var(--sc-font-display); font-size: max(0.68rem, var(--sc-fs-floor));
      letter-spacing: 0.09em; text-transform: uppercase; color: var(--sc-accent); }
    .entity-name { margin: 0; font-size: 1.6rem; font-weight: 700; line-height: 1.15; }

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

    .section-title { margin: 0 0 14px; font-size: 1rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--sc-fg-2); border-bottom: 1px solid var(--sc-border); padding-bottom: 8px; }

    .facts { display: flex; flex-wrap: wrap; gap: 10px; }
    .fact { display: flex; flex-direction: column; gap: 2px; padding: 8px 14px; border-radius: 8px;
      background: var(--sc-bg-0); border: 1px solid var(--sc-border); min-width: 110px; }
    .fact-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-fg-2); }
    .fact-val { font-size: 0.92rem; font-weight: 600; color: var(--sc-fg-0); font-family: var(--sc-font-display); }

    .browse { display: inline-block; margin-top: 10px; color: var(--sc-accent); text-decoration: none; font-size: 0.85rem; }
    .browse:hover { text-decoration: underline; }

    .muted { color: var(--sc-fg-2); margin: 0; line-height: 1.55; }
    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .err { color: var(--sc-danger); margin: 4px 0 0; font-size: 0.84rem; }

    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      .sc-card { padding: 14px 16px; }
      .entity-name { font-size: 1.3rem; }
    }
  `],
})
export class UpcomingDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly rsi = inject(UpcomingShipsService);
  private readonly translate = inject(TranslateService);
  readonly hangar = inject(HangarService);

  readonly loading = signal(true);
  readonly watchPending = signal(false);
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
    if (s.type) out.push({ label: t('codex.upcomingDetail.fact.type'), value: s.type });
    if (s.focus) out.push({ label: t('codex.upcomingDetail.fact.focus'), value: s.focus });
    if (s.productionStatus) {
      out.push({ label: t('codex.upcomingDetail.fact.status'), value: t(this.statusKey()) });
    }
    return out;
  });

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
