import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { UpcomingShip, UpcomingShipsService } from '../codex/upcoming-ships.service';

/** How many ship names the notice spells out before collapsing into "+N more". */
const NAME_LIMIT = 6;

/**
 * Verse News notice for the Codex "Upcoming Ships" list (feedback d3fbc023):
 * which ships appeared since the user last looked, plus favorites whose RSI
 * production status moved (e.g. in-concept → flight-ready).
 *
 * The baseline lives in `UpcomingShipsService` (localStorage, preference
 * category). A device that has never loaded the list is seeded silently, so the
 * notice only ever reports real deltas. Dismissing, or visiting the upcoming
 * list, acknowledges it. Renders nothing when there is no delta — no empty box.
 */
@Component({
  selector: 'sc-upcoming-ships-notice',
  standalone: true,
  imports: [RouterLink, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (count() > 0) {
      <section class="notice sc-card" [attr.aria-label]="'news.upcomingShips.title' | translate">
        <div class="head">
          <span class="icon" aria-hidden="true">🚀</span>
          <h2>{{ 'news.upcomingShips.title' | translate }}</h2>
          <button type="button" class="dismiss" (click)="dismiss()"
                  [attr.aria-label]="'news.upcomingShips.dismiss' | translate"
                  [attr.title]="'news.upcomingShips.dismiss' | translate">×</button>
        </div>

        @if (added().length > 0) {
          <p class="line">
            <strong>{{ (added().length === 1 ? 'news.upcomingShips.addedOne' : 'news.upcomingShips.addedMany')
              | translate: { count: added().length } }}</strong>
          </p>
          <ul class="ships">
            @for (ship of addedShown(); track ship.id) {
              <li class="ship" [class.fav]="isFavorite(ship)">
                @if (isFavorite(ship)) { <span class="star" aria-hidden="true">★</span> }
                <span class="nm">{{ ship.name }}</span>
              </li>
            }
            @if (addedRest() > 0) {
              <li class="ship more">{{ 'news.upcomingShips.more' | translate: { count: addedRest() } }}</li>
            }
          </ul>
        }

        @if (favoriteUpdates().length > 0) {
          <p class="line">
            <strong>{{ 'news.upcomingShips.favoritesUpdated' | translate: { count: favoriteUpdates().length } }}</strong>
          </p>
          <ul class="ships">
            @for (ship of favoriteUpdates(); track ship.id) {
              <li class="ship fav">
                <span class="star" aria-hidden="true">★</span>
                <span class="nm">{{ ship.name }}</span>
                @if (ship.productionStatus) { <span class="st">{{ statusLabel(ship) | translate }}</span> }
              </li>
            }
          </ul>
        }

        <a class="cta" routerLink="/codex/upcoming">{{ 'news.upcomingShips.open' | translate }} →</a>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .notice { display: flex; flex-direction: column; gap: 8px; padding: 14px 16px;
      border-left: 3px solid var(--sc-accent); }
    .head { display: flex; align-items: center; gap: 8px; }
    .head h2 { margin: 0; font-size: 0.95rem; }
    .icon { font-size: 1rem; }
    .dismiss { margin-left: auto; width: 26px; height: 26px; border: 0; border-radius: 6px;
      background: transparent; color: var(--sc-fg-2); font-size: 1.1rem; line-height: 1; cursor: pointer; }
    .dismiss:hover { color: var(--sc-fg-0); background: var(--sc-bg-2); }
    .line { margin: 0; font-size: 0.82rem; color: var(--sc-fg-1); }
    .ships { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .ship { display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: 999px;
      border: 1px solid var(--sc-border); background: var(--sc-bg-2); font-size: 0.75rem; }
    .ship.fav { border-color: color-mix(in srgb, var(--sc-accent) 44%, transparent); }
    .ship .star { color: var(--sc-accent); }
    .ship .st { color: var(--sc-fg-2); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .ship.more { color: var(--sc-fg-2); background: transparent; border-style: dashed; }
    .cta { align-self: flex-start; margin-top: 2px; color: var(--sc-accent); text-decoration: none;
      font-family: var(--sc-font-display); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; }
    .cta:hover { text-decoration: underline; }
  `],
})
export class UpcomingShipsNoticeComponent implements OnInit {
  private readonly svc = inject(UpcomingShipsService);

  readonly added = computed(() => this.svc.diff().added);
  readonly favoriteUpdates = computed(() => this.svc.diff().favoriteUpdates);
  readonly count = this.svc.notificationCount;

  readonly addedShown = computed(() => this.added().slice(0, NAME_LIMIT));
  readonly addedRest = computed(() => Math.max(0, this.added().length - NAME_LIMIT));

  ngOnInit(): void {
    // Silent: the notice is a side dish on the news page, never a spinner.
    if (!this.svc.feed()) void this.svc.refresh(true);
  }

  isFavorite(ship: UpcomingShip): boolean {
    return this.svc.isFavorite(ship.id);
  }

  dismiss(): void {
    this.svc.acknowledge();
  }

  statusLabel(ship: UpcomingShip): string {
    const s = (ship.productionStatus ?? '').toLowerCase();
    if (s === 'in-concept' || s === 'in concept') return 'codex.upcoming.status.concept';
    if (s === 'flight-ready' || s === 'flight ready') return 'codex.upcoming.status.flightReady';
    return ship.productionStatus ?? '';
  }
}
