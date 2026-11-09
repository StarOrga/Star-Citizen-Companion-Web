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

/** A themed group of tiles, headed by a small eyebrow. */
export interface AdminHubGroup {
  id: string;
  labelKey: string;
  tiles: readonly AdminHubTile[];
}

/**
 * The admin pages behind the merged "Admin" nav entry, grouped by what they are
 * for: people and access, operations (feedback, telemetry), content and data.
 */
export const ADMIN_HUB_GROUPS: readonly AdminHubGroup[] = [
  {
    id: 'people',
    labelKey: 'adminHub.groups.people',
    tiles: [
      {
        id: 'users',
        link: '/admin',
        titleKey: 'adminHub.tiles.users.title',
        textKey: 'adminHub.tiles.users.text',
        icon: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
      },
      {
        id: 'integrations',
        link: '/admin/api-tokens',
        titleKey: 'adminHub.tiles.integrations.title',
        textKey: 'adminHub.tiles.integrations.text',
        icon: 'M15 7h3a5 5 0 0 1 0 10h-3M9 17H6A5 5 0 0 1 6 7h3M8 12h8',
      },
    ],
  },
  {
    id: 'operations',
    labelKey: 'adminHub.groups.operations',
    tiles: [
      {
        id: 'feedback',
        link: '/admin/feedback',
        titleKey: 'adminHub.tiles.feedback.title',
        textKey: 'adminHub.tiles.feedback.text',
        icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
      },
      {
        id: 'telemetry',
        link: '/admin/telemetry',
        titleKey: 'adminHub.tiles.telemetry.title',
        textKey: 'adminHub.tiles.telemetry.text',
        icon: 'M3 3v18h18M7 15l4-4 3 3 5-6',
      },
    ],
  },
  {
    id: 'content',
    labelKey: 'adminHub.groups.content',
    tiles: [
      {
        id: 'events',
        link: '/admin/events',
        titleKey: 'adminHub.tiles.events.title',
        textKey: 'adminHub.tiles.events.text',
        icon: 'M12 3l2 6.2 6.2 2.8-6.2 2.8L12 21l-2-6.2L3.8 12 10 9.2z',
      },
      {
        id: 'translations',
        link: '/admin/translations',
        titleKey: 'adminHub.tiles.translations.title',
        textKey: 'adminHub.tiles.translations.text',
        icon: 'M4 5h8M8 3v2M5 9c1 3 3 5 6 6M11 5c-1 4-3 7-7 10M13 21l4-10 4 10M14.5 18h5',
      },
      {
        id: 'uploader',
        link: '/apps/uploader',
        titleKey: 'adminHub.tiles.uploader.title',
        textKey: 'adminHub.tiles.uploader.text',
        icon: 'M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
      },
    ],
  },
];

/** Every tile in reading order (group by group). */
export const ADMIN_HUB_TILES: readonly AdminHubTile[] = ADMIN_HUB_GROUPS.flatMap((g) => g.tiles);

/**
 * `/admin/hub` — the target of the merged "Admin" main-nav entry (beta shell).
 * A cinematic main page like Verse, Codex and HQ: the scene stays behind it,
 * the tiles are real anchors to the admin pages. Admin-only (roleGuard on the
 * route), so the eyebrow says it in words, and the accent is the hot one.
 */
@Component({
  selector: 'sc-admin-hub',
  // A cinematic route spans the full track: the head is the stage (A), the tiles
  // below it take the subheader width B (styles.scss "PAGE FRAME").
  standalone: true,
  imports: [RouterLink, TranslatePipe, PageHeaderComponent, StageSearchDirective, StageHeroDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The main page hero (beta shell): eyebrow · title · stage slot, centred, the slot
         at the same spot as on every main page (StageHeroDirective). -->
    <div class="sc-stage-hero sc-stage-a" scStageHero>
      <sc-page-header
        [eyebrow]="'adminHub.eyebrow' | translate"
        [title]="'adminHub.title' | translate" />
      <div scStageSearch></div>
    </div>
    <div class="groups sc-below-stage">
      @for (g of groups; track g.id) {
        <section class="group" [attr.data-group]="g.id" [attr.aria-labelledby]="'admin-hub-' + g.id">
          <h2 class="group-label" [id]="'admin-hub-' + g.id">{{ g.labelKey | translate }}</h2>
          <!-- Every group shares the same column tracks, so tiles line up across groups. -->
          <ul class="tiles" role="list">
            @for (t of g.tiles; track t.id) {
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
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding-block: var(--sc-space-5) var(--sc-space-7);
      }
      .groups {
        display: grid;
        gap: var(--sc-space-6);
        margin-top: var(--sc-space-5);
      }
      .group {
        display: grid;
        gap: var(--sc-space-3);
      }
      .group-label {
        margin: 0;
        color: var(--sc-fg-2);
        font-family: var(--sc-font-display);
        font-size: max(0.72rem, var(--sc-fs-floor));
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }
      /* Fixed column tracks (not auto-fill + 1fr per group), so a two-tile group
         keeps the same tile width as a three-tile one and every row lines up. */
      .tiles {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: var(--sc-space-4);
      }
      @media (max-width: 900px) {
        .tiles {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 560px) {
        .tiles {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .tile {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        grid-template-rows: auto 1fr;
        align-content: start;
        column-gap: var(--sc-space-3);
        row-gap: var(--sc-space-1);
        height: 100%;
        box-sizing: border-box;
        padding: var(--sc-space-4);
        border-radius: 14px;
        border: 1px solid color-mix(in srgb, var(--sc-accent-hot) 30%, var(--sc-border));
        background: color-mix(in srgb, var(--sc-bg-2) 85%, transparent);
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
        grid-row: 1 / span 2;
        width: 26px;
        height: 26px;
        color: var(--sc-accent-hot);
      }
      .tile-title {
        font-weight: 600;
        font-size: 1.05rem;
      }
      .tile-text {
        grid-column: 2;
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
  readonly groups = ADMIN_HUB_GROUPS;
}
