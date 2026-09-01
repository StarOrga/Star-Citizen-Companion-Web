import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
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
import { PolySearchHit, polyHitLink } from './codex-poly-search';
import { ShipStatDelta } from './codex-build-diff';
import {
  ArmorSlotState,
  EntityPayloadEntry,
  armorSlotsFromLoadout,
  computeFpsKpis,
  computeShipKpis,
  KpiRow,
  sortByRecency,
} from './codex-landing-kpi';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShip, UpcomingShipsService, thumbnailCandidates } from './upcoming-ships.service';
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

/** One rendered fleet group: a heading (empty for the ungrouped axis) + its ships. */
export interface FleetGroup {
  label: string;
  rows: CodexListRow[];
}

/** One anatomical paperdoll marker's display state (see codex-landing-kpi.ts for the slot spec). */
interface PaperdollSlotView {
  filled: boolean;
  name: string;
  detail: string;
  archiveCount: number | null;
}

/**
 * The Codex landing — "the scale ladder" (person → ship → verse).
 *
 * Three depth planes, ONE continuous surface for the first two (no container
 * border between them — the amber→cyan scope shift is carried by eyebrow
 * colour and a thin edge accent, not by two boxes):
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="landing">
      <!-- ── TOP: Archive Terminal + patch + status pill + app menu ─────────── -->
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

        <!-- The patch "what changed?" disclosure used to own the far right of
             this row; the Data-Uploader control took that slot (admin feedback
             924bf1d8). Nothing was thrown away: the patch label moved into the
             status pill, where it is read far more often than it was expanded,
             and the provenance lines moved into the uploader overlay below —
             which is where they belong, because that tool is what produced
             them. build_number is literally the string "desktop" (a
             placeholder), so it stays a provenance footnote, never a headline. -->
        <div class="status-pill" [class.stale]="svc.stale()">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="status-online">{{ 'codex.landing.status.online' | translate }}</span>
          @if (svc.build(); as b) {
            <span class="status-patch mono">{{
              'codex.landing.status.patch' | translate: { patch: b.patchVersion }
            }}</span>
          }
          @if (svc.stale()) {
            <a class="status-stale" routerLink="/uploader">{{
              'codex.landing.status.stale' | translate
            }}</a>
          }
        </div>

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
                <a class="hit" [class.meta]="hit.scope === 'meta'" [routerLink]="hitLink(hit)">
                  <span class="hit-icon" aria-hidden="true">
                    <sc-codex-icon [kind]="hit.kind" />
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
                    </span>
                  </span>
                  <button
                    type="button"
                    class="pin"
                    [class.pinned]="svc.isPinned(hit.kind, hit.classNameSlug)"
                    (click)="togglePin($event, hit.kind, hit.classNameSlug)"
                    [attr.aria-label]="
                      (svc.isPinned(hit.kind, hit.classNameSlug)
                        ? 'codex.compare.pinned'
                        : 'codex.compare.pin'
                      ) | translate
                    "
                  >
                    <svg class="icon" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"
                         stroke-linejoin="round" aria-hidden="true"
                         [attr.fill]="svc.isPinned(hit.kind, hit.classNameSlug) ? 'currentColor' : 'none'">
                      <path d="M12 3 L14.7 9.2 L21.5 9.9 L16.4 14.3 L17.9 21 L12 17.4 L6.1 21 L7.6 14.3 L2.5 9.9 L9.3 9.2 Z" />
                    </svg>
                  </button>
                </a>
              }
            </div>
          }
        </section>
      }

      <!-- ── SURFACE: AN BORD + IM HANGAR, one continuous surface ────────────── -->
      <div class="surface" [class.dimmed]="searchActive()">
        <!-- AN BORD — amber, on-foot character. The WHOLE zone is an entrance
             into the on-foot subview (feedback, 2026-08-16: "wenn man dort
             irgendwo drauf klickt"). Nested anchors are invalid HTML and the
             zone already hosts real interactive children (the pin button, the
             config <details> list, its own deep links), so we cannot wrap the
             whole zone in one <a>. Instead a.zone-entry carries the
             heading/eyebrow and is stretched over the WHOLE zone via its
             ::after (position:absolute; inset:0 — resolves against .zone,
             the nearest positioned ancestor, since .zone-entry itself stays
             unpositioned). Every sibling that holds real controls gets
             position:relative + a higher z-index so it stays clickable; empty
             chrome (paperdoll, KPI cards) is allowed to fall through to the
             entrance link, which is exactly the "click anywhere" goal. -->
        <article class="zone board" aria-labelledby="board-title">
          <a class="zone-entry" [routerLink]="boardEntryLink()">
            <header class="zone-head">
              <span class="zone-eyebrow" id="board-title">{{ 'codex.landing.me.eyebrow' | translate }}</span>
              @if (!hasPersonalSet()) {
                <h2>{{ 'codex.landing.me.title' | translate }}</h2>
              }
            </header>
          </a>

          @if (!hasPersonalSet()) {
            <div class="board-empty">
              <span class="empty-chip">{{ 'codex.landing.me.uncommissioned' | translate }}</span>
              <p class="me-lead">{{ 'codex.landing.me.emptyLead' | translate }}</p>
              <a class="btn tint" routerLink="/codex/fps">
                {{ 'codex.landing.me.cta' | translate }}
                <span class="btn-goal">{{ 'codex.landing.me.ctaGoal' | translate }}</span>
              </a>
            </div>
          } @else {
            <div class="ready-row">
              <span class="ready-chip">{{ 'codex.landing.me.ready' | translate }}</span>
              <span class="me-set-name">{{ activeLoadout()!.name }}</span>
            </div>

            <!-- Schematic paperdoll: six slots at their anatomical position,
                 leader lines to labels. Filled markers tint amber; empty
                 markers stay dashed outlines — a labelled instrument, not a
                 greyed-out gap. -->
            <div class="paperdoll-wrap">
              <svg class="paperdoll" viewBox="0 0 320 264" role="img"
                   [attr.aria-label]="'codex.landing.paperdoll.aria' | translate">
                <path class="doll-undersuit" [class.filled]="paperdollSlot('undersuit').filled"
                  d="M160,24 c10,0 17,7 17,17 c0,6 -3,11 -7,14 l0,3 c14,3 23,12 23,12 l0,58 c0,4 -3,7 -7,7 l-4,0 l0,90 c0,4 -3,7 -7,7 l-30,0 c-4,0 -7,-3 -7,-7 l0,-90 l-4,0 c-4,0 -7,-3 -7,-7 l0,-58 c0,0 9,-9 23,-12 l0,-3 c-4,-3 -7,-8 -7,-14 c0,-10 7,-17 17,-17 z" />
                <rect class="doll-slot doll-slot--rucksack" [class.filled]="paperdollSlot('backpack').filled" x="188" y="82" width="30" height="54" rx="2" />
                <rect class="doll-slot" [class.filled]="paperdollSlot('legs').filled" x="136" y="154" width="22" height="100" rx="2" />
                <rect class="doll-slot" [class.filled]="paperdollSlot('legs').filled" x="162" y="154" width="22" height="100" rx="2" />
                <rect class="doll-slot" [class.filled]="paperdollSlot('arms').filled" x="104" y="76" width="20" height="70" rx="2" />
                <rect class="doll-slot" [class.filled]="paperdollSlot('arms').filled" x="196" y="76" width="20" height="70" rx="2" />
                <rect class="doll-slot" [class.filled]="paperdollSlot('torso').filled" x="132" y="70" width="56" height="90" rx="2" />
                <circle class="doll-slot" [class.filled]="paperdollSlot('helmet').filled" cx="160" cy="40" r="19" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('helmet').filled" x1="160" y1="40" x2="45" y2="34" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('torso').filled" x1="176" y1="100" x2="275" y2="60" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('arms').filled" x1="108" y1="108" x2="45" y2="140" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('undersuit').filled" x1="212" y1="108" x2="108" y2="108" stroke-dasharray="2 3" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('legs').filled" x1="160" y1="200" x2="45" y2="228" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('arms').filled" x1="120" y1="150" x2="275" y2="138" />
                <line class="doll-leader" [class.empty]="!paperdollSlot('backpack').filled" x1="203" y1="108" x2="275" y2="226" />
                <foreignObject x="0" y="10" width="90" height="46"><div xmlns="http://www.w3.org/1999/xhtml" class="doll-label" [class.empty]="!paperdollSlot('helmet').filled">
                  <span class="doll-label__slot">{{ 'codex.landing.paperdoll.helmet' | translate }}</span>
                  <span class="doll-label__item">{{ paperdollItemLabel('helmet') }}</span>
                  <span class="doll-label__state">{{ paperdollSubLabel('helmet') }}</span>
                </div></foreignObject>
                <foreignObject x="230" y="34" width="90" height="46"><div xmlns="http://www.w3.org/1999/xhtml" class="doll-label" [class.empty]="!paperdollSlot('torso').filled">
                  <span class="doll-label__slot">{{ 'codex.landing.paperdoll.torso' | translate }}</span>
                  <span class="doll-label__item">{{ paperdollItemLabel('torso') }}</span>
                  <span class="doll-label__state">{{ paperdollSubLabel('torso') }}</span>
                </div></foreignObject>
                <foreignObject x="0" y="118" width="90" height="46"><div xmlns="http://www.w3.org/1999/xhtml" class="doll-label" [class.empty]="!paperdollSlot('arms').filled">
                  <span class="doll-label__slot">{{ 'codex.landing.paperdoll.arms' | translate }}</span>
                  <span class="doll-label__item">{{ paperdollItemLabel('arms') }}</span>
                  <span class="doll-label__state">{{ paperdollSubLabel('arms') }}</span>
                </div></foreignObject>
                <foreignObject x="0" y="206" width="90" height="46"><div xmlns="http://www.w3.org/1999/xhtml" class="doll-label" [class.empty]="!paperdollSlot('legs').filled">
                  <span class="doll-label__slot">{{ 'codex.landing.paperdoll.legs' | translate }}</span>
                  <span class="doll-label__item">{{ paperdollItemLabel('legs') }}</span>
                  <span class="doll-label__state">{{ paperdollSubLabel('legs') }}</span>
                </div></foreignObject>
                <foreignObject x="230" y="112" width="90" height="50"><div xmlns="http://www.w3.org/1999/xhtml" class="doll-label" [class.empty]="!paperdollSlot('undersuit').filled">
                  <span class="doll-label__slot">{{ 'codex.landing.paperdoll.undersuit' | translate }}</span>
                  <span class="doll-label__item">{{ paperdollItemLabel('undersuit') }}</span>
                  <span class="doll-label__state">{{ paperdollSubLabel('undersuit') }}</span>
                </div></foreignObject>
                <foreignObject x="230" y="200" width="90" height="50"><div xmlns="http://www.w3.org/1999/xhtml" class="doll-label" [class.empty]="!paperdollSlot('backpack').filled">
                  <span class="doll-label__slot">{{ 'codex.landing.paperdoll.backpack' | translate }}</span>
                  <span class="doll-label__item">{{ paperdollItemLabel('backpack') }}</span>
                  <span class="doll-label__state">{{ paperdollSubLabel('backpack') }}</span>
                </div></foreignObject>
              </svg>
            </div>

            <!-- On-foot KPIs (max 7) — never fabricated: two honest gap markers
                 stand where Stealth/Rüstung/Waffengewalt would sit, because
                 armour carries no protection stat block in this build. -->
            <div class="kpi-row">
              @for (k of fpsKpis(); track k.labelKey) {
                <div class="kpi" [class.gap]="k.gap" [attr.title]="k.gapTitleKey ? (k.gapTitleKey | translate) : null">
                  <span class="kpi-label">{{ k.labelKey | translate }}</span>
                  <span class="kpi-value mono">{{ k.value }}</span>
                </div>
              }
            </div>

            @if (otherLoadouts().length) {
              <div class="config-list">
                <span class="config-list__label">{{ 'codex.landing.configs.otherRoles' | translate }}</span>
                @for (l of otherLoadouts(); track l.id) {
                  <details class="config-row">
                    <summary>
                      <span class="config-row__name">{{ l.name }}</span>
                      <span class="config-row__role">{{ 'hangar.roles.' + l.role | translate }}</span>
                    </summary>
                    <div class="config-row__body">
                      <a routerLink="/hangar/loadout/{{ l.id }}">{{
                        'codex.landing.configs.openDetail' | translate: { name: l.name }
                      }}</a>
                    </div>
                  </details>
                }
              </div>
            }
          }
        </article>

        <!-- IM HANGAR — cyan, ship identity + KPI + fleet field. Same
             stretched-link entrance as AN BORD, this time into /hangar. -->
        <article class="zone hangar" aria-labelledby="hangar-title">
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

              <!-- The fleet in the same 16:9 art-tile format the concept-ship
                   rail uses, grouped by the chosen sort axis. The flagship is
                   part of it (starred) rather than excluded — the grouping only
                   reads right when every owned hull is in it. -->
              @if (fleetRows().length) {
                <div class="fleet-lane">
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
        </article>
      </div>

      <!-- ── IM VERSUM: frameless domain entry points ────────────────────────── -->
      <section class="versum" [class.dimmed]="searchActive()">
        <!-- The "Domänen" headline is gone (feedback 2026-08-23) — the
             eyebrow is the heading now, and the keybindings entry sits on that
             same line instead of below the rail. -->
        <header class="versum-head">
          <span class="versum-eyebrow">{{ 'codex.landing.versum.eyebrow' | translate }}</span>
          <a
            class="rail-icon"
            routerLink="/codex/keybinds"
            [attr.aria-label]="'codex.landing.versum.keybinds' | translate"
            [attr.title]="'codex.landing.versum.keybinds' | translate"
          >
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 3a5 5 0 0 0-4.9 6.1L3 15.2V19h3.8l1-1h2v-2h2l1.1-1.1A5 5 0 1 0 14 3z" />
              <circle cx="16.6" cy="7.4" r="1.1" />
            </svg>
          </a>
        </header>
        <!-- Horizontal chip strip: glyph + domain, the count as side info
             (feedback 2026-08-23 — "die Anzahl ist eine side Info"). Every
             chip lands on the SAME subview with its filter preselected, so
             the seven entries behave identically. -->
        <nav class="domain-strip" [attr.aria-label]="'codex.landing.versum.eyebrow' | translate">
          @for (d of versumDomains(); track d.kind) {
            <a class="domain-chip" routerLink="/codex/index" [queryParams]="{ kind: d.kind }">
              <sc-codex-icon [kind]="d.kind" />
              <span class="domain-label">{{ d.labelKey | translate }}</span>
              <span class="domain-count mono">{{ formatNum(d.count!) }}</span>
            </a>
          }
        </nav>

        <!-- "Auf dem Reissbrett" — announced-but-unbuilt ships, folded into
             the Schiffe domain (feedback, 2026-08-16) as a horizontal rail
             right under the domain tiles rather than a domain entry of its
             own. NOT a "what's new" feed: these are RSI ship-matrix entries
             the rsi-upcoming-ships diff found NO game-data match for, i.e.
             concept hulls that are meant to be built some day, newest
             announcement first (feedback, 2026-08-23 — the old "Was ist neu"
             title claimed a recency that the list does not carry).
             Renders nothing while the feed is loading/empty (honest empty
             state, no skeleton promising a rail that never fills). Every tile
             is a real RSI anchor: with the current feed shape no classNameSlug
             is returned for these ships, so an internal /codex/ship/:className
             route never applies — external is not a fallback here, it is the
             only correct target. -->
        @if (upcomingRailShips().length > 0) {
          <div class="upcoming-rail">
            <header class="upcoming-rail__head">
              <h3 class="upcoming-rail__title">{{ 'codex.landing.versum.upcomingRail.title' | translate }}</h3>
              @if (rsi.notificationCount() > 0) {
                <span
                  class="upcoming-rail__badge mono"
                  [attr.aria-label]="'codex.landing.versum.upcomingRail.badgeAria' | translate: { count: rsi.notificationCount() }"
                >{{ formatNum(rsi.notificationCount()) }}</span>
              }
            </header>
            <div class="upcoming-rail__scroll" role="list">
              @for (ship of upcomingRailShips(); track ship.id) {
                <a
                  class="upcoming-tile"
                  role="listitem"
                  [class.icon-only]="upcomingThumbs(ship).length === 0"
                  [href]="ship.rsiUrl || upcomingFallbackUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <sc-fallback-image [candidates]="upcomingThumbs(ship)" [alt]="ship.name">
                    <sc-codex-icon kind="ship" />
                  </sc-fallback-image>
                  <span class="upcoming-tile__caption">
                    @if (upcomingMfr(ship); as mfr) {
                      <span class="upcoming-tile__mfr" [attr.title]="mfr">{{ mfr }}</span>
                    }
                    <span class="upcoming-tile__name">{{ ship.name }}</span>
                  </span>
                </a>
              }
            </div>
          </div>
        }

      </section>

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

      /* ── status pill + patch disclosure ───────────────────────────────── */
      .status-pill {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px;
        border-radius: 3px;
        font-family: var(--sc-font-display);
        font-size: max(0.7rem, var(--sc-fs-floor, 0.68rem));
        letter-spacing: 0.04em;
        text-transform: uppercase;
        color: var(--sc-fg-1);
        border: 1px solid color-mix(in srgb, var(--sc-success, #5fd698) 30%, transparent);
        background: color-mix(in srgb, var(--sc-success, #5fd698) 10%, transparent);
      }
      .status-pill.stale {
        border-color: color-mix(in srgb, var(--sc-warning, #ffc14d) 40%, transparent);
        background: color-mix(in srgb, var(--sc-warning, #ffc14d) 10%, transparent);
      }
      .live-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--sc-success, #5fd698);
        box-shadow: 0 0 8px var(--sc-success, #5fd698);
        animation: pulse 2.4s ease-in-out infinite;
      }
      .status-pill.stale .live-dot {
        background: var(--sc-warning, #ffc14d);
        box-shadow: 0 0 8px var(--sc-warning, #ffc14d);
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      .status-stale { color: var(--sc-warning, #ffc14d); text-decoration: underline; }
      /* Patch label, now a chip in the pill instead of its own disclosure. */
      .status-patch {
        padding-left: 8px;
        border-left: 1px solid color-mix(in srgb, var(--sc-fg-2) 35%, transparent);
        color: var(--sc-fg-2);
        text-transform: none;
        letter-spacing: 0;
      }

      /* Far-right slot: never stretch, never wrap mid-control. The menu owns
         its own overlay positioning (sc-app-download-menu). */
      .terminal-menu { flex: 0 0 auto; }

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
      .hit:hover { border-color: var(--sc-accent); box-shadow: 0 0 16px color-mix(in srgb, var(--sc-accent) 22%, transparent); }
      .hit.meta:hover { border-color: var(--meta); }
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

      /* ── ONE SURFACE: AN BORD + IM HANGAR ─────────────────────────────── */
      /* Correction (2026-08-16): still ONE box for both scales — no divider
         between the zones, the scale break stays the eyebrow + amber→cyan
         shift — but now a visibly "floating" panel rather than a borderless
         field: a real 1px border plus --shadow-elevated (StarUI: border
         glows only, no positive-Y drop shadow). */
      .surface {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
        gap: 0;
        border: 1px solid color-mix(in srgb, var(--sc-accent) 18%, var(--sc-border));
        border-radius: 4px;
        background: var(--sc-bg-1);
        box-shadow: var(--shadow-elevated);
        transition: opacity 0.2s;
        overflow: hidden;
      }
      .dimmed { opacity: 0.55; }
      .zone {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border-left: 2px solid var(--tint);
      }
      .zone.board { --tint: var(--sc-warning, #ffc14d); }
      .zone.hangar {
        --tint: var(--sc-accent);
        border-top: 1px solid var(--sc-border);
      }
      @media (min-width: 761px) {
        .zone.hangar { border-top: none; border-left: 1px solid var(--sc-border); }
      }
      /* Zone entrance: the whole zone is a click target into its subview
         (Hangar / on-foot). This <a> itself carries only the heading, but its
         ::after is absolutely positioned against .zone (the nearest
         positioned ancestor, since .zone-entry stays position:static) and
         stretched to the zone's full bounds via inset:0 — the "click
         anywhere in the empty area" trick without nesting an <a> around the
         zone's own interactive children. Those children (board-empty,
         ready-row, paperdoll-wrap, kpi-row, config-list, hangar-empty,
         identity) get position:relative + z-index:1 below to stay above the
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
      .board-empty, .ready-row, .paperdoll-wrap, .kpi-row, .config-list,
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

      .board-empty, .ready-row, .hangar-empty {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
      }
      .ready-row { flex-direction: row; align-items: center; flex-wrap: wrap; }
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
      .ready-chip {
        font-family: var(--sc-font-display);
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        padding: 3px 9px;
        border-radius: 3px;
        color: var(--sc-bg-0);
        background: var(--tint);
      }
      .me-lead, .me-set-name { margin: 0; color: var(--sc-fg-1); font-size: 0.9rem; }
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

      /* ── paperdoll ─────────────────────────────────────────────────────── */
      .paperdoll-wrap { display: flex; justify-content: center; padding: 4px 0; }
      .paperdoll { width: 100%; max-width: 320px; height: auto; overflow: visible; }
      .doll-undersuit {
        fill: color-mix(in srgb, var(--tint) 10%, var(--sc-bg-2));
        stroke: color-mix(in srgb, var(--tint) 30%, transparent);
        stroke-width: 1;
        stroke-dasharray: 3 3;
        opacity: 0.35;
      }
      .doll-undersuit.filled { opacity: 0.55; stroke-dasharray: none; }
      .doll-slot {
        fill: color-mix(in srgb, var(--sc-bg-2) 92%, transparent);
        stroke: color-mix(in srgb, var(--sc-fg-2) 50%, transparent);
        stroke-width: 1.2;
        stroke-dasharray: 3 3;
      }
      .doll-slot.filled {
        fill: color-mix(in srgb, var(--tint) 22%, var(--sc-bg-2));
        stroke: var(--tint);
        stroke-dasharray: none;
      }
      .doll-leader { stroke: color-mix(in srgb, var(--sc-fg-2) 45%, transparent); stroke-width: 1; }
      .doll-leader.empty { stroke-dasharray: 2 3; opacity: 0.6; }
      .doll-label {
        display: flex;
        flex-direction: column;
        font-family: var(--sc-font-body, inherit);
        font-size: 0.62rem;
        line-height: 1.25;
        color: var(--sc-fg-1);
      }
      .doll-label__slot {
        font-family: var(--sc-font-display);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-size: 0.56rem;
        color: var(--tint);
      }
      .doll-label__item { font-weight: 600; }
      .doll-label.empty .doll-label__item { color: var(--sc-fg-2); font-weight: 400; font-style: italic; }
      .doll-label__state { color: var(--sc-fg-2); font-size: 0.58rem; }

      /* ── KPI row (used by both zones) ─────────────────────────────────── */
      .kpi-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
      .kpi {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px 10px;
        border-radius: 3px;
        border: 1px solid var(--sc-border);
        background: var(--sc-bg-2);
      }
      .kpi.warn { border-color: color-mix(in srgb, var(--sc-warning, #ffc14d) 55%, var(--sc-border)); }
      .kpi.warn .kpi-value { color: var(--sc-warning, #ffc14d); }
      .kpi.gap { border-style: dashed; opacity: 0.7; cursor: help; }
      .kpi-label { font-size: 0.66rem; color: var(--sc-fg-2); }
      .kpi-value { font-size: 0.86rem; font-weight: 600; color: var(--sc-fg-0); }

      /* ── other saved configs ──────────────────────────────────────────── */
      .config-list { display: flex; flex-direction: column; gap: 4px; }
      .config-list__label { font-size: 0.68rem; color: var(--sc-fg-2); }
      .config-row { border-top: 1px solid var(--sc-border); font-size: 0.8rem; }
      .config-row summary {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 7px 2px;
        cursor: pointer;
        min-height: var(--sc-tap-min, 44px);
      }
      .config-row__name { font-weight: 600; }
      .config-row__role { color: var(--sc-fg-2); font-size: 0.72rem; }
      .config-row__active {
        margin-left: auto;
        font-size: 0.66rem;
        text-transform: uppercase;
        color: var(--tint);
      }
      .config-row__body { padding: 0 2px 8px; font-size: 0.78rem; color: var(--sc-fg-2); }
      .config-row__body a { color: var(--sc-accent); }

      /* ── identity (IM HANGAR) ─────────────────────────────────────────── */
      .identity { display: flex; flex-direction: column; gap: 10px; }
      .identity.skel { min-height: 140px; border-radius: 3px; }
      /* ── ship hero — the artwork IS the ship ──────────────────────────
         A 16:9 bleed crop with the identity and the KPI chips on a bottom
         scrim, the same art-first treatment the concept-ship rail uses.
         The custom properties cross into sc-fallback-image (a plain
         .ship-hero img rule cannot reach the projected <img>). */
      .ship-hero {
        position: relative;
        aspect-ratio: 16 / 9;
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
      .fleet-tile__mfr {
        font-family: var(--sc-font-display);
        font-size: max(0.56rem, var(--sc-fs-floor));
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--sc-accent) 78%, #f2f7fb);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
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

      /* ── IM VERSUM (frameless) ────────────────────────────────────────── */
      .versum { display: flex; flex-direction: column; gap: 12px; }
      .versum-head { display: flex; align-items: center; gap: 12px; }
      .versum-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      /* Horizontal chip strip. The count is deliberately secondary — the
         glyph and the domain name carry the row, the number is side info. */
      .domain-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      /* Frameless at rest, framed on interaction ("rahmenlos bzw. mit dem
         highlight rahmen", 2026-08-16 correction): no resting border/panel —
         a transparent 1px border keeps the box size stable — only hover/focus
         paints the accent frame + glow. */
      .domain-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 7px 12px 7px 9px;
        border-radius: 999px;
        border: 1px solid transparent;
        text-decoration: none;
        color: inherit;
        background: transparent;
        transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
      }
      .domain-chip:hover,
      .domain-chip:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent);
        background: color-mix(in srgb, var(--sc-accent) 6%, transparent);
        box-shadow: var(--shadow-glow);
      }
      .domain-chip sc-codex-icon { width: 17px; height: 17px; flex: 0 0 17px; }
      .domain-label { font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
      /* Side info, not the headline (feedback 2026-08-23). */
      .domain-count {
        font-size: max(0.68rem, var(--sc-fs-floor));
        font-weight: 400;
        color: var(--sc-fg-2);
        font-variant-numeric: tabular-nums;
      }

      /* ── "Auf dem Reissbrett" — cinematic upcoming-ships rail, folded into
           the Schiffe domain (2026-08-16, replaces the standalone "Kommende
           Schiffe" tile). Own overflow-x container so the PAGE never scrolls
           sideways — the mobile gate fails on horizontal page overflow.
           2026-08-23: the tile is now the artwork itself — a 16:9 bleed crop
           with the name/manufacturer riding a bottom scrim, the same
           art-first treatment the ship pages use — instead of a boxed thumb
           with a caption stacked under it. ── */
      .upcoming-rail { display: flex; flex-direction: column; gap: 8px; }
      .upcoming-rail__head { display: flex; align-items: center; gap: 8px; }
      .upcoming-rail__title { margin: 0; font-size: 0.92rem; }
      .upcoming-rail__badge {
        padding: 1px 8px;
        border-radius: 999px;
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--sc-bg-0);
        background: var(--sc-accent);
      }
      .upcoming-rail__scroll {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        overflow-y: hidden;
        -webkit-overflow-scrolling: touch;
        scroll-snap-type: x proximity;
        padding: 2px 2px 6px;
        margin: 0 -2px;
      }
      .upcoming-tile {
        position: relative;
        flex: 0 0 208px;
        aspect-ratio: 16 / 9;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        border-radius: 4px;
        border: 1px solid var(--sc-border);
        background: radial-gradient(circle at 50% 42%, var(--sc-bg-2), var(--sc-bg-0));
        color: inherit;
        text-decoration: none;
        scroll-snap-align: start;
        min-height: var(--sc-tap-min, 44px);
        transition: border-color 0.16s ease, box-shadow 0.16s ease;
        /* Bleed crop: the art IS the tile. See fallback-image.component.ts —
           these custom properties cross the component boundary, a plain
           .upcoming-tile img rule could not reach the projected <img>. */
        --sc-img-w: 100%;
        --sc-img-h: 100%;
        --sc-img-max-h: 100%;
        --sc-img-fit: cover;
        --sc-img-shadow: none;
      }
      .upcoming-tile:hover, .upcoming-tile:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border));
        box-shadow: var(--shadow-glow);
      }
      /* Art-less hull: lift the placeholder glyph clear of the caption scrim
         so it reads centred in the visible area, not half-swallowed by it. */
      .upcoming-tile.icon-only sc-codex-icon {
        width: 32%; height: 32%; opacity: 0.55; color: var(--sc-accent); transform: translateY(-14%);
      }
      .upcoming-tile__caption {
        position: absolute;
        inset: auto 0 0 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 16px 10px 8px;
        /* Scrim, not a bar: the art keeps breathing above the type while the
           name stays AA-legible over a bright render. */
        background: linear-gradient(to top, rgba(2, 8, 14, 0.92) 0%, rgba(2, 8, 14, 0.72) 46%, transparent 100%);
      }
      .upcoming-tile__name {
        font-size: 0.8rem;
        font-weight: 600;
        line-height: 1.15;
        color: #f2f7fb;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }
      .upcoming-tile__mfr {
        font-family: var(--sc-font-display);
        font-size: max(0.62rem, var(--sc-fs-floor));
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--sc-accent) 78%, #f2f7fb);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* Sits on the "Im Versum" line, right-aligned — no longer a lane of
         its own below the rail (feedback 2026-08-23). */
      .rail-icon {
        margin-left: auto;
        width: 22px;
        height: 22px;
        min-height: var(--sc-tap-min, 44px);
        min-width: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--sc-fg-2);
      }
      .rail-icon:hover { color: var(--sc-accent); }

      /* ── responsive ───────────────────────────────────────────────────── */
      @media (max-width: 760px) {
        .surface { grid-template-columns: 1fr; }
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
        .hit, .surface, .fleet-tile, .fleet-sort__btn, .domain-chip, .zone-entry::after, .upcoming-tile { transition: none; }
        .live-dot, .bay-ring { animation: none; }
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
  /** External fallback when an upcoming ship carries no RSI url of its own. */
  readonly upcomingFallbackUrl = 'https://robertsspaceindustries.com/pledge/ships';
  private readonly locale = inject(LocaleService);

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

  /** Grouping axis of the fleet strip. Session-local — deliberately not persisted. */
  readonly fleetSortAxes: readonly FleetSortAxis[] = ['manufacturer', 'role', 'recent'];
  readonly fleetSort = signal<FleetSortAxis>('manufacturer');

  // AN BORD extras
  readonly personalLoadouts = signal<HangarRoleLoadout[]>([]);
  readonly resolvedArmor = signal<Map<string, ResolvedEntity>>(new Map());
  readonly archiveDepth = signal<Map<string, number>>(new Map());

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

  // AN BORD: the "active" personal loadout is the most recently touched one
  // (see sortByRecency — no last_opened_at yet, sorts by updatedAt).
  readonly activeLoadout = computed<HangarRoleLoadout | null>(() => this.personalLoadouts()[0] ?? null);
  readonly otherLoadouts = computed(() => this.personalLoadouts().slice(1, 4));
  readonly hasPersonalSet = computed(() => this.activeLoadout() !== null);

  /**
   * AN BORD zone entrance target — the on-foot subview. A saved `fps` role
   * loadout (which may not be the most-recently-touched `activeLoadout`,
   * see above) opens straight into its own detail page; otherwise the zone
   * falls back to the on-foot equipment index, same as the empty-state CTA.
   */
  readonly boardEntryLink = computed<(string | number)[]>(() => {
    const fps = this.personalLoadouts().find((l) => l.role === 'fps');
    return fps ? ['/hangar', 'loadout', fps.id] : ['/codex', 'fps'];
  });
  readonly paperdollSlots = computed<ArmorSlotState[]>(() =>
    armorSlotsFromLoadout(this.activeLoadout()?.items ?? []),
  );
  private readonly paperdollBySlot = computed(() => {
    const bySlot = new Map<string, ArmorSlotState>();
    for (const s of this.paperdollSlots()) bySlot.set(s.roleSlot, s);
    return bySlot;
  });
  readonly fpsKpis = computed<KpiRow[]>(() =>
    computeFpsKpis(this.paperdollSlots(), this.resolvedArmor(), this.archiveDepth()),
  );

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
    if (axis === 'recent') return [{ label: '', rows }];

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

  readonly archiveRecordCount = computed<number | null>(() => {
    const counts = this.svc.build()?.entityCounts as Record<string, unknown> | undefined;
    if (!counts) return null;
    let total = 0;
    let found = false;
    for (const [k, v] of Object.entries(counts)) {
      if (k === 'seeded') continue;
      if (typeof v === 'number') {
        total += v;
        found = true;
      }
    }
    return found ? total : null;
  });

  readonly extractedAtLabel = computed<string | null>(() => {
    const at = this.svc.build()?.extractedAt;
    if (!at) return null;
    return formatScDate(at, { language: this.locale.language(), region: this.locale.region() }) || at;
  });

  readonly versumDomains = computed(() => {
    const counts = this.svc.build()?.entityCounts as
      | (Record<string, number> & { seeded?: Record<string, number> })
      | undefined;
    if (!counts) return [];
    // Every domain lands on the SAME subview with its facet preselected
    // (feedback 2026-08-23) — Baupläne used to jump to /codex/blueprint
    // instead, which is a different page with different controls. `blueprint`
    // is a first-class CODEX_KIND, so `?kind=blueprint` preselects it there
    // exactly like the other six.
    const defs: { kind: CodexKind; labelKey: string }[] = [
      { kind: 'ship', labelKey: 'codex.landing.versum.domain.ship' },
      { kind: 'item', labelKey: 'codex.landing.versum.domain.item' },
      { kind: 'component', labelKey: 'codex.landing.versum.domain.component' },
      { kind: 'weapon', labelKey: 'codex.landing.versum.domain.weapon' },
      { kind: 'blueprint', labelKey: 'codex.landing.versum.domain.blueprint' },
      { kind: 'manufacturer', labelKey: 'codex.landing.versum.domain.manufacturer' },
      { kind: 'ammunition', labelKey: 'codex.landing.versum.domain.ammunition' },
    ];
    return defs
      .map((d) => {
        const plural = d.kind === 'ammunition' ? 'ammunition' : `${d.kind}s`;
        const total = counts[plural];
        const seeded = counts.seeded?.[plural];
        const count = typeof (seeded ?? total) === 'number' ? (seeded ?? total) : null;
        return { ...d, count };
      })
      .filter((d) => d.count != null);
  });

  /**
   * "Was ist neu" rail — folded into the Schiffe domain instead of its own
   * "Kommende Schiffe" entry. Renders nothing (see template) until the feed
   * that `ngOnInit` already kicked off via `rsi.ensureLoaded()` resolves —
   * no separate fetch. Capped so the rail stays a scroll strip, not the
   * whole matrix.
   */
  readonly upcomingRailShips = computed<UpcomingShip[]>(() => (this.rsi.feed()?.ships ?? []).slice(0, 20));

  constructor() {
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
    const loadouts = sortByRecency(this.hangar.roleLoadouts());
    this.personalLoadouts.set(loadouts);
    const active = loadouts[0] ?? null;
    if (!active) {
      this.resolvedArmor.set(new Map());
      this.archiveDepth.set(new Map());
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

  /**
   * Manufacturer of an RSI ship-matrix entry. The matrix ships the full name
   * next to the code, so the code is only ever the fallback.
   */
  upcomingMfr(ship: UpcomingShip): string | null {
    return ship.manufacturer?.trim() || ship.manufacturerCode || null;
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

  /** Ordered art candidates for an upcoming-ship rail tile; the fallback-image falls through them on load error. */
  upcomingThumbs(ship: UpcomingShip): string[] {
    return thumbnailCandidates(ship);
  }

  // ── paperdoll rendering helpers ─────────────────────────────────────────────
  paperdollSlot(key: string): PaperdollSlotView {
    const spec = this.paperdollBySlot().get(key);
    if (!spec || !spec.className) {
      const count = spec ? this.archiveDepth().get(spec.attachType) ?? null : null;
      return { filled: false, name: '', detail: '', archiveCount: count };
    }
    const resolved = this.resolvedArmor().get(spec.className);
    const name =
      cleanLocaleValue(resolved?.nameLocalized) || humanizeClassName(spec.className);
    const detail = [
      resolved?.manufacturerCode,
      resolved?.grade ? `Grad ${resolved.grade}` : '',
      resolved?.size != null ? `S${resolved.size}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return { filled: true, name, detail, archiveCount: null };
  }

  paperdollItemLabel(key: string): string {
    const s = this.paperdollSlot(key);
    return s.filled ? s.name : this.t.instant('codex.landing.paperdoll.empty');
  }

  paperdollSubLabel(key: string): string {
    const s = this.paperdollSlot(key);
    if (s.filled) return s.detail;
    return s.archiveCount != null
      ? this.t.instant('codex.landing.paperdoll.archiveDepth', { count: formatNumber(s.archiveCount) })
      : '';
  }

  private lang(): Lang {
    return toLang(this.t.currentLang ?? this.t.getDefaultLang());
  }
}
