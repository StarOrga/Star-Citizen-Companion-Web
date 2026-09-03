import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { humanizeClassName } from '../codex/codex-format';
import { ScDatePipe } from '../core/locale/sc-date.pipe';
import { RoleLoadoutItem } from '../hangar/hangar.types';
import { LoadoutShareService } from './loadout-share.service';
import { SharedLoadoutView, isValidShareToken, shareItems } from './loadout-share.types';

/**
 * The public read-only view of a shared loadout (`/shared/loadout/:token`).
 *
 * Rendered through PublicLayoutComponent, i.e. OUTSIDE the gated shell: the
 * whole point of a share link is that "anyone holding the link can view it,
 * including unregistered visitors". It is therefore also the only page in the
 * app that shows another account's hangar data, which is why it shows exactly
 * what `get_shared_loadout()` projects — name, role, items, owner handle —
 * and offers no way to walk from there to anything else of that account's.
 *
 * An unknown token, a revoked link and a suspended owner all render the same
 * "not available" state, because the RPC answers all three identically. That
 * is deliberate: a distinguishable answer would turn this page into a probe
 * for which links once existed.
 */
@Component({
  selector: 'sc-shared-loadout',
  standalone: true,
  imports: [TranslateModule, RouterLink, ScDatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page">
      @if (loading()) {
        <div class="sc-card state">{{ 'share.view.loading' | translate }}</div>
      } @else if (view(); as v) {
        <header class="head">
          <p class="eyebrow">{{ 'share.view.eyebrow' | translate }}</p>
          <h1>{{ v.name }}</h1>
          <div class="badges">
            <span class="badge role">{{ ('hangar.roles.' + v.role) | translate }}</span>
            <span class="badge subtle">
              {{ 'hangar.roleLoadouts.itemCount' | translate: { count: items().length } }}
            </span>
          </div>
          <p class="byline">
            {{ 'share.view.by' | translate: { name: ownerLabel() } }}
            <span class="dot">·</span>
            {{ 'share.view.updated' | translate: { date: (v.updated_at | scDate) } }}
          </p>
        </header>

        <div class="sc-card">
          @if (items().length === 0) {
            <p class="state inline">{{ 'share.view.emptyLoadout' | translate }}</p>
          } @else {
            <ul class="slot-list">
              @for (i of items(); track i.slot) {
                <li class="slot">
                  <span class="slot-label">{{ i.slot }}</span>
                  <span class="slot-item">{{ i.className ? itemName(i.className) : '—' }}</span>
                </li>
              }
            </ul>
          }
        </div>

        <p class="footnote">{{ 'share.view.footnote' | translate }}</p>
        <a class="sc-btn" routerLink="/about">{{ 'share.view.aboutCta' | translate }}</a>
      } @else {
        <div class="sc-card state">
          <p class="state__title">{{ 'share.view.unavailable.title' | translate }}</p>
          <p>{{ 'share.view.unavailable.body' | translate }}</p>
          <a class="sc-btn" routerLink="/about">{{ 'share.view.aboutCta' | translate }}</a>
        </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .page { display: flex; flex-direction: column; gap: 16px; max-width: 680px; margin: 0 auto; }
    .eyebrow {
      margin: 0 0 4px;
      color: var(--sc-fg-2);
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    h1 { margin: 0; overflow-wrap: anywhere; }
    .badges { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
    .badge {
      font-size: max(0.68rem, var(--sc-fs-floor));
      padding: 2px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
    }
    .badge.role { text-transform: uppercase; letter-spacing: 0.05em; }
    .badge.subtle { background: var(--sc-bg-2); border-color: var(--sc-border); color: var(--sc-fg-2); }
    .byline { margin: 10px 0 0; color: var(--sc-fg-2); font-size: 0.86rem; overflow-wrap: anywhere; }
    .dot { margin: 0 6px; }

    .slot-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .slot {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-wrap: wrap;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--sc-bg-0);
      border: 1px solid var(--sc-border);
    }
    .slot-label {
      flex: 0 0 120px;
      font-size: max(0.72rem, var(--sc-fs-floor));
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sc-fg-2);
    }
    .slot-item { flex: 1 1 160px; min-width: 0; font-size: 0.9rem; overflow-wrap: anywhere; }

    .state { color: var(--sc-fg-2); text-align: center; padding: 28px; }
    .state.inline { padding: 12px 0; text-align: left; }
    .state__title { color: var(--sc-fg-0); font-weight: 600; margin: 0 0 6px; }
    .footnote { color: var(--sc-fg-2); font-size: max(0.74rem, var(--sc-fs-floor)); margin: 0; }

    .sc-btn {
      align-self: flex-start;
      padding: 10px 16px;
      border-radius: 6px;
      background: var(--sc-bg-1);
      border: 1px solid var(--sc-accent);
      color: var(--sc-accent);
      font-family: var(--sc-font-display);
      font-size: max(0.72rem, var(--sc-fs-floor));
      letter-spacing: 0.05em;
      text-transform: uppercase;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      min-height: 48px;
    }
    .sc-btn:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .state .sc-btn { align-self: center; margin-top: 14px; }

    @media (max-width: 560px) {
      .slot-label { flex: 1 1 100%; }
      .sc-btn { align-self: stretch; justify-content: center; }
    }
  `],
})
export class SharedLoadoutComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly shares = inject(LoadoutShareService);

  readonly view = signal<SharedLoadoutView | null>(null);
  readonly loading = signal(true);

  readonly items = computed<RoleLoadoutItem[]>(() => {
    const v = this.view();
    return v ? shareItems(v).filter((i) => i.slot) : [];
  });

  readonly ownerLabel = computed(() => {
    const v = this.view();
    return v?.owner_handle ?? v?.owner_name ?? '—';
  });

  async ngOnInit(): Promise<void> {
    const token = this.route.snapshot.paramMap.get('token') ?? '';
    // A malformed token cannot match anything; refusing it here keeps a
    // mistyped URL from being a round trip, and the shape check mirrors the
    // `loadout_shares_token_len` constraint.
    if (!isValidShareToken(token)) {
      this.loading.set(false);
      return;
    }
    this.view.set(await this.shares.getShared(token.trim()));
    this.loading.set(false);
  }

  itemName(className: string): string {
    return humanizeClassName(className);
  }
}
