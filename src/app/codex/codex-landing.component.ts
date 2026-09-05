import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  CodexListRow,
  CodexKind,
  CodexService,
  ResolvedEntity,
  manufacturerLabel,
  pickLocalized,
  toLang,
} from './codex.service';
import { cleanLocaleValue, formatNumber, humanizeClassName } from './codex-format';
import { LocalizedText, Lang, ShipPayload } from './codex.types';
import {
  PolySearchHit,
  isUpcomingHit,
  polyHitIconKind,
  polyHitLink,
  polyHitQueryParams,
} from './codex-poly-search';
import { CodexBoardPanelComponent } from './codex-board-panel.component';
import { CodexZoneRailComponent } from './codex-zone-rail.component';
import { CodexPatchHeadlineComponent } from './codex-patch-headline.component';
import { totalRecordCount } from './codex-patch-timeline';
import { ShipStatDelta } from './codex-build-diff';
import {
  ArmorSlotState,
  EntityPayloadEntry,
  armorSlotsFromLoadout,
  computeShipKpis,
  KpiRow,
  sortByRecency,
  withSelectedFirst,
} from './codex-landing-kpi';

import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShipsService } from './upcoming-ships.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarRoleLoadout } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { AppDownloadMenuComponent } from '../desktop/app-download-menu.component';
import { formatScDate } from '../core/locale/date-format';
import { LocaleService } from '../core/locale/locale.service';
import { NeuroFieldDirective } from '../core/neuro-field.directive';

const SEARCH_DEBOUNCE_MS = 250;

/** Axis the IM-HANGAR fleet strip groups by. */
export type FleetSortAxis = 'manufacturer' | 'role' | 'recent';

/** Which half of the AN BORD ⇄ IM HANGAR switcher is expanded. */
export type SurfaceZone = 'board' | 'hangar';

/** One rendered fleet group: a heading (empty for the ungrouped axis) + its ships. */
export interface FleetGroup {
  label: string;
  rows: CodexListRow[];
}

/**
 * The Codex landing — "the scale ladder" (person → ship → verse).
 *
 * Three depth planes. The first two share ONE fixed-height surface and behave
 * as a single switcher (feedback e80cc831): exactly one of them is expanded,
 * the other collapses to a slim rail, and the box never changes height:
 *   AN BORD    — a schematic paperdoll of the six armour slots at their
 *                anatomical position, plus up to 7 honestly-derived on-foot
 *                KPIs and the other saved role-loadouts (native <details>).
 *   IM HANGAR  — Hersteller · Rolle · Name of the selected (flagship) ship,
 *                up to 7 mount-derived KPIs, the other saved ship configs,
 *                and the flagship-led fleet field (kept from the old page).
 *   IM VERSUM  — frameless domain entry points with real archive counts.
 *
 * Zero-to-one extra query per zone: ship KPIs need one getEntityPayloads
 * batch for the selected ship's fitted components; on-foot KPIs need one
 * resolveEntities batch for the equipped armour. Everything else (mount
 * structure, entity counts) is already loaded on the rows.
 */
@Component({
  selector: 'sc-codex-landing',
  standalone: true,
  imports: [NeuroFieldDirective, 
    FormsModule,
    RouterLink,
    TranslateModule,
    CodexCompareTrayComponent,
    CodexCategoryIconComponent,
    FallbackImageComponent,
    AppDownloadMenuComponent,
    CodexBoardPanelComponent,
    CodexZoneRailComponent,
    CodexPatchHeadlineComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="landing">
      <!-- ── TOP: Archive Terminal + patch headline + app menu ──────────────── -->
      <header class="terminal">
        <div class="terminal-bar">
          <svg class="icon terminal-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
          </svg>
          <input
            class="terminal-input"
            type="search"
            [ngModel]="searchInput()"
            (ngModelChange)="onSearchInput($event)"
            [attr.aria-label]="'codex.landing.terminal.label' | translate"
            [attr.placeholder]="'codex.landing.terminal.placeholder' | translate"
          />
          @if (searchInput()) {
            <button
              class="terminal-clear"
              type="button"
              (click)="clearSearch()"
              [attr.aria-label]="'codex.landing.terminal.clear' | translate"
            >
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                   stroke-linecap="round" aria-hidden="true">
                <line x1="5" y1="5" x2="19" y2="19" /><line x1="19" y1="5" x2="5" y2="19" />
              </svg>
            </button>
          }
        </div>

        <!-- ONE headline (admin feedback 463872dd): the patch that produced
             everything below it. Round two of that feedback dropped the
             playable state from this line — the header chip already reports
             "Spielbar" on every page, so saying it twice cost the headline its
             own subject. The patch doubles as the page's quiet time machine
             (last 5 patches, five more per page, data-less ones marked). -->
        <sc-codex-patch-headline (patchChange)="reload()" />

        <ng-template #codexProvenance>
          @if (svc.build(); as b) {
            @if (archiveRecordCount(); as count) {
              <span>{{ 'codex.landing.patch.archive' | translate: { count: formatNum(count) } }}</span>
            }
            @if (extractedAtLabel(); as date) {
              <span>{{ 'codex.landing.patch.extracted' | translate: { date } }}</span>
            }
            <span>{{ 'codex.landing.patch.build' | translate: { build: b.buildNumber } }}</span>
          }
        </ng-template>

        <!-- Keybindings — moved off the retired "Im Versum" band onto the
             terminal row (prio 2): the terminal is where a returning player
             already looks for a tool, and it survives the band's removal
             untouched. -->
        <a
          class="terminal-tool"
          routerLink="/codex/keybinds"
          [attr.aria-label]="'codex.landing.terminal.keybinds' | translate"
          [attr.title]="'codex.landing.terminal.keybinds' | translate"
        >
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M14 3a5 5 0 0 0-4.9 6.1L3 15.2V19h3.8l1-1h2v-2h2l1.1-1.1A5 5 0 1 0 14 3z" />
            <circle cx="16.6" cy="7.4" r="1.1" />
          </svg>
        </a>

        <!-- Far right of the terminal row: the Data-Uploader download control.
             Collaborator+ only, so a viewer sees nothing here and the
             Verse-online pill ends the row. Same component as the Starscape one
             in /starscape, on purpose — one control, two homes. -->
        <sc-app-download-menu
          class="terminal-menu"
          [product]="'uploader'"
          [extra]="codexProvenance" />
      </header>

      @if (error(); as err) {
        <div class="sc-card err">
          <p>{{ 'codex.error.title' | translate }}</p>
          <button type="button" (click)="reload()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      }

      <!-- ── SEARCH-ACTIVE: cross-entity results staged in the field ────────── -->
      @if (searchActive()) {
        <section class="results" aria-live="polite">
          <header class="results-head">
            <h2>{{ 'codex.landing.results.title' | translate }}</h2>
            <span class="results-term">"{{ searchTerm() }}"</span>
          </header>
          @if (searching()) {
            <p class="results-note">{{ 'codex.landing.results.searching' | translate }}</p>
          } @else if (searchResults().length === 0) {
            <p class="results-note">{{
              'codex.landing.results.empty' | translate: { term: searchTerm() }
            }}</p>
          } @else {
            <div class="hit-grid">
              @for (hit of searchResults(); track hit.kind + ':' + hit.classNameSlug) {
                <a
                  class="hit"
                  [class.meta]="hit.scope === 'meta'"
                  [class.upcoming]="hit.scope === 'upcoming'"
                  [routerLink]="hitLink(hit)"
                  [queryParams]="hitQueryParams(hit)"
                >
                  <span class="hit-icon" aria-hidden="true">
                    <sc-codex-icon [kind]="hitIcon(hit)" />
                  </span>
                  <span class="hit-body">
                    <span class="hit-name">{{ hitName(hit) }}</span>
                    <span class="hit-meta">
                      <span class="hit-kind">{{
                        'codex.kindSingular.' + hit.kind | translate
                      }}</span>
                      @if (hitMfr(hit); as mfr) {
                        <span class="hit-mfr" [attr.title]="mfr">{{ mfr }}</span>
                      }
                      @if (hit.size != null) {
                        <span class="hit-badge">{{
                          'codex.card.size' | translate: { size: hit.size }
                        }}</span>
                      }
                      <!-- Says in words what the amber tint says in colour: RSI
                           announced this hull, the live build has no data for it. -->
                      @if (isUpcoming(hit)) {
                        <span class="hit-badge soon">{{
                          'codex.landing.results.upcomingBadge' | translate
                        }}</span>
                      }
                    </span>
                  </span>
                  <!-- Nothing to compare on a ship with no datamined stats, so
                       announced hits carry no pin. -->
                  @if (hitCompareKind(hit); as pinKind) {
                    <button
                      type="button"
                      class="pin"
                      [class.pinned]="svc.isPinned(pinKind, hit.classNameSlug)"
                      (click)="togglePin($event, pinKind, hit.classNameSlug)"
                      [attr.aria-label]="
                        (svc.isPinned(pinKind, hit.classNameSlug)
                          ? 'codex.compare.pinned'
                          : 'codex.compare.pin'
                        ) | translate
                      "
                    >
                      <svg class="icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"
                           stroke-linejoin="round" aria-hidden="true"
                           [attr.fill]="svc.isPinned(pinKind, hit.classNameSlug) ? 'currentColor' : 'none'">
                        <path d="M12 3 L14.7 9.2 L21.5 9.9 L16.4 14.3 L17.9 21 L12 17.4 L6.1 21 L7.6 14.3 L2.5 9.9 L9.3 9.2 Z" />
                      </svg>
                    </button>
                  }
                </a>
              }
            </div>
          }
        </section>
      }

      <!-- ── SURFACE: AN BORD ⇄ IM HANGAR — ONE switcher, ONE fixed height ───
           Feedback e80cc831: the two zones used to grow and shrink vertically
           with whatever was selected, so the page jumped around. They are one
           toggle now — exactly one zone is expanded, the other collapses to a
           slim vertical rail — and the surface keeps the SAME height in every
           state (--surface-h), with the expanded zone scrolling internally.
           On a phone the rail turns horizontal (a bar) rather than squeezing
           a vertical strip into a 360px viewport.
           Feedback 77668f11: the collapsed half is no longer two words on a
           spine — it carries its zone's HERO (the figure / the flagship's
           art) and nothing else, and the strip widens to make it legible. See
           codex-zone-rail.component.ts for what does and does not come along. -->
      <div
        class="surface"
        [class.dimmed]="searchActive()"
        [class.hero-rail]="railHasHero()"
        [class.open-board]="openZone() === 'board'"
        [class.open-hangar]="openZone() === 'hangar'"
      >
        <!-- AN BORD — the on-foot plane. Rebuilt in the /tune-rethink round of
             2026-09-01 (concept: docs/concepts/2026-09-01-codex-an-bord-neu.html,
             6 iterations, chosen variant Ⓣ "Gewicht" on the Ⓜ light panel with
             the Ⓟ plinth).
             THE STRETCHED ZONE LINK IS GONE ON PURPOSE. It used to swallow the
             whole zone so "click anywhere" opened the on-foot subview — which is
             exactly what made this a display case: no individual position could
             ever be clicked. Now every anatomical position is its own real
             <a routerLink> carrying an EQUIP INTENT in the URL
             (?cat=armor&slot=Helmet&equipInto=<setId>), read by
             FpsListComponent.applyDeepLink(). The zone entrance survives as the
             set-name link in the header only.
             DESIGN SYSTEM (concept iteration 6 — the panel had four meanings on
             amber and two on cyan, which is what made it read as noise):
               · amber   = "equipped / yours", and nothing else
               · blue-grey = "open", and nothing else
               · armour class is encoded as BAR HEIGHT, never as hue
               · three type roles only: label / value / name
               · the role is named ONCE, on the plinth. -->
        @if (openZone() === 'board') {
          <article class="zone board" id="zone-board" aria-labelledby="board-title">
            <sc-codex-board-panel
              [loadouts]="personalLoadouts()"
              [resolved]="resolvedArmor()"
              [payloads]="armorPayloads()"
              [archiveDepth]="archiveDepth()" />

            <!-- Quick access into the full archive, pre-filtered per entry
                 (prio 3, replaces "Im Versum"). No count on Waffen/Baupläne —
                 a combined FPS+ship total would be misleading once the index
                 splits them; see codex-landing-kpi / briefing. -->
            <nav class="zone-archive" [attr.aria-label]="'codex.landing.archive.label' | translate">
              <span class="zone-archive__label">{{ 'codex.landing.archive.label' | translate }}</span>
              <a class="zone-archive__link" routerLink="/codex/fps" [queryParams]="{ cat: 'armor' }">
                {{ 'codex.landing.archive.armor' | translate }}
                <span class="zone-archive__chevron" aria-hidden="true">›</span>
              </a>
              <span class="zone-archive__sep" aria-hidden="true">·</span>
              <a class="zone-archive__link" routerLink="/codex/fps" [queryParams]="{ cat: 'weapon' }">
                {{ 'codex.landing.archive.weapons' | translate }}
                <span class="zone-archive__chevron" aria-hidden="true">›</span>
              </a>
              <span class="zone-archive__sep" aria-hidden="true">·</span>
              <a class="zone-archive__link" routerLink="/codex/index"
                 [queryParams]="{ kind: 'blueprint', group: 'fps' }">
                {{ 'codex.landing.archive.blueprints' | translate }}
                <span class="zone-archive__chevron" aria-hidden="true">›</span>
              </a>
            </nav>
          </article>
        } @else {
          <!-- Collapsed AN BORD: the figure and nothing else (feedback
               77668f11). The set's name, the six positions and their values
               all belong to the expanded panel. The figure is unconditional —
               round three: an unequipped suit is still the person, and it is
               what the expanded zone draws in that state too. -->
          <sc-codex-zone-rail
            kind="board"
            eyebrowKey="codex.landing.me.eyebrow"
            labelKey="codex.landing.surface.expandBoard"
            fallbackKey="codex.landing.me.uncommissioned"
            [summary]="activeLoadout()?.name ?? null"
            [heroSuit]="boardHero()"
            (expand)="openZone.set('board')" />
        }

        <!-- IM HANGAR — cyan, ship identity + KPI + fleet field. Same
             stretched-link entrance as AN BORD, this time into /hangar. -->
        @if (openZone() === 'hangar') {
        <article class="zone hangar" id="zone-hangar" aria-labelledby="hangar-title">
          <a class="zone-entry" routerLink="/hangar">
            <header class="zone-head">
              <span class="zone-eyebrow" id="hangar-title">{{ 'codex.landing.fleet.eyebrow' | translate }}</span>
              @if (emptyHangar()) {
                <h2>{{ 'codex.landing.fleet.title' | translate }}</h2>
              }
            </header>
          </a>

          @if (loading()) {
            <div class="identity skel sc-skel-field" scNeuroField></div>
          } @else if (emptyHangar()) {
            <!-- Empty bay, drawn not greyed out (feedback 2026-08-23: "muss
                 noch wesentlich attraktiver werden bildlich"). A generated
                 scene rather than a bitmap: floor grid in perspective, two
                 service light cones and an empty docking ring. Pure SVG, so
                 it costs no request, scales to any width and follows the
                 accent token. -->
            <div class="hangar-empty">
              <svg class="bay-scene" viewBox="0 0 420 210" role="img"
                   [attr.aria-label]="'codex.landing.fleet.emptyArt' | translate">
                <defs>
                  <linearGradient id="bay-floor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="currentColor" stop-opacity="0.02" />
                    <stop offset="100%" stop-color="currentColor" stop-opacity="0.16" />
                  </linearGradient>
                  <linearGradient id="bay-beam" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="currentColor" stop-opacity="0.22" />
                    <stop offset="100%" stop-color="currentColor" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path class="bay-fill" d="M120,96 H300 L400,196 H20 Z" fill="url(#bay-floor)" />
                <path class="bay-beam" d="M132,20 L160,20 L214,196 L96,196 Z" fill="url(#bay-beam)" />
                <path class="bay-beam" d="M260,20 L288,20 L324,196 L206,196 Z" fill="url(#bay-beam)" />
                <g class="bay-grid">
                  <path d="M120,96 L20,196 M156,96 L96,196 M192,96 L172,196 M228,96 L248,196 M264,96 L324,196 M300,96 L400,196" />
                  <path d="M120,96 H300 M110,106 H310 M96,120 H324 M76,140 H344 M48,168 H372 M20,196 H400" />
                </g>
                <ellipse class="bay-ring" cx="210" cy="150" rx="76" ry="26" />
                <ellipse class="bay-ring inner" cx="210" cy="150" rx="46" ry="15" />
                <path class="bay-rig" d="M134,150 H164 M256,150 H286 M210,124 V112 M210,176 V188" />
                <path class="bay-truss" d="M96,20 H324 M120,20 V44 M300,20 V44 M120,44 H300" />
              </svg>
              <span class="empty-chip">{{ 'codex.landing.fleet.empty' | translate }}</span>
              <p class="me-lead">{{ 'codex.landing.fleet.emptyLead' | translate }}</p>
              <a class="btn tint" routerLink="/codex/index" [queryParams]="{ kind: 'ship' }">
                {{ 'codex.landing.fleet.cta' | translate }}
                <span class="btn-goal">{{ 'codex.landing.fleet.ctaGoal' | translate }}</span>
              </a>
            </div>
          } @else if (flagshipRow(); as f) {
            <div class="identity">
              <!-- The flagship hero only rides along in the DEFAULT mode
                   ("Zuletzt bearbeitet"), where the lane under it is simply the
                   ships you touched last. Switching the lane to Einsatzzweck or
                   Hersteller turns the zone into a browser and drops the hero —
                   feedback e80cc831: "dann kann man aber auch irgendwie den
                   einsatzzweck umschalten, in dem fall brauche ich die schiffs
                   hero card nicht mehr sehen". The freed height goes to the
                   groups, which is the only thing that makes grouping useful. -->
              @if (heroVisible()) {
              <!-- Cinematic hero: the artwork IS the ship, and the numbers ride
                   a scrim INSIDE the frame rather than sitting in cards under
                   it (feedback 2026-08-23: "direkt dardran die wesentlichen
                   punkte und nicht darunter"). Same art-first treatment as the
                   concept-ship rail. The pin stays a real <button> outside the
                   anchor — nested interactive content is invalid HTML. -->
              <div class="ship-hero" [class.icon-only]="thumbs(f).length === 0">
                <sc-fallback-image [candidates]="thumbs(f)" [alt]="rowName(f)" [eager]="true">
                  <sc-codex-icon kind="ship" />
                </sc-fallback-image>
                <button
                  type="button"
                  class="pin hero-pin"
                  [class.pinned]="svc.isPinned('ship', f.classNameSlug)"
                  (click)="togglePin($event, 'ship', f.classNameSlug)"
                  [attr.aria-label]="
                    (svc.isPinned('ship', f.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin')
                      | translate
                  "
                >
                  <svg class="icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"
                       stroke-linejoin="round" aria-hidden="true"
                       [attr.fill]="svc.isPinned('ship', f.classNameSlug) ? 'currentColor' : 'none'">
                    <path d="M12 3 L14.7 9.2 L21.5 9.9 L16.4 14.3 L17.9 21 L12 17.4 L6.1 21 L7.6 14.3 L2.5 9.9 L9.3 9.2 Z" />
                  </svg>
                </button>
                <a class="hero-scrim identity-name" [routerLink]="['/codex', 'ship', f.classNameSlug]">
                  <span class="identity-mfr">
                    {{ rowMfr(f) }}
                    @if (shipRoleResolved(); as role) {
                      <span class="identity-role">· {{ role }}</span>
                    }
                  </span>
                  <span class="hero-name">{{ rowName(f) }}</span>
                  @if (heroKpis().length) {
                    <span class="hero-kpis">
                      @for (k of heroKpis(); track k.labelKey) {
                        <span class="hero-kpi" [class.warn]="k.warn"
                              [attr.title]="k.labelKey | translate">
                          <sc-codex-icon [kind]="kpiIcon(k.labelKey).kind" [sub]="kpiIcon(k.labelKey).sub" />
                          <span class="hero-kpi__text">
                            <span class="hero-kpi__label">{{ k.labelKey | translate }}</span>
                            <span class="hero-kpi__value mono">{{ k.value }}</span>
                          </span>
                        </span>
                      }
                    </span>
                  }
                </a>
              </div>

              @if (deltasFor(f.classNameSlug).length) {
                <span class="delta-row">
                  @for (d of deltasFor(f.classNameSlug); track d.labelKey) {
                    <span class="delta" [class]="'dir-' + d.direction">
                      <span class="delta-label">{{ d.labelKey | translate }}</span>
                      <span class="delta-val"
                        >{{ d.delta > 0 ? '+' : '' }}{{ d.delta
                        }}{{ d.unit ? ' ' + d.unit : '' }}</span
                      >
                    </span>
                  }
                </span>
              }
              } <!-- /@if (heroVisible()) — hero + its delta row -->

              <!-- The fleet in the same 16:9 art-tile format the concept-ship
                   rail uses, grouped by the chosen sort axis. The flagship is
                   part of it (starred) rather than excluded — the grouping only
                   reads right when every owned hull is in it. -->
              @if (fleetRows().length) {
                <div class="fleet-lane" [class.browse]="!heroVisible()">
                  <div class="fleet-lane__head">
                    <span class="fleet-lane__title">{{
                      'codex.landing.fleet.laneTitle' | translate: { count: fleetRows().length }
                    }}</span>
                    <div class="fleet-sort" role="group"
                         [attr.aria-label]="'codex.landing.fleet.sortLabel' | translate">
                      @for (axis of fleetSortAxes; track axis) {
                        <button
                          type="button"
                          class="fleet-sort__btn"
                          [class.on]="fleetSort() === axis"
                          [attr.aria-pressed]="fleetSort() === axis"
                          (click)="fleetSort.set(axis)"
                        >{{ 'codex.landing.fleet.sort.' + axis | translate }}</button>
                      }
                    </div>
                  </div>
                  @for (g of fleetGroups(); track g.label) {
                    @if (g.label) {
                      <span class="fleet-group">{{ g.label }}</span>
                    }
                    <div class="fleet-strip" role="list">
                      @for (r of g.rows; track r.classNameSlug) {
                        <a
                          class="fleet-tile"
                          role="listitem"
                          [class.icon-only]="thumbs(r).length === 0"
                          [class.flag]="r.classNameSlug === f.classNameSlug"
                          [routerLink]="['/codex', 'ship', r.classNameSlug]"
                          [attr.aria-label]="'codex.landing.fleet.open' | translate: { ship: rowName(r) }"
                        >
                          <sc-fallback-image [candidates]="thumbs(r)" [alt]="rowName(r)">
                            <sc-codex-icon kind="ship" />
                          </sc-fallback-image>
                          @if (r.classNameSlug === f.classNameSlug) {
                            <span class="fleet-tile__badge flag"
                                  [attr.title]="'codex.landing.fleet.flagship' | translate">★</span>
                          } @else if (deltasFor(r.classNameSlug).length) {
                            <span
                              class="fleet-tile__badge"
                              [class]="'fleet-tile__badge dir-' + deltasFor(r.classNameSlug)[0].direction"
                              aria-hidden="true"
                            >
                              <svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M12 4 L20.5 19 H3.5 Z" />
                              </svg>
                            </span>
                          }
                          <span class="fleet-tile__cap">
                            @if (rowMfr(r); as mfr) {
                              <span class="fleet-tile__mfr" [attr.title]="mfr">{{ mfr }}</span>
                            }
                            <span class="fleet-tile__name">{{ rowName(r) }}</span>
                          </span>
                        </a>
                      }
                    </div>
                  }
                </div>
              }

              @if (comparableFleet()) {
                <p class="compare-hint">{{ 'codex.landing.fleet.compareHint' | translate }}</p>
              }
            </div>
          }

          <!-- Quick access into the full archive, pre-filtered per entry
               (prio 3, replaces "Im Versum"). Ships/Komponenten carry the
               archive's real seeded count; Waffen/Baupläne don't — a
               ship+FPS-combined total would be misleading once the index
               splits them. Renders even with an empty hangar. -->
          <nav class="zone-archive" [attr.aria-label]="'codex.landing.archive.label' | translate">
            <span class="zone-archive__label">{{ 'codex.landing.archive.label' | translate }}</span>
            <a class="zone-archive__link" routerLink="/codex/index" [queryParams]="{ kind: 'ship' }">
              {{ 'codex.landing.archive.ships' | translate }}
              @if (archiveShipCount(); as ct) {
                <span class="zone-archive__count mono">{{ formatNum(ct) }}</span>
              }
              <span class="zone-archive__chevron" aria-hidden="true">›</span>
            </a>
            <span class="zone-archive__sep" aria-hidden="true">·</span>
            <a class="zone-archive__link" routerLink="/codex/index" [queryParams]="{ kind: 'component' }">
              {{ 'codex.landing.archive.components' | translate }}
              @if (archiveComponentCount(); as ct) {
                <span class="zone-archive__count mono">{{ formatNum(ct) }}</span>
              }
              <span class="zone-archive__chevron" aria-hidden="true">›</span>
            </a>
            <span class="zone-archive__sep" aria-hidden="true">·</span>
            <a class="zone-archive__link" routerLink="/codex/index"
               [queryParams]="{ kind: 'weapon', weaponClass: 'Ship' }">
              {{ 'codex.landing.archive.weapons' | translate }}
              <span class="zone-archive__chevron" aria-hidden="true">›</span>
            </a>
            <span class="zone-archive__sep" aria-hidden="true">·</span>
            <a class="zone-archive__link" routerLink="/codex/index"
               [queryParams]="{ kind: 'blueprint', group: 'vehicle' }">
              {{ 'codex.landing.archive.blueprints' | translate }}
              <span class="zone-archive__chevron" aria-hidden="true">›</span>
            </a>
          </nav>
        </article>
        } @else {
          <!-- Collapsed IM HANGAR: the FLAGSHIP's art and nothing else — not
               the fleet, not the name, not the KPI band (feedback 77668f11). -->
          <sc-codex-zone-rail
            kind="hangar"
            eyebrowKey="codex.landing.fleet.eyebrow"
            labelKey="codex.landing.surface.expandHangar"
            fallbackKey="codex.landing.fleet.empty"
            [summary]="flagshipName()"
            [heroArt]="flagshipArt()"
            (expand)="openZone.set('hangar')" />
        }
      </div>

      <sc-codex-compare-tray />
    </section>
  `,
  styles: [
    `
      .landing {
        display: flex;
        flex-direction: column;
        gap: 20px;
        max-width: 1180px;
        margin: 0 auto;
        padding: 16px 16px 96px;
      }
      .icon { width: 100%; height: 100%; display: block; }
      .mono { font-family: var(--font-monospace, 'Share Tech Mono', monospace); font-variant-numeric: tabular-nums; }

      /* ── Archive Terminal ─────────────────────────────────────────────── */
      .terminal {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }
      .terminal-bar {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1 1 340px;
        padding: 0 12px;
        min-height: var(--sc-tap-min, 44px);
        border-radius: 3px;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
        background:
          radial-gradient(140% 160% at 0% 0%, color-mix(in srgb, var(--sc-accent) 10%, transparent), transparent 60%),
          var(--sc-bg-1);
      }
      .terminal-icon { width: 18px; height: 18px; color: var(--sc-accent); }
      .terminal-input {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: none;
        outline: none;
        color: var(--sc-fg-0);
        font-size: max(0.95rem, var(--sc-fs-floor, 0.9rem));
        padding: 10px 0;
      }
      .terminal-bar:focus-within {
        border-color: var(--sc-accent);
        box-shadow: 0 0 0 2px rgba(0, 212, 255, 0.22);
      }
      .terminal-clear {
        width: 22px;
        height: 22px;
        background: none;
        border: none;
        color: var(--sc-fg-2);
        cursor: pointer;
        min-height: var(--sc-tap-min, 44px);
        min-width: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }

      /* The patch headline is its own component (sc-codex-patch-headline) — it
         owns the pill chrome and the patch-switch overlay. Only its slot in the
         row is ours. */
      sc-codex-patch-headline { flex: 0 0 auto; }

      /* Far-right slot: never stretch, never wrap mid-control. The menu owns
         its own overlay positioning (sc-app-download-menu). */
      .terminal-menu { flex: 0 0 auto; }

      /* Keybindings entry, formerly the "Im Versum" band's rail-icon — same
         glyph, same 44px target, now a row-mate of the download menu. */
      .terminal-tool {
        flex: 0 0 auto;
        width: 22px;
        height: 22px;
        min-height: var(--sc-tap-min, 44px);
        min-width: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--sc-fg-2);
      }
      .terminal-tool:hover { color: var(--sc-accent); }

      .sc-card.err {
        border: 1px solid var(--sc-danger);
        border-radius: 3px;
        padding: 14px;
        background: color-mix(in srgb, var(--sc-danger) 8%, var(--sc-bg-1));
      }
      .sc-card.err button { margin-top: 8px; }

      /* ── search results ───────────────────────────────────────────────── */
      .results-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
      .results-head h2 { margin: 0; font-size: 1.05rem; }
      .results-term { color: var(--sc-accent); font-family: var(--sc-font-display); }
      .results-note { color: var(--sc-fg-2); }
      .hit-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
      .hit {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 3px;
        text-decoration: none;
        color: inherit;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border));
        background:
          linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 10%, transparent), transparent 70%),
          var(--sc-bg-1);
        transition: border-color 0.16s, box-shadow 0.16s;
      }
      .hit.meta {
        --meta: #b98bff;
        border-color: color-mix(in srgb, var(--meta) 32%, var(--sc-border));
        background: linear-gradient(90deg, color-mix(in srgb, var(--meta) 12%, transparent), transparent 70%),
          var(--sc-bg-1);
      }
      /* Announced-but-not-in-the-build ships: amber, the app's "not yet" colour.
         Distinct from cyan (flyable today) and violet (meta), and never the hot
         red, which is reserved for elevated access. */
      .hit.upcoming {
        --soon: #f0b44a;
        border-color: color-mix(in srgb, var(--soon) 32%, var(--sc-border));
        background: linear-gradient(90deg, color-mix(in srgb, var(--soon) 12%, transparent), transparent 70%),
          var(--sc-bg-1);
      }
      .hit:hover { border-color: var(--sc-accent); box-shadow: 0 0 16px color-mix(in srgb, var(--sc-accent) 22%, transparent); }
      .hit.meta:hover { border-color: var(--meta); }
      .hit.upcoming:hover { border-color: var(--soon); box-shadow: 0 0 16px color-mix(in srgb, var(--soon) 22%, transparent); }
      .hit.upcoming .hit-icon, .hit.upcoming .hit-kind { color: var(--soon); }
      .hit-badge.soon {
        padding: 1px 6px; border-radius: 999px; letter-spacing: 0.04em; text-transform: uppercase;
        font-size: max(0.62rem, var(--sc-fs-floor));
        color: var(--soon); border: 1px solid color-mix(in srgb, var(--soon) 40%, transparent);
        background: color-mix(in srgb, var(--soon) 14%, transparent);
      }
      .hit-icon { display: inline-flex; width: 34px; height: 34px; align-items: center; justify-content: center; color: var(--sc-accent); }
      .hit.meta .hit-icon { color: var(--meta); }
      .hit-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
      .hit-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      /* Wraps since the manufacturer is spelled out now — "Consolidated Outland"
         next to the kind and size chips overruns a single line on a narrow card. */
      .hit-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 0.72rem; color: var(--sc-fg-2); }
      .hit-mfr { overflow: hidden; text-overflow: ellipsis; }
      .hit-kind { font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.04em; color: var(--sc-accent); }
      .hit.meta .hit-kind { color: var(--meta); }

      /* ── ONE SURFACE: AN BORD ⇄ IM HANGAR ─────────────────────────────── */
      /* Correction (2026-08-16): ONE floating box for both scales — a real 1px
         border plus --shadow-elevated (StarUI: border glows only, no
         positive-Y drop shadow).
         Correction (2026-09-03, feedback e80cc831): the two zones are a SWITCH,
         not a pair of columns that each grow with their content. Exactly one is
         expanded; the other is a --rail-w strip. The box keeps --surface-h in
         EVERY state, so nothing below it ever moves — the expanded zone
         scrolls internally instead of stretching the page. */
      .surface {
        --rail-w: 52px;
        --surface-h: 520px;
        display: grid;
        gap: 0;
        height: var(--surface-h);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 18%, var(--sc-border));
        border-radius: 4px;
        background: var(--sc-bg-1);
        box-shadow: var(--shadow-elevated);
        transition: opacity 0.2s;
        overflow: hidden;
      }
      /* Round two (feedback 77668f11): a collapsed zone now shows its hero,
         so the strip has to be wide enough for the figure / the flagship art
         to be recognisable — "gern horizontal breiter zugeklappt". Fluid
         rather than three breakpoints: 13vw lands between 104 and 168px across
         every tablet and desktop width, and the expanded half keeps the rest.
         The plain rail (nothing equipped, empty hangar) stays 52px. */
      .surface.hero-rail { --rail-w: clamp(104px, 13vw, 168px); }
      /* DOM order is always board → hangar; only the track sizes swap. */
      .surface.open-board { grid-template-columns: minmax(0, 1fr) var(--rail-w); }
      .surface.open-hangar { grid-template-columns: var(--rail-w) minmax(0, 1fr); }
      .dimmed { opacity: 0.55; }
      .zone {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border-left: 2px solid var(--tint);
        min-height: 0;
        min-width: 0;
        overflow-y: auto;
        overflow-x: hidden;
      }
      .zone.board { --tint: var(--sc-warning, #ffc14d); }
      .zone.hangar { --tint: var(--sc-accent); }
      /* The collapsed half is sc-codex-zone-rail — it owns its own chrome
         (styles are encapsulated, and these rules would push this file's
         inline stylesheet over the 18 kB component budget). */
      /* Zone entrance: the whole zone is a click target into its subview
         (Hangar / on-foot). This <a> itself carries only the heading, but its
         ::after is absolutely positioned against .zone (the nearest
         positioned ancestor, since .zone-entry stays position:static) and
         stretched to the zone's full bounds via inset:0 — the "click
         anywhere in the empty area" trick without nesting an <a> around the
         zone's own interactive children. Those children (board-empty,
         hangar-empty, identity) get position:relative + z-index:1 below to stay above the
         overlay and keep working (pin button, per-item deep links, the
         config <details> lists). */
      .zone-entry {
        display: block;
        text-decoration: none;
        color: inherit;
        border-radius: inherit;
      }
      .zone-entry::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 0;
        border: 1px solid transparent;
        border-radius: inherit;
        transition: border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
      }
      .zone-entry:hover::after {
        border-color: color-mix(in srgb, var(--tint) 40%, transparent);
        background: color-mix(in srgb, var(--tint) 4%, transparent);
        box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tint) 18%, transparent);
      }
      .zone-entry:focus-visible {
        outline: none;
      }
      .zone-entry:focus-visible::after {
        border-color: var(--tint);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--tint) 55%, transparent), 0 0 18px color-mix(in srgb, var(--tint) 22%, transparent);
      }
      .zone-head { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 2px; }
      /* Everything past the entrance header that carries real controls
         (buttons, nested <a>, <details>) must outrank the ::after overlay. */
      .hangar-empty, .identity {
        position: relative;
        z-index: 1;
      }
      .zone-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--tint);
      }
      .zone-head h2 { margin: 0; font-size: 1.15rem; }

      .hangar-empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .empty-chip {
        font-family: var(--sc-font-display);
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 3px 9px;
        border-radius: 3px;
        color: var(--sc-fg-2);
        border: 1px dashed color-mix(in srgb, var(--tint) 45%, var(--sc-border));
      }
      .me-lead { margin: 0; color: var(--sc-fg-1); font-size: 0.9rem; }
      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 14px;
        border-radius: 3px;
        text-decoration: none;
        font-weight: 600;
        font-size: 0.88rem;
        min-height: var(--sc-tap-min, 44px);
        box-sizing: border-box;
      }
      .btn.tint { color: var(--sc-bg-0); background: var(--tint); border: 1px solid var(--tint); }
      .btn.tint:hover { box-shadow: 0 0 18px color-mix(in srgb, var(--tint) 40%, transparent); }
      .btn-goal { font-weight: 400; opacity: 0.8; }

      /* ── identity (IM HANGAR) ─────────────────────────────────────────── */
      .identity { display: flex; flex-direction: column; gap: 10px; }
      .identity.skel { min-height: 140px; border-radius: 3px; }
      /* ── ship hero — the artwork IS the ship ──────────────────────────
         A 16:9 bleed crop with the identity and the KPI chips on a bottom
         scrim, the same art-first treatment the concept-ship rail uses.
         The custom properties cross into sc-fallback-image (a plain
         .ship-hero img rule cannot reach the projected <img>). */
      /* The zone is nearly full-width now that only one is expanded, so a bare
         16:9 would render a 600px-tall hero and blow the fixed surface height.
         Capped: the frame becomes a cinematic banner, the art still fills it
         (--sc-img-fit: cover). */
      .ship-hero {
        position: relative;
        aspect-ratio: 16 / 9;
        max-height: 300px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 4px;
        border: 1px solid var(--sc-border);
        background: radial-gradient(circle at 52% 42%, var(--sc-bg-2), var(--sc-bg-0));
        --sc-img-w: 100%;
        --sc-img-h: 100%;
        --sc-img-max-h: 100%;
        --sc-img-fit: cover;
        --sc-img-shadow: none;
      }
      .ship-hero.icon-only sc-codex-icon {
        width: 26%;
        height: 26%;
        opacity: 0.55;
        color: var(--sc-accent);
        transform: translateY(-16%);
      }
      .hero-pin {
        position: absolute;
        top: 2px;
        right: 2px;
        z-index: 2;
        color: color-mix(in srgb, #f2f7fb 72%, transparent);
      }
      .hero-pin.pinned { color: var(--sc-accent); }
      .hero-scrim {
        position: absolute;
        inset: auto 0 0 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 26px 12px 10px;
        text-decoration: none;
        color: inherit;
        background: linear-gradient(to top, rgba(2, 8, 14, 0.94) 0%, rgba(2, 8, 14, 0.74) 52%, transparent 100%);
      }
      /* Holds a spelled-out manufacturer ("Roberts Space Industries") plus the
         role, so it needs the clamp the 3-letter code never did. */
      .identity-mfr {
        font-family: var(--sc-font-display);
        font-size: max(0.66rem, var(--sc-fs-floor));
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--sc-accent) 78%, #f2f7fb);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .identity-role { color: color-mix(in srgb, #f2f7fb 72%, transparent); }
      .hero-name {
        font-size: 1.15rem;
        font-weight: 700;
        line-height: 1.15;
        color: #f2f7fb;
      }
      .hero-scrim:hover .hero-name,
      .hero-scrim:focus-visible .hero-name { color: var(--sc-accent); }
      .hero-kpis { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
      .hero-kpi {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 8px 3px 6px;
        border-radius: 3px;
        border: 1px solid rgba(242, 247, 251, 0.22);
        background: rgba(2, 8, 14, 0.55);
      }
      .hero-kpi sc-codex-icon { width: 14px; height: 14px; flex: 0 0 14px; }
      .hero-kpi__text { display: flex; flex-direction: column; line-height: 1.05; min-width: 0; }
      .hero-kpi__label {
        font-size: max(0.56rem, var(--sc-fs-floor));
        letter-spacing: 0.03em;
        color: color-mix(in srgb, #f2f7fb 62%, transparent);
      }
      .hero-kpi__value { font-size: max(0.74rem, var(--sc-fs-floor)); color: #f2f7fb; }
      .hero-kpi.warn { border-color: color-mix(in srgb, var(--sc-warn, #e8a33d) 62%, transparent); }
      .hero-kpi.warn .hero-kpi__value { color: var(--sc-warn, #e8a33d); }
      .delta-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .delta { display: inline-flex; gap: 5px; align-items: baseline; padding: 2px 7px; border-radius: 3px; font-size: 0.72rem; background: var(--sc-bg-2); }
      .delta-label { color: var(--sc-fg-2); }
      .delta-val { font-variant-numeric: tabular-nums; font-weight: 600; }
      .dir-up .delta-val { color: var(--sc-success, #5fd698); }
      .dir-down .delta-val { color: var(--sc-danger, #ff6b6b); }
      .dir-neutral .delta-val { color: var(--sc-fg-1); }

      /* ── fleet strip — the same art tile as the concept-ship rail ────── */
      .fleet-lane { display: flex; flex-direction: column; gap: 6px; }
      .fleet-lane__head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .fleet-lane__title {
        font-family: var(--sc-font-display);
        font-size: max(0.62rem, var(--sc-fs-floor));
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      .fleet-sort { display: flex; gap: 3px; margin-left: auto; flex-wrap: wrap; }
      .fleet-sort__btn {
        padding: 3px 9px;
        border-radius: 999px;
        border: 1px solid var(--sc-border);
        background: none;
        cursor: pointer;
        font: inherit;
        font-size: max(0.64rem, var(--sc-fs-floor));
        color: var(--sc-fg-2);
        min-height: var(--sc-tap-min, 26px);
        transition: border-color 0.16s, color 0.16s;
      }
      .fleet-sort__btn:hover { color: var(--sc-fg-1); }
      .fleet-sort__btn.on {
        border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border));
        color: var(--sc-accent);
      }
      .fleet-group {
        font-family: var(--sc-font-display);
        font-size: max(0.58rem, var(--sc-fs-floor));
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
        margin-top: 2px;
      }
      /* Own overflow-x container — the PAGE must never scroll sideways. */
      .fleet-strip {
        display: flex;
        gap: 7px;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x proximity;
        padding: 2px 2px 4px;
        margin: 0 -2px;
      }
      /* Browse mode (grouped by Einsatzzweck/Hersteller, hero hidden): the
         height the hero gave up goes to the groups, so the tiles WRAP into a
         field instead of hiding the rest of each group behind a sideways
         scroll — and a horizontal scroller nested in a vertical one is a trap
         on touch anyway. */
      .fleet-lane.browse .fleet-strip { flex-wrap: wrap; overflow-x: visible; }
      .fleet-tile {
        position: relative;
        flex: 0 0 150px;
        aspect-ratio: 16 / 9;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 3px;
        border: 1px solid var(--sc-border);
        background: radial-gradient(circle at 52% 44%, var(--sc-bg-2), var(--sc-bg-0));
        text-decoration: none;
        color: inherit;
        scroll-snap-align: start;
        min-height: var(--sc-tap-min, 44px);
        transition: border-color 0.16s ease, box-shadow 0.16s ease;
        --sc-img-w: 100%;
        --sc-img-h: 100%;
        --sc-img-max-h: 100%;
        --sc-img-fit: cover;
        --sc-img-shadow: none;
      }
      .fleet-tile:hover, .fleet-tile:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border));
        box-shadow: var(--shadow-glow);
      }
      .fleet-tile.flag { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); }
      .fleet-tile.icon-only sc-codex-icon {
        width: 30%; height: 30%; opacity: 0.55; color: var(--sc-accent); transform: translateY(-14%);
      }
      .fleet-tile__cap {
        position: absolute;
        inset: auto 0 0 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 14px 8px 6px;
        background: linear-gradient(to top, rgba(2, 8, 14, 0.93) 0%, rgba(2, 8, 14, 0.72) 48%, transparent 100%);
      }
      /* Spelled-out maker ("Drake Interplanetary") on a 150px tile: wrap to a
         second line like the name does rather than cutting the word off, and
         only ellipsize past that. */
      .fleet-tile__mfr {
        font-family: var(--sc-font-display);
        font-size: max(0.56rem, var(--sc-fs-floor));
        letter-spacing: 0.06em;
        line-height: 1.2;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--sc-accent) 78%, #f2f7fb);
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .fleet-tile__name {
        font-size: max(0.7rem, var(--sc-fs-floor));
        font-weight: 600;
        line-height: 1.15;
        color: #f2f7fb;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .fleet-tile__badge {
        position: absolute;
        top: 5px;
        right: 6px;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.66rem;
        line-height: 1;
        color: var(--sc-fg-2);
      }
      .fleet-tile__badge.flag { color: var(--sc-accent); width: auto; }
      .fleet-tile__badge.dir-up { color: var(--sc-success, #5fd698); }
      .fleet-tile__badge.dir-down { color: var(--sc-danger, #ff6b6b); }
      .fleet-tile__badge.dir-neutral { color: var(--sc-fg-2); }
      .compare-hint { margin: 0; font-size: 0.74rem; color: var(--sc-fg-2); }

      /* ── empty bay — drawn, not greyed out ───────────────────────────── */
      .bay-scene {
        width: 100%;
        max-width: 380px;
        height: auto;
        align-self: center;
        color: var(--sc-accent);
        margin-bottom: 2px;
      }
      .bay-grid path { fill: none; stroke: currentColor; stroke-width: 0.6; opacity: 0.28; }
      .bay-ring {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.1;
        opacity: 0.5;
        stroke-dasharray: 5 6;
      }
      .bay-ring.inner { opacity: 0.3; stroke-dasharray: 3 5; }
      .bay-rig, .bay-truss { fill: none; stroke: currentColor; stroke-width: 1.2; opacity: 0.42; }
      .bay-truss { opacity: 0.26; }
      @media (prefers-reduced-motion: no-preference) {
        .bay-ring { animation: bay-pulse 5s ease-in-out infinite; }
      }
      @keyframes bay-pulse {
        0%, 100% { opacity: 0.34; }
        50% { opacity: 0.62; }
      }

      /* shared pin button */
      .pin {
        width: 22px;
        height: 22px;
        align-self: flex-start;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--sc-fg-2);
        padding: 4px;
        min-height: var(--sc-tap-min, 44px);
        min-width: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .pin.pinned { color: var(--sc-accent); }

      /* ── Zone archive quick access (prio 3, replaces "Im Versum") ────────
         One quiet line at the bottom of EACH zone — same treatment, only the
         zone's own --tint differs. Pinned to the bottom via margin-top: auto
         (the zone is display:flex; flex-direction:column already). */
      .zone-archive {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px solid color-mix(in srgb, var(--sc-fg-2) 12%, transparent);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        row-gap: 4px;
        column-gap: 10px;
        min-height: 48px;
      }
      .zone-archive__label {
        font-family: var(--sc-font-display);
        font-size: 0.6rem;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      .zone-archive__sep { color: var(--sc-fg-2); opacity: 0.5; }
      .zone-archive__link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 0;
        color: var(--sc-fg-1);
        text-decoration: none;
        font-size: max(0.78rem, var(--sc-fs-floor));
      }
      .zone-archive__link:hover, .zone-archive__link:focus-visible { color: var(--tint); outline: none; }
      .zone-archive__chevron { color: var(--tint); opacity: 0.7; }
      .zone-archive__count {
        color: var(--sc-fg-2);
        font-size: max(0.68rem, var(--sc-fs-floor));
        font-variant-numeric: tabular-nums;
      }

      /* ── responsive ───────────────────────────────────────────────────── */
      /* Phone/small tablet: the switcher stacks, so the collapsed zone becomes
         a horizontal bar. Same toggle, same fixed total height. */
      @media (max-width: 760px) {
        .surface { --surface-h: 500px; --rail-h: 52px; }
        .surface.open-board { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) var(--rail-h); }
        .surface.open-hangar { grid-template-columns: minmax(0, 1fr); grid-template-rows: var(--rail-h) minmax(0, 1fr); }
        /* Here the rail is a horizontal bar, so "wider" is taller. The surface
           grows by exactly the same 40px, which leaves the EXPANDED half at
           the height it has always had — the fixed-height promise of
           e80cc831 is about the zone, not about the page. */
        .surface.hero-rail { --surface-h: 540px; --rail-h: 92px; }
      }
      @media (max-width: 480px) {
        .surface { --surface-h: 460px; }
        .surface.hero-rail { --surface-h: 500px; }
        .ship-hero { max-height: 210px; }
      }
      /* On a phone the zone is ~360px wide, where four labelled KPI chips
         stack three rows deep and the scrim grows TALLER than the 16:9 hero
         frame — the manufacturer line then gets clipped out of the top of it.
         Drop to glyph + value there; the full label stays on the chip's
         title, so nothing is lost. */
      @media (max-width: 560px) {
        .hero-kpi__label { display: none; }
        .hero-kpi { padding: 4px 8px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .hit, .surface, .fleet-tile, .fleet-sort__btn, .zone-entry::after { transition: none; }
        .bay-ring { animation: none; }
      }
    `,
  ],
})
export class CodexLandingComponent implements OnInit {
  readonly svc = inject(CodexService);
  readonly hangar = inject(HangarService);
  readonly auth = inject(AuthService);
  private readonly t = inject(TranslateService);
  readonly rsi = inject(UpcomingShipsService);
  private readonly locale = inject(LocaleService);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  // Archive Terminal (poly-search)
  readonly searchInput = signal('');
  readonly searchTerm = signal('');
  readonly searching = signal(false);
  readonly searchResults = signal<PolySearchHit[]>([]);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private searchSeq = 0;

  // Fleet — public: the template's fleet lane reads the raw row list for its
  // count and its "is the fleet empty" guard.
  readonly fleetRows = signal<CodexListRow[]>([]);
  private readonly fleetDeltas = signal<Map<string, ShipStatDelta[]>>(new Map());

  // IM HANGAR extras (flagship-scoped, best-effort)
  readonly shipComponentPayloads = signal<Map<string, EntityPayloadEntry>>(new Map());
  readonly shipRoleResolved = signal<string | null>(null);
  readonly selectedHangarShipId = signal<string | null>(null);

  /**
   * classNameSlug → resolved role label for EVERY owned hull, not just the
   * flagship: the fleet strip groups by role, so a `@`-locale key that was
   * never resolved would render as its raw token in a group heading.
   */
  readonly fleetRoleLabels = signal<Map<string, string>>(new Map());

  /**
   * Grouping axis of the fleet strip. Session-local — deliberately not
   * persisted. `recent` leads and is the default (feedback e80cc831: "vllt.
   * sieht man die zuletzt bearbeiteten schiffe normalerweise unter der hero
   * card") — the other two are browse modes that trade the hero for height.
   */
  readonly fleetSortAxes: readonly FleetSortAxis[] = ['recent', 'role', 'manufacturer'];
  readonly fleetSort = signal<FleetSortAxis>('recent');

  /**
   * The expanded half of the surface. A single signal IS the mutual exclusion
   * the feedback asked for — there is no state in which both are open, and
   * none in which both are collapsed. IM HANGAR leads: this is the fleet page.
   */
  readonly openZone = signal<SurfaceZone>('hangar');

  /**
   * `?set=<hangar_role_loadouts.id>` — which personal set AN BORD shows.
   * Null means "the most recently touched one", which is the ordinary visit.
   *
   * This is what makes the zone addressable: the retired `/hangar/loadout/:id`
   * editor route (admin feedback 34505d70, decision 2A) redirects here with the
   * id it was given, and the set switcher inside the zone navigates with it, so
   * "which set am I looking at" lives in the URL and survives a reload, a
   * bookmark and a middle click.
   */
  readonly selectedSetId = signal<string | null>(null);

  /**
   * The flagship hero shows only in the default `recent` mode. Grouping by
   * Einsatzzweck (or Hersteller) needs the vertical space more than it needs
   * the hero — the admin said so himself.
   */
  readonly heroVisible = computed(() => this.fleetSort() === 'recent');

  // AN BORD extras
  readonly personalLoadouts = signal<HangarRoleLoadout[]>([]);
  readonly resolvedArmor = signal<Map<string, ResolvedEntity>>(new Map());
  readonly archiveDepth = signal<Map<string, number>>(new Map());
  /**
   * Payloads of everything the active set carries — the armour class lives in
   * `stats.SCItemSuitArmorParams`, the readiness classes in `subType`, so ONE
   * batch covers both. Same zero-to-one-extra-query budget as the ship zone.
   */
  readonly armorPayloads = signal<Map<string, EntityPayloadEntry>>(new Map());

  readonly searchActive = computed(() => this.searchTerm().trim().length > 0);

  private readonly ownedClassNames = computed(() =>
    this.hangar
      .ships()
      .filter((s) => s.status === 'owned')
      .map((s) => s.shipClassName),
  );

  readonly emptyHangar = computed(() => !this.loading() && this.fleetRows().length === 0);

  readonly flagshipRow = computed<CodexListRow | null>(() => {
    const rows = this.fleetRows();
    const flagship = this.hangar.flagshipClassName();
    if (flagship) {
      const match = rows.find((r) => r.classNameSlug === flagship);
      if (match) return match;
    }
    return rows[0] ?? null;
  });

  readonly fleetOthers = computed(() => {
    const flag = this.flagshipRow();
    return this.fleetRows().filter((r) => r.classNameSlug !== flag?.classNameSlug);
  });

  readonly comparableFleet = computed(() => this.fleetRows().length >= 2);

  /** What the collapsed IM HANGAR rail names — the flagship, or nothing yet. */
  readonly flagshipName = computed<string | null>(() => {
    const f = this.flagshipRow();
    return f ? this.rowName(f) : null;
  });

  /**
   * The collapsed IM HANGAR hero: the flagship's art candidates, flagship only.
   * Null with an empty hangar — the rail then falls back to the plain strip
   * with its "Kein Schiff" line rather than showing a picture of nothing.
   * A computed, not `thumbs(flagshipRow())` in the template: the candidate list
   * has to stay referentially stable or the image walks its fallbacks again on
   * every change-detection pass.
   */
  readonly flagshipArt = computed<readonly string[] | null>(() => {
    const f = this.flagshipRow();
    return f ? this.thumbs(f) : null;
  });

  /** classNameSlug → when the owning hangar row was last edited (ISO, sortable). */
  private readonly fleetTouchedAt = computed(() => {
    const m = new Map<string, string>();
    for (const s of this.hangar.ships()) m.set(s.shipClassName, s.updatedAt || s.createdAt || '');
    return m;
  });

  // AN BORD: the "active" personal loadout is the most recently touched one
  // (see sortByRecency — no last_opened_at yet, sorts by updatedAt).
  readonly activeLoadout = computed<HangarRoleLoadout | null>(() => this.personalLoadouts()[0] ?? null);
  readonly otherLoadouts = computed(() => this.personalLoadouts().slice(1, 4));
  readonly hasPersonalSet = computed(() => this.activeLoadout() !== null);

  readonly paperdollSlots = computed<ArmorSlotState[]>(() =>
    armorSlotsFromLoadout(this.activeLoadout()?.items ?? []),
  );

  /**
   * The collapsed AN BORD hero: which positions the active set has equipped —
   * the only state the figure carries. ALWAYS a set, never null.
   *
   * Round two withheld the figure while nothing was equipped, on the theory
   * that a fully open suit is "a picture of an empty set". Round three of the
   * same feedback threw that out: "wenn ich ship im hangar aufrufe, dann sehe
   * ich für zu fuß an board immer noch nicht die person als spalte sondern nur
   * die textleiste" — and it is right, because the figure is the CHARACTER, not
   * the set. An unequipped suit is an honest empty one, it is exactly what the
   * EXPANDED zone draws in that same state, and the whole ask was to see "das
   * männchen" instead of a text strip.
   *
   * IM HANGAR keeps its null (`flagshipArt`): an empty hangar has no ship, and
   * a hull the user does not own would be a lie rather than a hero.
   */
  readonly boardHero = computed<ReadonlySet<string>>(
    () => new Set(this.paperdollSlots().filter((s) => s.className).map((s) => s.roleSlot)),
  );

  /**
   * Does the currently COLLAPSED half have a hero? Only then does the rail earn
   * its extra width. AN BORD always does — the figure is the character and it
   * is there whether or not anything is equipped; only an empty HANGAR keeps
   * the 52px strip and gives the whole surface back to the expanded zone.
   */
  readonly railHasHero = computed(() =>
    this.openZone() === 'board' ? this.flagshipArt() !== null : true,
  );

  private readonly paperdollBySlot = computed(() => {
    const bySlot = new Map<string, ArmorSlotState>();
    for (const s of this.paperdollSlots()) bySlot.set(s.roleSlot, s);
    return bySlot;
  });
  readonly shipKpis = computed<KpiRow[]>(() =>
    computeShipKpis(this.flagshipRow()?.payload ?? null, this.shipComponentPayloads()),
  );

  /**
   * The KPIs that fit ON the hero scrim. Four is the ceiling: a fifth chip
   * wraps onto its own row and starts eating the ship name underneath it.
   * `computeShipKpis` already returns them in priority order (shield sum,
   * then the actionable empty-mount count, then the rest).
   */
  readonly heroKpis = computed<KpiRow[]>(() => this.shipKpis().slice(0, 4));

  /**
   * The fleet strip's rows, grouped by the active axis. `manufacturer` and
   * `role` emit real headings; `recent` keeps hangar order in one unlabelled
   * group (the rows already arrive in that order, see resolveFleet).
   */
  readonly fleetGroups = computed<FleetGroup[]>(() => {
    const rows = this.fleetRows();
    if (rows.length === 0) return [];
    const axis = this.fleetSort();
    // "Zuletzt bearbeitet" means exactly that: the hangar row's updated_at,
    // newest first — not the pinned-then-created order the rows arrive in.
    if (axis === 'recent') {
      const touched = this.fleetTouchedAt();
      const sorted = [...rows].sort((a, b) =>
        (touched.get(b.classNameSlug) ?? '').localeCompare(touched.get(a.classNameSlug) ?? ''),
      );
      return [{ label: '', rows: sorted }];
    }

    const roles = this.fleetRoleLabels();
    const unknown = this.t.instant('codex.landing.fleet.sortUnknown');
    // Group headings spell the manufacturer out ("Aegis Dynamics"), same as the
    // tiles under them — grouping still collapses per manufacturer because the
    // name is resolved from the same record for every hull of that make.
    const keyOf = (r: CodexListRow) =>
      axis === 'manufacturer'
        ? manufacturerLabel(r, this.lang()) || unknown
        : roles.get(r.classNameSlug) || unknown;

    const groups = new Map<string, CodexListRow[]>();
    for (const r of rows) {
      const key = keyOf(r);
      const bucket = groups.get(key);
      if (bucket) bucket.push(r);
      else groups.set(key, [r]);
    }
    // Named groups alphabetically, the catch-all last — a group whose heading
    // is "unbekannt" sorting into the middle of the alphabet reads like a
    // manufacturer nobody has heard of.
    return [...groups.entries()]
      .sort((a, b) => {
        if (a[0] === unknown) return 1;
        if (b[0] === unknown) return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, groupRows]) => ({ label, rows: groupRows }));
  });

  readonly archiveRecordCount = computed<number | null>(() =>
    totalRecordCount(this.svc.build()?.entityCounts as Record<string, unknown> | undefined),
  );

  readonly extractedAtLabel = computed<string | null>(() => {
    const at = this.svc.build()?.extractedAt;
    if (!at) return null;
    return formatScDate(at, { language: this.locale.language(), region: this.locale.region() }) || at;
  });

  /**
   * Honest counts for the IM HANGAR archive quick-access line (prio 3) —
   * `seeded` preferred over the full extractor total, the same rule the old
   * "Im Versum" domain chips used. `null` while the build hasn't loaded (or
   * the build carries no count for the kind), which the template reads as
   * "show no count" rather than a placeholder.
   */
  private archiveCount(plural: 'ships' | 'components'): number | null {
    const counts = this.svc.build()?.entityCounts as
      | (Record<string, number> & { seeded?: Record<string, number> })
      | undefined;
    if (!counts) return null;
    const total = counts[plural];
    const seeded = counts.seeded?.[plural];
    const v = seeded ?? total;
    return typeof v === 'number' ? v : null;
  }

  readonly archiveShipCount = computed(() => this.archiveCount('ships'));
  readonly archiveComponentCount = computed(() => this.archiveCount('components'));

  constructor() {
    // Zone + set come from the URL, and they keep coming: the set switcher
    // navigates to this same route, so a snapshot read would only ever apply
    // the first one.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      const zone = q.get('zone');
      if (zone === 'board' || zone === 'hangar') this.openZone.set(zone);
      const set = q.get('set');
      if (set) this.openZone.set('board');
      if (set !== this.selectedSetId()) {
        this.selectedSetId.set(set);
        // Only re-resolve once the first load has populated the service; the
        // initial pass is driven by ngOnInit.
        if (this.hangar.roleLoadouts().length > 0) void this.resolvePersonal();
      }
    });

    effect(() => {
      const term = this.searchTerm().trim();
      if (!term) {
        this.searchResults.set([]);
        this.searching.set(false);
        return;
      }
      void this.runSearch(term);
    });
  }

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.svc.loadCurrentBuild();
      void this.rsi.ensureLoaded();
      if (this.auth.user() && this.hangar.ships().length === 0) {
        await this.hangar.loadAll();
      }
      await Promise.all([this.resolveFleet(), this.resolvePersonal()]);
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  reload(): void {
    void this.ngOnInit();
  }

  private async resolveFleet(): Promise<void> {
    const names = this.ownedClassNames();
    if (names.length === 0) {
      this.fleetRows.set([]);
      this.fleetDeltas.set(new Map());
      this.shipComponentPayloads.set(new Map());
      this.shipRoleResolved.set(null);
      this.fleetRoleLabels.set(new Map());
      return;
    }
    const byName = await this.svc.getShipsByClassNames(names);
    // Preserve hangar order, drop names absent from the current build.
    const rows = names.map((n) => byName.get(n)).filter((r): r is CodexListRow => !!r);
    this.fleetRows.set(rows);
    void this.resolveFleetRoles(rows);
    // Best-effort inline patch-diff — degrades to an empty map (no error).
    this.fleetDeltas.set(await this.svc.ownedFleetDeltas(rows.map((r) => r.classNameSlug)));
    await this.resolveShipExtras();
  }

  /**
   * Resolve the role label of every owned hull in ONE batch so the fleet strip
   * can group by it. Best-effort: a failure leaves the map as-is and the
   * grouping falls back to the "unknown" bucket rather than showing raw
   * `@`-locale tokens as headings.
   */
  private async resolveFleetRoles(rows: readonly CodexListRow[]): Promise<void> {
    const labels = new Map<string, string>();
    const pending: string[] = [];
    for (const r of rows) {
      if (!r.role) continue;
      if (r.role.startsWith('@')) pending.push(r.role);
      else {
        const clean = cleanLocaleValue(r.role);
        if (clean) labels.set(r.classNameSlug, clean);
      }
    }
    if (pending.length) {
      try {
        const resolved = await this.svc.resolveLocaleKeys([...new Set(pending)], this.lang());
        for (const r of rows) {
          if (!r.role?.startsWith('@')) continue;
          const clean = cleanLocaleValue(resolved.get(r.role));
          if (clean) labels.set(r.classNameSlug, clean);
        }
      } catch {
        /* leave the unresolved hulls in the "unknown" bucket */
      }
    }
    this.fleetRoleLabels.set(labels);
  }

  /** IM HANGAR extras for the selected (flagship) ship — best-effort, non-blocking. */
  private async resolveShipExtras(): Promise<void> {
    const ship = this.flagshipRow();
    if (!ship) {
      this.shipComponentPayloads.set(new Map());
      this.shipRoleResolved.set(null);
      this.selectedHangarShipId.set(null);
      return;
    }
    const payload = ship.payload as ShipPayload | null;
    const classNames = (payload?.defaultLoadout ?? [])
      .map((e) => e.entityClassName)
      .filter((c): c is string => !!c);

    const tasks: Promise<void>[] = [
      this.svc
        .getEntityPayloads(classNames)
        .then((m) => this.shipComponentPayloads.set(m))
        .catch(() => this.shipComponentPayloads.set(new Map())),
    ];

    if (ship.role?.startsWith('@')) {
      tasks.push(
        this.svc
          .resolveLocaleKeys([ship.role], this.lang())
          .then((m) => this.shipRoleResolved.set(cleanLocaleValue(m.get(ship.role!)) || null))
          .catch(() => this.shipRoleResolved.set(null)),
      );
    } else {
      this.shipRoleResolved.set(cleanLocaleValue(ship.role) || null);
    }

    // The saved per-ship configurations no longer render here (feedback
    // 2026-08-23: "Konfigurationen brauchen wir nicht direkt zugreifbar,
    // einfach direkt die Flotte") — the id stays because the hangar deep
    // link still uses it.
    this.selectedHangarShipId.set(this.hangar.shipByClassName(ship.classNameSlug)?.id ?? null);

    await Promise.all(tasks);
  }

  /** AN BORD extras — active + other loadouts, resolved armour, archive depth for empty slots. */
  private async resolvePersonal(): Promise<void> {
    // Most recently touched first — unless the URL names a set, which then
    // leads. Everything downstream (`activeLoadout`, the paperdoll, the panel's
    // switcher) reads position 0, so ordering IS the selection.
    const loadouts = withSelectedFirst(
      sortByRecency(this.hangar.roleLoadouts()),
      this.selectedSetId(),
    );
    this.personalLoadouts.set(loadouts);
    const active = loadouts[0] ?? null;
    if (!active) {
      this.resolvedArmor.set(new Map());
      this.archiveDepth.set(new Map());
      this.armorPayloads.set(new Map());
      return;
    }
    const classNames = active.items.map((i) => i.className).filter((c): c is string => !!c);
    const slots = armorSlotsFromLoadout(active.items);
    const emptySlots = slots.filter((s) => !s.className);

    const tasks: Promise<void>[] = [
      this.svc
        .resolveEntities(classNames)
        .then((m) => this.resolvedArmor.set(m))
        .catch(() => this.resolvedArmor.set(new Map())),
      // Armour class (stats.SCItemSuitArmorParams) + readiness (subType) both
      // live on the payload, so one batch covers both. Best-effort: a failure
      // degrades to "no class known", which renders as an honest hatch.
      this.svc
        .getEntityPayloads(classNames)
        .then((m) => this.armorPayloads.set(m))
        .catch(() => this.armorPayloads.set(new Map())),
      Promise.all(
        emptySlots.map((s) =>
          this.svc
            .listByKind('item', { attachType: s.attachType, limit: 1 })
            .then((r) => [s.attachType, r.count] as const)
            .catch(() => [s.attachType, null] as const),
        ),
      ).then((entries) => {
        const m = new Map<string, number>();
        for (const [attachType, count] of entries) if (count != null) m.set(attachType, count);
        this.archiveDepth.set(m);
      }),
    ];
    await Promise.all(tasks);
  }

  // ── Archive Terminal ──────────────────────────────────────────────────────
  onSearchInput(value: string): void {
    this.searchInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.searchTerm.set(value), SEARCH_DEBOUNCE_MS);
  }

  clearSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchInput.set('');
    this.searchTerm.set('');
  }

  private async runSearch(term: string): Promise<void> {
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const hits = await this.svc.searchAll(term, 6);
      if (seq !== this.searchSeq) return; // a newer search superseded this one
      this.searchResults.set(hits);
    } catch {
      if (seq === this.searchSeq) this.searchResults.set([]);
    } finally {
      if (seq === this.searchSeq) this.searching.set(false);
    }
  }

  hitLink(hit: PolySearchHit): string[] {
    return polyHitLink(hit);
  }

  /** Query params for the hit's anchor (`?q=` for announced ships), else none. */
  hitQueryParams(hit: PolySearchHit): Record<string, string> | null {
    return polyHitQueryParams(hit);
  }

  /** Category glyph for a hit; announced ships borrow the ship icon. */
  hitIcon(hit: PolySearchHit): CodexKind {
    return polyHitIconKind(hit);
  }

  isUpcoming(hit: PolySearchHit): boolean {
    return isUpcomingHit(hit);
  }

  /**
   * The compare-tray kind for a hit, or `null` when it cannot be pinned.
   * Announced ships have no build row, so there is nothing to line up against.
   */
  hitCompareKind(hit: PolySearchHit): CodexKind | null {
    return isUpcomingHit(hit) ? null : (hit.kind as CodexKind);
  }

  hitName(hit: PolySearchHit): string {
    return cleanLocaleValue(hit.nameLocalized) || humanizeClassName(hit.classNameSlug);
  }

  /** Full manufacturer name of a search hit, code-only as the honest fallback. */
  hitMfr(hit: PolySearchHit): string | null {
    return pickLocalized(hit.manufacturerName, this.lang()) || hit.manufacturerCode || null;
  }

  // ── compare tray ──────────────────────────────────────────────────────────
  togglePin(ev: Event, kind: CodexKind, className: string): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.svc.togglePin(kind, className);
  }

  // ── fleet rendering helpers ────────────────────────────────────────────────
  deltasFor(className: string): ShipStatDelta[] {
    return this.fleetDeltas().get(className) ?? [];
  }

  rowName(r: CodexListRow): string {
    const p = r.payload as { name?: LocalizedText } | null;
    const localized = p?.name ? pickLocalized(p.name, this.lang()) : '';
    return localized || cleanLocaleValue(r.nameLocalized) || humanizeClassName(r.classNameSlug);
  }

  /**
   * Manufacturer of a hull, spelled out ("Aegis Dynamics", not "AEG"). The name
   * is extracted game data carried on the row payload — see `manufacturerLabel`.
   */
  rowMfr(r: CodexListRow): string | null {
    return manufacturerLabel(r, this.lang());
  }

  thumbs(r: CodexListRow): string[] {
    const out: string[] = [...this.rsi.artFor(r.nameLocalized ?? this.rowName(r))];
    const p = r.payload as { previewImage?: string | null } | null;
    const local = this.svc.previewUrl(p?.previewImage);
    if (local) out.push(local);
    return out;
  }

  formatNum(v: number): string {
    return formatNumber(v);
  }

  /**
   * Category glyph for a ship KPI chip. Maps the KPI's i18n key onto the
   * (kind, sub) pair `sc-codex-icon` already understands, so the chips reuse
   * the catalog's existing glyph + colour vocabulary instead of inventing a
   * second one. An unmapped key falls back to the generic component glyph
   * rather than rendering nothing.
   */
  kpiIcon(labelKey: string): { kind: CodexKind; sub: string | null } {
    if (labelKey.endsWith('.shieldTotal')) return { kind: 'component', sub: 'Shield' };
    if (labelKey.endsWith('.quantumDrive')) return { kind: 'component', sub: 'QuantumDrive' };
    if (labelKey.endsWith('.emptyMounts') || labelKey.endsWith('.weaponMounts')) {
      return { kind: 'weapon', sub: null };
    }
    if (labelKey.endsWith('.missileCapacity')) return { kind: 'ammunition', sub: null };
    if (labelKey.endsWith('.fillRate')) return { kind: 'component', sub: 'PowerPlant' };
    return { kind: 'component', sub: null };
  }

  private lang(): Lang {
    return toLang(this.t.currentLang ?? this.t.getDefaultLang());
  }
}
