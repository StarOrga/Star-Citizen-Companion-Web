import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ShipSkinsService } from '../ship-skins.service';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CodexDetail } from '../codex.service';
import { CodexItemPort } from '../codex.types';
import type { StageCountChip } from '../codex-detail.component';
import { HoloSilhouette, SilhouetteAnchor } from '../holo-silhouette';
import { MISSIONS, MissionId, missionById, missionDisabledReasonKey } from '../codex-mission';
import type { ShipCapabilities } from '../codex-mission';
import { KpiStripCell } from '../codex-kpi-sets';
import { formatEquippedStat, formatEquippedStatNumber } from '../codex-equipped-stats';
import type { EquippedStat } from '../codex-equipped-stats';
import { CodexRankCardComponent } from '../codex-rank-card.component';
import { RankProfileId, RankResult, RankScope, RankShipInput } from '../codex-rank';
import {
  CodexHardpointLayoutComponent,
  LayoutChild,
  LayoutSection,
  LayoutSlot,
  LayoutTarget,
} from '../codex-hardpoint-layout.component';
import { SHIP_MODULE_SECTION_ORDER, ShipModuleSection } from '../ship-module-sections';
import { ShipFactGroup } from '../codex-analysis-panels.component';
import { KpiSheet, OffensivePanel, DefensivePanel } from '../codex-loadout-stats';
import { BuildRef, PERSPECTIVE_KPIS, PERSPECTIVES, Perspective, PortOccupantMap } from '../codex-build-compare';
import { humanizeClassName } from '../codex-format';
import { CodexLoadoutSaveBarComponent } from '../codex-loadout-save-bar.component';
import { ShipHardpointMapComponent } from '../ship-hardpoint-map.component';
import { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import { HardpointPortRef, ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import { FallbackImageComponent } from '../fallback-image.component';
import { CodexHoloStripComponent } from './codex-holo-strip.component';
import { HangarPickerComponent, HangarPickerItem } from '../stage/hangar-picker.component';
import {
  CodexHoloPatchComponent,
  HoloPatchComparisonSide,
  HoloPatchKpiGhosts,
  PortPinBadge,
} from './codex-holo-patch.component';
import { CodexHoloShareComponent } from './codex-holo-share.component';
import { CodexHoloPerspectivesComponent, HoloGhost, HoloPerspectiveView } from './codex-holo-perspectives.component';
import { HangarShipConfig } from '../../hangar/hangar.types';
import type { CodexBuild } from '../codex.types';
import type { PowerSheet } from '../codex-power';
import type { SummaryOccupant } from '../ship-summary-panels';

/** One journal row — a single draft-changed hardpoint, sourced straight off
 * the same `LayoutSlot.draftState`/`draftPaths` the ports list already
 * renders per-row (#37). No new draft tracking, only a second read of it. */
interface JournalEntry {
  port: string;
  label: string;
  state: 'changed' | 'pending' | 'unresolved';
  paths: string[];
}

/** One pin on the silhouette: an anchored port, an unresolved one (dashed
 * fallback ring), or — per the wave1-redteam note — a port that is neither
 * (same dashed treatment; "pins derived from detail.ports, not from
 * anchors ∪ unresolved"). Numbered in ports-list order so the legend, the
 * inspector counter and the digit hotkeys all mean the same pin. */
interface StagePin {
  portName: string;
  index: number;
  x: number;
  y: number;
  resolved: boolean;
  /** Where the label sits relative to the dot — chosen so ring neighbours
   * never run into each other (top/bottom pins stack vertically). */
  side: 'right' | 'left' | 'above' | 'below';
  /** What sits in the port (occupant name, else the humanized port label). */
  label: string;
  /** Short value shown on hover ("Hover = Kurzwerte"): the row's first stat. */
  short: string | null;
  /** Missile racks pin gold (concept legend), everything else accent. */
  tone: 'accent' | 'gold';
  slot: LayoutSlot | null;
}

/** One perspective tile (concept round 10 "Weg B": four tiles). */
interface PerspectiveTile {
  id: Perspective;
  titleKey: string;
  /** Mean percentile of the ranked axes inside this perspective, null = gap. */
  pct: number | null;
  /** The headline cell ("2.359 DAUER-DPS") — the first key with a value. */
  lead: KpiStripCell | null;
  /** Up to three further cells rendered as mini tiles. */
  subs: readonly KpiStripCell[];
  /** The one-line reading ("Über dem Median …"), already translated. */
  say: string;
}

/** One segment of the Einsatz bar (the table's header): every mission with
 * its lead KPI, so the bar says what each Einsatz is about before you pick it. */
interface MissionSegment {
  id: MissionId;
  labelKey: string;
  sub: string;
  disabledKey: string | null;
}

/** One "Einordnung" top-3 row (user decision 1). */
interface TopCohortShip {
  className: string;
  displayName: string;
  value: number;
}

const SOUND_PREF_KEY = 'sc.codex.holo.sound';
const MOBILE_TABS_PREF_KEY = 'sc.codex.holo.mobileTabs';
const UNDO_TOAST_MS = 6000;
/** ≈1.6 s hero → table transformation (concept: "keine 5 Sekunden"). */
const ARRIVAL_MS = 1600;
/** Above this many pins the labels leave the canvas for the numbered key —
 * on a ring of ~250 px radius, 8 labels of 120–220 px is the most that
 * stays legible without collisions (wave 5 A2.4). */
const DENSE_PIN_COUNT = 8;
/** Digit hotkeys cover 1–9 and 0 (= 10); the inspector hint must not
 * promise more (wave 5 B1.4). */
const HOTKEY_PIN_MAX = 10;
/** Last-resort hull glyph (top-down, nose up, 100×100 viewBox) shown only
 * when a ship has neither a traced silhouette nor any artwork. */
const GENERIC_HULL_PATH =
  'M50 4 L56 18 L58 34 L74 46 L90 52 L90 58 L72 58 L64 66 L66 82 L60 88 L54 78 L50 90 L46 78 L40 88 L34 82 L36 66 L28 58 L10 58 L10 52 L26 46 L42 34 L44 18 Z';

/** The headline key per perspective, in preference order (first with a value wins). */
const PERSPECTIVE_LEAD: Readonly<Record<Perspective, readonly KpiStripCell['key'][]>> = {
  offensive: ['sustainedDps', 'burstDps', 'alpha', 'missiles'],
  defensive: ['shieldHp', 'hullHp', 'effectiveHp', 'shieldRegen', 'armorHp'],
  movement: ['boost', 'scm', 'maxSpeed', 'agility', 'quantumRange', 'mass', 'cargo'],
  signature: ['ir', 'emMax', 'crossSection', 'emIdle'],
};

/** Which rank profile the "Einordnung" follows for each Einsatz (concept
 * round 4: the left panel shows the profile, it never offers a second
 * selector). Missions without a profile of their own map to the nearest. */
const MISSION_RANK_PROFILE: Readonly<Record<MissionId, RankProfileId>> = {
  all: 'combat',
  combat: 'combat',
  transport: 'transport',
  travel: 'transport',
  stealth: 'defence',
  mining: 'transport',
  salvage: 'transport',
};

/**
 * The Holotable stage (concept 2026-09-20, rounds 1–10). Purely
 * presentational: every value comes in as an input from
 * `codex-detail.component.ts`, which keeps owning the modals, swap picker,
 * weapon detail, compare tray, draft persistence and hover-sync
 * `activePorts` for BOTH views.
 *
 * Layout (hv6-s1 / hv6-s4 / hv10-s1): top bar = search | hangar tab docked
 * on the table | patch chooser; three panels in one frame = Einordnung |
 * Tisch (Einsatz bar as its header, rings, numbered pins, legend) |
 * Inspector (+ "Zuletzt geändert" journal with the save bar); below =
 * calm ports list | four perspective tiles; details drawer; sticky strip.
 */
@Component({
  selector: 'sc-codex-holo-stage',
  standalone: true,
  imports: [
    TranslateModule,
    RouterLink,
    CodexRankCardComponent,
    CodexHardpointLayoutComponent,
    CodexHoloPerspectivesComponent,
    CodexLoadoutSaveBarComponent,
    ShipHardpointMapComponent,
    ShipSkinViewerComponent,
    FallbackImageComponent,
    CodexHoloStripComponent,
    HangarPickerComponent,
    CodexHoloPatchComponent,
    CodexHoloShareComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="holo-stage" [class.reduced-motion]="reducedMotion()" [class.arrived]="arrived()"
             [class.left-collapsed]="leftCollapsed()" [class.right-collapsed]="rightCollapsed()">

      <!-- ── Top bar: search | (hangar tab docks on the table) | patch ── -->
      <div class="holo-topbar">
        <form class="ht-search" role="search" (submit)="submitSearch($event)">
          <svg class="ht-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" /><line x1="15.5" y1="15.5" x2="21" y2="21" />
          </svg>
          <input class="ht-input" type="search" name="q"
                 [attr.aria-label]="'codex.holo.stage.searchLabel' | translate"
                 [placeholder]="'codex.holo.stage.searchPlaceholder' | translate" />
          <kbd>↵</kbd>
        </form>
        <div class="ht-mid" aria-hidden="true"></div>
        <div class="ht-right">
          <!-- slot: patch-delta trigger -->
          @if (buildRef(); as ab) {
            <sc-codex-holo-patch
              [className]="detail().classNameSlug"
              [channel]="channel()"
              [activeBuild]="ab"
              [activeKpiSheet]="activeKpiSheet()"
              [activeOccupants]="activeOccupants()"
              [resolveComparisonSide]="resolveComparisonSide()"
              (kpiGhosts)="patchGhosts.set($event)"
              (portPins)="patchPortPins.set($event)"
              (comparisonBuild)="patchComparisonBuild.set($event)" />
          }
        </div>
      </div>

      <!-- Mobile "Tisch | Daten" tab control (user decision 5, default = stacked) -->
      @if (mobileTabsEnabled()) {
        <div class="mobile-tabs" role="tablist">
          <button type="button" role="tab" [attr.aria-selected]="mobileTab() === 'table'" (click)="mobileTab.set('table')">{{ 'codex.holo.stage.tabTable' | translate }}</button>
          <button type="button" role="tab" [attr.aria-selected]="mobileTab() === 'data'" (click)="mobileTab.set('data')">{{ 'codex.holo.stage.tabData' | translate }}</button>
        </div>
      }

      <div class="holo-body" [class.mobile-hide-table]="mobileTabsEnabled() && mobileTab() !== 'table'" [class.mobile-hide-data]="mobileTabsEnabled() && mobileTab() !== 'data'">
        <!-- ── Left panel: Einordnung ─────────────────────────────── -->
        <aside class="holo-panel holo-left mobile-data" [class.collapsed]="leftCollapsed()">
          <div class="ph">
            <span class="ph-glyph" aria-hidden="true">◈</span>
            <span class="ph-title">{{ 'codex.holo.stage.einordnung' | translate }}</span>
            @if (rankResult(); as r) { <span class="n">{{ r.cohortSize }}</span> }
            <span class="sp"></span>
            <button type="button" class="ic" (click)="leftCollapsed.set(!leftCollapsed())"
                    [attr.aria-expanded]="!leftCollapsed()"
                    [attr.aria-label]="'codex.holo.stage.railToggle' | translate"
                    [title]="'codex.holo.stage.railToggle' | translate">{{ leftCollapsed() ? '⟩' : '⟨' }}</button>
          </div>
          @if (leftCollapsed()) {
            <div class="pb rail-min"><span class="vi">{{ 'codex.holo.stage.einordnung' | translate }}</span></div>
          } @else {
            <div class="pb frame">
              <div class="wm" aria-hidden="true">{{ ('codex.mission.' + activeMissionId()) | translate }}</div>
              <div class="statics">
                <div [attr.title]="staticChipTitle('crew')"><span class="k">{{ 'codex.holo.stage.staticCrew' | translate }}</span><span class="v">{{ staticChip('crew') }}</span></div>
                <div [attr.title]="staticChipTitle('mass')"><span class="k">{{ 'codex.holo.stage.staticMass' | translate }}</span><span class="v">{{ staticChip('mass') }}</span></div>
                <div [attr.title]="staticChipTitle('cargo')"><span class="k">{{ 'codex.holo.stage.staticCargo' | translate }}</span><span class="v" [class.long]="staticChip('cargo').length > 7">{{ staticChip('cargo') }}</span></div>
              </div>
              <sc-codex-rank-card
                [holo]="true"
                [shipName]="displayName()"
                [sizeClass]="null"
                [result]="rankResult()"
                [loading]="rankLoading()"
                [profile]="rankProfile()"
                [scope]="rankScope()"
                [disabledReasons]="rankDisabledReasons()"
                (profileChange)="rankProfileChange.emit($event)"
                (scopeChange)="rankScopeChange.emit($event)" />
              @if (topCohortShips().length > 0) {
                <div class="sub"><span>{{ 'codex.holo.stage.top3' | translate }}</span><i></i></div>
                <ol class="top3">
                  @for (s of topCohortShips(); track s.className) {
                    <li><a [routerLink]="['/codex', 'ship', s.className]">{{ s.displayName }}</a></li>
                  }
                </ol>
              }
              <a class="cohort-link" routerLink="/codex/index" [queryParams]="{ kind: 'ship' }">
                {{ 'codex.holo.stage.cohortLink' | translate }} ›
              </a>
            </div>
          }
        </aside>

        <!-- ── Table: Einsatz header, rings, silhouette, pins, legend ── -->
        <section class="holo-panel holo-table mobile-table">
          <!-- slot: hangar-tab (round 16-17, N4): the same HangarPicker as the
               Codex landing and the classic hero, top-left inside the table —
               one component, one behaviour, the same "top 3 recently chosen"
               source. Replaces the golden sc-codex-holo-hangar tab+overlay
               (kept in the tree, unused, per the round-17 decision text). -->
          <div class="ph role">
            <div class="rolebar" role="radiogroup" [attr.aria-label]="'codex.mission.label' | translate">
              <span class="lab">{{ 'codex.mission.label' | translate }}</span>
              @for (m of missionSegments(); track m.id) {
                <button type="button" class="r" role="radio"
                        [class.on]="m.id === activeMissionId()"
                        [class.dim]="!!m.disabledKey"
                        [disabled]="!!m.disabledKey"
                        [attr.aria-checked]="m.id === activeMissionId()"
                        [attr.title]="m.disabledKey ? (m.disabledKey | translate) : null"
                        (click)="missionChange.emit(m.id)">
                  <span class="r-l">{{ m.labelKey | translate }}</span>
                  <small>{{ m.sub }}</small>
                </button>
              }
            </div>
          </div>
          <div class="pb">
            <div class="rings" aria-hidden="true"></div>

            <!-- Table head — ONE flow row, never absolute overlays (wave 5
                 A2.1): hangar dock | eyebrow (ellipsis) | view tools. -->
            <div class="table-head">
              <!-- slot: hangar-tab (round 16-17, N4): the same HangarPicker as
                   the Codex landing and the classic hero. -->
              <div class="hangar-dock">
                <sc-hangar-picker
                  kind="ship"
                  [docked]="true"
                  [items]="hangarPickerItems()"
                  [linkQueryParams]="{ view: 'holo' }"
                  (pick)="hangarPick.emit($event)"
                  (open)="hangarOpen.emit()" />
              </div>
              <p class="table-eyebrow" [attr.title]="eyebrowTitle()">
                @if (manufacturerName(); as mfr) { <span>{{ mfr }}</span> · }<b>{{ displayName() }}</b>
                @if (!silhouette() && viewMode() === 'holo') {
                  <span class="no-geometry-badge" [title]="'codex.holo.stage.noGeometryReason' | translate">&nbsp;· {{ 'codex.holo.noGeometry' | translate }}</span>
                }
              </p>
              <div class="tools5" [class.open]="sharePopoverOpen()">
                @if (has3d()) {
                  <button type="button" class="tt" [class.on]="viewMode() === '3d'" [attr.aria-pressed]="viewMode() === '3d'" (click)="toggleViewMode('3d')">{{ 'codex.holo.stage.view3d' | translate }}</button>
                }
                <button type="button" class="tt" [class.on]="viewMode() === 'schema'" [attr.aria-pressed]="viewMode() === 'schema'"
                        [disabled]="!hardpointFrame()"
                        [attr.title]="hardpointFrame() ? null : ('codex.holo.stage.viewSchemaUnavailable' | translate)"
                        (click)="toggleViewMode('schema')">{{ 'codex.holo.stage.viewSchema' | translate }}</button>
                <span class="share-wrap" (keydown.escape)="closeShare($event)">
                  <button type="button" class="tt" [class.on]="sharePopoverOpen()" [attr.aria-expanded]="sharePopoverOpen()" (click)="toggleShare()">↗ {{ 'codex.holo.stage.viewShare' | translate }}</button>
                  @if (sharePopoverOpen()) {
                    <!-- slot: share -->
                    <sc-codex-holo-share
                      class="share-popover"
                      [config]="myConfig()"
                      [shipClassName]="detail().classNameSlug"
                      [channel]="channel()"
                      [patchVersion]="patchVersion()"
                      [linkCopied]="linkCopied()"
                      [signedIn]="!!userId()"
                      [inHangar]="inHangar()"
                      [unsavedChanges]="draftChangedCount()"
                      (copyCurrentLink)="copyShareLink.emit()"
                      (addToHangar)="addToHangar.emit()"
                      (configRefreshed)="configRefreshed.emit($event)" />
                  }
                </span>
              </div>
            </div>

            <div class="silhouette-frame" [class.mode-3d]="viewMode() === '3d'" [class.mode-schema]="viewMode() === 'schema'">
              <!-- Arrival (concept hv3-s1): the hero art is the loading image
                   and transforms into the table — no click, ≈1.6 s, a cut on
                   reduced motion or a repeat visit. -->
              @if (!arrived() && heroArt().length > 0) {
                <sc-fallback-image class="hero-art" [candidates]="heroArt()" [alt]="displayName()" [eager]="true" />
              }
              @if (viewMode() === '3d') {
                <sc-ship-skin-viewer class="mode-viewer" [shipId]="shipClassName()" [embedded]="true"
                  [hardpointPorts]="hardpointPortRefs()" [activePorts]="activePorts()"
                  (hovered)="hovered.emit($event)" (available)="artAvailable.emit($event)" />
              } @else if (viewMode() === 'schema' && hardpointFrame(); as frame) {
                <sc-ship-hardpoint-map class="mode-viewer" [markers]="hardpointMarkersMutable()" [frame]="frame"
                  [activePorts]="activePorts()" (hovered)="hovered.emit($event)" />
              } @else {
                <div class="shipwrap" [class.no-geometry]="!silhouette()" [class.dense]="dense()" [class.empty]="pins().length === 0">
                  @if (silhouette(); as s) {
                    <svg class="silhouette" [attr.viewBox]="s.viewBox" preserveAspectRatio="xMidYMid meet" role="img"
                         [attr.aria-label]="'codex.holo.stage.silhouetteAria' | translate: { name: displayName() }">
                      <path class="glow" [attr.d]="s.path" fill-rule="evenodd" />
                      <path class="hull" [attr.d]="s.path" fill-rule="evenodd" />
                    </svg>
                  } @else {
                    <!-- No traced silhouette for this hull (wave 5 A3.2): the
                         default is the hull's own artwork (RSI render, else the
                         game's flat previewImage) in a holo treatment — and
                         only when even that is missing, a generic hull glyph.
                         Never a client-side guess of the real outline. -->
                    <div class="silhouette-placeholder" role="img" [attr.aria-label]="'codex.holo.stage.placeholderAria' | translate: { name: displayName() }">
                      <span class="ring"></span>
                      <span class="ring inner"></span>
                      @if (previewSilhouette() && !previewFailed()) {
                        <!-- The game's own flat top-down icon (nose right in the
                             file) — the closest thing to a traced outline. -->
                        <img class="ghost-icon" [src]="previewSilhouette()" alt="" aria-hidden="true" (error)="previewFailed.set(true)" />
                      } @else if (heroArt().length > 0) {
                        <div class="ghost-art" aria-hidden="true">
                          <sc-fallback-image [candidates]="heroArt()" [alt]="''" [eager]="true">
                            <svg class="generic-hull" viewBox="0 0 100 100" aria-hidden="true"><path [attr.d]="GENERIC_HULL" /></svg>
                          </sc-fallback-image>
                        </div>
                      } @else {
                        <svg class="generic-hull" viewBox="0 0 100 100" aria-hidden="true"><path [attr.d]="GENERIC_HULL" /></svg>
                      }
                    </div>
                  }
                  @if (pins().length === 0) {
                    <p class="table-empty">{{ 'codex.holo.stage.noPorts' | translate }}</p>
                  }
                  @for (pin of pins(); track pin.portName) {
                    <button
                      type="button"
                      class="pin"
                      [class.unresolved]="!pin.resolved"
                      [class.gold]="pin.tone === 'gold'"
                      [class.active]="activePorts().includes(pin.portName)"
                      [class.sel]="inspectedPort() === pin.portName"
                      [class.patched]="!!patchPortPins()?.[pin.portName]"
                      [class.rev]="pin.side === 'left'"
                      [class.pos-b]="pin.side === 'below'"
                      [class.pos-t]="pin.side === 'above'"
                      [style.left.%]="pin.x"
                      [style.top.%]="pin.y"
                      [attr.aria-pressed]="inspectedPort() === pin.portName"
                      [attr.title]="pin.resolved ? pin.label : (pin.label + ' · ' + ('codex.holo.pinUnresolved' | translate))"
                      (mouseenter)="hovered.emit([pin.portName])"
                      (mouseleave)="hovered.emit(null)"
                      (focus)="hovered.emit([pin.portName])"
                      (blur)="hovered.emit(null)"
                      (click)="inspectPin(pin.portName)">
                      <i aria-hidden="true">{{ pin.index }}</i>
                      <span class="pin-label">
                        {{ pin.label }}
                        @if (pin.short && (activePorts().includes(pin.portName) || inspectedPort() === pin.portName)) {
                          <em>· {{ pin.short }}</em>
                        }
                      </span>
                    </button>
                  }
                </div>
              }
            </div>

            <!-- Dense tables (wave 5 A2.4): labels leave the pins and become a
                 numbered key under the table — hover/click work like the pins. -->
            @if (dense() && viewMode() === 'holo') {
              <ol class="pin-key" [attr.aria-label]="'codex.holo.stage.pinKey' | translate">
                @for (pin of pins(); track pin.portName) {
                  <li>
                    <button type="button" class="pk"
                            [class.gold]="pin.tone === 'gold'"
                            [class.active]="activePorts().includes(pin.portName)"
                            [class.sel]="inspectedPort() === pin.portName"
                            (mouseenter)="hovered.emit([pin.portName])"
                            (mouseleave)="hovered.emit(null)"
                            (focus)="hovered.emit([pin.portName])"
                            (blur)="hovered.emit(null)"
                            (click)="inspectPin(pin.portName)">
                      <i aria-hidden="true">{{ pin.index }}</i><span>{{ pin.label }}</span>
                    </button>
                  </li>
                }
              </ol>
            }

            <div class="legend">
              <span><i aria-hidden="true"></i>{{ 'codex.holo.stage.legendConfigurable' | translate }}</span>
              <span><i class="g" aria-hidden="true"></i>{{ 'codex.holo.stage.legendMissiles' | translate }}</span>
              @if (hasUnresolvedPins()) {
                <span><i class="u" aria-hidden="true"></i>{{ 'codex.holo.stage.legendUnresolved' | translate }}</span>
              }
              <span class="legend-hint">{{ 'codex.holo.stage.legendHint' | translate }}</span>
            </div>
          </div>
        </section>

        <!-- ── Right panel: Inspector + "Zuletzt geändert" ──────────── -->
        <aside class="holo-panel holo-right mobile-data" [class.collapsed]="rightCollapsed()">
          <div class="ph">
            <span class="ph-glyph" aria-hidden="true">ⓘ</span>
            <span class="ph-title">{{ 'codex.holo.stage.inspector' | translate }}</span>
            <span class="n">{{ inspectedIndex() }} / {{ pins().length }}</span>
            <span class="sp"></span>
            <button type="button" class="ic" (click)="rightCollapsed.set(!rightCollapsed())"
                    [attr.aria-expanded]="!rightCollapsed()"
                    [attr.aria-label]="'codex.holo.stage.railToggle' | translate"
                    [title]="'codex.holo.stage.railToggle' | translate">{{ rightCollapsed() ? '⟨' : '⟩' }}</button>
          </div>
          @if (rightCollapsed()) {
            <div class="pb rail-min"><span class="vi">{{ 'codex.holo.stage.inspector' | translate }}</span></div>
          } @else {
            <div class="pb">
              @if (inspectorTarget(); as it) {
                <div class="inspector" role="region" [attr.aria-label]="'codex.holo.stage.inspector' | translate">
                  <div class="insp-head">
                    @if (sizeBadge(it.slot); as b) { <span class="size-tag">{{ b }}</span> }
                    <div class="insp-ident">
                      <b>{{ it.slot.name ?? ((it.slot.emptyLabelKey ?? 'codex.holo.stage.emptyBay') | translate) }}</b>
                      <small>{{ inspectorMeta(it.slot) }}</small>
                    </div>
                    <button type="button" class="inspector-close" (click)="inspectedPort.set(null)"
                            [attr.aria-label]="'codex.swap.close' | translate"
                            [title]="('codex.swap.close' | translate) + ' (Esc)'">✕</button>
                  </div>
                  @if (inspectedPort() && patchPortPins()?.[inspectedPort()!]; as pin) {
                    <!-- slot: patch-delta — the per-PORT occupant delta for the pin under inspection -->
                    <p class="inspector-patch-delta" [class.unresolved]="pin.unresolved">
                      {{ pin.fromClassName ?? '—' }} → {{ pin.unresolved ? ('codex.holo.pinUnresolved' | translate) : (pin.toClassName ?? '—') }}
                    </p>
                  }
                  @if (inspectorStats(it.slot).length > 0) {
                    <dl class="insp-stats">
                      @for (st of inspectorStats(it.slot); track st.labelKey) {
                        <div><dt>{{ st.labelKey | translate }}</dt><dd>{{ fmtStat(st) }}</dd></div>
                      }
                    </dl>
                  }
                  @if (it.slot.draftState; as ds) {
                    <p class="insp-draft">
                      <span class="tag draft" [class.pending]="ds === 'pending'" [class.unresolved]="ds === 'unresolved'">{{ ('codex.loadout.draftState.' + ds) | translate }}</span>
                      @if (it.slot.draftPaths?.length) {
                        <button type="button" class="lnk" (click)="reverted.emit(it.slot.draftPaths!)">{{ 'codex.loadout.revert' | translate }}</button>
                      }
                    </p>
                  }
                  @if (!inspectorIsRawPort()) {
                    <div class="insp-actions">
                      <button type="button" class="btn" (click)="swapRequested.emit(it)">⇄ {{ 'codex.swap.open' | translate }}</button>
                      <button type="button" class="btn quiet" (click)="inspected.emit(it)">{{ 'codex.inspect.openStats' | translate }}</button>
                    </div>
                  } @else {
                    <p class="mut">{{ 'codex.holo.stage.rawPortHint' | translate }}</p>
                  }
                  <!-- What the mount carries (the gun in the gimbal, the
                       missiles in the rack) — the thing that actually shoots. -->
                  @for (kid of it.slot.children ?? []; track kid.port) {
                    <div class="insp-kid" [class.empty]="!kid.className">
                      <div class="insp-head">
                        @if (kid.size != null) { <span class="size-tag">{{ kid.count > 1 ? kid.count + '×' : '' }}S{{ kid.size }}</span> }
                        <div class="insp-ident">
                          <b>{{ kid.name ?? '—' }}</b>
                          <small>{{ kidMeta(kid) }}</small>
                        </div>
                      </div>
                      @if (kid.stats?.length) {
                        <dl class="insp-stats">
                          @for (st of kid.stats!.slice(0, 4); track st.labelKey) {
                            <div><dt>{{ st.labelKey | translate }}</dt><dd>{{ fmtStat(st) }}</dd></div>
                          }
                        </dl>
                      }
                      <div class="insp-actions">
                        @if (kid.className || kid.rawTypes.length > 0) {
                          <button type="button" class="btn quiet" (click)="swapRequested.emit(childTarget(it, kid))">⇄ {{ 'codex.swap.open' | translate }}</button>
                        }
                        @if (kid.className) {
                          <button type="button" class="btn quiet" (click)="inspected.emit(childTarget(it, kid))">{{ 'codex.inspect.openStats' | translate }}</button>
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <div class="empty">
                  <b>{{ 'codex.holo.stage.inspectorEmptyTitle' | translate }}</b>
                  @if (hotkeyPinCount() > 0) {
                    {{ 'codex.holo.stage.inspectorEmptyBody' | translate: { n: hotkeyPinCount() } }}
                  } @else {
                    {{ 'codex.holo.stage.noPorts' | translate }}
                  }
                </div>
              }

              <div class="card flat">
                <div class="h2"><span>{{ 'codex.holo.stage.journal' | translate }}</span><span class="rule"></span></div>
                @if (journal().length === 0) {
                  <p class="mut">{{ 'codex.holo.stage.journalEmpty' | translate }}</p>
                } @else {
                  <ul class="journal">
                    @for (e of journal(); track e.port) {
                      <li>
                        <span class="j-label">{{ e.label }}</span>
                        <span class="j-state">{{ ('codex.loadout.draftState.' + e.state) | translate }}</span>
                        <button type="button" class="lnk" (click)="reverted.emit(e.paths)">{{ 'codex.holo.stage.undo' | translate }}</button>
                      </li>
                    }
                  </ul>
                  <sc-codex-loadout-save-bar
                    class="draft-controls"
                    [changed]="draftChangedCount()"
                    [saveable]="saveableCount()"
                    [saving]="saving()"
                    [error]="saveError()"
                    [inHangar]="inHangar()"
                    (save)="saveDraft.emit()"
                    (discard)="discardDraft.emit()"
                    (addAndSave)="saveDraft.emit()" />
                  <button type="button" class="lnk" (click)="reverted.emit(journalAllPaths())">
                    {{ 'codex.detail.actionFactoryLoadout' | translate }}
                  </button>
                }
              </div>
            </div>
          }
        </aside>
      </div>

      <!-- ── Below: calm ports list | four perspectives ─────────────── -->
      <div class="holo-below mobile-data">
        <section class="below-ports">
          <div class="sh">
            <span class="t">{{ 'codex.holo.stage.allPorts' | translate: { n: pins().length } }}</span>
            <span class="rule"></span>
          </div>
          <sc-codex-hardpoint-layout
            [calm]="true"
            [sections]="allSectionsMutable()"
            [locatablePorts]="locatablePorts()"
            [activePorts]="activePorts()"
            (reverted)="reverted.emit($event)"
            (hovered)="hovered.emit($event)"
            (inspected)="inspected.emit($event)"
            (swapRequested)="swapRequested.emit($event)" />
        </section>

        <sc-codex-holo-perspectives
          class="below-persp"
          [tiles]="perspectiveViews()"
          [missionLabelKey]="'codex.mission.' + activeMissionId()"
          [cohortSize]="rankResult()?.cohortSize ?? null"
          [pulse]="pulseTile()"
          [offensivePanel]="offensivePanel()"
          [defensivePanel]="defensivePanel()"
          [shipFactGroups]="shipFactGroups()" />
      </div>

      <!-- Undo toast (concept fb-journal: "Undo gern einfach als toast") -->
      @if (undoToast(); as toast) {
        <div class="undo-toast" role="status">
          <span>{{ 'codex.holo.stage.journalChanged' | translate: { label: toast.label } }}</span>
          <button type="button" class="btn quiet" (click)="undoToastAction()">{{ 'codex.holo.stage.undo' | translate }}</button>
        </div>
      }

      <!-- ── Details drawer (everything with no other home) ──────────── -->
      <section class="holo-details mobile-data">
        <div class="sh">
          <button type="button" class="details-toggle" (click)="detailsOpen.set(!detailsOpen())"
                  [attr.aria-expanded]="detailsOpen()">
            {{ (detailsOpen() ? 'codex.holo.stage.detailsHide' : 'codex.holo.stage.detailsShow') | translate }}
          </button>
          <span class="rule"></span>
          <label class="switch">
            <input type="checkbox" [checked]="soundOn()" (change)="toggleSound()" />
            <span class="track" aria-hidden="true"></span>
            {{ 'codex.holo.stage.sound' | translate }}
          </label>
          <label class="switch mobile-only">
            <input type="checkbox" [checked]="mobileTabsEnabled()" (change)="toggleMobileTabs()" />
            <span class="track" aria-hidden="true"></span>
            {{ 'codex.holo.stage.mobileTabsSetting' | translate }}
          </label>
        </div>
        @if (detailsOpen()) {
          <div class="details-body">
            <ng-content></ng-content>
          </div>
        }
      </section>

      <!-- slot: strip — sticky bottom (mobile: sticky KPI row via its own CSS) -->
      <sc-codex-holo-strip
        [occupants]="occupants()"
        [shipStats]="shipStats()"
        [shipClassName]="shipClassName()"
        [schemaVersion]="schemaVersion()"
        [userId]="userId()"
        [crossSection]="crossSection()"
        [cells]="allKpiCells()"
        [active]="activeMissionId()"
        [capabilities]="shipCapabilities()"
        [rankResult]="rankResult()"
        [rankCohortLoading]="rankLoading()"
        (sheetChange)="sheetChange.emit($event)" />
    </section>
  `,
  styles: [
`
  :host { display: block; }
  .holo-stage {
  --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, "Share Tech Mono", monospace);
  --l1: var(--sc-border); --l2: var(--border-default, color-mix(in srgb, var(--sc-accent) 30%, transparent));
  --glass: color-mix(in srgb, var(--sc-bg-1) 55%, transparent); --ink: color-mix(in srgb, var(--sc-bg-0) 78%, transparent);
  --holo-gold: var(--accent-gold, #c8a84b); --holo-gold-rgb: var(--accent-gold-rgb, 200, 168, 75);
  --a4: color-mix(in srgb, var(--sc-accent) 4%, transparent); --a5: color-mix(in srgb, var(--sc-accent) 5%, transparent); --a7: color-mix(in srgb, var(--sc-accent) 7%, transparent); --a10: color-mix(in srgb, var(--sc-accent) 10%, transparent); --a12: color-mix(in srgb, var(--sc-accent) 12%, transparent); --a14: color-mix(in srgb, var(--sc-accent) 14%, transparent); --a22: color-mix(in srgb, var(--sc-accent) 22%, transparent); --a28: color-mix(in srgb, var(--sc-accent) 28%, transparent); --a40: color-mix(in srgb, var(--sc-accent) 40%, transparent); --a50: color-mix(in srgb, var(--sc-accent) 50%, transparent); --a55: color-mix(in srgb, var(--sc-accent) 55%, transparent); --a80: color-mix(in srgb, var(--sc-accent) 80%, transparent);
  --p-offensive: var(--sc-accent); --p-defensive: var(--cat-game, #c07888); --p-movement: var(--sc-success); --p-signature: var(--holo-gold);
  display: flex; flex-direction: column; gap: 10px; padding-bottom: 96px;
  }
  .btn, .table-eyebrow, .mobile-tabs button, .holo-panel > .ph, .rail-min .vi, .wm, .statics .k, .sub, .rolebar .r, .tt, .pin-label, .legend, .empty b, .insp-stats dt, .h2, .sh, .details-toggle, .switch { font-family: var(--d); text-transform: uppercase; }
  .n { font-family: var(--m); font-size: max(10px, var(--f)); color: var(--sc-fg-1); background: var(--sc-bg-2); padding: 0 6px; border-radius: 2px; letter-spacing: 0; }
  .sp { flex: 1; }
  .rule { flex: 1; height: 1px; background: var(--l1); }
  .lnk { background: none; border: none; padding: 0; color: var(--sc-accent); cursor: pointer; font: inherit; font-size: max(11px, var(--f)); min-height: var(--sc-tap-min, 24px); }
  .btn { min-height: var(--sc-tap-min, 32px); padding: 5px 12px; border-radius: 3px; border: 1px solid var(--l2);
 background: var(--a10); color: var(--sc-fg-0); cursor: pointer; font: inherit;
 font-size: max(11px, var(--f)); letter-spacing: 0.08em; }
  .btn.quiet { background: none; border-color: var(--l1); color: var(--sc-fg-1); }
  .btn:hover, .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
  .holo-topbar { display: grid; grid-template-columns: minmax(220px, 380px) 1fr auto; align-items: center; gap: 12px; }
  .ht-search { display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--l2); border-radius: 3px;
  background: var(--surface-input, var(--sc-bg-0)); color: var(--sc-fg-2); min-height: var(--sc-tap-min, 34px); }
  .ht-icon { width: 15px; height: 15px; flex: none; }
  .ht-input { flex: 1; min-width: 0; background: none; border: none; color: var(--sc-fg-0); font: inherit; font-size: max(12px, var(--f)); padding: 7px 0; outline: none; }
  .ht-input::placeholder { color: var(--sc-fg-2); }
  .ht-search:focus-within { border-color: var(--sc-accent); }
  .ht-search kbd { font-family: var(--m); font-size: 10px; color: var(--sc-fg-2); border: 1px solid var(--l1); padding: 0 5px; border-radius: 2px; }
  .ht-mid { min-height: 34px; }
  .table-head { position: relative; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 8px 12px 0; min-height: 40px; }
  .table-eyebrow { flex: 1; min-width: 0; margin: 0; font-size: max(9.5px, var(--f)); color: var(--sc-fg-2);
 letter-spacing: 0.14em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .table-eyebrow b { font-weight: 400; color: var(--sc-fg-0); }
  .ht-right { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
  .mobile-tabs { display: none; gap: 6px; }
  .mobile-tabs button { flex: 1; min-height: var(--sc-tap-min, 32px); padding: 6px 10px; border-radius: 3px; border: 1px solid var(--l2); background: var(--glass); color: var(--sc-fg-1); cursor: pointer;
 font-size: max(10px, var(--f)); letter-spacing: 0.14em; }
  .mobile-tabs button[aria-selected="true"] { color: var(--sc-accent); border-color: var(--sc-accent); }
  .mobile-only { display: none; }
  .holo-body { display: grid; grid-template-columns: var(--rail) minmax(0, 1fr) var(--rail); gap: 10px; align-items: stretch;
  padding: 10px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent); border-radius: 4px; }
  .holo-stage { --rail: 300px; }
  .left-collapsed .holo-body { grid-template-columns: 44px minmax(0, 1fr) var(--rail); }
  .right-collapsed .holo-body { grid-template-columns: var(--rail) minmax(0, 1fr) 44px; }
  .left-collapsed.right-collapsed .holo-body { grid-template-columns: 44px minmax(0, 1fr) 44px; }
  .holo-panel { border: 1px solid var(--l2); border-radius: 4px; background: var(--glass);
  display: grid; grid-template-rows: auto 1fr; min-height: 520px; min-width: 0; position: relative; }
  .holo-panel > .ph { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--l2);
 background: var(--ink); font-size: max(9.5px, var(--f));
 letter-spacing: 0.16em; color: var(--sc-accent); min-height: 38px; }
  .ph-glyph { font-size: 11px; }
  .ph .ic { background: none; border: none; color: var(--sc-fg-2); cursor: pointer; font: inherit; font-size: 13px; letter-spacing: 0;
  min-width: var(--sc-tap-min, 24px); min-height: var(--sc-tap-min, 24px); padding: 0; }
  .ph .ic:hover { color: var(--sc-accent); }
  .holo-panel > .pb { padding: 12px; display: grid; gap: 10px; align-content: start; min-width: 0; }
  .holo-panel > .pb.rail-min { padding: 10px 4px; justify-items: center; }
  .rail-min .vi { writing-mode: vertical-rl; transform: rotate(180deg); font-size: max(8.5px, var(--f)); letter-spacing: 0.18em; color: var(--sc-fg-2); }
  .holo-panel.collapsed > .ph .ph-title, .holo-panel.collapsed > .ph .n, .holo-panel.collapsed > .ph .ph-glyph { display: none; }
  .holo-panel.collapsed > .ph { padding: 7px 4px; justify-content: center; }
  .frame { position: relative; }
  /* Watermark: the Einsatz word behind the panel's lower half. Specificity
     matches the ".frame > *" rule below (wave 5 A2.3) so it stays out of the flow. */
  .frame > .wm { position: absolute; inset: auto 0 6% 0; text-align: center; font-size: 30px;
 letter-spacing: 0.3em; color: var(--a7); pointer-events: none; z-index: 0; overflow: hidden; white-space: nowrap; text-overflow: clip; }
  .frame > * { position: relative; z-index: 1; }
  .statics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .statics div { display: grid; gap: 2px; padding: 6px 8px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); border-radius: 3px; min-width: 0; }
  .statics .k { font-size: max(8px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); }
  .statics .v { font-family: var(--m); font-size: 15px; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .statics .v.long { font-family: var(--sc-font-body); font-size: max(10.5px, var(--f)); white-space: normal; color: var(--sc-fg-1); line-height: 1.2; }
  .sub { font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); display: flex; align-items: center; gap: 8px; }
  .sub i { flex: 1; height: 1px; background: var(--l1); }
  .top3 { margin: 0; padding: 0 0 0 18px; font-size: max(11.5px, var(--f)); color: var(--sc-fg-1); display: grid; gap: 3px; }
  .top3 a { color: var(--sc-fg-0); text-decoration: none; }
  .top3 a:hover { color: var(--sc-accent); }
  .cohort-link { font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); text-decoration: none; text-align: center; }
  .cohort-link:hover { color: var(--sc-accent); }
  .holo-table > .ph.role { padding: 0; gap: 0; background: var(--ink); overflow-x: auto; }
  .rolebar { display: flex; width: 100%; min-width: max-content; }
  .rolebar .lab { display: grid; place-items: center; padding: 0 14px; font-size: max(8.5px, var(--f)); letter-spacing: 0.2em; color: var(--sc-fg-2); border-right: 1px solid var(--l1); }
  .rolebar .r { flex: 1; padding: 8px 8px 6px; text-align: center; font-size: max(10.5px, var(--f));
 letter-spacing: 0.16em; color: var(--sc-fg-1); border: none; border-right: 1px solid var(--l1); border-bottom: 2px solid transparent;
 background: none; cursor: pointer; display: grid; gap: 2px; min-height: var(--sc-tap-min, 44px); min-width: 92px; }
  .rolebar .r small { font-family: var(--m); font-size: max(9px, var(--f)); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
  .rolebar .r.on { color: var(--sc-accent); border-bottom-color: var(--sc-accent);
  background: linear-gradient(180deg, var(--a4), var(--a14));
  text-shadow: 0 0 10px var(--a50); }
  .rolebar .r.on small { color: var(--sc-fg-1); }
  .rolebar .r.dim { opacity: 0.4; cursor: not-allowed; }
  .rolebar .r:last-child { border-right: 0; }
  .rolebar .r:hover:not(.dim):not(.on) { color: var(--sc-fg-0); }
  .holo-table > .pb { padding: 0 0 8px; position: relative; display: flex; flex-direction: column; min-height: 480px; }
  .rings { position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background:
  repeating-radial-gradient(circle at 50% 52%, transparent 0 58px, var(--a7) 59px 60px),
  linear-gradient(var(--a5) 1px, transparent 1px) 0 0 / 100% 40px,
  linear-gradient(90deg, var(--a5) 1px, transparent 1px) 0 0 / 40px 100%; }
  .hangar-dock { flex: none; display: flex; align-items: center; }
  .tools5 { flex: none; display: flex; gap: 12px; align-items: center; opacity: 0.55; transition: opacity 160ms ease; }
  .holo-table:hover .tools5, .holo-table:focus-within .tools5, .tools5:has(.on), .tools5.open { opacity: 1; }
  @media (hover: none) { .tools5 { opacity: 1; } }
  .tt { background: none; border: none; padding: 4px 2px; cursor: pointer; font-size: max(8.5px, var(--f));
 letter-spacing: 0.16em; color: var(--sc-fg-2); min-height: var(--sc-tap-min, 24px); }
  .tt:hover { color: var(--sc-fg-0); }
  .tt.on { color: var(--sc-accent); text-shadow: 0 0 8px var(--a50); }
  .tt:disabled { opacity: 0.35; cursor: not-allowed; }
  .share-wrap { position: relative; display: inline-flex; }
  .share-popover { position: absolute; top: 100%; inset-inline-end: 0; z-index: 8; margin-top: 8px; }
  /* The pin canvas is sized FROM the frame (wave 5 A2.2): a square that fits
     the frame's height minus a label inset on every side, so ring pins and
     their labels always stay inside the table — never under the head/legend. */
  .silhouette-frame { position: relative; flex: 1; width: 100%; min-height: 480px; z-index: 1; display: flex; align-items: center; justify-content: center; overflow: hidden;
  container-type: size; --pin-inset: 56px; }
  /* Dense tables carry no on-canvas labels, so the hull may use more of the frame. */
  .silhouette-frame:has(.shipwrap.dense) { --pin-inset: 40px; }
  .mode-viewer { width: 100%; height: 100%; min-height: 480px; }
  .shipwrap { position: absolute; left: 50%; top: 50%; width: min(560px, 100cqw - 2 * var(--pin-inset), 100cqh - 2 * var(--pin-inset)); aspect-ratio: 1 / 1; transform: translate(-50%, -50%); }
  .shipwrap.no-geometry { width: min(440px, 100cqw - 2 * var(--pin-inset), 100cqh - 2 * var(--pin-inset)); }
  .silhouette { width: 100%; height: 100%; display: block; overflow: visible; }
  .silhouette .glow { fill: none; stroke: var(--sc-accent); stroke-width: 10; opacity: 0.16; filter: blur(6px); }
  .silhouette .hull { fill: var(--a10); stroke: var(--sc-accent); stroke-width: 2; vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 6px var(--a55)); }
  .silhouette-placeholder { position: absolute; inset: 0; display: grid; place-items: center; }
  .silhouette-placeholder .ring { grid-area: 1 / 1; width: 78%; height: 78%; border: 1px dashed var(--l2); border-radius: 50%; }
  .silhouette-placeholder .ring.inner { width: 40%; height: 40%; border-style: dotted; }
  /* Default silhouette (wave 5 A3.2): the hull's own artwork, holo-tinted and
     feathered into the rings, so a ship without a traced outline still shows
     its shape. The generic glyph is the last resort behind a missing image. */
  /* sc-fallback-image is display:contents — its img (or the projected glyph)
     is the grid item, so the sizing goes on those, not on the host. */
  .silhouette-placeholder > .generic-hull, .silhouette-placeholder .ghost-art, .silhouette-placeholder .ghost-icon { grid-area: 1 / 1; width: 74%; height: 74%; display: block; pointer-events: none; }
  /* The icon file pads its hull generously and points nose-right: rotate to
     the table's nose-up and scale it up to read like the traced outlines. */
  .silhouette-placeholder .ghost-icon { object-fit: contain; transform: rotate(-90deg) scale(1.4); opacity: 0.5;
  filter: sepia(1) saturate(4) hue-rotate(160deg) brightness(1.05) drop-shadow(0 0 3px var(--sc-accent)) drop-shadow(0 0 10px var(--a55)); }
  .silhouette-placeholder .ghost-art { display: grid; place-items: center; mix-blend-mode: screen; opacity: 0.75;
  filter: grayscale(1) sepia(1) hue-rotate(158deg) saturate(2.6) brightness(1.05) contrast(1.15);
  -webkit-mask-image: radial-gradient(ellipse closest-side at center, #000 55%, transparent 100%); mask-image: radial-gradient(ellipse closest-side at center, #000 55%, transparent 100%); }
  .silhouette-placeholder .ghost-art ::ng-deep img { width: 100%; height: 100%; max-height: none; object-fit: contain; display: block; filter: none; }
  .silhouette-placeholder .ghost-art .generic-hull { width: 100%; height: 100%; }
  .generic-hull path { fill: var(--a10); stroke: var(--sc-accent); stroke-width: 0.8; stroke-dasharray: 2 1.5; opacity: 0.7; filter: drop-shadow(0 0 4px var(--a40)); }
  .no-geometry-badge { color: var(--sc-fg-2); cursor: help; }
  .table-empty { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; text-align: center; font-family: var(--d); text-transform: uppercase; letter-spacing: 0.14em; font-size: max(10px, var(--f)); color: var(--sc-fg-2); padding: 24px; }
  /* Dense tables (many pins) keep the labels off the canvas — the numbered
     key below carries them; hover / selection still shows the pin's own. */
  .shipwrap.dense .pin-label { display: none; }
  .shipwrap.dense .pin:is(.sel, .active, :hover, :focus-visible) .pin-label { display: inline; }
  .pin-key { position: relative; z-index: 2; list-style: none; margin: 0; padding: 8px 12px 0; display: flex; flex-wrap: wrap; gap: 4px 6px; }
  .pk { display: inline-flex; align-items: center; gap: 5px; padding: 2px 7px 2px 2px; border: 1px solid var(--l1); border-radius: 999px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
  color: var(--sc-fg-1); cursor: pointer; font: inherit; font-size: max(9.5px, var(--f)); min-height: var(--sc-tap-min, 24px); max-width: 100%; transition: border-color 160ms ease, color 160ms ease; }
  .pk:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .pk i { width: 16px; height: 16px; border-radius: 50%; border: 1px solid var(--sc-accent); color: var(--sc-accent); font-family: var(--m); font-style: normal; font-size: 9px; display: grid; place-items: center; flex: none; }
  .pk.gold i { border-color: var(--holo-gold); color: var(--holo-gold); }
  .pk span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pk:hover, .pk.active { border-color: var(--sc-accent); color: var(--sc-fg-0); }
  .pk.sel { border-color: var(--sc-accent); color: var(--sc-accent); }
  .pk.sel i { background: var(--sc-accent); color: var(--sc-bg-0); }
  .hero-art { position: absolute; inset: 0; z-index: 3; display: block; pointer-events: none; opacity: 1; }
  .hero-art ::ng-deep img, .hero-art ::ng-deep picture { width: 100%; height: 100%; object-fit: cover; display: block; }
  .holo-stage:not(.arrived):not(.reduced-motion) .hero-art { animation: holo-hero-out 1.6s ease-in-out forwards; }
  .holo-stage:not(.arrived):not(.reduced-motion) .shipwrap, .holo-stage:not(.arrived):not(.reduced-motion) .rings { animation: holo-reveal 1.6s ease-out both; }
  .holo-stage:not(.arrived):not(.reduced-motion) .silhouette-frame::after { content: ''; position: absolute; inset: 0; z-index: 4; pointer-events: none;
  background: linear-gradient(180deg, transparent 0, var(--a28) 50%, transparent 100%) 0 0 / 100% 18%;
  background-repeat: no-repeat; animation: holo-scan 1.6s linear both; }
  @keyframes holo-hero-out { 0% { opacity: 1; transform: scale(1); filter: saturate(1); } 55% { opacity: 0.85; filter: saturate(0.3) brightness(1.4); } 100% { opacity: 0; transform: scale(0.72); filter: saturate(0) brightness(2); } }
  @keyframes holo-reveal { 0% { opacity: 0; } 45% { opacity: 0; } 100% { opacity: 1; } }
  @keyframes holo-scan { 0% { background-position: 0 -20%; } 100% { background-position: 0 120%; } }
  .reduced-motion .hero-art { display: none; }
  /* The pin keeps its 20px box so the dot stays ON its anchor even under the
     global 48px touch minimum; the hit area comes from the dot's halo. */
  .pin { position: absolute; display: flex; align-items: center; gap: 6px; padding: 0; margin: -10px 0 0 -10px; background: none; border: none; cursor: pointer; z-index: 2; color: var(--sc-fg-1); min-width: 0; min-height: 0; }
  .pin i { position: relative; }
  .pin i::after { content: ''; position: absolute; inset: -14px; border-radius: 50%; }
  .pin.rev { flex-direction: row-reverse; transform: translateX(calc(-100% + 20px)); }
  /* Top / bottom ring pins stack their label vertically so neighbours on the
     ring never run into each other horizontally (wave 5 A2.4). */
  .pin.pos-b { flex-direction: column; transform: translateX(calc(-50% + 10px)); }
  .pin.pos-t { flex-direction: column-reverse; transform: translate(calc(-50% + 10px), calc(-100% + 20px)); }
  .pin.sel, .pin:hover, .pin:focus-visible { z-index: 4; }
  .pin i { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--sc-accent); background: var(--ink); color: var(--sc-accent);
  font-family: var(--m); font-style: normal; font-size: 10px; display: grid; place-items: center; flex: none;
  box-shadow: 0 0 0 4px var(--a12), 0 0 12px var(--a50); }
  .pin-label { font-size: max(8.5px, var(--f)); letter-spacing: 0.1em; color: var(--sc-fg-1);
 background: color-mix(in srgb, var(--sc-bg-0) 85%, transparent); padding: 2px 6px; border: 1px solid var(--l1); border-radius: 2px; white-space: nowrap; }
  .pin-label em { font-style: normal; color: var(--sc-fg-0); font-family: var(--m); letter-spacing: 0; text-transform: none; }
  .pin.gold i { border-color: var(--holo-gold); color: var(--holo-gold); box-shadow: 0 0 0 4px rgba(var(--holo-gold-rgb), 0.1), 0 0 10px rgba(var(--holo-gold-rgb), 0.4); }
  .pin:is(.active, :hover) i { box-shadow: 0 0 0 6px var(--a22), 0 0 18px var(--a80); }
  .pin:is(.active, :hover) .pin-label { border-color: var(--sc-accent); color: var(--sc-fg-0); }
  .pin.sel i { background: var(--sc-accent); color: var(--sc-bg-0); }
  .pin.sel .pin-label { color: var(--sc-accent); border-color: var(--sc-accent); }
  .pin.unresolved i { border-style: dashed; background: transparent; color: var(--sc-fg-2); border-color: var(--sc-fg-2); box-shadow: none; }
  .pin.patched i { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .pin:focus-visible { outline: none; }
  .pin:focus-visible i { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .legend { position: relative; z-index: 2; padding: 8px 12px 0; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: max(8.5px, var(--f));
 letter-spacing: 0.1em; color: var(--sc-fg-2); }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1px solid var(--sc-accent); vertical-align: middle; margin-right: 4px; }
  .legend i.g { border-color: var(--holo-gold); }
  .legend i.u { border-style: dashed; border-color: var(--sc-fg-2); }
  .legend-hint { margin-inline-start: auto; }
  .empty { display: grid; place-items: center; text-align: center; gap: 8px; color: var(--sc-fg-2); padding: 40px 10px; border: 1px dashed var(--l2); border-radius: 4px; font-size: max(12px, var(--f)); }
  .empty b { font-size: max(11px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-1); font-weight: 400; }
  .inspector { display: grid; gap: 10px; padding: 10px 12px; border: 1px solid var(--sc-accent); border-radius: 4px; background: var(--ink); }
  .insp-head { display: flex; align-items: flex-start; gap: 8px; }
  .size-tag { font-family: var(--m); font-size: 10px; color: var(--sc-fg-2); border: 1px solid var(--l1); border-radius: 2px; padding: 1px 5px; flex: none; margin-top: 2px; }
  .insp-ident { display: grid; gap: 2px; min-width: 0; flex: 1; }
  .insp-ident b { font-weight: 500; color: var(--sc-fg-0); font-size: max(13px, var(--f)); }
  .insp-ident small { font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); }
  .inspector-close { background: none; border: none; color: var(--sc-fg-2); cursor: pointer; min-height: var(--sc-tap-min, 24px); min-width: 24px; padding: 0; flex: none; }
  .inspector-close:hover { color: var(--sc-fg-0); }
  .inspector-patch-delta { margin: 0; font-size: max(11px, var(--f)); color: var(--sc-accent); font-family: var(--m); }
  .inspector-patch-delta.unresolved { color: var(--sc-fg-2); font-style: italic; }
  .insp-stats { margin: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .insp-stats div { display: grid; gap: 1px; padding: 5px 8px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); border-radius: 3px; }
  .insp-stats dt { font-size: max(8px, var(--f)); letter-spacing: 0.12em; color: var(--sc-fg-2); }
  .insp-stats dd { margin: 0; font-family: var(--m); font-size: 13px; color: var(--sc-fg-0); }
  .insp-draft { margin: 0; display: flex; align-items: center; gap: 8px; }
  .tag.draft { font-size: max(10px, var(--f)); color: var(--sc-accent); border: 1px solid var(--sc-accent); border-radius: 2px; padding: 1px 6px; }
  .tag.draft.pending { color: var(--sc-fg-2); border-color: var(--sc-fg-2); }
  .tag.draft.unresolved { color: var(--sc-warning); border-color: var(--sc-warning); }
  .insp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .insp-kid { display: grid; gap: 8px; margin-inline-start: 10px; padding: 8px 0 0 10px; border-inline-start: 2px solid var(--a40); }
  .insp-kid.empty .insp-ident b { color: var(--sc-fg-2); font-weight: 400; }
  .insp-kid .btn { padding: 3px 8px; min-height: var(--sc-tap-min, 26px); font-size: max(9.5px, var(--f)); }
  .card.flat { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid var(--l1); border-radius: 4px; }
  .h2 { display: flex; align-items: center; gap: 8px; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); }
  .mut { margin: 0; font-size: max(11.5px, var(--f)); color: var(--sc-fg-2); }
  .journal { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .journal li { display: flex; align-items: center; gap: 8px; font-size: max(11.5px, var(--f)); }
  .j-label { color: var(--sc-fg-0); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .j-state { color: var(--sc-fg-2); font-size: max(10px, var(--f)); }
  .holo-below { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr); gap: 14px; align-items: start; padding: 0 10px; }
  .sh { display: flex; align-items: center; gap: 10px; font-size: max(9.5px, var(--f)); letter-spacing: 0.16em; color: var(--sc-accent); margin-bottom: 8px; min-height: 28px; }
  .sh .t { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  .holo-details { padding: 0 10px; }
  .holo-details .sh { margin-bottom: 0; }
  .details-toggle { background: none; border: 1px solid var(--l2); border-radius: 3px; color: var(--sc-fg-1); cursor: pointer; padding: 5px 12px; min-height: var(--sc-tap-min, 32px);
 font: inherit; font-size: max(9.5px, var(--f)); letter-spacing: 0.14em; }
  .details-toggle:hover, .details-toggle[aria-expanded="true"] { color: var(--sc-accent); border-color: var(--sc-accent); }
  .details-body { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }
  .switch { display: inline-flex; align-items: center; gap: 8px; font-size: max(8.5px, var(--f)); letter-spacing: 0.12em; color: var(--sc-fg-2); cursor: pointer; min-height: var(--sc-tap-min, 24px); }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch .track { width: 28px; height: 14px; border-radius: 7px; border: 1px solid var(--l2); background: var(--sc-bg-0); position: relative; transition: background 160ms ease; }
  .switch .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--sc-fg-2); transition: transform 160ms ease, background 160ms ease; }
  .switch input:checked + .track { background: color-mix(in srgb, var(--sc-accent) 30%, var(--sc-bg-0)); border-color: var(--sc-accent); }
  .switch input:checked + .track::after { transform: translateX(14px); background: var(--sc-accent); }
  .switch input:focus-visible + .track { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .undo-toast { position: fixed; bottom: 110px; inset-inline-start: 50%; transform: translateX(-50%); z-index: 20;
  display: flex; align-items: center; gap: 10px; background: var(--sc-bg-0); border: 1px solid var(--sc-accent);
  border-radius: 4px; padding: 8px 12px; font-size: max(12px, var(--f)); color: var(--sc-fg-0); box-shadow: 0 8px 24px rgb(0 0 0 / 0.4); }
  @media (max-width: 1180px) {
  .holo-stage { --rail: 260px; }
  .holo-body { grid-template-columns: var(--rail) minmax(0, 1fr) var(--rail); }
  .holo-below { grid-template-columns: 1fr; }
  }
  @media (max-width: 1000px) {
  .holo-topbar { grid-template-columns: 1fr auto; }
  .holo-body { grid-template-columns: 44px minmax(0, 1fr) 44px; }
  .holo-left.collapsed { order: 0; }
  .holo-table { order: 1; }
  .holo-right.collapsed { order: 2; }
  .holo-panel:not(.collapsed).holo-left, .holo-panel:not(.collapsed).holo-right { grid-column: 1 / -1; min-height: 0; }
  .holo-panel:not(.collapsed).holo-left { order: 3; }
  .holo-panel:not(.collapsed).holo-right { order: 4; }
  .holo-body:has(.holo-left:not(.collapsed)) { grid-template-columns: 0 minmax(0, 1fr) 44px; gap: 0 10px; }
  .holo-body:has(.holo-right:not(.collapsed)) { grid-template-columns: 44px minmax(0, 1fr) 0; }
  .holo-body:has(.holo-left:not(.collapsed)):has(.holo-right:not(.collapsed)) { grid-template-columns: 0 minmax(0, 1fr) 0; }
  .holo-panel:not(.collapsed).holo-left, .holo-panel:not(.collapsed).holo-right { margin-top: 10px; }
  }
  @media (orientation: landscape) and (max-width: 1000px) and (max-height: 600px) {
  .holo-table > .pb, .silhouette-frame { min-height: 320px; }
  }
  @media (max-width: 640px) {
  .holo-stage { padding-bottom: 72px; }
  .mobile-tabs { display: flex; }
  .mobile-only { display: inline-flex; }
  .holo-topbar { grid-template-columns: 1fr auto; grid-template-areas: 'search patch' 'mid mid'; gap: 8px; }
  .ht-search { grid-area: search; }
  .ht-right { grid-area: patch; justify-content: flex-end; }
  .ht-mid { grid-area: mid; min-height: 44px; }
  /* Every :has() column rule from the <=1000px block outranks a bare
     .holo-body (wave 5 A2.7) — restate them here or the table lands in a
     0px column on phones. */
  .holo-body, .holo-body:has(.holo-left:not(.collapsed)), .holo-body:has(.holo-right:not(.collapsed)),
  .holo-body:has(.holo-left:not(.collapsed)):has(.holo-right:not(.collapsed)) { grid-template-columns: 1fr; gap: 10px; padding: 6px; }
  .holo-panel, .holo-panel:not(.collapsed).holo-left, .holo-panel:not(.collapsed).holo-right { grid-column: auto; order: initial; min-height: 0; margin-top: 0; }
  .holo-table { order: -1; }
  .holo-table > .ph.role { max-width: 100%; }
  .holo-table > .pb, .silhouette-frame, .mode-viewer { min-height: 360px; }
  .silhouette-frame { --pin-inset: 36px; }
  /* Phone: dock and tools share the first line, the ship name gets its own. */
  .table-head { flex-wrap: wrap; gap: 6px; padding: 6px 6px 0; }
  .table-head .hangar-dock { order: 1; }
  .table-head .tools5 { order: 2; margin-inline-start: auto; gap: 6px; }
  .tt { letter-spacing: 0.1em; padding: 4px 0; }
  .table-head .table-eyebrow { order: 3; flex-basis: 100%; }
  .pin-label { display: none; }
  .pin.sel .pin-label, .pin.active .pin-label { display: inline; }
  .legend-hint { display: none; }
  .holo-below { grid-template-columns: 1fr; padding: 0 6px; }
  .holo-body.mobile-hide-table .mobile-table { display: none; }
  .holo-body.mobile-hide-data .mobile-data { display: none; }
  .undo-toast { bottom: 84px; width: calc(100% - 32px); justify-content: space-between; }
  }

  `],
})
export class CodexHoloStageComponent {
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly skins = inject(ShipSkinsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  readonly GENERIC_HULL = GENERIC_HULL_PATH;

  // ── Identity / chrome ────────────────────────────────────────────
  readonly detail = input.required<CodexDetail>();
  readonly displayName = input.required<string>();
  readonly manufacturerName = input<string | null>(null);
  readonly stageCounts = input<readonly StageCountChip[]>([]);
  readonly heroChips = input<readonly { key: string; text: string; accent?: boolean; ghost?: boolean; gap?: boolean }[]>([]);
  /** The classic hero art candidates — the arrival's loading image. */
  readonly heroArt = input<readonly string[]>([]);
  /** The datamined flat top-down icon of the hull, when the extract has one —
   * the default silhouette for a ship without a traced outline (wave 5 A3.2). */
  readonly previewSilhouette = input<string | null>(null);
  readonly previewFailed = signal(false);

  // ── Hover-sync / ports ───────────────────────────────────────────
  readonly activePorts = input<readonly string[]>([]);
  readonly locatablePorts = input<readonly string[]>([]);
  readonly primaryModuleSections = input<readonly LayoutSection[]>([]);
  readonly tailModuleSections = input<readonly LayoutSection[]>([]);

  // ── Silhouette / 3D / schema (in-place, user decision 2) ──────────
  readonly silhouette = input<HoloSilhouette | null>(null);
  readonly shipClassName = input<string>('');
  readonly hardpointPortRefs = input<readonly HardpointPortRef[]>([]);
  readonly hardpointFrame = input<HardpointFrame | null>(null);
  readonly hardpointMarkers = input<readonly HardpointMarker[]>([]);

  // ── Einsatz bar / KPI ────────────────────────────────────────────
  /** The six band cells of the active Einsatz (kept for the lead-metric accent). */
  readonly kpiCells = input<readonly KpiStripCell[]>([]);
  /** Every sheet key as a cell — the perspectives and the strip read these. */
  readonly allKpiCells = input<readonly KpiStripCell[]>([]);
  readonly activeMissionId = input.required<MissionId>();
  readonly shipCapabilities = input.required<ShipCapabilities>();
  readonly draftChangedCount = input(0);

  // ── Draft save bar (inventory #27) ─────────────────────────────────
  readonly saveableCount = input(0);
  readonly saving = input(false);
  readonly saveError = input<string | null>(null);
  readonly inHangar = input(false);

  // ── Rank / radar / top-3 (user decision 1) ─────────────────────────
  readonly rankResult = input<RankResult | null>(null);
  readonly rankLoading = input(false);
  readonly rankProfile = input<RankProfileId>('combat');
  readonly rankScope = input<RankScope>('sizeClass');
  readonly rankDisabledReasons = input<Partial<Record<RankProfileId, string | null>>>({});
  readonly rankCohort = input<readonly RankShipInput[] | null>(null);
  readonly recentlyViewedShips = input<readonly string[]>([]);
  readonly hangarShipClassNames = input<readonly string[]>([]);

  // ── Perspectives (reuse today's analysis panels for "Alle Werte") ──
  readonly offensivePanel = input<OffensivePanel | null>(null);
  readonly defensivePanel = input<DefensivePanel | null>(null);
  readonly shipFactGroups = input<readonly ShipFactGroup[]>([]);

  // ── Patch chooser / Δ (slot: patch-delta) ──────────────────────────
  readonly channel = input('LIVE');
  readonly patchVersion = input('');
  readonly buildRef = input<BuildRef | null>(null);
  readonly activeKpiSheet = input<KpiSheet>({} as KpiSheet);
  readonly activeOccupants = input<PortOccupantMap>({});
  readonly resolveComparisonSide =
    input<(detail: CodexDetail) => HoloPatchComparisonSide | Promise<HoloPatchComparisonSide>>(async () => ({
      kpiSheet: {} as KpiSheet,
      occupants: {},
    }));

  // ── Share popover (slot: share) ─────────────────────────────────────
  readonly myConfig = input<HangarShipConfig | null>(null);

  // ── HangarPicker (slot: hangar-tab, N4) ─────────────────────────────
  readonly hangarPickerItems = input<readonly HangarPickerItem[]>([]);

  // ── Strip (slot: strip) — mirrors sc-codex-energy-dock's own inputs ──
  readonly occupants = input<readonly SummaryOccupant[]>([]);
  readonly shipStats = input<Record<string, Record<string, string | number | boolean | null>> | null>(null);
  readonly schemaVersion = input<number | null>(null);
  readonly userId = input<string | null>(null);
  readonly crossSection = input<number | null>(null);

  // ── Arrival / motion ─────────────────────────────────────────────
  readonly reducedMotion = input(false);
  readonly seenThisSession = input(false);
  /** Host's `copyShareLink()` flashed its toast — mirrored into the share
   * popover so the holo view gives the same "Kopiert" feedback (wave 5 A1.1). */
  readonly linkCopied = input(false);

  // ── Outputs — the parent still owns every one of these ───────────
  readonly hovered = output<string[] | null>();
  readonly inspected = output<LayoutTarget>();
  readonly swapRequested = output<LayoutTarget>();
  readonly reverted = output<string[]>();
  readonly missionChange = output<MissionId>();
  readonly rankProfileChange = output<RankProfileId>();
  readonly rankScopeChange = output<RankScope>();
  readonly copyShareLink = output<void>();
  readonly addToHangar = output<void>();
  readonly saveDraft = output<void>();
  readonly discardDraft = output<void>();
  readonly configRefreshed = output<HangarShipConfig>();
  readonly sheetChange = output<PowerSheet>();
  /** HangarPicker outputs (slot: hangar-tab, N4) — the parent owns the
   * subject switch (navigate + `markShipPicked`) and the hangar-open route. */
  readonly hangarPick = output<string>();
  readonly hangarOpen = output<void>();
  /** The embedded 3D viewer's catalog answer, forwarded so the host's latch
   * (`has3dView`) learns about a model from the holo view too. */
  readonly artAvailable = output<boolean>();
  /** The arrival transformation finished for this hull (slug) — the host
   * records it as "seen this session" so a return visit cuts straight in. */
  readonly arrivedShip = output<string>();

  // ── Local, purely-presentational view state ───────────────────────
  /** Tablet (concept mo5-rails): both rails start as 44px edges so the table
   * gets the width; a tap expands one below the table. Desktop and phone
   * start open (the phone stacks everything anyway). */
  private static tabletStart(): boolean {
    try {
      return typeof matchMedia === 'function' && matchMedia('(min-width: 641px) and (max-width: 1000px)').matches;
    } catch {
      return false;
    }
  }
  readonly leftCollapsed = signal(CodexHoloStageComponent.tabletStart());
  readonly rightCollapsed = signal(CodexHoloStageComponent.tabletStart());
  readonly viewMode = signal<'holo' | '3d' | 'schema'>('holo');
  readonly detailsOpen = signal(false);
  readonly inspectedPort = signal<string | null>(null);
  readonly sharePopoverOpen = signal(false);
  readonly arrived = signal(false);
  readonly soundOn = signal(this.readSoundPref());
  readonly mobileTabsEnabled = signal(this.readMobileTabsPref());
  readonly mobileTab = signal<'table' | 'data'>('table');
  /** The tile that pulses after a port selection (concept pe4-pulse). */
  readonly pulseTile = signal<Perspective | null>(null);

  // slot: patch-delta outputs, surfaced to the pins/inspector/KPI band
  readonly patchGhosts = signal<HoloPatchKpiGhosts | null>(null);
  readonly patchPortPins = signal<Readonly<Record<string, PortPinBadge>> | null>(null);
  readonly patchComparisonBuild = signal<CodexBuild | null>(null);

  /** 3D model availability, answered by the skin catalog (never by a mounted
   * viewer, which would only exist once the user is already in 3D). */
  readonly has3d = signal(false);
  private skinsSeq = 0;

  constructor() {
    effect((onCleanup) => {
      // Keyed on the ship: every hull switch re-runs the arrival. Reduced
      // motion = hard cut (no transformation). A repeat visit in the same
      // session also cuts straight to the arrived state (concept: "repeat
      // visit in the session = cut only").
      const slug = this.detail().classNameSlug;
      if (this.reducedMotion() || this.seenThisSession()) {
        this.arrived.set(true);
        return;
      }
      this.arrived.set(false);
      const t = setTimeout(() => {
        this.arrived.set(true);
        this.startCountUp();
        // Only now is the ship "seen" — the host must not mark it before the
        // stage mounted, or the arrival never plays (wave 5 A3.1).
        this.arrivedShip.emit(slug);
      }, ARRIVAL_MS);
      onCleanup(() => clearTimeout(t));
    });

    // A new hull is a new table (wave 5 B0.1 / B1.1 / B1.2): nothing the user
    // selected on the previous ship may survive — the inspector, the share
    // popover, the view mode (a ship without a model would show an empty
    // frame in "3D"), the undo toast and the patch Δ overlays.
    effect(() => {
      this.detail().classNameSlug;
      untracked(() => {
        this.previewFailed.set(false);
        this.inspectedPort.set(null);
        this.sharePopoverOpen.set(false);
        this.viewMode.set('holo');
        this.undoToast.set(null);
        this.pulseTile.set(null);
        this.patchGhosts.set(null);
        this.patchPortPins.set(null);
        this.patchComparisonBuild.set(null);
      });
    });

    // Is there a 3D model at all? Asked of the catalog up front so the "3D"
    // toggle is only offered when it can show something (wave 5 A3.2).
    effect(() => {
      const shipId = this.shipClassName();
      const seq = ++this.skinsSeq;
      untracked(() => this.has3d.set(false));
      if (!shipId) return;
      void this.skins.listSkins(shipId).then(({ skins }) => {
        if (seq !== this.skinsSeq) return;
        const available = skins.some((s) => !!s.modelPath);
        this.has3d.set(available);
        if (available) this.artAvailable.emit(true);
      }).catch(() => {
        /* catalog unreachable — the toggle simply stays hidden */
      });
    });

    // Share popover: click anywhere outside closes it (Esc is handled on the
    // wrapper). Registered only while open, so an idle page listens to nothing.
    effect((onCleanup) => {
      if (!this.sharePopoverOpen()) return;
      const onPointerDown = (ev: PointerEvent) => {
        const wrap = this.host.nativeElement.querySelector('.share-wrap');
        if (wrap && ev.target instanceof Node && wrap.contains(ev.target)) return;
        this.sharePopoverOpen.set(false);
      };
      // Deferred one tick so the opening click itself never counts as outside.
      const arm = setTimeout(() => document.addEventListener('pointerdown', onPointerDown, true), 0);
      onCleanup(() => {
        clearTimeout(arm);
        document.removeEventListener('pointerdown', onPointerDown, true);
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      if (this.countUpRaf) cancelAnimationFrame(this.countUpRaf);
      void this.audioCtx?.close().catch(() => undefined);
    });

    // The "Einordnung" follows the Einsatz (concept round 4: no second
    // profile selector on the left) — every mission maps onto the nearest
    // of the three rank profiles, the parent keeps owning the signal.
    effect(() => {
      const wanted = MISSION_RANK_PROFILE[this.activeMissionId()];
      if (wanted !== this.rankProfile() && !this.rankDisabledReasons()[wanted]) {
        this.rankProfileChange.emit(wanted);
      }
    });

    // Undo toast (item 3): the newest journal entry gets a ~6s toast with an
    // immediate undo, ON TOP of the always-present inline revert list (so a
    // second/third simultaneous change is never stranded once the toast for
    // the first one has faded).
    let seenPorts = new Set<string>();
    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const entries = this.journal();
      const nowPorts = new Set(entries.map((e) => e.port));
      const added = entries.find((e) => !seenPorts.has(e.port));
      seenPorts = nowPorts;
      if (added) {
        this.undoToast.set(added);
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => this.undoToast.set(null), UNDO_TOAST_MS);
      }
    });
  }

  readonly undoToast = signal<JournalEntry | null>(null);
  undoToastAction(): void {
    const t = this.undoToast();
    if (!t) return;
    this.reverted.emit(t.paths);
    this.undoToast.set(null);
  }

  /** Digit hotkeys select pins ("tippe 1 bis N"), Esc closes the share
   * popover, then the inspector. Inert while any dialog (swap picker, weapon
   * detail, …) is open — those own the keyboard (wave 5 B2.4). */
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (document.querySelector('[role="dialog"], dialog[open]')) return;
    if (ev.key === 'Escape') {
      if (this.sharePopoverOpen()) {
        this.sharePopoverOpen.set(false);
        return;
      }
      if (this.inspectedPort()) this.inspectedPort.set(null);
      return;
    }
    if (!/^[0-9]$/.test(ev.key)) return;
    const n = ev.key === '0' ? 10 : Number(ev.key);
    const pin = this.pins().find((p) => p.index === n);
    if (!pin) return;
    ev.preventDefault();
    this.inspectPin(pin.portName);
  }

  /** How many pins the digit hotkeys can reach — what the empty inspector may promise. */
  readonly hotkeyPinCount = computed(() => Math.min(this.pins().length, HOTKEY_PIN_MAX));

  toggleShare(): void {
    this.sharePopoverOpen.set(!this.sharePopoverOpen());
  }

  closeShare(ev?: Event): void {
    if (!this.sharePopoverOpen()) return;
    ev?.stopPropagation();
    this.sharePopoverOpen.set(false);
  }

  readonly eyebrowTitle = computed(() => {
    const mfr = this.manufacturerName();
    return mfr ? `${mfr} · ${this.displayName()}` : this.displayName();
  });

  submitSearch(ev: Event): void {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    const q = (form.elements.namedItem('q') as HTMLInputElement | null)?.value.trim() ?? '';
    void this.router.navigate(['/codex'], { queryParams: q ? { q } : {} });
  }

  toggleViewMode(mode: '3d' | 'schema'): void {
    this.viewMode.set(this.viewMode() === mode ? 'holo' : mode);
  }

  private readSoundPref(): boolean {
    try {
      return localStorage.getItem(SOUND_PREF_KEY) === 'on';
    } catch {
      return false;
    }
  }

  toggleSound(): void {
    const next = !this.soundOn();
    this.soundOn.set(next);
    try {
      localStorage.setItem(SOUND_PREF_KEY, next ? 'on' : 'off');
    } catch {
      /* localStorage unavailable — the toggle still works for this session */
    }
    if (next) this.blip();
  }

  /** One lazily created context for the whole stage — browsers cap live
   * AudioContexts (~6 in Chrome), a fresh one per click went silent after a
   * handful of pins (wave 5 B1.5). Closed on destroy. */
  private audioCtx: AudioContext | null = null;

  /** Opt-in-only UI sound: a short WebAudio oscillator blip, no audio asset. */
  private blip(): void {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (this.audioCtx ??= new Ctx());
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      /* WebAudio unavailable — silently a no-op, this is cosmetic only */
    }
  }

  private readMobileTabsPref(): boolean {
    try {
      return localStorage.getItem(MOBILE_TABS_PREF_KEY) === 'on';
    } catch {
      return false;
    }
  }

  toggleMobileTabs(): void {
    const next = !this.mobileTabsEnabled();
    this.mobileTabsEnabled.set(next);
    try {
      localStorage.setItem(MOBILE_TABS_PREF_KEY, next ? 'on' : 'off');
    } catch {
      /* localStorage unavailable — the toggle still works for this tab */
    }
  }

  // ── Static tiles (Crew · Masse · Laderaum) off the hero chips ─────
  staticChip(key: 'crew' | 'mass' | 'cargo'): string {
    const chip = this.heroChips().find((c) => c.key === key);
    if (!chip) return '—';
    if (key === 'crew') return chip.text.replace(/\s*crew$/i, '').trim() || chip.text;
    // A chip that carries a sentence instead of a value ("Kapazität nicht in
    // den Spieldaten") is a gap, not a number — the tile shows the dash and
    // keeps the sentence as its tooltip (see `staticChipTitle`).
    if (chip.ghost || (!/\d/.test(chip.text) && chip.text.length > 12)) return '—';
    return chip.text;
  }

  /** The gap explanation behind a dashed static tile, else null. */
  staticChipTitle(key: 'crew' | 'mass' | 'cargo'): string | null {
    const chip = this.heroChips().find((c) => c.key === key);
    if (!chip) return null;
    return this.staticChip(key) === '—' ? chip.text : null;
  }

  // ── Einsatz bar segments ──────────────────────────────────────────
  readonly missionSegments = computed<MissionSegment[]>(() => {
    const cells = this.allKpiCells();
    const caps = this.shipCapabilities();
    const rank = this.rankResult();
    const portCount = this.pins().length;
    return MISSIONS.map((m) => {
      let sub: string;
      if (m.id === 'all') {
        sub = this.t.instant('codex.holo.stage.portsCount', { n: portCount });
      } else {
        const lead = m.kpis.map((k) => cells.find((c) => c.key === k)).find((c) => c && c.value != null);
        sub = lead ? `${this.fmtCell(lead)} ${this.t.instant('codex.kpi.short.' + lead.key)}` : this.t.instant('codex.kpi.gap');
      }
      if (m.id === this.activeMissionId() && rank?.overall != null) sub += ` · P${Math.round(rank.overall)}`;
      return { id: m.id, labelKey: m.labelKey, sub, disabledKey: missionDisabledReasonKey(m.id, caps) };
    });
  });

  // ── Ports list (below the table) ──────────────────────────────────
  readonly allSections = computed<readonly LayoutSection[]>(() => [
    ...this.primaryModuleSections(),
    ...this.tailModuleSections(),
  ]);
  /** The layout component wants a mutable array type; same content. */
  readonly allSectionsMutable = computed<LayoutSection[]>(() => [...this.allSections()]);

  /** rawPort → slot, in ports-list order — the pin numbering source. Only
   * the configurable blocks (weapons … countermeasures) pin the table; the
   * airframe's fixed systems (thrusters, tanks, …) stay in the list below. */
  private readonly slotByRawPort = computed<Map<string, { slot: LayoutSlot; index: number; section: ShipModuleSection }>>(() => {
    const out = new Map<string, { slot: LayoutSlot; index: number; section: ShipModuleSection }>();
    let i = 0;
    // The SAME display order the ports list applies (weapons first, airframe
    // last) — so pin 1 is the first row a reader sees, not the first bucket.
    const rank = (sec: ShipModuleSection) => {
      const k = SHIP_MODULE_SECTION_ORDER.indexOf(sec);
      return k === -1 ? SHIP_MODULE_SECTION_ORDER.length : k;
    };
    const ordered = [...this.primaryModuleSections()].sort((a, b) => rank(a.section) - rank(b.section));
    for (const section of ordered) {
      for (const slot of section.slots) {
        const key = slot.rawPort ?? slot.port;
        if (!out.has(key)) out.set(key, { slot, index: ++i, section: section.section });
      }
    }
    return out;
  });

  // ── Silhouette pins — one per port the ports list shows (never from
  // `anchors ∪ unresolved`, per wave1-redteam.md: the silhouette may place a
  // pin, it never decides which ports exist). Ships with no loadout blocks
  // fall back to the extract's raw item ports. Numbered in list order. ──
  /** The fallback ring, as an ellipse that hugs the traced hull's bbox (in %
   * of the canvas) — or the plain ring when there is no silhouette. Pins
   * without an anchor sit on it in list order, starting at the nose. */
  private readonly fallbackRing = computed<{ cx: number; cy: number; rx: number; ry: number }>(() => {
    const s = this.silhouette();
    const plain = { cx: 50, cy: 50, rx: 42, ry: 42 };
    if (!s) return plain;
    const vb = s.viewBox.trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some((v) => !Number.isFinite(v)) || vb[2] <= 0 || vb[3] <= 0) return plain;
    const [vx, vy, vw, vh] = vb;
    // The ring may leave the canvas by a few % — the frame keeps a pin
    // inset around it (see --pin-inset), so a full-height hull still gets
    // its nose/tail pins just OUTSIDE the outline instead of on it.
    const pad = 8;
    const cx = ((s.bbox.x + s.bbox.w / 2 - vx) / vw) * 100;
    const cy = ((s.bbox.y + s.bbox.h / 2 - vy) / vh) * 100;
    const rx = Math.min(54, Math.max(24, ((s.bbox.w / vw) * 100) / 2 + pad));
    const ry = Math.min(54, Math.max(24, ((s.bbox.h / vh) * 100) / 2 + pad));
    const clamp = (v: number) => Math.min(100, Math.max(0, v));
    // An off-centre bbox must not push the ring past the canvas (+4 % is the
    // slack --pin-inset leaves): the radius yields, the centre stays.
    const ccx = clamp(cx);
    const ccy = clamp(cy);
    return { cx: ccx, cy: ccy, rx: Math.min(rx, ccx + 4, 104 - ccx), ry: Math.min(ry, ccy + 4, 104 - ccy) };
  });

  readonly pins = computed<StagePin[]>(() => {
    const s = this.silhouette();
    const byRaw = this.slotByRawPort();
    // Raw-port fallback is de-duplicated (wave 5 A2.4): the extract can list a
    // port name twice, and `track pin.portName` must stay unique.
    const seenRaw = new Set<string>();
    const source: { raw: string; known: { slot: LayoutSlot; index: number; section: ShipModuleSection } | null }[] =
      byRaw.size > 0
        ? [...byRaw.entries()].map(([raw, known]) => ({ raw, known }))
        : ((this.detail()?.ports ?? []) as readonly CodexItemPort[])
            .filter((p) => !!p.portName && !seenRaw.has(p.portName) && seenRaw.add(p.portName))
            .map((p) => ({ raw: p.portName!, known: null }));
    const byPort = new Map<string, SilhouetteAnchor>(s ? s.anchors.map((a) => [a.portId, a]) : []);
    let nextIndex = 0;
    let fallbackIndex = 0;
    const n = source.filter(({ raw }) => !byPort.has(raw)).length || 1;
    // A crowded ring (capital ships: 40+ ports) widens until neighbouring
    // dots no longer touch — ~7 % of the canvas per pin along the perimeter.
    const base = this.fallbackRing();
    const ring = { ...base };
    const needMean = (n * 7) / (2 * Math.PI);
    const mean = Math.sqrt((ring.rx * ring.rx + ring.ry * ring.ry) / 2);
    if (mean < needMean) {
      const maxRx = Math.min(54, ring.cx + 4, 104 - ring.cx);
      const maxRy = Math.min(54, ring.cy + 4, 104 - ring.cy);
      ring.rx = Math.min(maxRx, Math.max(ring.rx, Math.sqrt(Math.max(0, 2 * needMean * needMean - ring.ry * ring.ry))));
      const mean2 = Math.sqrt((ring.rx * ring.rx + ring.ry * ring.ry) / 2);
      if (mean2 < needMean) ring.ry = Math.min(maxRy, Math.max(ring.ry, Math.sqrt(Math.max(0, 2 * needMean * needMean - ring.rx * ring.rx))));
    }
    const sideFor = (x: number, y: number): StagePin['side'] => {
      // Near the top/bottom of the ring the neighbours sit side by side, so
      // the label goes above/below the dot; on the flanks it goes outward.
      if (y <= 18) return 'below';
      if (y >= 82) return 'above';
      return x > 55 ? 'left' : 'right';
    };
    return source
      .map(({ raw, known }) => {
        const slot = known?.slot ?? null;
        const index = known?.index ?? ++nextIndex;
        const anchor = byPort.get(raw);
        const stat = slot?.stats?.[0] ?? null;
        const base = {
          portName: raw,
          index,
          label: slot?.name ?? slot?.port ?? humanizeClassName(raw),
          short: stat ? formatEquippedStat(stat) : slot?.statChip ?? null,
          tone: (known?.section === 'missiles' ? 'gold' : 'accent') as 'accent' | 'gold',
          slot,
        };
        if (anchor) return { ...base, x: anchor.x, y: anchor.y, side: sideFor(anchor.x, anchor.y), resolved: true };
        // Deterministic fallback ring position for a port with no anchor and
        // no `unresolved[]` entry either (§C3: "same as unresolved").
        const angle = (Math.PI * 2 * fallbackIndex) / n - Math.PI / 2;
        fallbackIndex += 1;
        const x = ring.cx + ring.rx * Math.cos(angle);
        const y = ring.cy + ring.ry * Math.sin(angle);
        return { ...base, x, y, side: sideFor(x, y), resolved: false };
      })
      .sort((a, b) => a.index - b.index);
  });

  /** Too many pins for on-canvas labels — the numbered key takes over. */
  readonly dense = computed(() => this.pins().length > DENSE_PIN_COUNT);
  readonly hasUnresolvedPins = computed(() => this.pins().some((p) => !p.resolved));
  /** The map wants a mutable array; computed once per markers change, never per CD (wave 5 B2.2). */
  readonly hardpointMarkersMutable = computed<HardpointMarker[]>(() => [...this.hardpointMarkers()]);

  readonly inspectedIndex = computed<number>(() => {
    const port = this.inspectedPort();
    return port ? (this.pins().find((p) => p.portName === port)?.index ?? 0) : 0;
  });

  /** The inspected pin has no loadout slot behind it (raw extract port) —
   * nothing to swap or open, the host's swap picker would silently no-op. */
  readonly inspectorIsRawPort = computed<boolean>(() => {
    const port = this.inspectedPort();
    if (!port) return false;
    return !this.allSections().some((s) => s.slots.some((sl) => (sl.rawPort ?? sl.port) === port));
  });

  readonly inspectorTarget = computed<LayoutTarget | null>(() => {
    const port = this.inspectedPort();
    if (!port) return null;
    for (const section of this.allSections()) {
      const slot = section.slots.find((s) => (s.rawPort ?? s.port) === port);
      if (slot) return { slot, count: 1, child: null, rawPorts: [port] };
    }
    // A raw-port pin (ship without loadout sections, wave 5 B1.3): a minimal
    // target so the inspector names the port instead of contradicting the
    // selected pin with its empty state.
    const pin = this.pins().find((p) => p.portName === port);
    if (!pin) return null;
    const raw = (this.detail()?.ports ?? []).find((p) => p.portName === port) as CodexItemPort | undefined;
    const slot: LayoutSlot = {
      port: pin.label,
      rawPort: port,
      className: null,
      kind: null,
      name: null,
      size: raw?.maxSize ?? null,
      grade: null,
      manufacturerCode: null,
      portSize: raw?.maxSize ?? null,
    };
    return { slot, count: 1, child: null, rawPorts: [port] };
  });

  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

  inspectPin(port: string): void {
    const next = this.inspectedPort() === port ? null : port;
    this.inspectedPort.set(next);
    if (next) {
      if (this.soundOn()) this.blip();
      // Pulse the perspective the selected port belongs to (concept pe4-pulse).
      const section = this.slotByRawPort().get(port)?.section ?? null;
      const tile: Perspective | null =
        section === 'weapons' || section === 'missiles' || section === 'remoteTurrets' || section === 'pod' ? 'offensive'
        : section === 'shields' ? 'defensive'
        : section === 'quantum' ? 'movement'
        : section === 'coolers' || section === 'radar' ? 'signature'
        : null;
      this.pulseTile.set(tile);
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(() => this.pulseTile.set(null), 900);
    }
  }

  /** The same dotted `parent.child` target the ports list emits for a sub-slot. */
  childTarget(it: LayoutTarget, kid: LayoutChild): LayoutTarget {
    const kids = kid.rawPorts.length > 0 ? kid.rawPorts : [kid.port];
    return { slot: it.slot, count: kid.count, child: kid, rawPorts: it.rawPorts.flatMap((p) => kids.map((k) => `${p}.${k}`)) };
  }

  sizeBadge(slot: LayoutSlot): string | null {
    const size = slot.size ?? slot.portSize;
    return size != null ? `S${size}` : null;
  }

  kidMeta(kid: LayoutChild): string {
    return [kid.manufacturerCode, kid.typeLabel, kid.port].filter((x): x is string => !!x).join(' · ');
  }

  inspectorMeta(slot: LayoutSlot): string {
    return [slot.manufacturerCode, slot.typeLabel, slot.port].filter((x): x is string => !!x).join(' · ');
  }

  inspectorStats(slot: LayoutSlot): readonly EquippedStat[] {
    return (slot.stats ?? []).slice(0, 4);
  }

  fmtStat(stat: EquippedStat): string {
    return formatEquippedStat(stat);
  }

  fmtCell(c: KpiStripCell): string {
    return c.value == null ? '—' : formatEquippedStat({ labelKey: c.labelKey, value: c.value, format: c.format });
  }

  /** Patch Δ ghost for one KPI key: the comparison build's value and how it
   * differs from the live one (tone = better/worse for THIS stat). */
  ghostFor(key: KpiStripCell['key']): HoloGhost | null {
    const g = this.patchGhosts();
    if (!g) return null;
    const cell = g.cells.find((c) => c.key === key);
    if (!cell || !cell.changed || cell.to == null) return null;
    const live = this.allKpiCells().find((c) => c.key === key);
    const text = formatEquippedStat({ labelKey: live?.labelKey ?? key, value: cell.to, format: live?.format ?? 'dec' });
    return { patch: g.toBuild.patchVersion, text, tone: cell.delta ? (cell.delta.good ? 'up' : 'down') : null };
  }

  // ── Count-up (concept cine-countup): on arrival the headline numbers run
  // from the previously viewed ship's stock value (read off the SAME cohort
  // sheets the ranking uses — nothing invented) to this ship's value, ~700 ms,
  // so a ship switch shows WHICH numbers moved. Reduced motion = cut. ──
  private readonly countUpProgress = signal(1);
  private countUpFrom: Partial<Record<KpiStripCell['key'], number>> = {};
  private countUpRaf: number | null = null;

  private startCountUp(): void {
    if (this.reducedMotion()) return;
    const prev = this.recentlyViewedShips().find((cn) => cn !== this.detail().classNameSlug);
    const cohort = this.rankCohort();
    const sheet = prev && cohort ? cohort.find((c) => c.className === prev)?.sheet : undefined;
    this.countUpFrom = {};
    for (const c of this.allKpiCells()) {
      const from = sheet ? (sheet as Record<string, number | null | undefined>)[c.key] : null;
      this.countUpFrom[c.key] = from ?? 0;
    }
    const start = performance.now();
    const ms = 700;
    this.countUpProgress.set(0);
    if (this.countUpRaf) cancelAnimationFrame(this.countUpRaf);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      this.countUpProgress.set(1 - Math.pow(1 - t, 3));
      this.countUpRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.countUpRaf = requestAnimationFrame(tick);
  }

  countUpText(c: KpiStripCell): string {
    const p = this.countUpProgress();
    if (c.value == null || p >= 1) return this.fmtCell(c);
    const from = this.countUpFrom[c.key] ?? 0;
    return formatEquippedStat({ labelKey: c.labelKey, value: from + (c.value - from) * p, format: c.format });
  }

  deltaText(c: KpiStripCell): string | null {
    if (!c.delta) return null;
    const raw = c.delta.raw;
    const magnitude = formatEquippedStatNumber({ labelKey: c.labelKey, value: Math.abs(raw), format: c.format });
    if (/^0([.,]0*)?$/.test(magnitude)) return null;
    return `${raw > 0 ? '+' : '−'}${magnitude}`;
  }

  deltaTone(c: KpiStripCell): 'up' | 'down' | null {
    if (!c.delta) return null;
    const better = c.lowerIsBetter ? c.delta.raw < 0 : c.delta.raw > 0;
    return better ? 'up' : 'down';
  }

  // ── "Einordnung" top-3 (user decision 1) ────────────────────────────
  // best-ranked ships (by the active Einsatz KPI) among recently-viewed ∪
  // hangar ships; random cohort fill-up below 3. Every value is read off the
  // SAME cohort data `rankShip()` already fetched — nothing invented.
  readonly topCohortShips = computed<TopCohortShip[]>(() => {
    const cohort = this.rankCohort();
    if (!cohort || cohort.length === 0) return [];
    const activeKey = (this.kpiCells().find((c) => c.accent) ?? this.kpiCells()[0])?.key;
    if (!activeKey) return [];
    const self = this.detail().classNameSlug;
    const byClass = new Map(cohort.map((c) => [c.className, c] as const));
    const candidateNames = new Set([...this.recentlyViewedShips(), ...this.hangarShipClassNames()]);
    candidateNames.delete(self);
    const hasValue = (c: RankShipInput): boolean => (c.sheet as Record<string, number | null>)[activeKey] != null;
    let pool = [...candidateNames].map((cn) => byClass.get(cn)).filter((c): c is RankShipInput => !!c && hasValue(c));
    if (pool.length < 3) {
      const already = new Set(pool.map((p) => p.className));
      const rest = cohort.filter((c) => c.className !== self && !already.has(c.className) && hasValue(c));
      const shuffled = [...rest].sort((a, b) => (a.className > b.className ? 1 : -1));
      pool = [...pool, ...shuffled.slice(0, 3 - pool.length)];
    }
    return pool
      .map((c) => ({
        className: c.className,
        displayName: humanizeClassName(c.className),
        value: (c.sheet as Record<string, number | null>)[activeKey] ?? 0,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 3);
  });

  // ── Perspectives (concept round 10 "Weg B": four tiles) ──────────
  readonly perspectiveTiles = computed<PerspectiveTile[]>(() => {
    const cells = this.allKpiCells();
    const rank = this.rankResult();
    return PERSPECTIVES.map((id) => {
      const keys = PERSPECTIVE_KPIS[id] as readonly string[];
      const tileCells = cells.filter((c) => keys.includes(c.key));
      const lead = PERSPECTIVE_LEAD[id].map((k) => tileCells.find((c) => c.key === k && c.value != null)).find((c) => !!c) ?? null;
      const subs = tileCells.filter((c) => c !== lead && c.value != null).slice(0, 3);
      const ranked = rank ? rank.axes.filter((a) => keys.includes(a.key) && a.percentile != null) : [];
      const pct = ranked.length > 0
        ? Math.round(ranked.reduce((sum, a) => sum + (a.percentile ?? 0), 0) / ranked.length)
        : null;
      return { id, titleKey: `codex.holo.stage.perspective.${id}`, pct, lead, subs, say: this.sayFor(pct, ranked, rank?.cohortSize ?? 0) };
    });
  });

  /** The one-line reading under the big number: the percentile band against
   * the cohort, plus the strongest/weakest ranked axis when there is one. */
  private sayFor(pct: number | null, ranked: RankResult['axes'], n: number): string {
    if (pct == null) return this.t.instant('codex.holo.stage.say.gap');
    const band = pct >= 75 ? 'top' : pct >= 50 ? 'high' : pct >= 25 ? 'mid' : 'low';
    let text: string = this.t.instant(`codex.holo.stage.say.${band}`, { n });
    if (ranked.length > 1) {
      const sorted = [...ranked].sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0));
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      text += ' ' + this.t.instant('codex.holo.stage.say.axes', {
        best: this.t.instant(best.labelKey), bp: Math.round(best.percentile ?? 0),
        worst: this.t.instant(worst.labelKey), wp: Math.round(worst.percentile ?? 0),
      });
    }
    return text;
  }

  /** The tiles as the child renders them — every string resolved here, so
   * the count-up, the ghosts and the formatter stay in one place. */
  readonly perspectiveViews = computed<HoloPerspectiveView[]>(() =>
    this.perspectiveTiles().map((t) => ({
      id: t.id,
      titleKey: t.titleKey,
      pct: t.pct,
      leadText: t.lead ? this.countUpText(t.lead) : null,
      leadLabelKey: t.lead?.labelKey ?? null,
      leadShortKey: t.lead ? `codex.kpi.short.${t.lead.key}` : null,
      deltaText: t.lead ? this.deltaText(t.lead) : null,
      deltaTone: t.lead ? this.deltaTone(t.lead) : null,
      ghost: t.lead ? this.ghostFor(t.lead.key) : null,
      say: t.say,
      subs: t.subs.map((c) => ({ key: c.key, shortKey: `codex.kpi.short.${c.key}`, text: this.fmtCell(c), ghost: this.ghostFor(c.key) })),
    })),
  );

  // ── Change journal ───────────────────────────────────────────────
  readonly journal = computed<JournalEntry[]>(() => {
    const entries: JournalEntry[] = [];
    for (const section of this.allSections()) {
      for (const slot of section.slots) {
        if (slot.draftState) {
          entries.push({
            port: slot.rawPort ?? slot.port,
            label: slot.name ?? slot.port,
            state: slot.draftState,
            paths: slot.draftPaths ?? [],
          });
        }
      }
    }
    return entries;
  });

  journalAllPaths(): string[] {
    return this.journal().flatMap((e) => e.paths);
  }
}
