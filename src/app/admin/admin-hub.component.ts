import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { StageSearchDirective } from '../shell/fusion-bar/stage-search.directive';
import { StageHeroDirective } from '../shell/fusion-bar/stage-hero.directive';

/** One admin page reachable from the hub. */
export interface AdminHubTile {
  id: string;
  link: string;
  titleKey: string;
  textKey: string;
  /** SVG path data of the 24×24 line icon. */
  icon: string;
}

/** The admin pages behind the merged "Admin" nav entry, in reading order. */
export const ADMIN_HUB_TILES: readonly AdminHubTile[] = [
  {
    id: 'users',
    link: '/admin',
    titleKey: 'adminHub.tiles.users.title',
    textKey: 'adminHub.tiles.users.text',
    icon: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  },
  {
    id: 'telemetry',
    link: '/admin/telemetry',
    titleKey: 'adminHub.tiles.telemetry.title',
    textKey: 'adminHub.tiles.telemetry.text',
    icon: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  },
  {
    id: 'feedback',
    link: '/admin/feedback',
    titleKey: 'adminHub.tiles.feedback.title',
    textKey: 'adminHub.tiles.feedback.text',
    icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  },
  {
    id: 'integrations',
    link: '/admin/api-tokens',
    titleKey: 'adminHub.tiles.integrations.title',
    textKey: 'adminHub.tiles.integrations.text',
    icon: 'M15 7h3a5 5 0 0 1 0 10h-3M9 17H6A5 5 0 0 1 6 7h3M8 12h8',
  },
  {
    id: 'uploader',
    link: '/uploader',
    titleKey: 'adminHub.tiles.uploader.title',
    textKey: 'adminHub.tiles.uploader.text',
    icon: 'M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  },
];

/**
 * `/admin/hub` — the target of the merged "Admin" main-nav entry (beta shell).
 * A cinematic main page like Verse, Codex and HQ: the scene stays behind it,
 * the tiles are real anchors to the admin pages. Admin-only (roleGuard on the
 * route), so the eyebrow says it in words, and the accent is the hot one.
 */
@Component({
  selector: 'sc-admin-hub',
  // A cinematic route spans the full track; the hub's content keeps the page frame.
  host: { class: 'sc-track-wide' },
  standalone: true,
  imports: [RouterLink, TranslatePipe, PageHeaderComponent, StageSearchDirective, StageHeroDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The main page hero (beta shell): eyebrow · title · stage slot, centred, the slot
         at the same spot as on every main page (StageHeroDirective). -->
    <div class="sc-stage-hero" scStageHero>
      <sc-page-header
        [eyebrow]="'adminHub.eyebrow' | translate"
        [title]="'adminHub.title' | translate"
        [subtitle]="'adminHub.subtitle' | translate" />
      <div scStageSearch></div>
    </div>
    <ul class="tiles" role="list">
      @for (t of tiles; track t.id) {
        <li>
          <a class="tile" [routerLink]="t.link" [attr.data-tile]="t.id">
            <svg class="tile-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="t.icon" /></svg>
            <span class="tile-title">{{ t.titleKey | translate }}</span>
            <span class="tile-text">{{ t.textKey | translate }}</span>
          </a>
        </li>
      }
    </ul>
  `,
  styles: [
    `
      :host {
        display: block;
        padding-block: var(--sc-space-5) var(--sc-space-7);
      }
      .tiles {
        list-style: none;
        margin: var(--sc-space-5) 0 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: var(--sc-space-4);
      }
      .tile {
        display: grid;
        gap: var(--sc-space-2);
        height: 100%;
        box-sizing: border-box;
        padding: var(--sc-space-4);
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--sc-accent-hot) 30%, var(--sc-border));
        background: color-mix(in srgb, var(--sc-bg-2) 72%, transparent);
        backdrop-filter: blur(10px);
        color: var(--sc-fg-0);
        text-decoration: none;
        transition: border-color 0.2s ease, transform 0.2s ease, background 0.2s ease;
      }
      .tile:hover,
      .tile:focus-visible {
        border-color: var(--sc-accent-hot);
        background: color-mix(in srgb, var(--sc-accent-hot) 8%, var(--sc-bg-2));
        transform: translateY(-2px);
      }
      .tile:focus-visible {
        outline: 2px solid var(--sc-accent-hot);
        outline-offset: 2px;
      }
      .tile-icon {
        width: 26px;
        height: 26px;
        color: var(--sc-accent-hot);
      }
      .tile-title {
        font-weight: 600;
        font-size: 1.05rem;
      }
      .tile-text {
        color: var(--sc-fg-1);
        font-size: 0.9rem;
        line-height: 1.45;
      }
      @media (prefers-reduced-motion: reduce) {
        .tile {
          transition: none;
        }
        .tile:hover,
        .tile:focus-visible {
          transform: none;
        }
      }
    `,
  ],
})
export class AdminHubComponent {
  readonly tiles = ADMIN_HUB_TILES;
}
