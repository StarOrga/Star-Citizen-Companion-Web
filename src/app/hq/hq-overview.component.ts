import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { humanizeClassName } from '../codex/codex-format';
import { HangarService } from '../hangar/hangar.service';
import { HangarShip, HangarShipConfig } from '../hangar/hangar.types';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { HqOwnershipService } from './hq-ownership.service';
import { HqLink, hqHangar, hqLocker, hqSet, hqShip, personalShipLink } from './hq-routes';

/**
 * HQ landing ("Übersicht"): the active ship with its active variant, the
 * active FPS set, the (empty) next ops and the (empty) supplies preview.
 *
 * The recent-ships / recent-sets choosers moved here from the Codex landing's
 * stage picker (concept 2026-10-08: the codex shows no personal content). A
 * chip is a selection, not a navigation — it puts that ship or set on the
 * overview card (and to the front of the recent list); the card itself is the
 * real link into the hangar / locker.
 */
@Component({
  selector: 'sc-hq-overview',
  standalone: true,
  imports: [RouterLink, TranslatePipe, PageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-page-header
      [eyebrow]="'hq.eyebrow' | translate"
      [title]="'hq.title' | translate"
      [subtitle]="'hq.subtitle' | translate" />

    @if (loadError(); as err) {
      <div class="sc-card err" role="alert">
        <span>{{ 'hq.overview.loadFailed' | translate }}</span>
        <button type="button" class="sc-btn small" (click)="retry()">{{ 'errors.retry' | translate }}</button>
      </div>
    }

    <div class="grid">
      <section class="sc-card tile" aria-labelledby="hq-ov-ship">
        <h2 id="hq-ov-ship" class="tile-eyebrow">{{ 'hq.overview.activeShip' | translate }}</h2>
        @if (activeShip(); as s) {
          <a class="tile-main" [routerLink]="shipRoute(s)">
            <strong class="tile-title">{{ shipName(s) }}</strong>
            <span class="tile-sub">
              {{ 'hq.overview.activeVariant' | translate }}:
              {{ activeVariant()?.name || ('hq.overview.noVariant' | translate) }}
            </span>
          </a>
          <a class="tile-link" [routerLink]="codexLink().commands" [queryParams]="codexLink().queryParams">
            {{ 'hq.overview.openCodex' | translate }} <span aria-hidden="true">→</span>
          </a>
          @if (recentShips().length > 1) {
            <div class="chips" role="group" [attr.aria-label]="'hq.overview.recentShips' | translate">
              @for (r of recentShips(); track r.id) {
                <button type="button" class="chip" [class.on]="r.id === s.id" [attr.aria-pressed]="r.id === s.id"
                        (click)="pickShip(r)">{{ shipName(r) }}</button>
              }
            </div>
          }
        } @else if (!loading()) {
          <p class="hint">{{ 'hq.overview.noShip' | translate }}</p>
          <a class="tile-link" [routerLink]="hangarLink">{{ 'hq.overview.setupHangar' | translate }} <span aria-hidden="true">→</span></a>
        }
      </section>

      <section class="sc-card tile" aria-labelledby="hq-ov-set">
        <h2 id="hq-ov-set" class="tile-eyebrow">{{ 'hq.overview.activeSet' | translate }}</h2>
        @if (activeSet(); as l) {
          <a class="tile-main" [routerLink]="setRoute(l.id)">
            <strong class="tile-title">{{ l.name }}</strong>
            <span class="tile-sub">{{ ('hangar.roles.' + l.role) | translate }}</span>
          </a>
          @if (recentSets().length > 1) {
            <div class="chips" role="group" [attr.aria-label]="'hq.overview.recentSets' | translate">
              @for (r of recentSets(); track r.id) {
                <button type="button" class="chip" [class.on]="r.id === l.id" [attr.aria-pressed]="r.id === l.id"
                        (click)="pickSet(r.id)">{{ r.name }}</button>
              }
            </div>
          }
        } @else if (!loading()) {
          <p class="hint">{{ 'hq.overview.noSet' | translate }}</p>
          <a class="tile-link" [routerLink]="lockerLink">{{ 'hq.overview.createSet' | translate }} <span aria-hidden="true">→</span></a>
        }
      </section>

      <section class="sc-card tile" aria-labelledby="hq-ov-ops">
        <h2 id="hq-ov-ops" class="tile-eyebrow">{{ 'hq.overview.nextOps' | translate }}</h2>
        <p class="hint">{{ 'hq.overview.opsEmpty' | translate }}</p>
      </section>

      <section class="sc-card tile" aria-labelledby="hq-ov-supplies">
        <h2 id="hq-ov-supplies" class="tile-eyebrow">{{ 'hq.overview.suppliesPreview' | translate }}</h2>
        <p class="hint">{{ 'hq.overview.suppliesEmpty' | translate }}</p>
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: 16px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 16px; }
      .tile { display: flex; flex-direction: column; gap: 10px; padding: 16px; }
      .tile-eyebrow {
        margin: 0;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      .tile-main { display: flex; flex-direction: column; gap: 4px; color: var(--sc-fg); text-decoration: none; }
      .tile-main:hover .tile-title { color: var(--sc-accent); }
      .tile-title { font-size: 1.15rem; }
      .tile-sub { color: var(--sc-fg-2); }
      .tile-link { color: var(--sc-accent); text-decoration: none; align-self: flex-start; }
      .tile-link:hover { text-decoration: underline; }
      .tile-main:focus-visible, .tile-link:focus-visible, .chip:focus-visible {
        outline: 2px solid var(--sc-accent);
        outline-offset: 2px;
      }
      .hint { margin: 0; color: var(--sc-fg-2); }
      .chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .chip {
        padding: 4px 10px;
        border: 1px solid var(--sc-border);
        border-radius: 999px;
        background: transparent;
        color: var(--sc-fg-2);
        font: inherit;
        cursor: pointer;
      }
      .chip.on { border-color: var(--sc-accent); color: var(--sc-accent); }
      .err { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; }
      @media (pointer: coarse) {
        .chip { min-height: 48px; }
      }
    `,
  ],
})
export class HqOverviewComponent implements OnInit {
  private readonly auth = inject(AuthService);
  readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);

  readonly hangarLink = hqHangar;
  readonly lockerLink = hqLocker;

  readonly loading = computed(() => this.hangar.loading());
  readonly loadError = computed(() => this.hangar.error() ?? this.ownership.error());

  readonly recentShips = computed(() => this.hangar.recentShips());
  readonly recentSets = computed(() => this.hangar.recentSets());
  readonly activeShip = computed<HangarShip | null>(() => this.recentShips()[0] ?? null);
  readonly activeSet = computed(() => this.recentSets()[0] ?? null);

  readonly activeVariant = computed<HangarShipConfig | null>(() => {
    const ship = this.activeShip();
    if (!ship) return null;
    return this.ownership.configsForShip(ship.id).find((c) => c.isActive) ?? null;
  });

  /** "View in codex" — the user's own variant when one is active, else the plain ship page. */
  readonly codexLink = computed<HqLink>(() => {
    const ship = this.activeShip();
    const variant = this.activeVariant();
    if (ship && variant) return personalShipLink(ship.shipClassName, variant.id);
    return { commands: ['/codex/ship', ship?.shipClassName ?? ''], queryParams: {} };
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    if (!this.auth.user()) return;
    if (this.hangar.ships().length === 0 && this.hangar.roleLoadouts().length === 0) {
      await this.hangar.loadAll();
    }
    await this.ownership.ensureLoaded();
  }

  retry(): void {
    this.ownership.invalidate();
    void this.hangar.loadAll().then(() => this.ownership.ensureLoaded());
  }

  shipName(s: HangarShip): string {
    return s.customName || humanizeClassName(s.shipClassName);
  }

  shipRoute(s: HangarShip): string[] {
    return hqShip(s.id);
  }

  setRoute(id: string): string[] {
    return hqSet(id);
  }

  pickShip(s: HangarShip): void {
    this.hangar.markShipPicked(s.shipClassName);
  }

  pickSet(id: string): void {
    this.hangar.markSetPicked(id);
  }
}
