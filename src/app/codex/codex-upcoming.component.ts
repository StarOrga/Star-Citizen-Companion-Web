import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { UpcomingShip, UpcomingShipsService } from './upcoming-ships.service';

/**
 * Codex — Upcoming Ships. Renders the diff computed by the `rsi-upcoming-ships`
 * edge function: ships announced/listed on the public RSI ship-matrix that are
 * NOT yet present in the game data we ingest from the desktop uploader
 * (`codex_ships`). Read-only, public. Cards deep-link out to the ship's RSI page
 * (there is no local Codex detail — we hold no game data for these ships yet).
 *
 * Two blocks: "In concept" (RSI still building them) and "Flight-ready elsewhere"
 * (RSI says flight-ready but our extraction has no match — a name-matching gap or
 * a just-released ship). Follows the Bridge's visual language: --sc-* tokens,
 * skeleton shimmer, OnPush, reduced-motion safe.
 *
 * Per-card favorites and the search box filter purely client-side (the whole
 * feed is already in memory). Ships added since the last visit carry a NEW
 * badge; leaving the view acknowledges them, which also clears the Verse News
 * notification.
 */
@Component({
  selector: 'sc-codex-upcoming',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, RouterLink, TranslateModule, CodexCategoryIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="upcoming">
      <header class="head">
        <div class="head-main">
          <a class="back" routerLink="/codex">← {{ 'codex.bridge.backToBridge' | translate }}</a>
          <h1>{{ 'codex.upcoming.title' | translate }}</h1>
          <p class="lede">{{ 'codex.upcoming.subtitle' | translate }}</p>
        </div>
        @if (feed(); as f) {
          @if (f.counts; as c) {
            <div class="meta" [attr.title]="'codex.upcoming.diffHint' | translate: { rsi: c.rsiTotal, game: c.gameNames }">
              <span class="meta-count">{{ 'codex.upcoming.count' | translate: { count: c.total } }}</span>
              <span class="meta-fresh">
                <span class="fresh-dot" aria-hidden="true"></span>
                {{ 'codex.upcoming.updated' | translate: { time: (f.fetchedAt | date: 'short') } }}
              </span>
            </div>
          }
        }
      </header>

      @if (feed()) {
        <div class="toolbar">
          <div class="search">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <input
              type="search"
              class="search-input"
              [value]="query()"
              (input)="onQuery($event)"
              [attr.placeholder]="'codex.upcoming.searchPlaceholder' | translate"
              [attr.aria-label]="'codex.upcoming.searchAria' | translate" />
            @if (query()) {
              <button type="button" class="search-clear" (click)="clearQuery()"
                      [attr.aria-label]="'codex.upcoming.searchClear' | translate">×</button>
            }
          </div>
          <button type="button" class="fav-chip"
                  [class.active]="favoritesOnly()"
                  [attr.aria-pressed]="favoritesOnly()"
                  (click)="toggleFavoritesOnly()">
            <span class="star" aria-hidden="true">★</span>
            <span>{{ 'codex.upcoming.favoritesOnly' | translate }}</span>
            <span class="ct">{{ favoriteCount() }}</span>
          </button>
        </div>
      }

      @if (error(); as err) {
        <div class="sc-card err">
          <strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}
          <button type="button" class="retry" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      }

      @if (loading() && !feed()) {
        <div class="grid">
          @for (s of skeletons; track s) { <div class="card skel"></div> }
        </div>
      } @else if (feed(); as f) {
        @if (f.ships.length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.upcoming.empty.title' | translate }}</strong>
            <p>{{ 'codex.upcoming.empty.body' | translate }}</p>
          </div>
        } @else if (concept().length === 0 && flightReadyMissing().length === 0) {
          <div class="sc-card empty">
            <strong>{{ 'codex.upcoming.noMatches.title' | translate }}</strong>
            <p>{{ 'codex.upcoming.noMatches.body' | translate }}</p>
          </div>
        } @else {
          @if (concept().length > 0) {
            <section class="block">
              <header class="block-head">
                <h2>{{ 'codex.upcoming.conceptTitle' | translate }}</h2>
                <span class="block-sub">{{ 'codex.upcoming.conceptSub' | translate }}</span>
              </header>
              <div class="grid">
                @for (ship of concept(); track ship.id) {
                  <ng-container [ngTemplateOutlet]="shipCard" [ngTemplateOutletContext]="{ $implicit: ship }" />
                }
              </div>
            </section>
          }
          @if (flightReadyMissing().length > 0) {
            <section class="block">
              <header class="block-head">
                <h2>{{ 'codex.upcoming.flightReadyTitle' | translate }}</h2>
                <span class="block-sub">{{ 'codex.upcoming.flightReadySub' | translate }}</span>
              </header>
              <div class="grid">
                @for (ship of flightReadyMissing(); track ship.id) {
                  <ng-container [ngTemplateOutlet]="shipCard" [ngTemplateOutletContext]="{ $implicit: ship }" />
                }
              </div>
            </section>
          }
        }
      }

      <!-- The favorite toggle lives next to the card, not inside it: the card is
           an <a> to RSI and interactive content must not nest inside a link. -->
      <ng-template #shipCard let-ship>
        <div class="card-wrap">
          <a class="card" [href]="ship.rsiUrl || rsiFallback" target="_blank" rel="noopener noreferrer">
            <div class="thumb" [class.icon-only]="!thumbSrc(ship)">
              @if (thumbSrc(ship); as src) {
                <img [src]="src" [alt]="ship.name" loading="lazy" (error)="onThumbError(ship)" />
              } @else {
                <sc-codex-icon kind="ship" />
              }
            </div>
            <div class="info">
              <h3 class="name">{{ ship.name }}</h3>
              @if (ship.manufacturer) { <span class="mfr">{{ ship.manufacturer }}</span> }
              <div class="badges">
                @if (isNew(ship)) { <span class="badge new">{{ 'codex.upcoming.newBadge' | translate }}</span> }
                @if (ship.focus) { <span class="badge">{{ ship.focus }}</span> }
                @else if (ship.type) { <span class="badge">{{ ship.type }}</span> }
                @if (ship.productionStatus) {
                  <span class="badge status" [class.concept]="!ship.flightReadyButMissing">{{ statusLabel(ship) | translate }}</span>
                }
              </div>
            </div>
            <span class="ext" aria-hidden="true">↗</span>
          </a>
          <button type="button" class="fav" [class.on]="isFavorite(ship)"
                  [attr.aria-pressed]="isFavorite(ship)"
                  [attr.aria-label]="(isFavorite(ship) ? 'codex.upcoming.favorite.remove' : 'codex.upcoming.favorite.add') | translate"
                  [attr.title]="(isFavorite(ship) ? 'codex.upcoming.favorite.remove' : 'codex.upcoming.favorite.add') | translate"
                  (click)="toggleFavorite(ship)">{{ isFavorite(ship) ? '★' : '☆' }}</button>
        </div>
      </ng-template>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .upcoming { display: flex; flex-direction: column; gap: 24px; padding-bottom: 60px; }

    .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .head-main { display: flex; flex-direction: column; gap: 6px; }
    .back { color: var(--sc-accent); text-decoration: none; font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; }
    .back:hover { text-decoration: underline; }
    .head h1 { margin: 0; font-size: clamp(1.4rem, 3vw, 2rem); }
    .lede { margin: 0; color: var(--sc-fg-2); font-size: 0.86rem; max-width: 62ch; }
    .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .meta-count { font-family: var(--sc-font-display); font-size: 0.9rem; letter-spacing: 0.04em; color: var(--sc-accent); text-transform: uppercase; }
    .meta-fresh { display: inline-flex; align-items: center; gap: 6px; color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor)); }
    .fresh-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--sc-success, #5fd698); box-shadow: 0 0 8px var(--sc-success, #5fd698); }

    .toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .search { position: relative; flex: 1 1 260px; max-width: 420px; display: flex; align-items: center; }
    .search-icon { position: absolute; left: 10px; color: var(--sc-fg-2); font-size: 1rem; pointer-events: none; }
    .search-input {
      width: 100%; padding: 9px 30px 9px 30px; border-radius: 8px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-fg-0);
      font-family: inherit; font-size: 0.86rem;
    }
    .search-input:focus { outline: none; border-color: var(--sc-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 24%, transparent); }
    .search-input::-webkit-search-cancel-button { display: none; }
    .search-clear { position: absolute; right: 6px; width: 22px; height: 22px; border: 0; border-radius: 50%;
      background: transparent; color: var(--sc-fg-2); cursor: pointer; font-size: 1rem; line-height: 1; }
    .search-clear:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }

    .fav-chip { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-fg-1);
      font-family: inherit; font-size: max(0.78rem, var(--sc-fs-floor)); cursor: pointer; }
    .fav-chip .star { color: var(--sc-fg-2); }
    .fav-chip .ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .fav-chip:hover { border-color: var(--sc-accent); }
    .fav-chip.active { border-color: var(--sc-accent); color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .fav-chip.active .star, .fav-chip.active .ct { color: var(--sc-accent); }

    .block { display: flex; flex-direction: column; gap: 12px; }
    .block-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .block-head h2 { margin: 0; font-size: 1.05rem; }
    .block-sub { color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }

    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }

    .card-wrap { position: relative; transition: transform 0.16s; }
    .card-wrap:hover { transform: translateY(-2px); }
    .card {
      position: relative; display: flex; flex-direction: column; gap: 8px; height: 100%;
      padding: 12px; border-radius: 10px; border: 1px solid var(--sc-border);
      background: var(--sc-bg-1); color: inherit; text-decoration: none;
      transition: border-color 0.16s, box-shadow 0.16s;
    }
    .card-wrap:hover .card { border-color: var(--sc-accent); box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 14px color-mix(in srgb, var(--sc-accent) 26%, transparent); }
    .thumb { height: 118px; display: flex; align-items: center; justify-content: center; border-radius: 8px;
      background: radial-gradient(circle at 50% 45%, var(--sc-bg-2), var(--sc-bg-0)); overflow: hidden; }
    .thumb img { max-height: 110px; max-width: 100%; object-fit: contain; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.5)); }
    .thumb.icon-only sc-codex-icon { width: 56%; height: 56%; opacity: 0.7; }
    .info { display: flex; flex-direction: column; gap: 4px; }
    .name { margin: 0; font-size: 0.92rem; font-weight: 600; line-height: 1.2; }
    .mfr { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-2); }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
    .badge { font-size: max(0.62rem, var(--sc-fs-floor)); letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 7px; border-radius: 6px;
      background: var(--sc-bg-2); color: var(--sc-fg-1); border: 1px solid var(--sc-border); }
    .badge.status { background: color-mix(in srgb, var(--sc-fg-2) 14%, transparent); }
    .badge.status.concept { background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border-color: color-mix(in srgb, var(--sc-accent) 34%, transparent); color: var(--sc-accent); }
    .badge.new { background: color-mix(in srgb, var(--sc-success, #5fd698) 18%, transparent); border-color: color-mix(in srgb, var(--sc-success, #5fd698) 40%, transparent); color: var(--sc-success, #5fd698); }
    .ext { position: absolute; top: 10px; right: 12px; color: var(--sc-fg-2); font-size: 0.9rem; }
    .card-wrap:hover .ext { color: var(--sc-accent); }

    .fav { position: absolute; top: 6px; left: 6px; width: 30px; height: 30px; border-radius: 8px;
      border: 1px solid transparent; background: color-mix(in srgb, var(--sc-bg-0) 66%, transparent);
      color: var(--sc-fg-2); font-size: 1.02rem; line-height: 1; cursor: pointer; padding: 0; }
    .fav:hover { color: var(--sc-accent); border-color: var(--sc-border); }
    .fav.on { color: var(--sc-accent); }
    .fav:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    .skel { background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%); background-size: 200% 100%; animation: skel 1.4s ease-in-out infinite; min-height: 210px; border-radius: 10px; }
    @keyframes skel { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .empty { text-align: center; padding: 40px 20px; color: var(--sc-fg-1); }
    .empty p { color: var(--sc-fg-2); margin: 6px 0 0; }
    .err { color: var(--sc-danger); padding: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }

    @media (prefers-reduced-motion: reduce) {
      .card, .card-wrap { transition: none; }
      .card-wrap:hover { transform: none; }
      .skel { animation: none; }
    }
  `],
})
export class CodexUpcomingComponent implements OnInit, OnDestroy {
  private readonly svc = inject(UpcomingShipsService);

  readonly feed = this.svc.feed;
  readonly loading = this.svc.loading;
  readonly error = this.svc.error;
  readonly concept = this.svc.concept;
  readonly flightReadyMissing = this.svc.flightReadyMissing;
  readonly query = this.svc.query;
  readonly favoritesOnly = this.svc.favoritesOnly;
  readonly favoriteCount = this.svc.favoriteCount;

  readonly skeletons = Array.from({ length: 8 }, (_, i) => i);
  readonly rsiFallback = 'https://robertsspaceindustries.com/pledge/ships';

  // Snapshot of "what was new when the view opened": acknowledging on leave
  // would otherwise clear the badges while the user is still looking at them.
  private readonly newOnEnter = signal<ReadonlySet<string> | null>(null);
  private readonly newIds = computed(() => this.newOnEnter() ?? this.svc.newIds());

  private readonly brokenThumbs = signal<ReadonlySet<string>>(new Set<string>());

  ngOnInit(): void {
    if (!this.feed()) void this.svc.refresh();
    else this.newOnEnter.set(this.svc.newIds());
  }

  ngOnDestroy(): void {
    // Leaving the list counts as "seen" — this clears the Verse News notice.
    this.svc.acknowledge();
  }

  reload(): void {
    void this.svc.refresh();
  }

  onQuery(event: Event): void {
    this.svc.query.set((event.target as HTMLInputElement).value);
  }

  clearQuery(): void {
    this.svc.clearQuery();
  }

  toggleFavoritesOnly(): void {
    this.svc.toggleFavoritesOnly();
  }

  isFavorite(ship: UpcomingShip): boolean {
    return this.svc.isFavorite(ship.id);
  }

  toggleFavorite(ship: UpcomingShip): void {
    this.svc.toggleFavorite(ship.id);
  }

  isNew(ship: UpcomingShip): boolean {
    return this.newIds().has(ship.id);
  }

  thumbSrc(ship: UpcomingShip): string | null {
    if (!ship.thumbnail || this.brokenThumbs().has(ship.id)) return null;
    return ship.thumbnail;
  }

  onThumbError(ship: UpcomingShip): void {
    const next = new Set(this.brokenThumbs());
    next.add(ship.id);
    this.brokenThumbs.set(next);
  }

  /** Map RSI's production_status to a localized label key; unknown → raw value passthrough. */
  statusLabel(ship: UpcomingShip): string {
    const s = (ship.productionStatus ?? '').toLowerCase();
    if (s === 'in-concept' || s === 'in concept') return 'codex.upcoming.status.concept';
    if (s === 'flight-ready' || s === 'flight ready') return 'codex.upcoming.status.flightReady';
    return ship.productionStatus ?? '';
  }
}
