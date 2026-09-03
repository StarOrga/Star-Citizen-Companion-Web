import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import {
  AmmunitionPayload,
  BaseEntityPayload,
  CodexBlueprintIngredient,
  CodexItemPort,
  ComponentPayload,
  Dimensions,
  ItemPayload,
  ItemPort,
  Lang,
  LoadoutEntry,
  ShipPayload,
  WeaponPayload,
} from './codex.types';
import {
  BlueprintRef,
  CodexDetail,
  CodexKind,
  CodexService,
  CompatibleItem,
  ResolvedEntity,
  pickLocalized,
  toLang,
} from './codex.service';
import { HangarService } from '../hangar/hangar.service';
import { HangarShipConfig } from '../hangar/hangar.types';
import {
  computeLoadoutStats,
  findStat,
  type QuantumStats,
  type ResolvedLoadoutLine,
} from '../hangar/loadout-stats';
import {
  DamageRow,
  HARDPOINT_CATEGORY_ORDER,
  HardpointCategory,
  SpecSection,
  StatGroup,
  StatRow,
  PortSummaryEntry,
  ammoDamage,
  categorizePort,
  cleanLocaleValue,
  curateComponentStats,
  flattenSpec,
  groupStatRows,
  humanizeClassName,
  formatCraftTime,
  formatNumber,
  humanizePortType,
  meaningfulRows,
  summarizePorts,
  unescapeText,
} from './codex-format';
import {
  EquippedStat,
  ammoClassNameFor,
  ammoClassNamesFor,
  damageChannelsOf,
  equippedStats,
  equippedTypeLabel,
  formatEquippedStat,
  isWeaponMountPort,
  weaponStatsUnavailable,
} from './codex-equipped-stats';
import {
  ShipModuleSection,
  classifyShipModule,
  isConfigurableSection,
  isIndividualSection,
  shipPortFamily,
} from './ship-module-sections';
import { SummaryOccupant, equippedMass } from './ship-summary-panels';
import { CodexCompareTrayComponent } from './codex-compare-tray.component';
import { CodexLoadoutSaveBarComponent } from './codex-loadout-save-bar.component';
import {
  CapabilityPort,
  MissionId,
  detectShipCapabilities,
  foldedSectionsFor,
  loadStoredMission,
  missionById,
  storeMission,
} from './codex-mission';
import {
  KpiCell,
  KpiShipInput,
  buildDefensivePanel,
  buildKpiCells,
  buildOffensivePanel,
  computeKpiSheet,
  crossSectionAxes,
  findArmorPayload,
} from './codex-loadout-stats';
import { CodexKpiBandComponent } from './codex-kpi-band.component';
import { CodexMissionBarComponent } from './codex-mission-bar.component';
import {
  CodexDefensivePanelComponent,
  CodexOffensivePanelComponent,
  CodexShipPanelComponent,
  ShipFactGroup,
} from './codex-analysis-panels.component';
import { carriedByPort, carriedSlots, stockLoadoutClassNames } from './stock-loadout';
import {
  CodexHardpointLayoutComponent,
  LayoutChild,
  LayoutSection,
  LayoutSlot,
  LayoutTarget,
  SectionNote,
} from './codex-hardpoint-layout.component';
import {
  CodexComponentModalComponent,
  ComponentInspectEntry,
} from './codex-component-modal.component';
import { CodexSwapPickerComponent, SwapPick, SwapTarget } from './codex-swap-picker.component';
import {
  DraftMap,
  EMPTY_DRAFT,
  HydrationEpoch,
  acceptedClassNames,
  beginHydration,
  changedCount as draftChangedCount,
  decodeDraftParam,
  deleteDraftPaths,
  encodeDraftParam,
  isNestedPath,
  mergeMapInto,
  mergeSavedLoadout,
  newHydrationEpoch,
  parseLocalDraft,
  restoreDraft,
  selectSaveableEntries,
  serializeLocalDraft,
  setDraftValueForPaths,
  topSegment,
  touchedTopPorts,
  LOCAL_DRAFT_STORAGE_KEY,
} from './codex-loadout-draft';
import { ShipHardpointMapComponent } from './ship-hardpoint-map.component';
import {
  HardpointFrame,
  HardpointMarker,
  HardpointMarkerInput,
  HardpointTransform,
  buildHardpointMarkers,
  readHardpointFrame,
  readHardpointTransforms,
} from './hardpoint-map';
import { HardpointPortRef, ShipSkinViewerComponent } from './ship-skin-viewer.component';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipLinkService } from './ship-link.service';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { BuyOption, UexShopService } from './uex-shop.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NeuroFieldDirective } from '../core/neuro-field.directive';

// Lazy-loaded compatible-items state per hardpoint (keyed by port_index).
interface PortCompat {
  loading: boolean;
  error: string | null;
  items: CompatibleItem[];
}

// A compact hero fact chip (manufacturer, role, crew, size, …).
interface Fact {
  label: string;
  value: string;
  accent?: boolean;
}

// Hardpoints grouped by functional category for display.
interface PortGroup {
  category: HardpointCategory;
  ports: CodexItemPort[];
}

// Tech spec facts derived from the stock loadout's component payloads (#137):
// quantum drive numbers plus summed hydrogen / quantum fuel tank capacities.
interface ShipTechStats {
  quantum: QuantumStats;
  quantumDriveClassName: string | null;
  hydrogenCapacity: number | null;
  quantumFuelCapacity: number | null;
}

interface LoadoutItem {
  port: string;
  className: string | null;
  kind: CodexKind | null;
  name: string | null; // friendly name (falls back to className)
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  /**
   * Sub-port name → the class the stock loadout installs there, for the item on
   * THIS hardpoint. Empty when the extract carries no nested fit for it.
   */
  carried: ReadonlyMap<string, string>;
}
interface LoadoutGroup {
  category: HardpointCategory;
  items: LoadoutItem[];
}

// One row of the hull / dimensions block. `value === null` renders "—": the
// ship HAS the property, this extract just does not carry it (admin request
// 461288f9: never show nothing).
interface HullFact {
  labelKey: string;
  value: string | null;
}

// What an occupied hardpoint proves about the bay it sits in (see portFitIndex).
interface PortFit {
  attachType: string;
  size: number | null;
}

// What may go into an UNFITTED hardpoint, and where that answer came from.
interface EmptyFit {
  types: string[];
  size: number | null;
  /** true = borrowed from an identical fitted bay, not read off this port. */
  inferred: boolean;
}

// Engine placeholders that identify no attach type — never build a fit on them.
const PLACEHOLDER_ATTACH_TYPE = new Set(['undefined', 'unknown', 'none', 'other']);

// The recipe that PRODUCES this entity (#187: "which materials do I need").
interface GearRecipe {
  classNameSlug: string;
  craftTimeSec: number | null;
  ingredients: CodexBlueprintIngredient[];
}

@Component({
  selector: 'sc-codex-detail',
  standalone: true,
  imports: [NeuroFieldDirective, RouterLink, TranslateModule, CodexCompareTrayComponent, CodexHardpointLayoutComponent, CodexComponentModalComponent, CodexSwapPickerComponent, ShipHardpointMapComponent, ShipSkinViewerComponent, CodexCategoryIconComponent, FallbackImageComponent, CodexLoadoutSaveBarComponent, CodexKpiBandComponent, CodexMissionBarComponent, CodexOffensivePanelComponent, CodexDefensivePanelComponent, CodexShipPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <a class="back" routerLink="/codex">← {{ 'codex.detail.back' | translate }}</a>

      @if (loading()) {
        <div class="sc-card skel-card sc-skel-field" scNeuroField></div>
      } @else if (error(); as err) {
        <div class="sc-card err"><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err }}</div>
      } @else if (!detail()) {
        <div class="sc-card empty">{{ 'codex.detail.notFound' | translate }}</div>
      } @else {
        <!-- ── Hero (ships get the dim Bay scene — P2 frame, same content) ── -->
        <header class="hero sc-card" [class.bay]="kind() === 'ship'">
          <figure class="hero-art" [class.icon-only]="heroArt().length === 0">
            <div class="art">
              <sc-fallback-image [candidates]="heroArt()" [alt]="displayName()" [eager]="true">
                <span class="art-fallback">
                  <sc-codex-icon class="hero-icon" [kind]="detail()!.kind" [sub]="heroSub()" />
                  @if (kind() === 'ship') {
                    <span class="art-note">{{ 'codex.detail.noArtwork' | translate }}</span>
                  }
                </span>
              </sc-fallback-image>
            </div>
          </figure>
          <div class="hero-body">
            <span class="kind-tag">{{ ('codex.kindSingular.' + detail()!.kind) | translate }}</span>
            <h1>{{ displayName() }}</h1>
            @if (manufacturerName(); as mfr) { <p class="mfr">{{ mfr }}</p> }
            <code class="cls">{{ detail()!.classNameSlug }}</code>

            @if (facts().length > 0) {
              <ul class="facts">
                @for (f of facts(); track f.label) {
                  <li class="fact" [class.accent]="f.accent">
                    <span class="f-label">{{ f.label }}</span>
                    <span class="f-value">{{ f.value }}</span>
                  </li>
                }
              </ul>
            }

            @if (portSummary().length > 0) {
              <ul class="loadout-summary" [attr.aria-label]="'codex.detail.equipment' | translate">
                @for (s of portSummary(); track s.category) {
                  <li class="ls-item" [attr.data-cat]="s.category">
                    <span class="ls-count">{{ s.count }}</span>
                    <span class="ls-cat">{{ ('codex.portCategory.' + s.category) | translate }}</span>
                  </li>
                }
              </ul>
            }

            <div class="hero-actions">
              <button type="button" class="pin" [class.pinned]="isPinned()" (click)="togglePin()">
                {{ isPinned() ? '★' : '☆' }} {{ (isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
              </button>
              @if (kind() === 'ship') {
                @if (inHangar()) {
                  <button type="button" class="pin add-hangar" (click)="configureLoadout()">
                    {{ 'codex.detail.configureLoadout' | translate }}
                  </button>
                } @else {
                  <button type="button" class="pin add-hangar" (click)="addToHangar()">
                    {{ 'quickSearch.addToHangar' | translate }}
                  </button>
                }
                <!-- Deep-link out to the official RSI site. We have no reliable
                     per-ship RSI slug (our classNameSlug ≠ RSI URL slug), so
                     without a pinned link this lands on the official ships
                     listing (admin-chosen target: name-sorted) rather than
                     404-ing on a guessed deeplink. Users can pin the real
                     pledge page themselves (feedback f7d3bd9a) — that value is
                     attacker-controlled, so it is bound with [href] on a plain
                     anchor and nothing else: no innerHTML, no LLM prompt. -->
                @if (pledgeLink(); as pledge) {
                  <a
                    class="pin rsi-link"
                    [href]="pledge"
                    target="_blank"
                    rel="noopener noreferrer nofollow">
                    {{ 'codex.detail.viewOnRsi' | translate }} ↗
                  </a>
                } @else {
                  <a
                    class="pin rsi-link"
                    href="https://robertsspaceindustries.com/en/pledge/ships?sortField=name&sortDirection=asc"
                    target="_blank"
                    rel="noopener noreferrer">
                    {{ 'codex.detail.viewOnRsi' | translate }} ↗
                  </a>
                }
                @if (auth.user()) {
                  <button type="button" class="raw-toggle" (click)="toggleLinkForm()">
                    {{ (myPledgeLink() ? 'codex.shipLink.edit' : 'codex.shipLink.add') | translate }}
                  </button>
                }
              }
              @if (provenance(); as p) {
                <span class="prov" [attr.title]="'codex.provenance.tooltip' | translate">
                  {{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}
                </span>
              }
            </div>

            <!-- Pin your own RSI pledge link (feedback f7d3bd9a). Private to
                 you; an admin can publish one for everyone, never automatic. -->
            @if (kind() === 'ship' && showLinkForm()) {
              <form class="ship-link-form" (submit)="saveShipLink($event)">
                <p class="sl-hint">{{ 'codex.shipLink.hint' | translate }}</p>
                <div class="sl-row">
                  <input
                    type="url"
                    class="sl-input"
                    [value]="shipLinkInput()"
                    (input)="onShipLinkInput($event)"
                    [attr.placeholder]="'codex.shipLink.placeholder' | translate"
                    [attr.aria-label]="'codex.shipLink.label' | translate"
                    [attr.aria-invalid]="shipLinkError() ? 'true' : null" />
                  <button type="submit" class="pin" [disabled]="shipLinks.saving()">
                    {{ 'codex.shipLink.save' | translate }}
                  </button>
                  @if (myPledgeLink()) {
                    <button type="button" class="raw-toggle" [disabled]="shipLinks.saving()"
                            (click)="removeShipLink()">
                      {{ 'codex.shipLink.remove' | translate }}
                    </button>
                  }
                  <button type="button" class="raw-toggle" (click)="toggleLinkForm()">
                    {{ 'codex.shipLink.cancel' | translate }}
                  </button>
                </div>
                @if (shipLinkError(); as errKey) {
                  <p class="sl-error" role="alert">
                    {{ ('codex.shipLink.error.' + errKey) | translate }}
                  </p>
                }
                @if (shipLinkSaved()) {
                  <p class="sl-ok" role="status">{{ 'codex.shipLink.saved' | translate }}</p>
                }
                @if (role.isAdmin()) {
                  <div class="sl-admin">
                    <span class="sl-admin-tag">{{ 'codex.shipLink.adminTitle' | translate }}</span>
                    <button type="button" class="raw-toggle" [disabled]="shipLinks.saving()"
                            (click)="promoteShipLink()">
                      {{ 'codex.shipLink.promote' | translate }}
                    </button>
                    @if (globalPledgeLink()) {
                      <button type="button" class="raw-toggle" [disabled]="shipLinks.saving()"
                              (click)="unpromoteShipLink()">
                        {{ 'codex.shipLink.unpromote' | translate }}
                      </button>
                    }
                    <span class="sl-admin-hint">{{ 'codex.shipLink.adminHint' | translate }}</span>
                  </div>
                }
              </form>
            }
          </div>
        </header>

        <!-- ── Ship liveries — always-on 3D view at hero level (#137 part 2) ──
             Moved directly beneath the hero so the interactive 3D model stays
             on-screen (RSI-site feel) instead of being buried below the spec
             sheet. The viewer itself keeps its deliberate lazy-load: expanded
             by default on desktop (the ~3 MB glb loads immediately), collapsed
             by default on mobile (opened on demand to spare cellular data).
             Comparison is intentionally NOT duplicated here — the existing
             floating compare tray (<sc-codex-compare-tray/>, pinned via the hero
             ★ action) is the single comparison surface. -->
        @if (shipClassName(); as cls) {
          <sc-ship-skin-viewer
            [shipId]="cls"
            [hardpointPorts]="hardpointPortRefs()"
            [activePorts]="activePorts()"
            (hovered)="setActivePorts($event)"
            (locatable)="glbLocatablePorts.set($event)" />
        }

        <!-- ── Description ───────────────────────────────────────── -->
        @if (description(); as d) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ d }}</p>
          </section>
        }

        <!-- ── Where to buy (#254/#255): UEX Corp purchase locations for FPS
             armor pieces and personal weapons. Best-effort — the section only
             appears for the relevant kinds and quietly shows "no data" rather
             than an error state for anything unmatched. ───────────────── -->
        @if (kind() === 'item' || kind() === 'weapon') {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.whereToBuy' | translate }}</h2>
            @if (buyLoading()) {
              <p class="muted">{{ 'codex.detail.whereToBuyLoading' | translate }}</p>
            } @else if (buyError()) {
              <p class="err-inline">{{ 'codex.detail.whereToBuyError' | translate }}</p>
            } @else if (buyOptions().length === 0) {
              <p class="muted">{{ 'codex.detail.whereToBuyEmpty' | translate }}</p>
            } @else {
              <table class="buy-table">
                <thead>
                  <tr>
                    <th>{{ 'codex.detail.whereToBuyPrice' | translate }}</th>
                    <th>{{ 'codex.detail.whereToBuyTerminal' | translate }}</th>
                    <th>{{ 'codex.detail.whereToBuyLocation' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (opt of buyOptions(); track opt.terminal + opt.price) {
                    <tr>
                      <td class="buy-price">{{ fmt(opt.price) }} aUEC</td>
                      <td>{{ opt.terminal }}</td>
                      <td class="muted">{{ opt.location }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            }
            <p class="hint buy-attribution">{{ 'codex.detail.whereToBuyAttribution' | translate }}</p>
          </section>
        }

        <!-- ── Ammunition: damage + ballistics ───────────────────── -->
        @if (damage().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.damage' | translate }}</h2>
            <div class="dmg-list">
              @for (row of damage(); track row.channel) {
                <div class="dmg" [attr.data-ch]="row.channel">
                  <span class="dmg-label">{{ ('codex.damage.' + row.channel) | translate }}</span>
                  <span class="dmg-bar"><span class="dmg-fill" [style.width.%]="damagePct(row)"></span></span>
                  <span class="dmg-val">{{ fmt(row.value) }}</span>
                </div>
              }
            </div>
          </section>
        }

        <!-- ── Component key stats, grouped by purpose ───────────── -->
        @if (componentStatGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.keyStats' | translate }}</h2>
            @for (g of componentStatGroups(); track g.purpose) {
              @if (showStatGroupHeaders(componentStatGroups())) {
                <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
              }
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Weapon parameters, grouped by purpose ─────────────── -->
        @if (weaponParamGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.weaponParams' | translate }}</h2>
            @for (g of weaponParamGroups(); track g.purpose) {
              @if (showStatGroupHeaders(weaponParamGroups())) {
                <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
              }
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Armor / undersuit stats, grouped by purpose ───────── -->
        @if (armorStatGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.armorStats' | translate }}</h2>
            @for (g of armorStatGroups(); track g.purpose) {
              @if (showStatGroupHeaders(armorStatGroups())) {
                <h3 class="sg-head" [attr.data-purpose]="g.purpose">{{ ('codex.statGroup.' + g.purpose) | translate }}</h3>
              }
              <div class="stat-grid">
                @for (s of g.rows; track s.key) {
                  <div class="stat"><span class="s-label">{{ s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Ships: KPI band + mission bar (PR C) ─────────────────
             Six headline numbers for the active mission, plus the profile
             chips that reorder/fold the loadout and analysis columns below.
             Supersedes the old three-panel "Kampfübersicht" (461288f9) — the
             new analysis column says the same things without duplicating
             the page. ───────────────────────────────────────────── -->
        @if (kind() === 'ship') {
          <sc-codex-kpi-band [cells]="kpiCells()" />
          <sc-codex-mission-bar
            [active]="activeMissionId()"
            [capabilities]="shipCapabilities()"
            (missionChange)="setMission($event)" />
        }

        <!-- ── Ships: hull, size and flight characteristics ────────
             Every row is rendered even when the value is absent, so the block
             answers "does the catalog know this?" rather than silently
             shrinking. ──────────────────────────────────────────── -->
        @if (hullFacts().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.hull.title' | translate }}</h2>
            <dl class="hull-grid">
              @for (f of hullFacts(); track f.labelKey) {
                <div class="hull-fact" [class.unknown]="!f.value">
                  <dt>{{ f.labelKey | translate }}</dt>
                  <dd>{{ f.value ?? '—' }}</dd>
                </div>
              }
            </dl>
            @if (flightDataMissing()) {
              <p class="hint warn">{{ 'codex.hull.flightMissing' | translate }}</p>
            }
          </section>
        }

        <!-- ── Loadout | Analyse: two-column split (PR C, 02-handover §2) ── -->
        <div class="analysis-grid" [class.single]="kind() !== 'ship'">
          <!-- ── Ship modules, configurable blocks first (461288f9), now
               mission-ordered/folded (PR C) ── -->
          @if (moduleSections().length > 0) {
            <section class="sc-card block">
              <h2>
                {{ 'codex.detail.loadout' | translate }}
                <span class="ct">{{ installedCount() }}</span>
                @if (hiddenEmptyCount() > 0) {
                  <button type="button" class="ghost-toggle" (click)="toggleEmptyLoadout()">
                    {{ (showEmptyLoadout() ? 'codex.detail.hideEmptyPorts' : 'codex.detail.showEmptyPorts') | translate: { count: hiddenEmptyCount() } }}
                  </button>
                }
              </h2>
              <!-- "What even IS a hardpoint?" — answered up front, once. -->
              <p class="hint">{{ 'codex.detail.hardpointExplainer' | translate }}</p>
              <p class="hint">{{ 'codex.detail.moduleOrderHint' | translate }}</p>
              <sc-codex-loadout-save-bar
                [changed]="draftChangedCount()"
                [saveable]="saveableEntries().length"
                [saving]="saving()"
                [error]="saveError()"
                [inHangar]="inHangar()"
                (save)="saveLoadoutDraft()"
                (discard)="discardLoadoutDraft()"
                (addAndSave)="saveLoadoutDraft()" />
              <!-- The "no stock guns in this extract" disclosure used to sit here,
                   far above the block it is about. It now rides on the Weapons
                   section itself (1add86a4) — see moduleSections below. -->
              <!-- WHERE each hardpoint sits on the hull (#137 part 3). Rendered
                   only when this ship's extract carries coordinates; every ship
                   without them keeps exactly the previous list-only layout. -->
              @if (hardpointFrame(); as frame) {
                <sc-ship-hardpoint-map
                  [markers]="hardpointMarkers()"
                  [frame]="frame"
                  [activePorts]="activePorts()"
                  (hovered)="setActivePorts($event)" />
              }
              <sc-codex-hardpoint-layout
                [sections]="moduleSections()"
                [sectionOrder]="moduleSectionOrder()"
                [foldedSections]="foldedModuleSections()"
                [locatablePorts]="locatablePorts()"
                [activePorts]="activePorts()"
                (reverted)="onRevertPaths($event)"
                (hovered)="setActivePorts($event)"
                (inspected)="openInspect($event)"
                (swapRequested)="openSwapPicker($event)" />
            </section>
          }

          <!-- ── Analyse: offensive / defensive / ship facts (PR C) ── -->
          @if (kind() === 'ship') {
            <div class="analysis-col">
              <sc-codex-offensive-panel [panel]="offensivePanel()" [startCollapsed]="offensiveStartsCollapsed()" />
              <sc-codex-defensive-panel [panel]="defensivePanel()" />
              <sc-codex-ship-panel [groups]="shipFactGroups()" />
            </div>
          }
        </div>

        <!-- ── Hardpoints, grouped by category ───────────────────── -->
        @if (hardpointGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ detail()!.ports.length }}</span></h2>
            <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
            <!-- The hull map lives with the loadout list when there is one; a
                 ship with only structural ports gets it here instead, so it is
                 never shown twice and never withheld. -->
            @if (!hasLoadoutSection() && hardpointFrame(); as frame) {
              <sc-ship-hardpoint-map
                [markers]="hardpointMarkers()"
                [frame]="frame"
                [activePorts]="activePorts()"
                (hovered)="setActivePorts($event)" />
            }
            @for (g of hardpointGroups(); track g.category) {
              <div class="hp-group">
                <h3 class="hp-cat">
                  {{ ('codex.portCategory.' + g.category) | translate }}
                  <span class="hp-ct">{{ g.ports.length }}</span>
                </h3>
                <ul class="hp-list">
                  @for (port of g.ports; track port.portIndex) {
                    <li class="hp" [class.expandable]="port.types.length > 0" [class.open]="expandedPort() === port.portIndex"
                        [class.located]="isPortLocated(port)" [class.on]="isPortActive(port)"
                        (mouseenter)="hoverPort(port)" (mouseleave)="setActivePorts(null)">
                      <button type="button" class="hp-head" (click)="togglePort(port)" [disabled]="port.types.length === 0">
                        <span class="hp-caret">{{ port.types.length ? (expandedPort() === port.portIndex ? '▾' : '▸') : '·' }}</span>
                        <span class="hp-name">{{ humanizePort(port.portName) }}</span>
                        <span class="hp-meta">
                          <span class="hp-size">{{ sizeRange(port.minSize, port.maxSize) }}</span>
                          @for (t of port.types; track t) { <span class="chip">{{ humanizeType(t) }}</span> }
                        </span>
                      </button>
                      @if (expandedPort() === port.portIndex) {
                        <div class="compat">
                          @if (compat(port.portIndex); as c) {
                            @if (c.loading) {
                              <span class="muted">{{ 'codex.detail.compatLoading' | translate }}</span>
                            } @else if (c.error) {
                              <span class="err-inline">{{ c.error }}</span>
                            } @else if (c.items.length === 0) {
                              <span class="muted">{{ 'codex.detail.compatNone' | translate }}</span>
                            } @else {
                              <div class="compat-head">{{ 'codex.detail.compatCount' | translate: { count: c.items.length } }}</div>
                              <ul class="compat-list">
                                @for (it of c.items; track it.kind + it.classNameSlug) {
                                  <li>
                                    <a class="compat-link" [routerLink]="['/codex', it.kind, it.classNameSlug]">
                                      {{ it.nameLocalized || it.classNameSlug }}
                                    </a>
                                    <span class="compat-meta">
                                      @if (it.size != null) { <span class="chip">S{{ it.size }}</span> }
                                      @if (it.grade) { <span class="chip">{{ it.grade }}</span> }
                                      @if (it.manufacturerCode) { <span class="chip">{{ it.manufacturerCode }}</span> }
                                    </span>
                                  </li>
                                }
                              </ul>
                            }
                          }
                        </div>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          </section>
        }

        <!-- ── Crafting recipe: what this item costs to make (#187) ─ -->
        @if (recipe(); as r) {
          <section class="sc-card block">
            <h2>
              {{ 'codex.detail.craftedFrom' | translate }}
              @if (r.craftTimeSec != null) { <span class="ct">{{ fmtCraft(r.craftTimeSec) }}</span> }
            </h2>
            <p class="hint">{{ 'codex.detail.craftedFromHint' | translate }}</p>
            @if (r.ingredients.length > 0) {
              <ul class="compat-list">
                @for (i of r.ingredients; track i.ingredientIndex) {
                  <li>
                    <span class="compat-link plain">{{ ingredientName(i) }}</span>
                    <span class="compat-meta">
                      @if (i.role) { <span class="chip subtle">{{ i.role }}</span> }
                      @if (i.quantity != null) { <span class="chip">{{ fmt(i.quantity) }} SCU</span> }
                      @if (i.minQuality) { <span class="chip subtle">{{ 'codex.detail.minQuality' | translate: { value: i.minQuality } }}</span> }
                    </span>
                  </li>
                }
              </ul>
            } @else {
              <p class="muted">{{ 'codex.detail.noIngredients' | translate }}</p>
            }
            <a class="compat-link" [routerLink]="['/codex', 'blueprint', r.classNameSlug]">
              {{ 'codex.detail.openBlueprint' | translate }}
            </a>
          </section>
        }

        <!-- ── Used in crafting blueprints (reverse ingredient lookup) ─ -->
        @if (usedInBlueprints().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.usedInBlueprints' | translate }} <span class="ct">{{ usedInBlueprints().length }}</span></h2>
            <p class="hint">{{ 'codex.detail.usedInBlueprintsHint' | translate }}</p>
            <ul class="compat-list">
              @for (b of usedInBlueprints(); track b.classNameSlug) {
                <li>
                  <a class="compat-link" [routerLink]="['/codex', 'blueprint', b.classNameSlug]">
                    {{ b.nameLocalized || humanizeName(b.classNameSlug) }}
                  </a>
                  <span class="compat-meta">
                    @if (b.tier != null) { <span class="chip">T{{ b.tier }}</span> }
                    @if (b.craftTimeSec != null) { <span class="chip">{{ fmtCraft(b.craftTimeSec) }}</span> }
                  </span>
                </li>
              }
            </ul>
          </section>
        }

        <!-- ── Full spec sheet (Manifest, collapsed) + raw payload ── -->
        <section class="sc-card block raw-block">
          <div class="spec-toggles">
            @if (specSections().length > 0) {
              <button type="button" class="raw-toggle" (click)="toggleSpec()">
                {{ (showSpec() ? 'codex.detail.hideFullSpec' : 'codex.detail.showFullSpec') | translate }}
              </button>
            }
            <button type="button" class="raw-toggle" (click)="toggleRaw()">
              {{ (showRaw() ? 'codex.detail.hideRaw' : 'codex.detail.showRaw') | translate }}
            </button>
          </div>
          @if (showSpec()) {
            <div class="spec">
              @for (sec of specSections(); track sec.title) {
                @if (sec.title) { <h3 class="sg-head">{{ sec.title }}</h3> }
                <table class="spec-table">
                  <tbody>
                    @for (r of sec.rows; track r.key) {
                      <tr>
                        <td class="sp-key">{{ r.key }}</td>
                        <td class="sp-val">{{ r.value }}@if (r.unit) {<span class="s-unit"> {{ r.unit }}</span>}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
              @if (provenance(); as p) {
                <p class="spec-prov">{{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}</p>
              }
            </div>
          }
          @if (showRaw()) { <pre class="raw">{{ rawJson() }}</pre> }
        </section>
      }

      <sc-codex-compare-tray />

      <!-- Full stat sheet for one clicked module (461288f9). Rendered last so
           its fixed-position backdrop sits above everything on the page. -->
      <sc-codex-component-modal [entry]="inspected()" (closed)="closeInspect()" />
      <sc-codex-swap-picker [target]="swapTarget()" (closed)="swapTarget.set(null)" (picked)="onSwapPicked($event)" />
    </section>
  `,
  styles: [`
    :host { display: block; }
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 90px; }
    .back { font-size: 0.82rem; color: var(--sc-accent); text-decoration: none; align-self: flex-start; }
    .back:hover { text-decoration: underline; }

    /* Hero */
    .hero { display: grid; grid-template-columns: minmax(200px, 320px) 1fr; gap: 22px; padding: 0; overflow: hidden; }
    /* sc-fallback-image owns the <img>, so its sizing crosses the style
       boundary as custom properties (it is display:contents — a transform on
       it would do nothing, hence the .art wrapper carries the bay drift). */
    .hero-art { margin: 0; display: flex; align-items: center; justify-content: center; min-height: 240px;
      --sc-img-max-h: 320px;
      --sc-img-shadow: drop-shadow(0 6px 24px rgba(0,0,0,0.55));
      --sc-icon-max: 132px;
      background: radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--sc-accent) 12%, var(--sc-bg-1)), var(--sc-bg-0)); }
    .hero-art.icon-only { background: radial-gradient(circle at 50% 40%, var(--sc-bg-2), var(--sc-bg-0)); }
    .hero-art .art { flex: 1 1 auto; align-self: stretch; min-width: 0;
      display: flex; align-items: center; justify-content: center; }
    /* Bay scene (ships): dim hangar light + rim glow around the hull. The
       frame gets atmospheric — every number stays on the calm right side. */
    .hero.bay .hero-art {
      background:
        radial-gradient(ellipse at 50% 62%, color-mix(in srgb, var(--sc-accent) 17%, #05080d), #04060a 78%);
      border-right: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent);
      --sc-img-shadow: drop-shadow(0 12px 34px rgba(0,0,0,0.72))
                       drop-shadow(0 0 22px color-mix(in srgb, var(--sc-accent) 28%, transparent)); }
    @media (prefers-reduced-motion: no-preference) {
      .hero.bay .hero-art:not(.icon-only) .art { animation: bay-drift 6s ease-in-out infinite alternate; }
      @keyframes bay-drift { from { transform: translateY(-3px); } to { transform: translateY(3px); } }
    }
    /* No artwork anywhere: say so instead of leaving a lost glyph in a big
       empty frame — the catalog simply has no render for this hull yet. */
    .hero-art .art-fallback { display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 10px; width: 100%; padding: 14px; box-sizing: border-box; }
    .hero-art .art-note { font-size: max(0.72rem, var(--sc-fs-floor)); line-height: 1.35; text-align: center;
      color: var(--sc-fg-2); max-width: 24ch; text-wrap: balance; }
    .hero-art .hero-icon { width: 100%; min-height: 120px; }
    .hero-body { padding: 22px 24px 22px 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .kind-tag { align-self: flex-start; font-size: max(0.64rem, var(--sc-fs-floor)); padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.1em;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); color: var(--sc-accent); }
    .hero-body h1 { margin: 2px 0 0; font-size: 1.7rem; line-height: 1.15; overflow-wrap: anywhere; }
    .hero-body .mfr { margin: 0; color: var(--sc-fg-1); font-size: 0.96rem; overflow-wrap: anywhere; }
    .hero-body .cls { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); overflow-wrap: anywhere; }

    .facts { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .fact { display: flex; flex-direction: column; gap: 1px; padding: 6px 12px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .fact.accent { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .f-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .f-value { font-size: 0.9rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
    .fact.accent .f-value { color: var(--sc-accent); }

    .loadout-summary { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .ls-item { display: inline-flex; align-items: baseline; gap: 5px; padding: 5px 11px; border-radius: 999px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .ls-count { font-family: var(--sc-font-display); font-size: 0.95rem; color: var(--sc-fg-0); }
    .ls-cat { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); }
    .ls-item[data-cat="weapons"] { border-color: color-mix(in srgb, var(--sc-accent-hot, #ff7a45) 45%, transparent); }
    .ls-item[data-cat="weapons"] .ls-count { color: var(--sc-accent-hot, #ff7a45); }
    .ls-item[data-cat="missiles"] { border-color: color-mix(in srgb, #ff5252 45%, transparent); }
    .ls-item[data-cat="defense"] { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }

    .hero-actions { display: flex; align-items: center; gap: 14px; margin-top: auto; padding-top: 12px; flex-wrap: wrap; }
    .pin { padding: 8px 16px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-1);
      font-family: var(--sc-font-display); font-size: max(0.74rem, var(--sc-fs-floor)); letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer; }
    .pin:hover, .pin.pinned { color: var(--sc-accent); border-color: var(--sc-accent); }
    .add-hangar { color: var(--sc-accent); }
    a.rsi-link { display: inline-flex; align-items: center; gap: 4px; text-decoration: none; }

    .ship-link-form { margin-top: 14px; padding: 12px 14px; border-radius: 8px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
    .sl-hint { margin: 0 0 8px; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .sl-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .sl-input { flex: 1 1 320px; min-width: 0; padding: 8px 12px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); color: var(--sc-fg-0); font-family: inherit; font-size: 0.82rem; }
    .sl-input:focus { outline: none; border-color: var(--sc-accent); }
    .sl-input[aria-invalid='true'] { border-color: var(--sc-danger); }
    .sl-error { margin: 8px 0 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-danger); }
    .sl-ok { margin: 8px 0 0; font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-accent); }
    .sl-admin { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--sc-border); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .sl-admin-tag { font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
    .sl-admin-hint { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); flex: 1 1 220px; }
    .in-hangar { font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .prov { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }

    /* Generic block */
    .block { padding: 16px 18px; }
    .block h2 { margin: 0 0 12px; font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .block h2 .ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .desc { margin: 0; color: var(--sc-fg-1); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }

    /* Damage · Defence · Power Management — the three headline panels */
    .sum-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .sum-panel { border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      border-top-width: 2px; padding: 10px 12px; }
    .sum-panel[data-panel="damage"] { border-top-color: var(--sc-accent-hot, #ff7a45); }
    .sum-panel[data-panel="defence"] { border-top-color: var(--sc-accent); }
    .sum-panel[data-panel="power"] { border-top-color: #ffc14d; }
    .sum-panel h3 { margin: 0 0 8px; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.07em; color: var(--sc-fg-1); }
    .sum-rows { margin: 0; display: flex; flex-direction: column; gap: 3px; }
    .sum-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    .sum-row dt { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .sum-row dd { margin: 0; font-size: 0.88rem; color: var(--sc-fg-0);
      font-family: var(--sc-font-display); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sum-row .derived { color: var(--sc-fg-2); cursor: help; }
    .sum-empty { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .sum-gap { margin: 8px 0 0; font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); line-height: 1.4; }

    /* Hull, size and flight — a row per property, "—" when unknown */
    .hull-grid { margin: 0; display: grid; gap: 8px;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); }
    .hull-fact { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px;
      border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .hull-fact dt { font-size: max(0.63rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--sc-fg-2); }
    .hull-fact dd { margin: 0; font-size: 0.95rem; color: var(--sc-fg-0);
      font-family: var(--sc-font-display); }
    .hull-fact.unknown { border-style: dashed; }
    .hull-fact.unknown dd { color: var(--sc-fg-2); }

    /* Stat grid (components / weapons), grouped by purpose */
    .sg-head { margin: 14px 0 8px; font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; gap: 8px; }
    .sg-head::after { content: ''; flex: 1; height: 1px; background: var(--sc-border); }
    .sg-head:first-of-type { margin-top: 0; }
    .sg-head[data-purpose="offense"] { color: var(--sc-accent-hot, #ff7a45); }
    .sg-head[data-purpose="defense"] { color: var(--sc-accent); }
    .stat-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .stat-grid + .sg-head { margin-top: 14px; }
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .s-label { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); }
    .s-value { font-size: 1.05rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
    .s-unit { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: system-ui, sans-serif; }

    /* Where to buy */
    .buy-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
    .buy-table th { text-align: left; padding: 6px 10px; font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--sc-fg-2); border-bottom: 1px solid var(--sc-border); }
    .buy-table td { padding: 7px 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .buy-price { color: var(--sc-accent); font-family: var(--sc-font-display); white-space: nowrap; }
    .buy-attribution { margin: 10px 0 0; font-style: italic; }

    /* Damage bars */
    .dmg-list { display: flex; flex-direction: column; gap: 8px; }
    .dmg { display: grid; grid-template-columns: 96px 1fr 64px; align-items: center; gap: 10px; }
    .dmg-label { font-size: max(0.76rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
    .dmg-bar { height: 8px; border-radius: 999px; background: var(--sc-bg-2); overflow: hidden; }
    .dmg-fill { display: block; height: 100%; border-radius: 999px; background: var(--sc-accent); }
    .dmg[data-ch="energy"] .dmg-fill { background: var(--sc-accent); }
    .dmg[data-ch="physical"] .dmg-fill { background: var(--sc-accent-hot, #ff7a45); }
    .dmg[data-ch="thermal"] .dmg-fill { background: #ff5252; }
    .dmg[data-ch="distortion"] .dmg-fill { background: #a674ff; }
    .dmg[data-ch="biochemical"] .dmg-fill { background: #5fd35f; }
    .dmg[data-ch="stun"] .dmg-fill { background: #f0c419; }
    .dmg-val { font-size: 0.84rem; text-align: right; color: var(--sc-fg-0); font-family: var(--sc-font-display); }

    /* Hardpoint / loadout groups */
    .hp-group { margin-top: 12px; }
    .hp-group:first-of-type { margin-top: 0; }
    .hp-cat { margin: 0 0 6px; font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-1);
      display: flex; align-items: center; gap: 6px; }
    .hp-cat .hp-ct { font-size: max(0.64rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .hp-list, .ld-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }

    .hp { border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); overflow: hidden; }
    .hp.open { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    /* A port whose position on the hull is known gets a locator rail; hovering
       it lights up its marker on the hull map (and vice versa). Ports without
       coordinates look exactly as they did before. */
    .hp.located { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .hp.located.on { border-left-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-1)); }
    .hp-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: transparent; border: none;
      color: inherit; font: inherit; text-align: left; cursor: default; }
    .hp.expandable .hp-head { cursor: pointer; }
    .hp.expandable .hp-head:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .hp-caret { width: 14px; color: var(--sc-fg-2); flex: 0 0 auto; }
    .hp.open .hp-caret { color: var(--sc-accent); }
    .hp-name { font-size: 0.82rem; color: var(--sc-fg-0); flex: 1 1 auto; overflow-wrap: anywhere; }
    .hp-meta { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; flex: 0 1 auto; }
    .hp-size { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .compat { padding: 4px 12px 12px 34px; background: var(--sc-bg-0); }

    .chip { font-size: max(0.62rem, var(--sc-fs-floor)); padding: 1px 6px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-fg-2); border: 1px solid var(--sc-border); white-space: nowrap; }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.82rem; }
    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: max(0.74rem, var(--sc-fs-floor)); }
    /* Data-gap disclosure: visible enough to be read, quiet enough not to
       look like an app error — the data is missing, nothing is broken. */
    .hint.warn { border-left: 2px solid color-mix(in srgb, var(--sc-warn, #e8a33d) 60%, transparent);
      padding-left: 8px; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }
    .compat-head { color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; margin: 4px 0 8px; }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
    .compat-link:hover { text-decoration: underline; }
    /* A raw resource has no codex page of its own, so it is listed as plain
       text — a dead link would be worse than no link. */
    .compat-link.plain { color: var(--sc-fg-0); }
    .compat-link.plain:hover { text-decoration: none; }
    .chip.subtle { background: transparent; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }

    .ghost-toggle { margin-left: auto; padding: 3px 10px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-family: inherit; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: 0; cursor: pointer; }
    .ghost-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    .raw-block { padding-top: 14px; }
    .spec-toggles { display: flex; gap: 8px; flex-wrap: wrap; }
    .raw-toggle { padding: 7px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border); color: var(--sc-fg-2); font-family: inherit; font-size: max(0.76rem, var(--sc-fs-floor)); cursor: pointer; }
    .raw-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .spec { margin-top: 12px; }
    .spec-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 4px; }
    .spec-table td { padding: 5px 10px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
    .sp-key { color: var(--sc-fg-2); width: 45%; overflow-wrap: anywhere; }
    .sp-val { color: var(--sc-fg-0); font-family: var(--sc-font-display); overflow-wrap: anywhere; }
    .spec-prov { margin: 10px 0 0; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .raw { margin: 12px 0 0; padding: 12px; border-radius: 6px; background: var(--sc-bg-0); border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-size: max(0.74rem, var(--sc-fs-floor)); overflow: auto; max-height: 460px; }

    .skel-card { height: 260px; }
    .err { color: var(--sc-danger); padding: 16px; }
    .empty { text-align: center; padding: 40px; color: var(--sc-fg-2); }

    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      .hero-art { min-height: 180px; }
      .hero-body { padding: 20px; }
      .dmg { grid-template-columns: 84px 1fr 56px; }
    }
    @media (max-width: 400px) {
      .hero-body { padding: 16px; }
      .hero-body h1 { font-size: 1.4rem; }
      .stat-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    }
  `],
})
export class CodexDetailComponent implements OnInit {
  private readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  // RSI ship-matrix artwork — the hero's primary art source for ships.
  private readonly rsi = inject(UpcomingShipsService);
  // User-supplied RSI pledge links (feedback f7d3bd9a) — public members because
  // the template reads `saving()` / `isAdmin()` / the signed-in user directly.
  readonly shipLinks = inject(ShipLinkService);
  readonly role = inject(RoleService);
  readonly auth = inject(AuthService);
  private readonly uexShop = inject(UexShopService);

  readonly detail = signal<CodexDetail | null>(null);
  readonly kind = computed(() => this.detail()?.kind ?? null);
  /** Ship pages only: whether this ship is already in the user's hangar. */
  readonly inHangar = computed(() => {
    const d = this.detail();
    return !!d && this.hangar.ships().some((s) => s.shipClassName === d.classNameSlug);
  });
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly showRaw = signal(false);
  readonly showEmptyLoadout = signal(false);

  // ── mission profiles / analysis column (PR C) ───────────────────────────────
  readonly activeMissionId = signal<MissionId>('all');
  readonly activeMission = computed(() => missionById(this.activeMissionId()));

  setMission(id: MissionId): void {
    this.activeMissionId.set(id);
    const d = this.detail();
    if (d) storeMission(d.classNameSlug, id);
  }

  // ── user-supplied RSI pledge link (feedback f7d3bd9a) ───────────────────────
  // The catalog has no dependable per-ship RSI store slug, so the user may pin
  // the real pledge page. Their link is PRIVATE (owner-only RLS); a globally
  // promoted link is admin-curated. Own link wins so a user's correction always
  // beats the catalog-wide one.
  readonly showLinkForm = signal(false);
  readonly shipLinkInput = signal('');
  /** i18n key suffix under `codex.shipLink.error.*`, or null. */
  readonly shipLinkError = signal<string | null>(null);
  readonly shipLinkSaved = signal(false);

  readonly myPledgeLink = computed(() => {
    const d = this.detail();
    return d ? (this.shipLinks.myLinks().get(d.classNameSlug) ?? null) : null;
  });
  readonly globalPledgeLink = computed(() => {
    const d = this.detail();
    return d ? (this.shipLinks.globalLinks().get(d.classNameSlug) ?? null) : null;
  });
  readonly pledgeLink = computed(() => this.myPledgeLink() ?? this.globalPledgeLink());

  // Reverse ingredient lookup: crafting blueprints that consume this entity.
  readonly usedInBlueprints = signal<BlueprintRef[]>([]);

  // "Where to buy" (#254/#255): UEX Corp purchase locations for FPS armor
  // pieces and personal weapons. Best-effort — never blocks/fails the page.
  readonly buyOptions = signal<BuyOption[]>([]);
  readonly buyLoading = signal(false);
  readonly buyError = signal(false);
  private buySeq = 0;

  // Forward crafting lookup (#187): the recipe that PRODUCES this item, so the
  // codex can answer "which materials does this cost". Null for the vast
  // majority of catalog entries, which are not craftable.
  readonly recipe = signal<GearRecipe | null>(null);

  // Hardpoint slot-compatibility: which port is expanded + its lazy item list.
  readonly expandedPort = signal<number | null>(null);
  private readonly compatMap = signal<Map<number, PortCompat>>(new Map());

  // Resolved localized values for raw @-keys (ship role, …).
  private readonly localeMap = signal<Map<string, string>>(new Map());

  // Resolved deep-link target + display fields for default-loadout entries.
  private readonly loadoutEntities = signal<Map<string, ResolvedEntity>>(new Map());

  // Full payloads of the stock-loadout occupants, plus the `<class>_AMMO`
  // projectile payloads for the guns among them. Together these back the
  // per-hardpoint stat readout (damage/velocity/range, shield HP/regen, …).
  private readonly loadoutPayloads = signal<Map<string, { kind: CodexKind; payload: unknown }>>(
    new Map(),
  );
  private readonly ammoPayloads = signal<Map<string, unknown>>(new Map());

  // ── loadout draft write path (PR B — 06-fallen.md) ─────────────────────────
  // Model per 03-rules §2.4: Map<rawPath, className|null>. `null` = emptied,
  // distinct from "absent" = unchanged. Only mutated through the pure helpers
  // in codex-loadout-draft.ts so the app/spec logic never drifts.
  readonly draft = signal<DraftMap>(EMPTY_DRAFT);
  /** Payloads for DRAFT-swapped classes — merged in, never a wholesale replace (R6). */
  private readonly draftPayloads = signal<Map<string, { kind: CodexKind; payload: unknown }>>(new Map());
  private readonly draftAmmoPayloads = signal<Map<string, unknown>>(new Map());
  private readonly draftResolved = signal<Map<string, ResolvedEntity>>(new Map());
  /** Classes currently being hydrated — rows render no numbers while pending (Falle 2). */
  private readonly pendingClasses = signal<ReadonlySet<string>>(new Set());
  /** Paths whose restored draft class does not resolve in the current build (R9). */
  private readonly unresolvableDraftPaths = signal<ReadonlySet<string>>(new Set());
  /** Paths whose current draft value is already reflected in the stored config. */
  private readonly savedPaths = signal<ReadonlySet<string>>(new Set());
  private readonly hydrationEpoch: HydrationEpoch = newHydrationEpoch();
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  // Ship tech stats derived from the stock loadout's component payloads (#137):
  // quantum range/speed + fuel capacities. Best-effort — null when unresolvable.
  private readonly techStats = signal<ShipTechStats | null>(null);

  // Star Citizen content exists in both DE and EN (DE is ~97.6% genuinely
  // translated, not an English copy). We render datamined CONTENT (names,
  // descriptions, manufacturer, role) in the app language with EN as the
  // guaranteed fallback, reacting to language switches. (UC-08)
  private readonly lang = signal<Lang>(toLang(this.t.currentLang || this.t.getDefaultLang()));

  constructor() {
    this.t.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe((e) => this.lang.set(toLang(e.lang)));
  }

  async ngOnInit(): Promise<void> {
    const kind = this.route.snapshot.paramMap.get('kind') as CodexKind | null;
    const className = this.route.snapshot.paramMap.get('className');
    if (!kind || !className) {
      this.error.set('Invalid route');
      this.loading.set(false);
      return;
    }
    // Deep links land here without ever touching the list, so the RSI art map
    // would otherwise be empty and every ship hero would fall back to the
    // datamined silhouette. `feed` is a signal — the hero repaints when it
    // lands, and a failed fetch is absorbed by the service.
    if (kind === 'ship') void this.rsi.ensureLoaded();
    await this.load(kind, className);
  }

  private async load(kind: CodexKind, className: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.expandedPort.set(null);
    this.compatMap.set(new Map());
    this.localeMap.set(new Map());
    this.techStats.set(null);
    this.loadoutPayloads.set(new Map());
    this.ammoPayloads.set(new Map());
    this.showEmptyLoadout.set(false);
    this.usedInBlueprints.set([]);
    this.recipe.set(null);
    this.swapTarget.set(null);
    this.showLinkForm.set(false);
    this.shipLinkInput.set('');
    this.shipLinkError.set(null);
    this.shipLinkSaved.set(false);
    this.buyOptions.set([]);
    this.buyLoading.set(false);
    this.buyError.set(false);
    this.draft.set(EMPTY_DRAFT);
    this.draftPayloads.set(new Map());
    this.draftAmmoPayloads.set(new Map());
    this.draftResolved.set(new Map());
    this.pendingClasses.set(new Set());
    this.unresolvableDraftPaths.set(new Set());
    this.savedPaths.set(new Set());
    this.saveError.set(null);
    this.activeMissionId.set('all');
    try {
      const d = await this.svc.getDetail(kind, className);
      this.detail.set(d);
      if (d) {
        await Promise.all([
          this.resolveLoadoutEntities(d),
          this.resolveLocale(d),
          this.resolveShipTech(d),
        ]);
        if (kind === 'ship') {
          this.activeMissionId.set(loadStoredMission(d.classNameSlug) ?? 'all');
        }
        if (kind === 'ship') this.restoreDraftFromUrlOrStorage(className);
        if (kind === 'item' || kind === 'weapon') void this.loadWhereToBuy(d);
        // Ships are not crafting ingredients; skip the reverse lookup for them.
        if (kind !== 'ship') void this.loadUsedInBlueprints(d.classNameSlug);
        // Ships are not craftable either, so skip the forward lookup as well.
        if (kind !== 'ship') void this.loadRecipe(d.classNameSlug);
        // Ship pages: hangar membership backs the add-to-hangar action.
        if (kind === 'ship' && this.hangar.ships().length === 0) void this.hangar.loadAll();
        // Ship pages: resolve the pinned pledge link (own > global). Best
        // effort — a missing link just falls back to the RSI ships listing.
        if (kind === 'ship') void this.shipLinks.loadForShip(d.classNameSlug);
      }
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  /** Resolve raw @-keys on the row (currently the ship role) to localized text. */
  private async resolveLocale(d: CodexDetail): Promise<void> {
    const keys: string[] = [];
    const role = d.row['role'];
    if (typeof role === 'string' && role.startsWith('@')) keys.push(role);
    if (keys.length === 0) return;
    this.localeMap.set(await this.svc.resolveLocaleKeys(keys, this.lang()));
  }

  // ── hardpoint slot compatibility ────────────────────────────────────────────
  compat(portIndex: number): PortCompat | undefined {
    return this.compatMap().get(portIndex);
  }

  async togglePort(port: CodexItemPort): Promise<void> {
    if (port.types.length === 0) return;
    if (this.expandedPort() === port.portIndex) {
      this.expandedPort.set(null);
      return;
    }
    this.expandedPort.set(port.portIndex);
    if (this.compatMap().has(port.portIndex)) return; // cached
    this.setCompat(port.portIndex, { loading: true, error: null, items: [] });
    try {
      const items = await this.svc.getCompatibleItems({
        types: port.types,
        minSize: port.minSize,
        maxSize: port.maxSize,
      });
      this.setCompat(port.portIndex, { loading: false, error: null, items });
    } catch (e) {
      this.setCompat(port.portIndex, {
        loading: false,
        error: (e as Error).message ?? 'error',
        items: [],
      });
    }
  }

  private setCompat(idx: number, v: PortCompat): void {
    const m = new Map(this.compatMap());
    m.set(idx, v);
    this.compatMap.set(m);
  }

  private async resolveLoadoutEntities(d: CodexDetail): Promise<void> {
    if (d.kind !== 'ship') return;
    const entries = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    // Sub-items too — a gun that only exists inside a mount still needs its
    // name, size and manufacturer resolved.
    this.loadoutEntities.set(
      await this.svc.resolveEntities(stockLoadoutClassNames(entries)),
    );
  }

  /**
   * Derive ship tech facts (#137 part 1) from the STOCK loadout's component
   * payloads: quantum jump range / drive speed and the summed hydrogen /
   * quantum fuel tank capacities. Reuses the hangar's loadout-stats math so
   * codex and hangar always agree. Best-effort: failures leave the hero
   * facts without tech chips instead of breaking the page.
   */
  private async resolveShipTech(d: CodexDetail): Promise<void> {
    if (d.kind !== 'ship') return;
    const entries = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    // Sub-items included: the per-hardpoint readout needs the payload of a gun
    // that sits inside a mount. The AGGREGATE lines below stay top-level —
    // computeLoadoutStats sums a ship's drives and tanks, and a sub-item is
    // never one of those.
    const classNames = stockLoadoutClassNames(entries);
    if (classNames.length === 0) return;
    try {
      const payloads = await this.svc.getEntityPayloads(classNames);
      // Publish the payloads first: the per-hardpoint stat readout depends only
      // on them, so it must survive a failure in the aggregate tech math below.
      this.loadoutPayloads.set(payloads);
      await this.resolveLoadoutAmmo(payloads);
      const lines: ResolvedLoadoutLine[] = [];
      for (const e of entries) {
        if (!e.entityClassName) continue;
        const hit = payloads.get(e.entityClassName);
        lines.push({
          portName: e.itemPortName ?? null,
          className: e.entityClassName,
          kind: hit?.kind ?? 'component',
          payload: hit?.payload ?? null,
        });
      }
      const stats = computeLoadoutStats(lines);
      let hydrogen: number | null = null;
      let qtFuel: number | null = null;
      let qdClassName: string | null = null;
      for (const line of lines) {
        const p = line.payload as ComponentPayload | null;
        if (!p || typeof p !== 'object' || (p as { entityKind?: string }).entityKind !== 'component') continue;
        const s = p.stats as Record<string, Record<string, unknown>> | undefined;
        // The payload `kind` union is narrower than the live extract — fuel
        // tanks arrive with kinds outside ComponentPayload['kind'], so match
        // on the raw string.
        const compKind = (p as { kind?: string }).kind ?? '';
        if (compKind === 'FuelTank') {
          const c = findStat(s, 'fuel', ['capacity', 'Capacity']);
          if (c !== null) hydrogen = (hydrogen ?? 0) + c;
        } else if (compKind === 'QuantumFuelTank') {
          const c = findStat(s, 'fuel', ['capacity', 'Capacity']);
          if (c !== null) qtFuel = (qtFuel ?? 0) + c;
        } else if (compKind === 'QuantumDrive') {
          qdClassName = line.className;
        }
      }
      this.techStats.set({
        quantum: stats.quantum,
        quantumDriveClassName: qdClassName,
        hydrogenCapacity: hydrogen,
        quantumFuelCapacity: qtFuel,
      });
    } catch {
      // tech chips are a bonus — never fail the detail page for them
    }
  }

  /**
   * Resolve the projectile ("ammo") payloads for the guns in a stock loadout.
   * The extract leaves every weapon's ammoContainerRecord null, so the only
   * link is the `<weaponClass>_AMMO` name convention — one batched query, and
   * whatever does not exist simply yields no projectile stats.
   */
  private async resolveLoadoutAmmo(
    payloads: Map<string, { kind: CodexKind; payload: unknown }>,
  ): Promise<void> {
    const weaponClasses = [...payloads.entries()]
      .filter(([, v]) => (v.payload as { entityKind?: string } | null)?.entityKind === 'weapon')
      .map(([className]) => className);
    const ammoNames = ammoClassNamesFor(weaponClasses);
    if (ammoNames.length === 0) return;
    try {
      this.ammoPayloads.set(await this.svc.getAmmoPayloads(ammoNames));
    } catch {
      // projectile stats are a bonus — a failed lookup just hides those rows
    }
  }

  /** Reverse lookup: crafting blueprints that consume this entity as an ingredient. */
  private async loadUsedInBlueprints(className: string): Promise<void> {
    try {
      this.usedInBlueprints.set(await this.svc.blueprintsUsingIngredient(className));
    } catch {
      this.usedInBlueprints.set([]);
    }
  }

  /** Forward lookup: the recipe that produces this entity, with its materials. */
  private async loadRecipe(className: string): Promise<void> {
    try {
      const bp = await this.svc.getCraftingRecipe(className);
      this.recipe.set(bp ? {
        classNameSlug: bp.classNameSlug,
        craftTimeSec: (bp.row['craft_time_seconds'] as number | null) ?? null,
        ingredients: bp.ingredients,
      } : null);
    } catch {
      // Crafting data is supplementary — a failed lookup just hides the panel.
      this.recipe.set(null);
    }
  }

  /**
   * "Where to buy" (#254/#255): resolve UEX Corp purchase locations for an FPS
   * armor piece (`kind === 'item'`) or personal weapon (`kind === 'weapon'`).
   * Best-effort — an upstream failure surfaces the error state, never breaks
   * the rest of the detail page.
   */
  private async loadWhereToBuy(d: CodexDetail): Promise<void> {
    const seq = ++this.buySeq;
    this.buyLoading.set(true);
    this.buyError.set(false);
    // Match against the ENGLISH name: UEX's catalog is English-only, so the
    // German display name ("A03-Snipergewehr") would never match "A03 Sniper
    // Rifle". Fall back to the display name when no English name exists.
    const p = d.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const name = (p?.name ? pickLocalized(p.name, 'en') : '') || this.displayName();
    const row = d.row;
    try {
      const options = await this.uexShop.whereToBuy({
        name,
        attachType: (row['attach_type'] as string | null) ?? null,
        weaponClass: (row['weapon_class'] as string | null) ?? null,
        subType: (row['sub_type'] as string | null) ?? null,
      });
      if (seq !== this.buySeq) return;
      this.buyOptions.set(options);
    } catch {
      if (seq !== this.buySeq) return;
      this.buyError.set(true);
    } finally {
      if (seq === this.buySeq) this.buyLoading.set(false);
    }
  }

  /** Ingredient display name — falls back to a humanized resource class name. */
  ingredientName(i: CodexBlueprintIngredient): string {
    return cleanLocaleValue(i.nameLocalized)
      || humanizeClassName(i.ingredientClassName ?? '')
      || (i.ingredientClassName ?? '');
  }

  // ── derived views ──────────────────────────────────────────────────────────
  readonly displayName = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { name?: { de: string; en: string; key: string } } | undefined;
    const name = p?.name ? pickLocalized(p.name, this.lang()) : '';
    // name_localized may itself be an unresolved @-key — drop it if so.
    return name || cleanLocaleValue(d.row['name_localized'] as string) || humanizeClassName(d.classNameSlug);
  });

  readonly manufacturerName = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { manufacturer?: { name?: { de: string; en: string; key: string }; code?: string } } | undefined;
    const fromPayload = p?.manufacturer?.name ? pickLocalized(p.manufacturer.name, this.lang()) : '';
    return fromPayload || (d.row['manufacturer_code'] as string) || '';
  });

  readonly description = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const p = d.payload as { description?: { de: string; en: string; key: string } } | undefined;
    return unescapeText(p?.description ? pickLocalized(p.description, this.lang()) : '');
  });

  readonly provenance = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const p = d.payload as { source?: { channel: string; patch: string; build: string } } | undefined;
    return p?.source ?? null;
  });

  /**
   * Ordered hero artwork, best-looking first — the same source chain the list
   * cards use, which the hero previously did not consume at all.
   *
   * Why: the datamined `previewImage` is the game's flat UI silhouette, and the
   * game only ships one for hulls that appear in the in-game vehicle UI. 129 of
   * the 661 ship rows in the current LIVE build have `previewImage: null`
   * (capital ships like the Javelin, most 2025+ hulls, every Wikelo variant),
   * and for those the hero had nothing left to show but the category glyph —
   * even though the card the user just clicked was showing RSI's store render
   * of the very same hull. 95 of those 129 have RSI artwork; they now paint it.
   *
   * A single url would not be enough either: RSI advertises derivatives it has
   * not always rendered, so the list goes to `sc-fallback-image`, which walks
   * it and only projects the glyph once every candidate has actually failed.
   */
  readonly heroArt = computed<readonly string[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const out: string[] = [];
    // Ships lead with the RSI render (a photo of the hull) and keep the
    // datamined silhouette as the fallback. Other kinds have no RSI
    // counterpart, so their datamined render is all there is.
    if (d.kind === 'ship') out.push(...this.rsi.heroArtFor(this.heroArtKey()));
    const local = this.svc.previewUrl((d.payload as BaseEntityPayload | undefined)?.previewImage);
    if (local) out.push(local);
    return out;
  });

  /**
   * Lookup key into the RSI art map. Must be the denormalized `name_localized`
   * — the very column the edge function keys `gameShipArt` by — so no second
   * normalization dialect can open a gap between card and detail.
   */
  private heroArtKey(): string {
    const raw = this.detail()?.row?.['name_localized'];
    return (typeof raw === 'string' && raw ? cleanLocaleValue(raw) : '') || this.displayName();
  }

  /**
   * Sub-category that refines the hero fallback icon (componentKind/subType/
   * weaponClass). `sub_type` ranks above `weapon_class` for the same reason as
   * in the list: 'FPS'/'Ship' refines nothing, while 'Gadget'/'Knife'/'Grenade'
   * is what keeps a crosshair off a fire extinguisher (admin feedback 8cd0aed7).
   */
  heroSub(): string | null {
    const row = this.detail()?.row;
    if (!row) return null;
    return (row['kind'] as string) || (row['sub_type'] as string) || (row['weapon_class'] as string) || null;
  }

  // Original class_name (e.g. 'DRAK_Cutlass_Black') for the skin selector —
  // matches public.ship_skins.ship_id. Empty string for non-ships (hides it).
  readonly shipClassName = computed(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return '';
    const raw = d.row?.['class_name'];
    return typeof raw === 'string' && raw ? raw : d.classNameSlug;
  });

  private readonly dimensions = computed<Dimensions | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    const dim = (d.payload as ShipPayload | undefined)?.dimensions ?? null;
    if (!dim || (!dim.length && !dim.width && !dim.height)) return null;
    return dim;
  });

  /** Compact hero facts — kind-aware, only meaningful values. */
  readonly facts = computed<Fact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const out: Fact[] = [];
    const row = d.row;
    const add = (label: string, value: unknown, accent = false) => {
      if (value == null || value === '' || value === 0) return;
      out.push({ label: this.t.instant(label), value: String(value), accent });
    };

    if (d.kind === 'ship') {
      const role = row['role'];
      const roleVal =
        typeof role === 'string'
          ? cleanLocaleValue(this.localeMap().get(role) ?? role)
          : '';
      add('codex.detail.role', roleVal);
      add('codex.detail.crew', row['crew_size']);
      const dim = this.dimensions();
      if (dim) {
        out.push({
          label: this.t.instant('codex.detail.dimensions'),
          value: `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m`,
        });
      }
      // Tech facts from the stock loadout (#137): quantum + fuel numbers.
      const tech = this.techStats();
      if (tech) {
        if (tech.quantum.jumpRangeMm != null) {
          add('codex.detail.quantumRange', this.fmtGm(tech.quantum.jumpRangeMm), true);
        }
        if (tech.quantum.driveSpeedMs != null) {
          add('codex.detail.quantumSpeed', formatNumber(tech.quantum.driveSpeedMs / 1000) + ' km/s');
        }
        add('codex.detail.quantumFuel', tech.quantumFuelCapacity == null ? '' : formatNumber(tech.quantumFuelCapacity));
        add('codex.detail.fuelCapacity', tech.hydrogenCapacity == null ? '' : formatNumber(tech.hydrogenCapacity));
      }
    } else if (d.kind === 'weapon') {
      const wc = row['weapon_class'];
      if (typeof wc === 'string') add('codex.detail.weaponClass', this.t.instant('codex.weaponClass.' + wc));
      add('codex.detail.subType', row['sub_type']);
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      add('codex.detail.grade', row['grade']);
      add('codex.detail.attachType', row['attach_type']);
    } else if (d.kind === 'component') {
      const ck = row['kind'];
      if (typeof ck === 'string') add('codex.detail.componentKind', this.t.instant('codex.componentKind.' + ck));
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      add('codex.detail.grade', row['grade']);
    } else if (d.kind === 'item') {
      add('codex.detail.subType', row['sub_type']);
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      add('codex.detail.grade', row['grade']);
      add('codex.detail.attachType', row['attach_type']);
    } else if (d.kind === 'ammunition') {
      if (row['size'] != null) add('codex.detail.size', 'S' + row['size']);
      const speed = row['speed'];
      if (typeof speed === 'number' && speed > 0) add('codex.detail.speed', formatNumber(speed) + ' m/s');
      const range = this.ammoRange();
      if (range) add('codex.detail.range', formatNumber(range) + ' m');
    }
    return out;
  });

  /** Effective ballistic range = speed × lifetime (when both present). */
  private ammoRange(): number | null {
    const p = this.detail()?.payload as AmmunitionPayload | undefined;
    if (!p) return null;
    const speed = p.speed ?? (p.raw?.['speed'] as number | undefined) ?? null;
    const life = p.lifetime ?? (p.raw?.['lifetime'] as number | undefined) ?? null;
    return speed && life ? speed * life : null;
  }

  readonly componentStats = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'component') return [];
    return curateComponentStats((d.payload as ComponentPayload | undefined)?.stats);
  });

  readonly weaponParams = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'weapon') return [];
    return meaningfulRows((d.payload as WeaponPayload | undefined)?.weaponParams);
  });

  // Personal FPS armor / undersuit pieces carry an SCItem*Params stat block in
  // the same heterogeneous shape as components — reuse the exact same curation.
  readonly armorStats = computed<StatRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'item') return [];
    return curateComponentStats((d.payload as ItemPayload | undefined)?.stats);
  });

  // Decision stats grouped by what the thing is FOR (Slice 3) — not a flat dump.
  readonly componentStatGroups = computed<StatGroup[]>(() => groupStatRows(this.componentStats()));
  readonly weaponParamGroups = computed<StatGroup[]>(() => groupStatRows(this.weaponParams()));
  readonly armorStatGroups = computed<StatGroup[]>(() => groupStatRows(this.armorStats()));

  /** Group headers only help once the stats span ≥2 buckets. */
  showStatGroupHeaders(groups: StatGroup[]): boolean {
    return groups.length > 1 || (groups.length === 1 && groups[0].purpose !== 'general');
  }

  // Full spec sheet (Manifest graft): every meaningful payload value, readable.
  readonly showSpec = signal(false);
  readonly specSections = computed<SpecSection[]>(() => {
    const d = this.detail();
    return d ? flattenSpec(d.payload) : [];
  });
  toggleSpec(): void {
    this.showSpec.update((v) => !v);
  }

  // Swap picker (Rung 2): the hardpoint currently being explored, or null.
  readonly swapTarget = signal<SwapTarget | null>(null);

  /**
   * Open the "what else fits here" table for a clicked module. A sub-slot click
   * targets the CHILD (the gun inside the gimbal), because that is the thing a
   * pilot swaps — the mount itself stays put.
   */
  openSwapPicker(ev: LayoutTarget): void {
    const src = ev.child ?? ev.slot;
    const port = ev.child ? ev.child.port : ev.slot.port;
    if (!src.className) {
      // An UNFITTED bay/seat is still a choice, as long as we know what fits
      // in it (1add86a4, Falle 3). A sub-slot reads its OWN raw types now
      // (carriedSlots.rawTypes); a top-level bay borrows from a sibling.
      const fit = ev.child
        ? ev.child.rawTypes.length > 0
          ? { types: ev.child.rawTypes, size: ev.child.size, inferred: false }
          : null
        : this.emptyFits().get(ev.slot.rawPort ?? '');
      if (!fit) return;
      this.swapTarget.set({
        port,
        count: ev.count,
        className: null,
        kind: null,
        name: null,
        size: fit.size,
        attachTypes: fit.types,
        fitInferred: fit.inferred,
        rawPorts: ev.rawPorts,
        rawTypes: fit.types,
      });
      return;
    }
    this.swapTarget.set({
      port,
      count: ev.count,
      className: src.className,
      kind: src.kind,
      name: src.name,
      size: src.size,
      rawPorts: ev.rawPorts,
      rawTypes: ev.child ? ev.child.rawTypes : (this.detail()?.ports.find((p) => p.portName === ev.slot.rawPort)?.types ?? []),
    });
  }

  // ── loadout draft write path (PR B) ─────────────────────────────────────────

  /** `codex_item_ports.port_name` — the only paths a draft entry can be saved against (R2). */
  private readonly joinablePorts = computed<ReadonlySet<string>>(() => {
    const d = this.detail();
    return new Set((d?.ports ?? []).map((p) => p.portName).filter((p): p is string => !!p));
  });

  readonly draftChangedCount = computed(() => draftChangedCount(this.draft()));

  private kindOfDraftClass(className: string): string {
    return (
      this.draftResolved().get(className)?.kind ??
      this.loadoutEntities().get(className)?.kind ??
      'component'
    );
  }

  readonly saveableEntries = computed(() =>
    selectSaveableEntries(this.draft(), this.joinablePorts(), (cn) => this.kindOfDraftClass(cn)),
  );

  /** "Übernehmen" / "Slot leeren" from the picker — applies to every covered path. */
  onSwapPicked(pick: SwapPick): void {
    const paths = pick.target.rawPorts && pick.target.rawPorts.length > 0 ? pick.target.rawPorts : [];
    if (paths.length === 0) {
      // No raw identity to write against — nothing we can do safely; close.
      this.swapTarget.set(null);
      return;
    }
    this.draft.update((d) =>
      setDraftValueForPaths(d, paths, pick.className, (path) => this.stockValueForPath(path)),
    );
    this.unresolvableDraftPaths.update((s) => {
      if (paths.every((p) => !s.has(p))) return s;
      const next = new Set(s);
      for (const p of paths) next.delete(p);
      return next;
    });
    this.swapTarget.set(null);
    if (pick.className) void this.hydrateDraftClass(pick.className);
    this.persistDraftMirror();
  }

  /** Revert the row's own draft entries (the ↺ button). */
  onRevertPaths(paths: string[]): void {
    if (paths.length === 0) return;
    this.draft.update((d) => deleteDraftPaths(d, paths));
    this.persistDraftMirror();
  }

  /** The STOCK value at a dotted path — top-level className, or a carried sub-port's. */
  private stockValueForPath(path: string): string | null {
    const top = topSegment(path);
    const item = this.loadoutAll().find((l) => l.port === top);
    if (!item) return null;
    if (!isNestedPath(path)) return item.className;
    const childPort = path.slice(top.length + 1).toLowerCase();
    for (const [k, v] of item.carried) {
      if (k.toLowerCase() === childPort) return v;
    }
    return null;
  }

  /** Async stat hydration for a draft-swapped class, epoch-guarded (R6/Falle 2). */
  private async hydrateDraftClass(className: string): Promise<void> {
    this.pendingClasses.update((s) => new Set(s).add(className));
    const ammoNames = ammoClassNamesFor([className]);
    const epoch = beginHydration(this.hydrationEpoch, [className, ...ammoNames]);
    try {
      const [payloads, resolved, ammo] = await Promise.all([
        this.svc.getEntityPayloads([className]),
        this.svc.resolveEntities([className]),
        ammoNames.length > 0 ? this.svc.getAmmoPayloads(ammoNames) : Promise.resolve(new Map<string, unknown>()),
      ]);
      const okMain = acceptedClassNames(this.hydrationEpoch, [className], epoch);
      const okAmmo = acceptedClassNames(this.hydrationEpoch, ammoNames, epoch);
      if (okMain.length > 0) {
        this.draftPayloads.update((m) => mergeMapInto(m, payloads, okMain));
        this.draftResolved.update((m) => mergeMapInto(m, resolved, okMain));
      }
      if (okAmmo.length > 0) this.draftAmmoPayloads.update((m) => mergeMapInto(m, ammo, okAmmo));
    } catch {
      // A failed hydration just leaves the row pending forever rather than
      // rendering wrong numbers — Falle 2: "a spinner beats a wrong number".
    } finally {
      if (acceptedClassNames(this.hydrationEpoch, [className], epoch).length > 0) {
        this.pendingClasses.update((s) => {
          const next = new Set(s);
          next.delete(className);
          return next;
        });
      }
    }
  }

  isDraftClassPending(className: string | null): boolean {
    return !!className && this.pendingClasses().has(className);
  }

  // ── persistence (R1/R2) ──────────────────────────────────────────────────

  /**
   * Write the draft into the ship's ACTIVE hangar config (creating + activating
   * one when it has none). Never a from-scratch array: only OUR joinable,
   * top-level paths are upserted/removed; every other row the config already
   * carries — including ones the hangar editor wrote — survives untouched.
   */
  async saveLoadoutDraft(): Promise<void> {
    const d = this.detail();
    if (d?.kind !== 'ship' || this.saveableEntries().length === 0) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const ship =
        this.hangar.shipByClassName(d.classNameSlug) ?? (await this.hangar.addShip(d.classNameSlug, 'owned'));
      if (!ship) {
        this.saveError.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
        return;
      }
      const configs = await this.hangar.listConfigs(ship.id);
      let target: HangarShipConfig | null = configs.find((c) => c.isActive) ?? configs[0] ?? null;
      if (!target) {
        target = await this.hangar.createConfig(
          ship.id,
          this.t.instant('codex.loadout.defaultConfigName') as string,
          'multipurpose',
          [],
        );
        if (!target) {
          this.saveError.set(this.t.instant('codex.loadout.saveErrorHangar') as string);
          return;
        }
        await this.hangar.activateConfig(target.id, ship.id);
      }
      const touched = touchedTopPorts(this.draft(), this.joinablePorts());
      const merged = mergeSavedLoadout(target.loadout, this.saveableEntries(), touched);
      const updated = await this.hangar.updateConfig(target.id, { loadout: merged });
      if (!updated) {
        this.saveError.set(this.t.instant('codex.loadout.saveErrorGeneric') as string);
        return;
      }
      this.savedPaths.set(new Set(this.saveableEntries().map((e) => e.portName)));
    } catch {
      this.saveError.set(this.t.instant('codex.loadout.saveErrorGeneric') as string);
    } finally {
      this.saving.set(false);
    }
  }

  discardLoadoutDraft(): void {
    this.draft.set(EMPTY_DRAFT);
    this.draftPayloads.set(new Map());
    this.draftAmmoPayloads.set(new Map());
    this.draftResolved.set(new Map());
    this.pendingClasses.set(new Set());
    this.unresolvableDraftPaths.set(new Set());
    this.savedPaths.set(new Set());
    this.saveError.set(null);
    this.persistDraftMirror();
  }

  // ── URL + localStorage draft mirror (R9) ────────────────────────────────

  /** Best-effort — try/catch throughout: private-mode localStorage still must not break the page. */
  private persistDraftMirror(): void {
    const d = this.detail();
    const buildId = this.svc.build()?.id;
    if (!d || d.kind !== 'ship' || !buildId) return;
    try {
      const param = encodeDraftParam(buildId, this.draft());
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { loadout: param },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch {
      // Router navigation should not throw in practice — best-effort regardless.
    }
    try {
      if (typeof localStorage === 'undefined') return;
      if (this.draft().size === 0) localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
      else localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, serializeLocalDraft(d.classNameSlug, buildId, this.draft()));
    } catch {
      // Private mode / quota — degrade to in-memory only.
    }
  }

  /** URL wins over localStorage; both are ignored when the ship or build doesn't match (R9). */
  private restoreDraftFromUrlOrStorage(classNameSlug: string): void {
    const buildId = this.svc.build()?.id;
    if (!buildId) return;
    const fromUrl = decodeDraftParam(this.route.snapshot.queryParamMap.get('loadout'));
    let entries: [string, string | null][] | null = null;
    let sourceBuildId = buildId;
    if (fromUrl) {
      entries = fromUrl.entries;
      sourceBuildId = fromUrl.buildId;
    } else {
      try {
        const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
        const local = parseLocalDraft(raw);
        if (local && local.shipClassName === classNameSlug) {
          entries = local.entries;
          sourceBuildId = local.buildId;
        }
      } catch {
        // Private mode — no restore, page still works.
      }
    }
    if (!entries || entries.length === 0) return;
    const classResolves = (className: string): boolean =>
      this.loadoutEntities().has(className) || stockLoadoutClassNames(
        (this.detail()?.payload as ShipPayload | undefined)?.defaultLoadout ?? [],
      ).includes(className);
    const restored = restoreDraft({ version: 'v1', buildId: sourceBuildId, entries }, buildId, classResolves);
    this.draft.set(restored.draft);
    this.unresolvableDraftPaths.set(new Set(restored.unresolvable));
    // A restored draft is UNSAVED by definition (R8) — savedPaths stays empty.
    for (const [path, value] of restored.draft) {
      if (value && !restored.unresolvable.includes(path)) void this.hydrateDraftClass(value);
    }
  }

  // ── hardpoint positions on the hull (#137 part 3) ───────────────────────────
  // The coordinates come out of the ship's .cga mesh via the desktop uploader,
  // so an already-ingested catalog carries none of this and every computed below
  // resolves to empty — the loadout list then renders exactly as before.
  private readonly hardpointTransforms = computed<Map<string, HardpointTransform>>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return new Map();
    return readHardpointTransforms(
      (d.payload as { hardpointTransforms?: unknown } | undefined)?.hardpointTransforms,
    );
  });

  /** The raw, validated frame from the payload (null when absent/degenerate). */
  private readonly rawHardpointFrame = computed<HardpointFrame | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    return readHardpointFrame(
      (d.payload as { hardpointFrame?: unknown } | undefined)?.hardpointFrame,
    );
  });

  /**
   * One marker per hardpoint the loadout list actually shows a row for, in row
   * order. Mesh helpers no port references are deliberately NOT plotted: a dot
   * without a row is a riddle, not information. `codex_item_ports` rows are
   * included too — they carry their own coordinates since migration
   * 20260726220000 and are the ship's structural ports.
   */
  readonly hardpointMarkers = computed<HardpointMarker[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const transforms = this.hardpointTransforms();
    const frame = this.rawHardpointFrame();
    if (transforms.size === 0 || !frame) return [];
    const inputs: HardpointMarkerInput[] = [];
    const seen = new Set<string>();
    const add = (rawPort: string | null | undefined, itemName: string | null) => {
      if (!rawPort || seen.has(rawPort)) return;
      const hit = transforms.get(rawPort);
      if (!hit) return;
      seen.add(rawPort);
      inputs.push({
        port: rawPort,
        label: this.humanizePort(rawPort),
        itemName,
        position: hit.position,
      });
    };
    for (const item of this.loadoutAll()) add(item.port, item.className ? item.name : null);
    for (const port of d.ports) add(port.portName, null);
    return buildHardpointMarkers(inputs, frame);
  });

  /**
   * The frame handed to the map: only once at least one hardpoint resolved. A
   * frame alone would draw an empty hull outline, which reads as a broken
   * feature rather than as "no data yet".
   */
  readonly hardpointFrame = computed<HardpointFrame | null>(() =>
    this.hardpointMarkers().length > 0 ? this.rawHardpointFrame() : null,
  );

  /**
   * Every port the loadout list shows a row for, in row order (#256).
   *
   * Unlike `hardpointMarkers` this does NOT require the extract to carry
   * coordinates — the 3D viewer resolves these names against the model's own
   * locator nodes, which is a second, independent way to answer "where is it".
   * A ship whose glb has no matching locator simply gets no marker.
   */
  readonly hardpointPortRefs = computed<HardpointPortRef[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const refs: HardpointPortRef[] = [];
    const seen = new Set<string>();
    const add = (rawPort: string | null | undefined, itemName: string | null) => {
      if (!rawPort || seen.has(rawPort)) return;
      seen.add(rawPort);
      refs.push({ port: rawPort, label: this.humanizePort(rawPort), itemName });
    };
    for (const item of this.loadoutAll()) add(item.port, item.className ? item.name : null);
    for (const port of d.ports) add(port.portName, null);
    return refs;
  });

  /** Ports the 3D model could locate — reported back by the skin viewer. */
  readonly glbLocatablePorts = signal<string[]>([]);

  /**
   * Raw port names SOME hardpoint view can locate — drives the row affordance.
   *
   * The union of the two independent sources: the extract's coordinates (2D
   * hull map) and the glb's locator nodes (3D viewer). A row is offered as
   * locatable when at least one of them can actually show it.
   */
  readonly locatablePorts = computed<string[]>(() => {
    const ports = new Set(this.hardpointMarkers().map((m) => m.port));
    for (const port of this.glbLocatablePorts()) ports.add(port);
    return [...ports];
  });

  /** Whether the modules card renders (it hosts the hull map when it does). */
  readonly hasLoadoutSection = computed(() => this.moduleSections().length > 0);

  isPortLocated(port: CodexItemPort): boolean {
    return !!port.portName && this.locatablePorts().includes(port.portName);
  }
  isPortActive(port: CodexItemPort): boolean {
    return !!port.portName && this.activePorts().includes(port.portName);
  }
  hoverPort(port: CodexItemPort): void {
    this.setActivePorts(this.isPortLocated(port) ? [port.portName as string] : null);
  }

  /**
   * The hardpoint(s) currently highlighted, hovered from either side (a loadout
   * row or a marker). One signal for both directions keeps them in sync.
   */
  readonly activePorts = signal<readonly string[]>([]);
  setActivePorts(ports: string[] | null): void {
    this.activePorts.set(ports ?? []);
  }

  // ── ship modules, ordered by what a pilot can configure (461288f9) ──────────
  // The three headline panels, the hull block and the module list all read the
  // SAME resolved occupants, so they can never contradict each other.

  /** The resolved occupant of one hardpoint (null payload = stock-empty port). */
  private readonly resolvedLoadout = computed(() => {
    const payloads = this.loadoutPayloads();
    const ammo = this.ammoPayloads();
    return this.loadoutAll().map((l) => {
      const hit = l.className ? payloads.get(l.className) : undefined;
      const payload = hit?.payload ?? null;
      const occupant = {
        entityKind: (payload as { entityKind?: string } | null)?.entityKind ?? l.kind,
        componentKind: (payload as { kind?: string } | null)?.kind ?? null,
        subType: (payload as { subType?: string } | null)?.subType ?? null,
        attachType: (payload as { attachType?: string } | null)?.attachType ?? null,
      };
      return {
        item: l,
        kind: hit?.kind ?? l.kind,
        payload,
        occupant,
        ammoPayload: l.className ? ammo.get(ammoClassNameFor(l.className) ?? '') : undefined,
        section: classifyShipModule(l.port, occupant) as ShipModuleSection,
      };
    });
  });

  /**
   * What an OCCUPIED hardpoint proves its bay accepts, indexed by section + port
   * family (`hardpoint_shield_generator_01/02/03` share a family, see
   * `shipPortFamily`). This is how an unfitted bay still gets a "what fits
   * here" list: the Nomad's empty `hardpoint_shield_generator_01` borrows the
   * `Shield` / size-1 fit its two fitted twins carry (admin request 1add86a4).
   *
   * It is an INFERENCE, not extract data — the picker labels it as such — but
   * it is inferred from this very hull, never from another ship or a guess.
   */
  private readonly portFitIndex = computed<Map<string, PortFit>>(() => {
    const out = new Map<string, PortFit>();
    for (const r of this.resolvedLoadout()) {
      if (!r.item.className) continue;
      const attachType = (r.occupant.attachType ?? '').trim();
      if (!attachType || PLACEHOLDER_ATTACH_TYPE.has(attachType.toLowerCase())) continue;
      const key = `${r.section}|${shipPortFamily(r.item.port)}`;
      if (out.has(key)) continue;
      out.set(key, {
        attachType,
        size: r.item.size ?? (r.payload as { size?: number | null } | null)?.size ?? null,
      });
    }
    return out;
  });

  /**
   * What may go into an unfitted hardpoint. The hardpoint's OWN accepted types
   * win when `codex_item_ports` carries them; otherwise an identical fitted bay
   * on the same hull answers, flagged `inferred` so the picker can say so.
   */
  private emptyFitFor(portName: string | null, section: ShipModuleSection): EmptyFit | null {
    if (!portName) return null;
    const own = this.detail()?.ports.find((p) => p.portName === portName);
    const ownTypes = (own?.types ?? []).filter(Boolean);
    if (own && ownTypes.length > 0) {
      return {
        types: ownTypes,
        size: own.minSize != null && own.minSize === own.maxSize ? own.minSize : null,
        inferred: false,
      };
    }
    const hit = this.portFitIndex().get(`${section}|${shipPortFamily(portName)}`);
    return hit ? { types: [hit.attachType], size: hit.size, inferred: true } : null;
  }

  /** Every unfitted configurable hardpoint we can offer a candidate list for. */
  private readonly emptyFits = computed<Map<string, EmptyFit>>(() => {
    const out = new Map<string, EmptyFit>();
    for (const r of this.resolvedLoadout()) {
      if (r.item.className || !isConfigurableSection(r.section) || !r.item.port) continue;
      const fit = this.emptyFitFor(r.item.port, r.section);
      if (fit) out.set(r.item.port, fit);
    }
    return out;
  });

  /** Aggregation input for the Damage / Defence / Power panels. */
  private readonly summaryOccupants = computed<SummaryOccupant[]>(() =>
    this.resolvedLoadout().flatMap((r) => [
      {
        section: r.section,
        kind: r.kind,
        payload: r.payload,
        ammoPayload: r.ammoPayload,
        count: 1,
      },
      ...this.carriedOccupants(r.section, r.item.carried),
    ]),
  );

  /**
   * The SAME occupants as `summaryOccupants`, but overlaid with the current
   * loadout DRAFT (PR C) — swapped ports show the candidate's payload, an
   * emptied port drops out, and a still-hydrating swap contributes nothing
   * rather than a stale number. Grouping/order is irrelevant here (this only
   * feeds aggregate stats), so a swapped mount's own sub-slots are skipped —
   * the draft write path does not track them separately at this stage.
   */
  private readonly draftSummaryOccupants = computed<SummaryOccupant[]>(() =>
    this.resolvedLoadout().flatMap((r) => {
      const configurable = isConfigurableSection(r.section);
      const draftEntry = configurable ? this.draft().get(r.item.port) : undefined;
      const item = { kind: r.kind, payload: r.payload, ammoPayload: r.ammoPayload };
      const overlay = this.draftOverlayFor(r.item.port, draftEntry, item);
      const pending = overlay.state === 'pending';
      const out: SummaryOccupant[] = [
        {
          section: r.section,
          kind: overlay.item.kind,
          payload: pending ? null : overlay.item.payload,
          ammoPayload: pending ? undefined : overlay.item.ammoPayload,
          count: 1,
        },
      ];
      if (draftEntry === undefined) out.push(...this.carriedOccupants(r.section, r.item.carried));
      return out;
    }),
  );

  /** What this hull can even attempt — drives the mission bar's disabled chips. */
  readonly shipCapabilities = computed(() => {
    const d = this.detail();
    const ports: CapabilityPort[] = (d?.ports ?? []).map((p) => ({ portName: p.portName, types: p.types }));
    const classNames = this.loadoutAll().map((l) => l.className);
    return detectShipCapabilities(ports, classNames);
  });

  /** The ship's own ARMR_ item payload, resolved from the STOCK loadout. */
  private readonly armorPayload = computed(() => findArmorPayload(this.summaryOccupants()));

  private readonly kpiShipInput = computed<KpiShipInput | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    const p = d.payload as ShipPayload;
    return { flight: p.flight, stats: p.stats ?? null };
  });

  private readonly stockKpiSheet = computed(() =>
    computeKpiSheet(this.summaryOccupants(), this.kpiShipInput()),
  );
  private readonly currentKpiSheet = computed(() =>
    computeKpiSheet(this.draftSummaryOccupants(), this.kpiShipInput()),
  );

  /** The six KPI-band cells for the active mission, stock vs. current draft. */
  readonly kpiCells = computed<KpiCell[]>(() => {
    if (this.kind() !== 'ship') return [];
    return buildKpiCells(this.activeMission(), this.stockKpiSheet(), this.currentKpiSheet());
  });

  readonly offensivePanel = computed(() => {
    if (this.kind() !== 'ship') return null;
    return buildOffensivePanel(this.draftSummaryOccupants());
  });

  readonly defensivePanel = computed(() => {
    if (this.kind() !== 'ship') return null;
    return buildDefensivePanel(this.draftSummaryOccupants(), this.armorPayload());
  });

  /** Sections the active mission folds away — feeds both the loadout layout
   *  and the analysis panels' default collapse state. */
  readonly foldedModuleSections = computed(() => foldedSectionsFor(this.activeMission()));
  readonly moduleSectionOrder = computed(() => this.activeMission().order);
  readonly offensiveStartsCollapsed = computed(() => this.foldedModuleSections().has('weapons'));

  /** Schiff panel — flight/mass/systems/signature/hull, grouped, gaps honoured. */
  readonly shipFactGroups = computed<ShipFactGroup[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const p = d.payload as ShipPayload;
    const flight = p.flight;
    const dim = this.dimensions();
    const mass = equippedMass(this.draftSummaryOccupants());
    const sheet = this.currentKpiSheet();
    const num = (v: number | null | undefined, unit: string): string | null =>
      v == null || !Number.isFinite(v) || v === 0 ? null : `${formatNumber(v)} ${unit}`;

    // "6.604 / 3.302 / 9.712" — only axes that actually exist; null when none do.
    const axes = crossSectionAxes(p.stats as Record<string, Record<string, unknown>> | undefined);
    const axisParts = [axes.x, axes.y, axes.z].filter((v): v is number => v != null);
    const crossSectionAxesLabel = axisParts.length > 0 ? axisParts.map((v) => formatNumber(v)).join(' / ') : null;

    const groups: ShipFactGroup[] = [
      {
        titleKey: 'codex.analysis.ship.flightPerformance',
        rows: [
          { labelKey: 'codex.hull.scmSpeed', value: num(flight?.scmSpeed, 'm/s'), gapKey: 'codex.summary.gap.noFlight' },
          { labelKey: 'codex.hull.maxSpeed', value: num(flight?.maxSpeed, 'm/s'), gapKey: 'codex.summary.gap.noFlight' },
          { labelKey: 'codex.hull.boostSpeed', value: num(flight?.boostSpeed, 'm/s'), gapKey: 'codex.summary.gap.noFlight' },
          { labelKey: 'codex.hull.pitch', value: num(flight?.pitch, '°/s'), gapKey: 'codex.summary.gap.noFlight' },
          { labelKey: 'codex.hull.yaw', value: num(flight?.yaw, '°/s'), gapKey: 'codex.summary.gap.noFlight' },
          { labelKey: 'codex.hull.roll', value: num(flight?.roll, '°/s'), gapKey: 'codex.summary.gap.noFlight' },
        ],
      },
      {
        titleKey: 'codex.analysis.ship.mass',
        rows: [{ labelKey: 'codex.hull.equippedMass', value: num(mass, 'kg'), gapKey: 'codex.summary.gap.noEquipmentMass' }],
        note: this.t.instant('codex.analysis.ship.massEquipmentNote'),
      },
      {
        titleKey: 'codex.analysis.ship.systems',
        rows: [
          { labelKey: 'codex.kpi.quantumSpeed', value: num(sheet.quantumSpeed, 'km/s'), gapKey: 'codex.summary.gap.noQuantum' },
          { labelKey: 'codex.kpi.quantumRange', value: sheet.quantumRange != null ? `${formatNumber(sheet.quantumRange / 1_000_000)} Gm` : null, gapKey: 'codex.summary.gap.noQuantum' },
          { labelKey: 'codex.kpi.spool', value: num(sheet.spool, 's'), gapKey: 'codex.summary.gap.noQuantum' },
        ],
      },
      {
        titleKey: 'codex.analysis.ship.signature',
        rows: [
          // IR/EM: the game files carry no scalar fields at all (verified live
          // Nomad) — distinct gap wording from the cross-section's "pending
          // upload" one.
          { labelKey: 'codex.kpi.ir', value: num(sheet.ir, ''), gapKey: 'codex.summary.gap.noEmissionModel' },
          { labelKey: 'codex.kpi.emIdle', value: num(sheet.emIdle, ''), gapKey: 'codex.summary.gap.noEmissionModel' },
          { labelKey: 'codex.kpi.emMax', value: num(sheet.emMax, ''), gapKey: 'codex.summary.gap.noEmissionModel' },
          // The three cross-section axes shown honestly (x/y/z), not
          // collapsed into one number — the KPI band uses the max of the
          // three for its single comparable cell (see crossSectionMax()).
          { labelKey: 'codex.kpi.crossSection', value: crossSectionAxesLabel, gapKey: 'codex.summary.gap.noSignature' },
        ],
        note: crossSectionAxesLabel != null ? this.t.instant('codex.analysis.ship.crossSectionNote') : null,
      },
      {
        titleKey: 'codex.analysis.ship.hull',
        rows: [
          { labelKey: 'codex.hull.dimensions', value: dim ? `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m` : null },
          { labelKey: 'codex.hull.crew', value: p.crew?.size ? String(p.crew.size) : null },
          { labelKey: 'codex.hull.hullHp', value: null, gapKey: 'codex.summary.gap.noHullMass' },
        ],
      },
    ];
    return groups;
  });

  /**
   * Sub-slots a mount exposes, read from the mount's OWN `itemPorts`: the gun
   * seat inside a gimbal, the two missile ports of a rack, the twin guns of a
   * remote turret.
   *
   * `carried` is the stock fit the ship's own loadout puts into those sub-ports
   * (uploader change for 1add86a4 — a gun mount names its gun there, which is
   * why the Nomad's repeaters used to be missing everywhere). A sub-port the
   * extract says nothing about keeps the sized placeholder it always had; the
   * mount never masquerades as the weapon either way.
   */
  /**
   * Overlay a top-level port's draft entry onto its STOCK display fields — the
   * caller keeps the STOCK values for grouping (`groupKey`), this is display
   * only. `undefined` draftValue = unchanged, `null` = emptied, a class name =
   * swapped, possibly still hydrating or possibly unresolvable (R6/R9).
   */
  private draftOverlayFor(
    path: string,
    draftValue: string | null | undefined,
    stockItem: { kind: CodexKind | null; payload: unknown; ammoPayload: unknown },
  ): {
    state: 'changed' | 'pending' | 'unresolved' | null;
    className: string | null;
    kind: CodexKind | null;
    name: string | null;
    size: number | null;
    grade: string | null;
    manufacturerCode: string | null;
    item: { kind: CodexKind | null; payload: unknown; ammoPayload: unknown };
  } {
    if (draftValue === undefined) {
      const l = this.loadoutAll().find((x) => x.port === path);
      return {
        state: null,
        className: l?.className ?? null,
        kind: l?.kind ?? null,
        name: l?.name ?? null,
        size: l?.size ?? null,
        grade: l?.grade ?? null,
        manufacturerCode: l?.manufacturerCode ?? null,
        item: stockItem,
      };
    }
    if (draftValue === null) {
      return {
        state: 'changed',
        className: null,
        kind: null,
        name: null,
        size: null,
        grade: null,
        manufacturerCode: null,
        item: { kind: null, payload: null, ammoPayload: undefined },
      };
    }
    if (this.unresolvableDraftPaths().has(path)) {
      return {
        state: 'unresolved',
        className: draftValue,
        kind: null,
        name: humanizeClassName(draftValue),
        size: null,
        grade: null,
        manufacturerCode: null,
        item: { kind: null, payload: null, ammoPayload: undefined },
      };
    }
    const hit = this.draftResolved().get(draftValue);
    const payloadHit = this.draftPayloads().get(draftValue);
    const pending = this.isDraftClassPending(draftValue) || !hit;
    return {
      state: pending ? 'pending' : 'changed',
      className: draftValue,
      kind: payloadHit?.kind ?? hit?.kind ?? null,
      name: cleanLocaleValue(hit?.nameLocalized) || draftValue,
      size: hit?.size ?? null,
      grade: hit?.grade ?? null,
      manufacturerCode: hit?.manufacturerCode ?? null,
      item: {
        kind: payloadHit?.kind ?? null,
        payload: payloadHit?.payload ?? null,
        ammoPayload: this.draftAmmoPayloads().get(ammoClassNameFor(draftValue) ?? ''),
      },
    };
  }

  private childrenFor(
    className: string | null,
    carried: ReadonlyMap<string, string>,
  ): LayoutChild[] {
    if (!className) return [];
    const payload = this.loadoutPayloads().get(className)?.payload as
      | { itemPorts?: ItemPort[] }
      | undefined;
    const resolved = this.loadoutEntities();
    return carriedSlots(
      payload?.itemPorts,
      carried,
      (cn) => {
        const hit = resolved.get(cn);
        return hit
          ? { kind: hit.kind, size: hit.size, displayName: cleanLocaleValue(hit.nameLocalized) }
          : undefined;
      },
      (portName) => this.humanizePort(portName),
    );
  }

  /**
   * The stock items sitting in the sub-slots of a hardpoint's occupant, as
   * summary occupants of the SAME block: a gimbal's gun belongs to the weapons
   * block, a rack's missiles to the missile block. Without this the Damage panel
   * would ignore every gun that is mounted through a gimbal — i.e. most of them.
   */
  private carriedOccupants(
    section: ShipModuleSection,
    carried: ReadonlyMap<string, string>,
  ): SummaryOccupant[] {
    const payloads = this.loadoutPayloads();
    const ammo = this.ammoPayloads();
    const out: SummaryOccupant[] = [];
    for (const className of carried.values()) {
      const hit = payloads.get(className);
      if (!hit) continue;
      out.push({
        section,
        kind: hit.kind,
        payload: hit.payload,
        ammoPayload: ammo.get(ammoClassNameFor(className) ?? ''),
        count: 1,
      });
    }
    return out;
  }

  /**
   * The module list: configurable blocks in the requested order, then the fixed
   * rest. Configurable blocks ALWAYS show every hardpoint — an unfitted mount
   * renders as an empty seat rather than disappearing, so the sections can
   * never come up blank. Only the fixed block still folds its empty ports away
   * behind the existing toggle (a capital ship has hundreds of them).
   */
  readonly moduleSections = computed<LayoutSection[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    // Jump range rendered as a chip directly on the quantum-drive slot (#137).
    const tech = this.techStats();
    const qdChip =
      tech?.quantumDriveClassName && tech.quantum.jumpRangeMm != null
        ? this.fmtGm(tech.quantum.jumpRangeMm)
        : null;
    const showEmpty = this.showEmptyLoadout();

    const buckets = new Map<ShipModuleSection, LayoutSlot[]>();
    for (const r of this.resolvedLoadout()) {
      const configurable = isConfigurableSection(r.section);
      // Only the AIRFRAME folds its unfitted ports away (a capital ship has
      // hundreds). A read-only block like the countermeasures is short and
      // still worth reading in full, so it keeps every bay.
      const fixedRest = r.section === 'structure';
      if (fixedRest && !r.item.className && !showEmpty) continue;
      const l = r.item;
      const item = { kind: r.kind, payload: r.payload, ammoPayload: r.ammoPayload };
      const children = fixedRest ? [] : this.childrenFor(l.className, l.carried);
      const fit = l.className ? undefined : this.emptyFits().get(l.port);
      // Grouping stays anchored to the STOCK identity, computed BEFORE any
      // draft overlay below — a per-slot draft edit can never split or
      // reorder a collapsed run mid-interaction (R5/Falle 4).
      const variantKey = children.map((c) => `${c.className ?? ''}:${c.count}`).join(',');
      const groupKey = `${l.className ?? ' '}|${l.size ?? ''}|${l.grade ?? ''}|${variantKey}`;

      const draftEntry = configurable ? this.draft().get(l.port) : undefined;
      const overlay = this.draftOverlayFor(l.port, draftEntry, item);

      const slot: LayoutSlot = {
        port: this.humanizePort(l.port),
        // Raw name kept alongside the label so the hull map can match the row.
        rawPort: l.port,
        className: overlay.className,
        kind: overlay.kind,
        name: overlay.name,
        size: overlay.size,
        grade: overlay.grade,
        manufacturerCode: overlay.manufacturerCode,
        statChip: qdChip && l.className === tech!.quantumDriveClassName ? qdChip : null,
        typeLabel: equippedTypeLabel(overlay.item),
        damageChannels: damageChannelsOf(overlay.item.payload, overlay.item.ammoPayload),
        stats: overlay.state === 'pending' ? [] : equippedStats(overlay.item),
        statsMissing: overlay.state === 'pending' ? false : weaponStatsUnavailable(overlay.item),
        children,
        portSize: this.portSizeOf(l.port) ?? fit?.size ?? null,
        // Two identical mounts holding different things must not collapse.
        variantKey,
        groupKey,
        // Every bay in an individual block, and every unfitted configurable
        // hardpoint, is a decision of its own and keeps its own row (1add86a4).
        noCollapse: isIndividualSection(r.section) || (configurable && !l.className),
        emptyLabelKey: isWeaponMountPort(l.port)
          ? 'codex.detail.loadoutEmptyWeaponMount'
          : null,
        emptySwappable: !!fit || (overlay.state === 'changed' && overlay.className === null),
        draftState: overlay.state,
        draftPaths: draftEntry !== undefined ? [l.port] : [],
      };
      const hit = buckets.get(r.section);
      if (hit) hit.push(slot);
      else buckets.set(r.section, [slot]);
    }
    // Configurable blocks are emitted even when the ship has none of that
    // hardpoint at all? No — an absent block says "this hull has no coolers",
    // which is information; an EMPTY block would just be noise.
    return [...buckets.entries()].map(([section, slots]) => ({
      section,
      slots,
      notes: this.sectionNotes(section),
    }));
  });

  // The shield block used to tag each row "Generator" or "Steuermodul" because
  // the control module sat inside it (1add86a4). 32659942 moved the controller
  // into the airframe — every row in the block is a shield again, so the tag
  // has nothing left to disambiguate and is gone with it.

  /** What a block can and cannot tell a pilot, said next to that block. */
  private sectionNotes(section: ShipModuleSection): SectionNote[] {
    if (section === 'weapons' && this.emptyWeaponMounts() > 0) {
      return [{ key: 'codex.equipped.armamentMissing', params: { count: this.emptyWeaponMounts() } }];
    }
    if (section === 'shields') return [{ key: 'codex.moduleSection.shieldsNote' }];
    if (section === 'countermeasures') return [{ key: 'codex.moduleSection.countermeasuresNote' }];
    return [];
  }

  /** Accepted size of a structural hardpoint, when `codex_item_ports` knows it. */
  private portSizeOf(portName: string | null): number | null {
    if (!portName) return null;
    const port = this.detail()?.ports.find((p) => p.portName === portName);
    if (!port) return null;
    return port.minSize != null && port.minSize === port.maxSize ? port.minSize : null;
  }

  /**
   * Hull HP, size and flight characteristics — the block under the panels.
   * Every row is rendered even when the value is missing ("—"), because the
   * ship undeniably HAS a hull and a top speed; only our extract does not.
   */
  readonly hullFacts = computed<HullFact[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const p = d.payload as ShipPayload | undefined;
    const dim = this.dimensions();
    const flight = p?.flight;
    const mass = equippedMass(this.summaryOccupants());
    const num = (v: number | null | undefined, unit: string): string | null =>
      v == null || !Number.isFinite(v) || v === 0 ? null : `${formatNumber(v)} ${unit}`;
    return [
      { labelKey: 'codex.hull.hullHp', value: null },
      {
        labelKey: 'codex.hull.dimensions',
        value: dim
          ? `${formatNumber(dim.length)} × ${formatNumber(dim.width)} × ${formatNumber(dim.height)} m`
          : null,
      },
      { labelKey: 'codex.hull.crew', value: p?.crew?.size ? String(p.crew.size) : null },
      { labelKey: 'codex.hull.equippedMass', value: num(mass, 'kg') },
      { labelKey: 'codex.hull.scmSpeed', value: num(flight?.scmSpeed, 'm/s') },
      { labelKey: 'codex.hull.maxSpeed', value: num(flight?.maxSpeed, 'm/s') },
      { labelKey: 'codex.hull.boostSpeed', value: num(flight?.boostSpeed, 'm/s') },
      { labelKey: 'codex.hull.pitch', value: num(flight?.pitch, '°/s') },
      { labelKey: 'codex.hull.yaw', value: num(flight?.yaw, '°/s') },
      { labelKey: 'codex.hull.roll', value: num(flight?.roll, '°/s') },
    ];
  });

  /** True while no flight number at all is in the extract — worth saying once. */
  readonly flightDataMissing = computed(() =>
    this.hullFacts()
      .filter((f) => f.labelKey.includes('Speed') || ['codex.hull.pitch', 'codex.hull.yaw', 'codex.hull.roll'].includes(f.labelKey))
      .every((f) => f.value === null),
  );

  // ── component overlay (461288f9) ────────────────────────────────────────────
  /** The occupant currently open in the full-stat overlay, or null. */
  readonly inspected = signal<ComponentInspectEntry | null>(null);

  /**
   * Open the overlay for a clicked card. A sub-slot with nothing resolvable in
   * it has no stats to show, so it stays inert rather than opening an empty
   * window.
   */
  openInspect(ev: LayoutTarget): void {
    const source = ev.child
      ? {
          className: ev.child.className,
          kind: ev.child.kind,
          name: ev.child.name,
          size: ev.child.size,
          grade: null as string | null,
          manufacturerCode: null as string | null,
          typeLabel: ev.child.typeLabel,
          port: ev.child.port,
        }
      : {
          className: ev.slot.className,
          kind: ev.slot.kind,
          name: ev.slot.name,
          size: ev.slot.size,
          grade: ev.slot.grade,
          manufacturerCode: ev.slot.manufacturerCode,
          typeLabel: ev.slot.typeLabel ?? null,
          port: ev.slot.port,
        };
    if (!source.className) return;
    const hit = this.loadoutPayloads().get(source.className);
    this.inspected.set({
      className: source.className,
      kind: hit?.kind ?? source.kind,
      name: source.name || humanizeClassName(source.className),
      port: source.port,
      count: ev.count,
      size: source.size,
      grade: source.grade,
      manufacturerCode: source.manufacturerCode,
      typeLabel: source.typeLabel,
      payload: hit?.payload ?? null,
      ammoPayload: this.ammoPayloads().get(ammoClassNameFor(source.className) ?? ''),
    });
  }

  closeInspect(): void {
    this.inspected.set(null);
  }

  /** Render one aggregated panel row with its unit. */
  fmtSummary(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }

  /**
   * The patch the catalog was extracted from, as a parenthetical for gap notes
   * that name it — empty when the build is not loaded yet, so the sentence
   * still reads. Read from the build, never from the translation file: a
   * version frozen into i18n keeps claiming the old patch after every upload.
   */
  readonly patchLabel = computed<string>(() => {
    const patch = this.svc.build()?.patchVersion?.trim();
    return patch ? ` (${patch})` : '';
  });

  /**
   * How many of the ship's weapon mounts have NO stock item in this extract.
   * Used to be nearly every mount on every hull, because the extractor read only
   * an entry's literal `entityClassName` and CIG names most stock fits by record
   * reference instead; the uploader resolves both now, so on a fresh extract
   * this is 0 for almost every ship. It stays here for the ones where the gap is
   * real — naming it beats letting a pilot conclude the ship is unarmed.
   */
  readonly emptyWeaponMounts = computed<number>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return 0;
    return this.loadoutAll().filter((l) => isWeaponMountPort(l.port) && !l.className).length;
  });

  /** jumpRange comes in metres → giga-metre display (Gm), same as the hangar. */
  private fmtGm(v: number): string {
    return `${formatNumber(Math.round(v / 1_000_000))} Gm`;
  }

  readonly damage = computed<DamageRow[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ammunition') return [];
    return ammoDamage(d.payload);
  });

  private readonly maxDamage = computed(() =>
    this.damage().reduce((m, r) => Math.max(m, r.value), 0),
  );

  damagePct(row: DamageRow): number {
    const max = this.maxDamage();
    return max > 0 ? Math.max(4, Math.round((row.value / max) * 100)) : 0;
  }

  /**
   * Ship equipment summary (weapon/shield/… counts) for the hero. Derived from
   * the INSTALLED default-loadout, not codex_item_ports — a ship's item_ports
   * are structural only (fuel/ATC/relay/lifesupport) and carry no weapon/shield
   * hardpoints, so the loadout is the only source that reflects real equipment.
   */
  readonly portSummary = computed<PortSummaryEntry[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const installed = this.loadoutAll().filter((l) => l.className);
    return summarizePorts(installed.map((l) => ({ types: [], portName: l.port })));
  });

  /** Hardpoints grouped into functional categories, in display order. */
  readonly hardpointGroups = computed<PortGroup[]>(() => {
    const d = this.detail();
    if (!d) return [];
    const buckets = new Map<HardpointCategory, CodexItemPort[]>();
    for (const port of d.ports) {
      const cat = categorizePort(port.types, port.portName);
      (buckets.get(cat) ?? buckets.set(cat, []).get(cat)!).push(port);
    }
    return HARDPOINT_CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
      category: c,
      ports: buckets.get(c)!,
    }));
  });

  private readonly loadoutAll = computed<LoadoutItem[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    const entries: LoadoutEntry[] = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    const resolved = this.loadoutEntities();
    return entries.map((e) => {
      const r = e.entityClassName ? resolved.get(e.entityClassName) : undefined;
      return {
        port: e.itemPortName || '—',
        className: e.entityClassName,
        kind: r?.kind ?? null,
        name: cleanLocaleValue(r?.nameLocalized) || e.entityClassName,
        size: r?.size ?? null,
        grade: r?.grade ?? null,
        manufacturerCode: r?.manufacturerCode ?? null,
        carried: carriedByPort(e),
      };
    });
  });

  readonly installedCount = computed(() => this.loadoutAll().filter((l) => l.className).length);
  readonly emptyLoadoutCount = computed(() => this.loadoutAll().filter((l) => !l.className).length);

  /**
   * Empty ports the toggle would reveal. Only the FIXED block folds anything
   * away now — every configurable section shows all of its hardpoints — so
   * counting a configurable empty here would promise rows the toggle never adds.
   */
  readonly hiddenEmptyCount = computed(
    () =>
      this.resolvedLoadout().filter((r) => r.section === 'structure' && !r.item.className).length,
  );

  /**
   * Default loadout grouped by the generic hardpoint category. Still the source
   * for the hero equipment summary; the ship's module list uses the richer
   * `moduleSections` above.
   */
  readonly loadoutGroups = computed<LoadoutGroup[]>(() => {
    const all = this.loadoutAll();
    if (all.length === 0) return [];
    const visible = this.showEmptyLoadout()
      ? all
      : all.filter((l) => l.className || isWeaponMountPort(l.port));
    const buckets = new Map<HardpointCategory, LoadoutItem[]>();
    for (const item of visible) {
      const cat = categorizePort([], item.port);
      (buckets.get(cat) ?? buckets.set(cat, []).get(cat)!).push(item);
    }
    return HARDPOINT_CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
      category: c,
      items: buckets.get(c)!,
    }));
  });

  readonly rawJson = computed(() => {
    const d = this.detail();
    return d ? JSON.stringify(d.payload, null, 2) : '';
  });

  // ── template helpers ─────────────────────────────────────────────────────────
  humanizePort(name: string | null): string {
    return name ? humanizePortType(name) : '—';
  }
  humanizeType(t: string): string {
    return humanizePortType(t);
  }
  fmt(n: number): string {
    return formatNumber(n);
  }
  humanizeName(cls: string): string {
    return humanizeClassName(cls);
  }
  fmtCraft(sec: number | null): string {
    return formatCraftTime(sec) ?? '';
  }

  isPinned(): boolean {
    const d = this.detail();
    return d ? this.svc.isPinned(d.kind, d.classNameSlug) : false;
  }
  togglePin(): void {
    const d = this.detail();
    if (d) this.svc.togglePin(d.kind, d.classNameSlug);
  }
  // ── user-supplied RSI pledge link (feedback f7d3bd9a) ───────────────────────
  // The typed value is validated client-side for a fast, friendly error, but
  // the `ship-link` edge function is the authority and re-validates everything.

  toggleLinkForm(): void {
    const next = !this.showLinkForm();
    this.showLinkForm.set(next);
    if (next) {
      this.shipLinkInput.set(this.myPledgeLink() ?? '');
      this.shipLinkError.set(null);
      this.shipLinkSaved.set(false);
    }
  }

  onShipLinkInput(e: Event): void {
    this.shipLinkInput.set((e.target as HTMLInputElement).value);
    if (this.shipLinkError()) this.shipLinkError.set(null);
    if (this.shipLinkSaved()) this.shipLinkSaved.set(false);
  }

  async saveShipLink(e: Event): Promise<void> {
    e.preventDefault();
    const slug = this.shipSlug();
    if (!slug) return;
    this.applyLinkResult(await this.shipLinks.setMyLink(slug, this.shipLinkInput()));
  }

  async removeShipLink(): Promise<void> {
    const slug = this.shipSlug();
    if (!slug) return;
    const err = await this.shipLinks.removeMyLink(slug);
    this.applyLinkResult(err);
    if (!err) this.shipLinkInput.set('');
  }

  /** ADMIN ONLY — publish the typed link for everyone. Server re-checks role. */
  async promoteShipLink(): Promise<void> {
    const slug = this.shipSlug();
    if (!slug) return;
    this.applyLinkResult(await this.shipLinks.promote(slug, this.shipLinkInput()));
  }

  /** ADMIN ONLY — withdraw the globally visible link. */
  async unpromoteShipLink(): Promise<void> {
    const slug = this.shipSlug();
    if (!slug) return;
    this.applyLinkResult(await this.shipLinks.unpromote(slug));
  }

  private shipSlug(): string | null {
    const d = this.detail();
    return d?.kind === 'ship' ? d.classNameSlug : null;
  }

  private applyLinkResult(err: string | null): void {
    this.shipLinkError.set(err);
    this.shipLinkSaved.set(err === null);
  }

  async addToHangar(): Promise<void> {
    const d = this.detail();
    if (d?.kind !== 'ship') return;
    const ship = await this.hangar.addShip(d.classNameSlug, 'owned');
    // UC-07: jump straight into the configurator instead of leaving a dead row.
    if (ship) await this.router.navigate(['/hangar/ship', ship.id]);
  }

  /** UC-07: open the hangar configurator for a ship already in the hangar. */
  configureLoadout(): void {
    const d = this.detail();
    const ship = d ? this.hangar.shipByClassName(d.classNameSlug) : null;
    void this.router.navigate(ship ? ['/hangar/ship', ship.id] : ['/hangar']);
  }
  toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }
  toggleEmptyLoadout(): void {
    this.showEmptyLoadout.update((v) => !v);
  }

  sizeRange(min: number | null, max: number | null): string {
    if (min == null && max == null) return '—';
    if (min === max || max == null) return 'S' + String(min ?? max);
    if (min == null) return 'S' + String(max);
    return `S${min}–${max}`;
  }
}
