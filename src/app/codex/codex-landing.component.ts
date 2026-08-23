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
import { CodexListRow, CodexKind, CodexService, ResolvedEntity, pickLocalized, toLang } from './codex.service';
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
import { HangarRoleLoadout, HangarShipConfig } from '../hangar/hangar.types';
import { AuthService } from '../auth/auth.service';
import { formatScDate } from '../core/locale/date-format';
import { LocaleService } from '../core/locale/locale.service';

const SEARCH_DEBOUNCE_MS = 250;

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
  imports: [
    FormsModule,
    RouterLink,
    TranslateModule,
    CodexCompareTrayComponent,
    CodexCategoryIconComponent,
    FallbackImageComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="landing">
      <!-- ── TOP: Archive Terminal + status pill + patch disclosure ─────────── -->
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

        <div class="status-pill" [class.stale]="svc.stale()">
          <span class="live-dot" aria-hidden="true"></span>
          <span class="status-online">{{ 'codex.landing.status.online' | translate }}</span>
          @if (svc.stale()) {
            <a class="status-stale" routerLink="/uploader">{{
              'codex.landing.status.stale' | translate
            }}</a>
          }
        </div>

        <!-- Patch badge: resting shows just the patch label. build_number is
             literally the string "desktop" (a placeholder) — never shown as a
             real build number, only inside the expanded panel as provenance. -->
        @if (svc.build(); as b) {
          <details class="patch-badge">
            <summary class="patch-summary">
              <span class="patch-label mono">{{ 'codex.landing.status.patch' | translate: { patch: b.patchVersion } }}</span>
              <span class="patch-ask">{{ 'codex.landing.patch.ask' | translate }}</span>
            </summary>
            <div class="patch-changes">
              @if (archiveRecordCount(); as count) {
                <span>{{ 'codex.landing.patch.archive' | translate: { count: formatNum(count) } }}</span>
              }
              @if (extractedAtLabel(); as date) {
                <span>{{ 'codex.landing.patch.extracted' | translate: { date } }}</span>
              }
              <span>{{ 'codex.landing.patch.build' | translate: { build: b.buildNumber } }}</span>
            </div>
          </details>
        }
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
                      @if (hit.manufacturerCode) {
                        <span class="hit-mfr">{{ hit.manufacturerCode }}</span>
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
            <div class="identity skel"></div>
          } @else if (emptyHangar()) {
            <div class="hangar-empty">
              <span class="empty-chip">{{ 'codex.landing.fleet.empty' | translate }}</span>
              <a class="btn tint" routerLink="/codex/index">
                {{ 'codex.landing.fleet.cta' | translate }}
                <span class="btn-goal">{{ 'codex.landing.fleet.ctaGoal' | translate }}</span>
              </a>
            </div>
          } @else if (flagshipRow(); as f) {
            <div class="identity">
              <div class="identity-head">
                <span class="identity-mfr">{{ f.manufacturerCode }}</span>
                @if (shipRoleResolved(); as role) {
                  <span class="identity-role">{{ role }}</span>
                }
                <button
                  type="button"
                  class="pin identity-pin"
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
              </div>
              <a class="identity-name" [routerLink]="['/codex', 'ship', f.classNameSlug]">{{ rowName(f) }}</a>

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

              <!-- Ship KPIs (max 7) — never crew/cargo/mass/flight.*, all null
                   for every ship in this build; derived purely from mount
                   structure + fitted-component payloads. -->
              <div class="kpi-row">
                @for (k of shipKpis(); track k.labelKey) {
                  <div class="kpi" [class.warn]="k.warn">
                    <span class="kpi-label">{{ k.labelKey | translate }}</span>
                    <span class="kpi-value mono">{{ k.value }}</span>
                  </div>
                }
              </div>

              @if (otherShipConfigs().length) {
                <div class="config-list">
                  <span class="config-list__label">{{ 'codex.landing.configs.otherShip' | translate }}</span>
                  @for (c of otherShipConfigs(); track c.id) {
                    <details class="config-row">
                      <summary>
                        <span class="config-row__name">{{ c.name }}</span>
                        <span class="config-row__role">{{ 'hangar.roles.' + c.role | translate }}</span>
                        @if (c.isActive) {
                          <span class="config-row__active">{{ 'codex.landing.configs.active' | translate }}</span>
                        }
                      </summary>
                      <div class="config-row__body">
                        <a [routerLink]="['/hangar', 'ship', selectedHangarShipId()]">{{
                          'codex.landing.configs.openDetail' | translate: { name: c.name }
                        }}</a>
                      </div>
                    </details>
                  }
                </div>
              }

              @if (fleetOthers().length) {
                <div class="fleet-others">
                  @for (r of fleetOthers(); track r.classNameSlug) {
                    <a
                      class="fleet-thumb"
                      [class.icon-only]="thumbs(r).length === 0"
                      [routerLink]="['/codex', 'ship', r.classNameSlug]"
                      [attr.aria-label]="'codex.landing.fleet.open' | translate: { ship: rowName(r) }"
                    >
                      <sc-fallback-image [candidates]="thumbs(r)" [alt]="rowName(r)">
                        <sc-codex-icon kind="ship" />
                      </sc-fallback-image>
                      <span class="thumb-name">{{ rowName(r) }}</span>
                      @if (deltasFor(r.classNameSlug).length) {
                        <span
                          class="thumb-delta"
                          [class]="'dir-' + deltasFor(r.classNameSlug)[0].direction"
                          aria-hidden="true"
                        >
                          <svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 4 L20.5 19 H3.5 Z" />
                          </svg>
                        </span>
                      }
                    </a>
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
        <header class="versum-head">
          <div class="versum-locate">
            <span class="versum-eyebrow">{{ 'codex.landing.versum.eyebrow' | translate }}</span>
            <h2 class="versum-title">{{ 'codex.landing.versum.title' | translate }}</h2>
          </div>
        </header>
        <div class="domain-row">
          @for (d of versumDomains(); track d.kind) {
            <a class="domain-tile" [routerLink]="d.route" [queryParams]="d.queryParams ?? null">
              <span class="domain-label">{{ d.labelKey | translate }}</span>
              <span class="domain-count mono">{{ formatNum(d.count!) }}</span>
            </a>
          }
        </div>

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
                    @if (ship.manufacturerCode) {
                      <span class="upcoming-tile__mfr">{{ ship.manufacturerCode }}</span>
                    }
                    <span class="upcoming-tile__name">{{ ship.name }}</span>
                  </span>
                </a>
              }
            </div>
          </div>
        }

        <!-- The Showroom entry is gone (feedback, 2026-08-23): a livery-first
             ship gallery is not a destination of its own — skins and the 3D
             model already live ON the ship, reachable via the hangar. -->
        <nav class="versum-rail">
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
        </nav>
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

      .patch-badge {
        border: 1px solid var(--sc-border);
        border-radius: 3px;
        background: var(--sc-bg-1);
      }
      .patch-summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 7px 12px;
        cursor: pointer;
        list-style: none;
        min-height: var(--sc-tap-min, 44px);
      }
      .patch-summary::-webkit-details-marker { display: none; }
      .patch-label { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
      .patch-ask { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-accent); }
      .patch-changes {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 0 12px 10px;
        font-size: max(0.7rem, var(--sc-fs-floor));
        color: var(--sc-fg-2);
      }

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
      .hit-meta { display: flex; gap: 6px; align-items: center; font-size: 0.72rem; color: var(--sc-fg-2); }
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
      .identity.skel {
        min-height: 140px;
        border-radius: 3px;
        background: linear-gradient(110deg, var(--sc-bg-1) 30%, var(--sc-bg-2) 50%, var(--sc-bg-1) 70%);
        background-size: 200% 100%;
        animation: skel 1.4s linear infinite;
      }
      @keyframes skel { to { background-position: -200% 0; } }
      .identity-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .identity-mfr {
        font-family: var(--sc-font-display);
        font-size: 0.74rem;
        letter-spacing: 0.04em;
        color: var(--sc-fg-1);
      }
      .identity-role { font-size: 0.72rem; color: var(--sc-fg-2); }
      .identity-pin { margin-left: auto; }
      .identity-name {
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--sc-fg-0);
        text-decoration: none;
      }
      .identity-name:hover { color: var(--sc-accent); }
      .delta-row { display: flex; flex-wrap: wrap; gap: 6px; }
      .delta { display: inline-flex; gap: 5px; align-items: baseline; padding: 2px 7px; border-radius: 3px; font-size: 0.72rem; background: var(--sc-bg-2); }
      .delta-label { color: var(--sc-fg-2); }
      .delta-val { font-variant-numeric: tabular-nums; font-weight: 600; }
      .dir-up .delta-val { color: var(--sc-success, #5fd698); }
      .dir-down .delta-val { color: var(--sc-danger, #ff6b6b); }
      .dir-neutral .delta-val { color: var(--sc-fg-1); }

      /* ── fleet thumbnails (kept from today's page) ────────────────────── */
      .fleet-others { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
      .fleet-thumb {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 6px;
        border-radius: 3px;
        text-decoration: none;
        color: inherit;
        border: 1px solid var(--sc-border);
        background: var(--sc-bg-2);
        --sc-img-max-h: 56px;
        transition: border-color 0.16s;
      }
      .fleet-thumb:hover { border-color: var(--sc-accent); }
      .fleet-thumb.icon-only { color: var(--sc-accent); }
      .thumb-name { font-size: 0.72rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .thumb-delta { position: absolute; top: 6px; right: 6px; width: 12px; height: 12px; }
      .thumb-delta.dir-up { color: var(--sc-success, #5fd698); }
      .thumb-delta.dir-down { color: var(--sc-danger, #ff6b6b); }
      .thumb-delta.dir-neutral { color: var(--sc-fg-2); }
      .compare-hint { margin: 0; font-size: 0.74rem; color: var(--sc-fg-2); }

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
      .versum-locate { display: flex; flex-direction: column; gap: 2px; }
      .versum-eyebrow {
        font-family: var(--sc-font-display);
        font-size: 0.68rem;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      .versum-title { margin: 0; font-size: 1.1rem; }
      .domain-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
      /* Frameless at rest, framed on interaction ("rahmenlos bzw. mit dem
         highlight rahmen", 2026-08-16 correction): no resting border/panel —
         a transparent 1px border keeps the box size stable — only hover/focus
         paints the accent frame + glow. */
      .domain-tile {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px;
        border-radius: 3px;
        border: 1px solid transparent;
        text-decoration: none;
        color: inherit;
        background: transparent;
        transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
      }
      .domain-tile:hover,
      .domain-tile:focus-visible {
        outline: none;
        border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent);
        background: color-mix(in srgb, var(--sc-accent) 6%, transparent);
        box-shadow: var(--shadow-glow);
      }
      .domain-label { font-size: 0.74rem; color: var(--sc-fg-2); }
      .domain-count { font-size: 1.15rem; font-weight: 700; color: var(--sc-fg-0); }

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
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: color-mix(in srgb, var(--sc-accent) 78%, #f2f7fb);
      }

      .versum-rail { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .versum-rail a:not(.rail-icon) { font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; }
      .versum-rail a:not(.rail-icon):hover { text-decoration: underline; }
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
      @media (prefers-reduced-motion: reduce) {
        .hit, .surface, .fleet-thumb, .domain-tile, .zone-entry::after, .upcoming-tile { transition: none; }
        .live-dot, .identity.skel { animation: none; }
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

  // Fleet
  private readonly fleetRows = signal<CodexListRow[]>([]);
  private readonly fleetDeltas = signal<Map<string, ShipStatDelta[]>>(new Map());

  // IM HANGAR extras (flagship-scoped, best-effort)
  readonly shipComponentPayloads = signal<Map<string, EntityPayloadEntry>>(new Map());
  readonly shipRoleResolved = signal<string | null>(null);
  readonly selectedHangarShipId = signal<string | null>(null);
  readonly otherShipConfigs = signal<HangarShipConfig[]>([]);

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
    const defs: {
      kind: CodexKind;
      labelKey: string;
      route: string;
      queryParams?: Record<string, string>;
    }[] = [
      { kind: 'ship', labelKey: 'codex.landing.versum.domain.ship', route: '/codex/index', queryParams: { kind: 'ship' } },
      { kind: 'item', labelKey: 'codex.landing.versum.domain.item', route: '/codex/index', queryParams: { kind: 'item' } },
      { kind: 'component', labelKey: 'codex.landing.versum.domain.component', route: '/codex/index', queryParams: { kind: 'component' } },
      { kind: 'weapon', labelKey: 'codex.landing.versum.domain.weapon', route: '/codex/index', queryParams: { kind: 'weapon' } },
      { kind: 'blueprint', labelKey: 'codex.landing.versum.domain.blueprint', route: '/codex/blueprint' },
      { kind: 'manufacturer', labelKey: 'codex.landing.versum.domain.manufacturer', route: '/codex/index', queryParams: { kind: 'manufacturer' } },
      { kind: 'ammunition', labelKey: 'codex.landing.versum.domain.ammunition', route: '/codex/index', queryParams: { kind: 'ammunition' } },
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
      this.otherShipConfigs.set([]);
      return;
    }
    const byName = await this.svc.getShipsByClassNames(names);
    // Preserve hangar order, drop names absent from the current build.
    const rows = names.map((n) => byName.get(n)).filter((r): r is CodexListRow => !!r);
    this.fleetRows.set(rows);
    // Best-effort inline patch-diff — degrades to an empty map (no error).
    this.fleetDeltas.set(await this.svc.ownedFleetDeltas(rows.map((r) => r.classNameSlug)));
    await this.resolveShipExtras();
  }

  /** IM HANGAR extras for the selected (flagship) ship — best-effort, non-blocking. */
  private async resolveShipExtras(): Promise<void> {
    const ship = this.flagshipRow();
    if (!ship) {
      this.shipComponentPayloads.set(new Map());
      this.shipRoleResolved.set(null);
      this.selectedHangarShipId.set(null);
      this.otherShipConfigs.set([]);
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

    const hangarShip = this.hangar.shipByClassName(ship.classNameSlug);
    this.selectedHangarShipId.set(hangarShip?.id ?? null);
    if (hangarShip) {
      tasks.push(
        this.hangar
          .listConfigs(hangarShip.id)
          .then((configs) => this.otherShipConfigs.set(sortByRecency(configs).slice(0, 3)))
          .catch(() => this.otherShipConfigs.set([])),
      );
    } else {
      this.otherShipConfigs.set([]);
    }

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
