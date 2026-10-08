import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { HqSuppliesPanelComponent } from './hq-supplies-panel.component';
import { HQ_ROOT, hqHangar, hqLocker, hqOps } from './hq-routes';

/** One category tab of the HQ frame. */
export interface HqTab {
  link: string;
  labelKey: string;
  exact: boolean;
}

/** Order fixed by the concept (2026-10-08): Übersicht, then Spind · Hangar · Einsätze. */
export const HQ_TABS: readonly HqTab[] = [
  { link: HQ_ROOT, labelKey: 'hq.tabs.overview', exact: true },
  { link: hqLocker, labelKey: 'hq.tabs.locker', exact: false },
  { link: hqHangar, labelKey: 'hq.tabs.hangar', exact: false },
  { link: hqOps, labelKey: 'hq.tabs.ops', exact: false },
];

/**
 * The HQ frame — the personal area's category tabs and the cross-area
 * "Nachschub" (supplies) button around the routed HQ page. No page padding or
 * max-width of its own: the shell's `.content` is the page frame.
 */
@Component({
  selector: 'sc-hq-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, HqSuppliesPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="hq-bar">
      <nav class="hq-tabs" [attr.aria-label]="'hq.tabsAria' | translate">
        @for (t of tabs; track t.link) {
          <a
            class="hq-tab"
            [routerLink]="t.link"
            routerLinkActive="active"
            ariaCurrentWhenActive="page"
            [routerLinkActiveOptions]="{ exact: t.exact }">
            {{ t.labelKey | translate }}
          </a>
        }
      </nav>
      <button
        #suppliesBtn
        type="button"
        class="sc-btn supplies-btn"
        aria-haspopup="dialog"
        [attr.aria-expanded]="suppliesOpen()"
        [attr.aria-label]="'hq.supplies.buttonAria' | translate: { count: suppliesCount() }"
        (click)="suppliesOpen.set(!suppliesOpen())">
        <span>{{ 'hq.supplies.button' | translate }}</span>
        <b class="supplies-count mono">{{ suppliesCount() }}</b>
      </button>
    </div>

    <router-outlet />

    @if (suppliesOpen()) {
      <sc-hq-supplies-panel [returnFocus]="suppliesBtn" (closed)="suppliesOpen.set(false)" />
    }
  `,
  styles: [
    `
      :host { display: block; }
      .hq-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--sc-space-3, 12px);
        margin-bottom: var(--sc-space-4, 16px);
        border-bottom: 1px solid var(--sc-border);
      }
      .hq-tabs { display: flex; gap: var(--sc-space-1, 4px); overflow-x: auto; min-width: 0; }
      .hq-tab {
        display: inline-flex;
        align-items: center;
        min-height: 40px;
        padding: 0 var(--sc-space-3, 12px);
        color: var(--sc-fg-2);
        text-decoration: none;
        border-bottom: 2px solid transparent;
        white-space: nowrap;
      }
      .hq-tab:hover { color: var(--sc-fg); }
      .hq-tab.active { color: var(--sc-accent); border-bottom-color: var(--sc-accent); }
      .hq-tab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .supplies-btn { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); flex: none; }
      .supplies-count {
        min-width: 1.5em;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--sc-bg-2);
        color: var(--sc-fg-2);
        text-align: center;
      }
      @media (pointer: coarse) {
        .hq-tab, .supplies-btn { min-height: 48px; }
      }
    `,
  ],
})
export class HqShellComponent {
  readonly tabs = HQ_TABS;
  readonly suppliesOpen = signal(false);
  /** Shell stage: the supplies list has no data source yet, so the counter is 0. */
  readonly suppliesCount = computed(() => 0);
}
