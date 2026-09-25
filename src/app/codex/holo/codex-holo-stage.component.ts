import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ShipSkinsService } from '../ship-skins.service';
import { Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { CodexDetail } from '../codex.service';
import { CodexItemPort } from '../codex.types';
import type { StageCountChip } from '../codex-detail.component';
import { HoloSilhouette, SilhouetteAnchor } from '../holo-silhouette';
import { MISSIONS, MissionId, missionDisabledReasonKey } from '../codex-mission';
import type { ShipCapabilities } from '../codex-mission';
import { KpiStripCell } from '../codex-kpi-sets';
import { formatEquippedStat, formatEquippedStatNumber } from '../codex-equipped-stats';
import { CodexRankCardComponent } from '../codex-rank-card.component';
import { RankProfileId, RankResult, RankScope, RankShipInput } from '../codex-rank';
import {
  CodexHardpointLayoutComponent,
  LayoutSection,
  LayoutSlot,
  LayoutTarget,
} from '../codex-hardpoint-layout.component';
import { SHIP_MODULE_SECTION_ORDER, ShipModuleSection } from '../ship-module-sections';
import { ShipFactGroup } from '../codex-analysis-panels.component';
import { KpiSheet, OffensivePanel, DefensivePanel } from '../codex-loadout-stats';
import { BuildRef, PERSPECTIVE_KPIS, PERSPECTIVES, Perspective, PortOccupantMap } from '../codex-build-compare';
import { displayItemName, formatNumber, humanizeClassName } from '../codex-format';
import { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import { HardpointPortRef } from '../ship-skin-viewer.component';
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
import { CodexHoloTableComponent } from './codex-holo-table.component';
import { CodexHoloInspectorComponent } from './codex-holo-inspector.component';
import { HoloPhase, JournalEntry, PinGroup, PinRing, StagePin, ringPositions, shipNameWithoutMaker } from './codex-holo-model';
import { HangarShipConfig } from '../../hangar/hangar.types';
import type { CodexBuild } from '../codex.types';
import type { PowerSheet } from '../codex-power';
import type { SummaryOccupant } from '../ship-summary-panels';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

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
  /** The active Einsatz's overall percentile ("P68"), shown when the bar has room. */
  pct: string | null;
  disabledKey: string | null;
}

/** One "Einordnung" top-3 row (user decision 1). */
interface TopCohortShip {
  className: string;
  displayName: string;
  value: number;
}

type StaticKey = 'crew' | 'mass' | 'cargo';

const SOUND_PREF_KEY = 'sc.codex.holo.sound';
const MOBILE_TABS_PREF_KEY = 'sc.codex.holo.mobileTabs';
const UNDO_TOAST_MS = 6000;
/** Arrival timing (concept hv3-s1: "keine 5 Sekunden"): how long the hero art
 * may take to arrive before the table goes on without it, how long it holds,
 * and the reveal itself — every entrance animation of the reveal ends inside it. */
const HERO_WAIT_MS = 450;
const HERO_HOLD_MS = 520;
const REVEAL_MS = 1100;
/** Above this many pins the labels leave the canvas for the numbered key —
 * on a ring of ~250 px radius, 8 labels of 120–220 px is the most that
 * stays legible without collisions (wave 5 A2.4). */
const DENSE_PIN_COUNT = 8;
/** Digit hotkeys cover 1–9 and 0 (= 10); the inspector hint must not
 * promise more (wave 5 B1.4). */
const HOTKEY_PIN_MAX = 10;

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
 * Layout (hv6-s1 / hv6-s4 / hv10-s1): top bar = search | ship title | patch
 * chooser; three panels in one frame = Einordnung | Tisch (Einsatz bar as its
 * header, `sc-codex-holo-table` as its surface) | Inspector
 * (`sc-codex-holo-inspector`); below = calm ports list | four perspective
 * tiles; details drawer; sticky strip. The stage computes every pin and owns
 * the arrival phase; the two children only render.
 */
@Component({
  selector: 'sc-codex-holo-stage',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    CodexRankCardComponent,
    CodexHardpointLayoutComponent,
    CodexHoloPerspectivesComponent,
    CodexHoloStripComponent,
    HangarPickerComponent,
    CodexHoloPatchComponent,
    CodexHoloShareComponent,
    CodexHoloTableComponent,
    CodexHoloInspectorComponent,
    ScTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="holo-stage" [class.reduced-motion]="reducedMotion()" [class.arrived]="arrived()"
             [class.ph-wait]="phase() === 'wait'" [class.ph-hero]="phase() === 'hero'" [class.ph-reveal]="phase() === 'reveal'"
             [class.left-collapsed]="leftCollapsed()" [class.right-collapsed]="rightCollapsed()">

      <!-- ── Top bar: search | the ship | patch ─────────────────────── -->
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
        <!-- Keyed on the name: a hull switch re-enters the title with it. -->
        @for (name of [shortName()]; track name) {
          <div class="ht-title">
            @if (kicker(); as k) { <span class="ht-kicker">{{ k }}</span> }
            <h1 class="ht-name" [scTooltip]="eyebrowTitle()">{{ name }}</h1>
          </div>
        }
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
                    [scTooltip]="'codex.holo.stage.railToggle' | translate" scTooltipTier="label">{{ leftCollapsed() ? '⟩' : '⟨' }}</button>
          </div>
          @if (leftCollapsed()) {
            <div class="pb rail-min"><span class="vi">{{ 'codex.holo.stage.einordnung' | translate }}</span></div>
          } @else if (bodyReady()) {
            <div class="pb frame">
              <div class="wm" aria-hidden="true">{{ ('codex.mission.' + activeMissionId()) | translate }}</div>
              <div class="statics">
                @for (k of staticKeys; track k) {
                  <div [scTooltip]="staticChipTitle(k)" scTooltipTier="label">
                    <span class="k">{{ staticLabelKey(k) | translate }}</span>
                    <span class="v" [class.mid]="staticChip(k).length > 6" [class.long]="staticChip(k).length > 8">{{ staticChip(k) }}</span>
                  </div>
                }
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
                    <li><a [routerLink]="['/codex', 'ship', s.className]" [queryParams]="{ view: 'holo' }">{{ s.displayName }}</a></li>
                  }
                </ol>
              }
              <a class="cohort-link" routerLink="/codex/index" [queryParams]="{ kind: 'ship' }">
                {{ 'codex.holo.stage.cohortLink' | translate }} ›
              </a>
            </div>
          }
        </aside>

        <!-- ── Table: Einsatz header, head row, projection surface ───── -->
        <section class="holo-panel holo-table mobile-table">
          <div class="ph role">
            <div class="rolebar" #rolebar role="radiogroup" [attr.aria-label]="'codex.mission.label' | translate">
              <span class="lab">{{ 'codex.mission.label' | translate }}</span>
              @for (m of missionSegments(); track m.id) {
                <span style="display: contents" [scTooltip]="m.disabledKey ? (m.disabledKey | translate) : null" scTooltipTier="label">
                <button type="button" class="r" role="radio"
                        [class.on]="m.id === activeMissionId()"
                        [class.dim]="!!m.disabledKey"
                        [disabled]="!!m.disabledKey"
                        [attr.aria-checked]="m.id === activeMissionId()"
                        (click)="missionChange.emit(m.id)">
                  <span class="r-l">{{ m.labelKey | translate }}</span>
                  <small>{{ m.sub }}@if (m.pct) {<span class="rp"> · {{ m.pct }}</span>}</small>
                </button>
                </span>
              }
              <span class="ink" aria-hidden="true"></span>
            </div>
          </div>
          <div class="pb">
            <!-- Table head — ONE flow row, never absolute overlays (wave 5
                 A2.1): hangar dock | what the surface shows | view tools. -->
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
              <p class="table-eyebrow">
                {{ eyebrowKey() | translate: { n: pins().length } }}
                @if (!silhouette() && viewMode() === 'holo') {
                  <span class="no-geometry-badge" [scTooltip]="'codex.holo.stage.noGeometryReason' | translate" scTooltipTier="label">· {{ 'codex.holo.noGeometry' | translate }}</span>
                }
              </p>
              <div class="tools5" [class.open]="sharePopoverOpen()">
                @if (has3d()) {
                  <button type="button" class="tt" [class.on]="viewMode() === '3d'" [attr.aria-pressed]="viewMode() === '3d'" (click)="toggleViewMode('3d')">{{ 'codex.holo.stage.view3d' | translate }}</button>
                }
                <span style="display: contents" [scTooltip]="hardpointFrame() ? null : ('codex.holo.stage.viewSchemaUnavailable' | translate)" scTooltipTier="label">
                <button type="button" class="tt" [class.on]="viewMode() === 'schema'" [attr.aria-pressed]="viewMode() === 'schema'"
                        [disabled]="!hardpointFrame()"
                        (click)="toggleViewMode('schema')">{{ 'codex.holo.stage.viewSchema' | translate }}</button>
                </span>
                <span class="share-wrap" (keydown.escape)="closeShare($event)">
                  <button type="button" class="tt" [class.on]="sharePopoverOpen()" [attr.aria-expanded]="sharePopoverOpen()" (click)="toggleShare()">↗ {{ 'codex.holo.stage.viewShare' | translate }}</button>
                  @if (sharePopoverOpen()) {
                    <!-- slot: share -->
                    <sc-codex-holo-share
                      class="share-popover"
                      animate.enter="pop-enter"
                      animate.leave="pop-leave"
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

            <sc-codex-holo-table
              [pins]="pins()"
              [orbit]="pinRing()"
              [silhouette]="silhouette()"
              [previewSilhouette]="previewSilhouette()"
              [previewFailed]="previewFailed()"
              [heroArt]="heroArt()"
              [heroSrc]="phase() === 'hero' || phase() === 'reveal' ? heroSrc() : null"
              [viewMode]="viewMode()"
              [shipClassName]="shipClassName()"
              [hardpointPortRefs]="hardpointPortRefs()"
              [hardpointFrame]="hardpointFrame()"
              [hardpointMarkers]="hardpointMarkersMutable()"
              [activePorts]="activePorts()"
              [inspectedPort]="inspectedPort()"
              [patchPortPins]="patchPortPins()"
              [displayName]="displayName()"
              [dense]="dense()"
              [hasUnresolved]="hasUnresolvedPins()"
              [phase]="phase()"
              [still]="reducedMotion()"
              (hovered)="hovered.emit($event)"
              (pinInspect)="inspectPin($event)"
              (artAvailable)="artAvailable.emit($event)"
              (previewError)="previewFailed.set(true)" />
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
                    [scTooltip]="'codex.holo.stage.railToggle' | translate" scTooltipTier="label">{{ rightCollapsed() ? '⟨' : '⟩' }}</button>
          </div>
          @if (rightCollapsed()) {
            <div class="pb rail-min"><span class="vi">{{ 'codex.holo.stage.inspector' | translate }}</span></div>
          } @else if (bodyReady()) {
            <sc-codex-holo-inspector
              class="pb"
              [target]="inspectorTarget()"
              [isRawPort]="inspectorIsRawPort()"
              [patchPin]="inspectedPatchPin()"
              [inspectedPort]="inspectedPort()"
              [pinGroups]="pinGroups()"
              [hotkeyPinCount]="hotkeyPinCount()"
              [activePorts]="activePorts()"
              [journal]="journal()"
              [draftChangedCount]="draftChangedCount()"
              [saveableCount]="saveableCount()"
              [saving]="saving()"
              [saveError]="saveError()"
              [inHangar]="inHangar()"
              (closed)="inspectedPort.set(null)"
              (pinInspect)="inspectPin($event)"
              (hovered)="hovered.emit($event)"
              (swapRequested)="swapRequested.emit($event)"
              (inspected)="inspected.emit($event)"
              (reverted)="reverted.emit($event)"
              (saveDraft)="saveDraft.emit()"
              (discardDraft)="discardDraft.emit()" />
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
            [foldedSections]="foldedModuleSections()"
            [occupantsBySection]="occupantsBySection()"
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
      @if (undoToast()) {
        <div class="undo-toast" role="status" animate.enter="toast-enter" animate.leave="toast-leave">
          <span>{{ 'codex.holo.stage.journalChanged' | translate: { label: undoToastLabel() } }}</span>
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
        (sheetChange)="onSheetChange($event)" />
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
  --e-out: cubic-bezier(0.2, 0.7, 0.2, 1); --e-io: cubic-bezier(0.65, 0, 0.35, 1);
  --rail: 300px;
  display: flex; flex-direction: column; gap: 10px;
  }
  .btn, .mobile-tabs button, .holo-panel > .ph, .rail-min .vi, .wm, .statics .k, .sub, .rolebar .r, .tt, .table-eyebrow, .sh, .details-toggle, .switch, .ht-kicker, .ht-name { font-family: var(--d); text-transform: uppercase; }
  .n { font-family: var(--m); font-size: max(10px, var(--f)); color: var(--sc-fg-1); background: var(--sc-bg-2); padding: 0 6px; border-radius: 2px; letter-spacing: 0; }
  .sp { flex: 1; }
  .rule { flex: 1; height: 1px; background: var(--l1); }
  .btn { min-height: var(--sc-tap-min, 32px); padding: 5px 12px; border-radius: 3px; border: 1px solid var(--l2); background: var(--a10);
  color: var(--sc-fg-0); cursor: pointer; font-size: max(11px, var(--f)); letter-spacing: 0.08em; transition: border-color 160ms ease, color 160ms ease; }
  .btn.quiet { background: none; border-color: var(--l1); color: var(--sc-fg-1); }
  .btn:hover, .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
  @keyframes rise { from { opacity: 0; transform: translateY(10px); } }
  @keyframes fade-in { from { opacity: 0; } }

  /* ── Top bar: search | the ship (the page's h1) | patch ── */
  .holo-topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); grid-template-areas: 'search title patch'; align-items: center; gap: 16px; }
  .ht-search { grid-area: search; width: 100%; max-width: 360px; display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--l2); border-radius: 4px;
  background: var(--surface-input, var(--sc-bg-0)); color: var(--sc-fg-2); min-height: max(40px, var(--sc-tap-min, 0px)); transition: border-color 160ms ease, box-shadow 160ms ease; }
  .ht-search:focus-within { border-color: var(--sc-accent); box-shadow: 0 0 0 3px var(--a12); }
  .ht-icon { width: 15px; height: 15px; flex: none; }
  .ht-input { flex: 1; min-width: 0; background: none; border: none; color: var(--sc-fg-0); font: inherit; font-size: max(12px, var(--f)); padding: 7px 0; outline: none; }
  .ht-input::placeholder { color: var(--sc-fg-2); }
  .ht-search kbd { font-family: var(--m); font-size: 10px; color: var(--sc-fg-2); border: 1px solid var(--l1); padding: 0 5px; border-radius: 2px; }
  /* Capped: a long variant name ("… Wikelo War Special") ellipsizes instead
     of squeezing the search and the patch chooser off the bar. */
  .ht-title { grid-area: title; display: grid; justify-items: center; gap: 3px; min-width: 0; max-width: min(46vw, 640px); text-align: center; }
  .ht-kicker { max-width: 100%; font-size: max(9px, var(--f)); letter-spacing: 0.2em; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  animation: fade-in 480ms ease-out 120ms backwards; }
  .ht-name { margin: 0; max-width: 100%; font-weight: 500; font-size: clamp(16px, 1.55vw, 22px); line-height: 1.15; letter-spacing: 0.12em; color: var(--sc-fg-0);
  text-shadow: 0 0 18px var(--a40); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: name-in 640ms var(--e-out) backwards; }
  @keyframes name-in { from { opacity: 0; letter-spacing: 0.32em; filter: blur(3px); } }
  .ht-right { grid-area: patch; display: flex; justify-content: flex-end; align-items: center; gap: 10px; min-width: 0; }
  .mobile-tabs { display: none; gap: 6px; }
  .mobile-tabs button { flex: 1; min-height: var(--sc-tap-min, 32px); padding: 6px 10px; border-radius: 3px; border: 1px solid var(--l2); background: var(--glass); color: var(--sc-fg-1); cursor: pointer;
  font-size: max(10px, var(--f)); letter-spacing: 0.14em; transition: color 160ms ease, border-color 160ms ease; }
  .mobile-tabs button[aria-selected="true"] { color: var(--sc-accent); border-color: var(--sc-accent); }

  /* ── The frame: Einordnung | Tisch | Inspektor ── */
  .holo-body { display: grid; grid-template-columns: var(--rail) minmax(0, 1fr) var(--rail); gap: 10px; align-items: stretch;
  padding: 10px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent); border-radius: 4px; transition: grid-template-columns 360ms var(--e-io); }
  .left-collapsed .holo-body { grid-template-columns: 44px minmax(0, 1fr) var(--rail); }
  .right-collapsed .holo-body { grid-template-columns: var(--rail) minmax(0, 1fr) 44px; }
  .left-collapsed.right-collapsed .holo-body { grid-template-columns: 44px minmax(0, 1fr) 44px; }
  .holo-panel { border: 1px solid var(--l2); border-radius: 4px; background: var(--glass);
  display: grid; grid-template-rows: auto 1fr; min-height: 520px; min-width: 0; position: relative; }
  .holo-panel > .ph { display: flex; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--l2);
  background: var(--ink); font-size: max(9.5px, var(--f)); letter-spacing: 0.16em; color: var(--sc-accent); min-height: 38px; }
  .ph-glyph { font-size: 11px; }
  /* --sc-tap-min is 0 on a mouse desktop: without the max() the rail toggle
     shrank to its 5px glyph. */
  .ph .ic { background: none; border: none; border-radius: 3px; color: var(--sc-fg-2); cursor: pointer; font: inherit; font-size: 13px; letter-spacing: 0;
  min-width: max(28px, var(--sc-tap-min, 0px)); min-height: max(28px, var(--sc-tap-min, 0px)); padding: 0; transition: color 160ms ease, background 160ms ease; }
  .ph .ic:hover { color: var(--sc-accent); background: var(--a10); }
  .holo-panel > .pb { padding: 12px; display: grid; gap: 10px; align-content: start; min-width: 0;
  animation: rise var(--rise-dur, 300ms) var(--e-out) var(--rise-delay, 60ms) backwards; }
  /* The arrival: the panels' bodies are created with the reveal and rise
     after the table began to materialise (same keyframes, slower timing). */
  .ph-reveal .holo-left > .pb { --rise-dur: 560ms; --rise-delay: 260ms; }
  .ph-reveal .holo-right > .pb { --rise-dur: 560ms; --rise-delay: 380ms; }
  .holo-stage:is(.ph-wait, .ph-hero) .holo-below { opacity: 0; }
  .ph-reveal .holo-below { animation: rise 600ms var(--e-out) 440ms backwards; }
  .holo-panel > .pb.rail-min { padding: 10px 4px; justify-items: center; }
  /* The inspector never decides the frame's height: a capital ship's
     hardpoint list is 40 rows long — it scrolls inside its panel instead of
     stretching the table (and dropping the hull to the bottom of a 1500px frame). */
  @media (min-width: 1001px) {
  .holo-right { height: 0; min-height: 100%; }
  .holo-right > .pb:not(.rail-min) { overflow-y: auto; overscroll-behavior: contain; }
  }
  .rail-min .vi { writing-mode: vertical-rl; transform: rotate(180deg); font-size: max(8.5px, var(--f)); letter-spacing: 0.18em; color: var(--sc-fg-2); }
  .holo-panel.collapsed > .ph .ph-title, .holo-panel.collapsed > .ph .n, .holo-panel.collapsed > .ph .ph-glyph { display: none; }
  .holo-panel.collapsed > .ph { padding: 7px 4px; justify-content: center; }
  .frame { position: relative; }
  /* Watermark: the Einsatz word behind the panel's lower half. Specificity
     matches the ".frame > *" rule below (wave 5 A2.3) so it stays out of the flow. */
  .frame > .wm { position: absolute; inset: auto 0 6% 0; text-align: center; font-size: 30px;
  letter-spacing: 0.3em; color: var(--a7); pointer-events: none; z-index: 0; overflow: hidden; white-space: nowrap; text-overflow: clip; }
  .frame > * { position: relative; z-index: 1; }
  .statics { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .statics div { display: grid; gap: 2px; align-content: space-between; padding: 6px 8px; background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent); border-radius: 3px; min-width: 0; }
  .statics .k { font-size: max(8px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); }
  .statics .v { font-family: var(--m); font-size: 15px; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .statics .v.mid { font-size: 13px; }
  .statics .v.long { font-family: var(--sc-font-body); font-size: max(10.5px, var(--f)); white-space: normal; color: var(--sc-fg-1); line-height: 1.2; }
  .sub { font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); display: flex; align-items: center; gap: 8px; }
  .sub i { flex: 1; height: 1px; background: var(--l1); }
  .top3 { margin: 0; padding: 0 0 0 18px; font-size: max(11.5px, var(--f)); color: var(--sc-fg-1); display: grid; gap: 3px; }
  .top3 a { color: var(--sc-fg-0); text-decoration: none; transition: color 160ms ease; }
  .top3 a:hover { color: var(--sc-accent); }
  .cohort-link { font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); text-decoration: none; text-align: center; transition: color 160ms ease; }
  .cohort-link:hover { color: var(--sc-accent); }

  /* ── Einsatz bar: every segment fits its label; the lead value may
     ellipsize; an ink bar glides to the active Einsatz. ── */
  .holo-table > .ph.role { padding: 0; gap: 0; background: var(--ink); overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; container-type: inline-size; }
  .holo-table > .ph.role::-webkit-scrollbar { display: none; }
  .rolebar { position: relative; display: flex; width: 100%; min-width: max-content; }
  .rolebar .lab { display: grid; place-items: center; padding: 0 12px; font-family: var(--d); text-transform: uppercase; font-size: max(8.5px, var(--f)); letter-spacing: 0.2em; color: var(--sc-fg-2); border-right: 1px solid var(--l1); }
  @container (max-width: 760px) { .rolebar .lab { display: none; } }
  /* The percentile rides along only where it fits — the strip repeats it. */
  @container (max-width: 900px) { .rolebar .rp { display: none; } }
  /* Where the bar scrolls (phones), its right edge fades: there is more. */
  @media (max-width: 640px) {
  .holo-table > .ph.role { -webkit-mask-image: linear-gradient(90deg, #000 86%, transparent); mask-image: linear-gradient(90deg, #000 86%, transparent); }
  }
  .rolebar .r { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 8px 8px 6px;
  font-size: max(10px, var(--f)); letter-spacing: 0.1em; color: var(--sc-fg-1); border: none; border-right: 1px solid var(--l1); background: none; cursor: pointer;
  min-height: var(--sc-tap-min, 44px); transition: color 200ms ease, background 260ms ease, text-shadow 260ms ease; }
  .rolebar .r-l { white-space: nowrap; }
  /* width:0 + min-width:100%: the value never widens its segment, it fills it and ellipsizes. */
  .rolebar .r small { width: 0; min-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--m); font-size: max(9px, var(--f));
  letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); transition: color 200ms ease; }
  .rolebar .r.on { color: var(--sc-accent); background: linear-gradient(180deg, var(--a4), var(--a14)); text-shadow: 0 0 10px var(--a50); }
  .rolebar .r.on small { color: var(--sc-fg-1); }
  /* An Einsatz this hull cannot fly keeps its label (it says what the ship is
     not) but gives its width to the ones it can. */
  .rolebar .r.dim { opacity: 0.38; cursor: not-allowed; flex-grow: 0; letter-spacing: 0.05em; }
  .rolebar .r.dim small { visibility: hidden; }
  .rolebar .r:last-of-type { border-right: 0; }
  .rolebar .r:hover:not(.dim):not(.on) { color: var(--sc-fg-0); background: var(--a4); }
  .rolebar .r:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
  .rolebar .ink { position: absolute; left: 0; bottom: 0; height: 2px; width: var(--ink-w, 0px); translate: var(--ink-x, 0px) 0; pointer-events: none;
  background: var(--sc-accent); box-shadow: 0 0 10px var(--a55); transition: translate 340ms var(--e-io), width 340ms var(--e-io); }

  /* ── Table head: hangar | what the surface shows | view tools ── */
  .holo-table > .pb { padding: 0 0 8px; position: relative; display: flex; flex-direction: column; min-height: 480px; }
  .table-head { position: relative; z-index: 5; display: flex; align-items: center; gap: 12px; padding: 8px 12px 0; min-height: 44px; }
  .hangar-dock { flex: none; display: flex; align-items: center; }
  .table-eyebrow { flex: 1; min-width: 0; margin: 0; font-size: max(9px, var(--f)); color: var(--sc-fg-2); letter-spacing: 0.16em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .no-geometry-badge { cursor: help; }
  .tools5 { flex: none; display: flex; gap: 14px; align-items: center; opacity: 0.8; transition: opacity 160ms ease; }
  .holo-table:hover .tools5, .holo-table:focus-within .tools5, .tools5:has(.on), .tools5.open { opacity: 1; }
  @media (hover: none) { .tools5 { opacity: 1; } }
  .tt { position: relative; background: none; border: none; padding: 4px 2px; cursor: pointer; font-size: max(8.5px, var(--f));
  letter-spacing: 0.16em; color: var(--sc-fg-1); min-height: var(--sc-tap-min, 24px); transition: color 160ms ease, text-shadow 160ms ease; }
  .tt::after { content: ''; position: absolute; left: 2px; right: 2px; bottom: 1px; height: 1px; background: currentColor; scale: 0 1; transition: scale 220ms var(--e-out); }
  .tt:hover:not(:disabled) { color: var(--sc-fg-0); }
  .tt:hover:not(:disabled)::after, .tt.on::after { scale: 1 1; }
  .tt.on { color: var(--sc-accent); text-shadow: 0 0 8px var(--a50); }
  .tt:disabled { opacity: 0.4; cursor: not-allowed; }
  .tt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .share-wrap { position: relative; display: inline-flex; }
  /* The share popover is a real surface: background, frame, shadow, a notch
     pointing at "Teilen" — never floating text over the table. */
  .share-popover { position: absolute; top: calc(100% + 12px); inset-inline-end: -8px; z-index: 30; width: min(340px, calc(100vw - 32px));
  padding: 12px 14px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border));
  box-shadow: 0 18px 48px rgb(0 0 0 / 0.55), 0 0 0 1px var(--a10); transform-origin: calc(100% - 22px) -6px; }
  .share-popover::before { content: ''; position: absolute; top: -6px; inset-inline-end: 18px; width: 10px; height: 10px; rotate: 45deg; background: var(--sc-bg-1);
  border-top: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); border-left: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); }
  .pop-enter { animation: pop-in 200ms var(--e-out); }
  .pop-leave { animation: pop-out 140ms ease-in forwards; }
  @keyframes pop-in { from { opacity: 0; transform: translateY(-6px) scale(0.97); } }
  @keyframes pop-out { to { opacity: 0; transform: translateY(-4px) scale(0.98); } }
  /* On a desktop with the inspector open, its hardpoint list replaces the
     dense key under the table — one list, not two. */
  @media (min-width: 1001px) { .holo-stage:not(.right-collapsed) ::ng-deep .pin-key { display: none; } }

  /* ── Below: calm ports list | perspectives (sticky beside the long list) ── */
  .holo-below { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr); gap: 14px; align-items: start; padding: 0 10px; }
  @media (min-width: 1181px) {
  .below-persp { position: sticky; top: max(84px, calc(100vh - var(--persp-h, 0px) - var(--holo-strip-h, 64px) - 16px)); }
  }
  .sh { display: flex; align-items: center; gap: 10px; font-size: max(9.5px, var(--f)); letter-spacing: 0.16em; color: var(--sc-accent); margin-bottom: 8px; min-height: 28px; }
  .sh .t { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  .holo-details { padding: 0 10px; }
  .holo-details .sh { margin-bottom: 0; flex-wrap: wrap; }
  .details-toggle { background: none; border: 1px solid var(--l2); border-radius: 3px; color: var(--sc-fg-1); cursor: pointer; padding: 5px 12px; min-height: var(--sc-tap-min, 32px);
  font-size: max(9.5px, var(--f)); letter-spacing: 0.14em; transition: color 160ms ease, border-color 160ms ease; }
  .details-toggle:hover, .details-toggle[aria-expanded="true"] { color: var(--sc-accent); border-color: var(--sc-accent); }
  .details-body { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; animation: rise 320ms var(--e-out) backwards; }
  .switch { display: inline-flex; align-items: center; gap: 8px; font-size: max(8.5px, var(--f)); letter-spacing: 0.12em; color: var(--sc-fg-2); cursor: pointer; min-height: var(--sc-tap-min, 24px); white-space: nowrap; }
  .switch.mobile-only { display: none; }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch .track { width: 28px; height: 14px; border-radius: 7px; border: 1px solid var(--l2); background: var(--sc-bg-0); position: relative; transition: background 160ms ease, border-color 160ms ease; }
  .switch .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--sc-fg-2); transition: transform 200ms var(--e-out), background 160ms ease; }
  .switch input:checked + .track { background: color-mix(in srgb, var(--sc-accent) 30%, var(--sc-bg-0)); border-color: var(--sc-accent); }
  .switch input:checked + .track::after { transform: translateX(14px); background: var(--sc-accent); }
  .switch input:focus-visible + .track { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  /* The toast rides above the strip, whatever height the strip has. */
  .undo-toast { position: fixed; bottom: calc(var(--holo-strip-h, 64px) + 16px); left: 50%; translate: -50% 0; z-index: 20;
  display: flex; align-items: center; gap: 10px; background: var(--sc-bg-0); border: 1px solid var(--sc-accent);
  border-radius: 4px; padding: 8px 12px; font-size: max(12px, var(--f)); color: var(--sc-fg-0); box-shadow: 0 8px 24px rgb(0 0 0 / 0.4), 0 0 0 1px var(--a10); }
  .toast-enter { animation: toast-in 240ms var(--e-out); }
  .toast-leave { animation: toast-out 160ms ease-in forwards; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(12px); } }
  @keyframes toast-out { to { opacity: 0; transform: translateY(8px); } }

  @media (max-width: 1180px) {
  .holo-stage { --rail: 260px; }
  .holo-below { grid-template-columns: 1fr; }
  }
  @media (max-width: 1000px) {
  .holo-topbar { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'title title' 'search patch'; gap: 10px; }
  .ht-search { max-width: none; }
  .ht-title { max-width: 100%; justify-self: center; }
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
  .holo-table > .pb { min-height: 320px; }
  }
  @media (max-width: 640px) {
  .holo-stage { padding-bottom: 72px; }
  .mobile-tabs { display: flex; }
  .switch.mobile-only { display: inline-flex; }
  /* Every :has() column rule from the <=1000px block outranks a bare
     .holo-body (wave 5 A2.7) — restate them here or the table lands in a
     0px column on phones. */
  .holo-body, .holo-body:has(.holo-left:not(.collapsed)), .holo-body:has(.holo-right:not(.collapsed)),
  .holo-body:has(.holo-left:not(.collapsed)):has(.holo-right:not(.collapsed)) { grid-template-columns: 1fr; gap: 10px; padding: 6px; }
  .holo-panel, .holo-panel:not(.collapsed).holo-left, .holo-panel:not(.collapsed).holo-right { grid-column: auto; order: initial; min-height: 0; margin-top: 0; }
  .holo-table { order: -1; }
  .holo-table > .ph.role { max-width: 100%; }
  .holo-table > .pb { min-height: 360px; }
  /* A collapsed panel on a phone is its header — no vertical rail label. */
  .holo-panel.collapsed > .ph { padding: 7px 12px; justify-content: flex-start; }
  .holo-panel.collapsed > .ph .ph-title, .holo-panel.collapsed > .ph .ph-glyph { display: inline; }
  .holo-panel > .pb.rail-min { display: none; }
  /* Phone: dock and tools share the first line, the surface label its own. */
  .table-head { flex-wrap: wrap; gap: 6px; padding: 6px 6px 0; }
  .table-head .hangar-dock { order: 1; }
  .table-head .tools5 { order: 2; margin-inline-start: auto; gap: 8px; }
  .tt { letter-spacing: 0.1em; padding: 4px 0; }
  .table-head .table-eyebrow { order: 3; flex-basis: 100%; }
  .holo-below { grid-template-columns: 1fr; padding: 0 6px; }
  .holo-body.mobile-hide-table .mobile-table { display: none; }
  .holo-body.mobile-hide-data .mobile-data { display: none; }
  .undo-toast { width: calc(100% - 32px); justify-content: space-between; }
  }
  .reduced-motion *, .reduced-motion *::before, .reduced-motion *::after { animation: none !important; transition: none !important; }
  @media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  }
  `],
})
export class CodexHoloStageComponent {
  private readonly router = inject(Router);
  private readonly t = inject(TranslateService);
  private readonly skins = inject(ShipSkinsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly rolebar = viewChild<ElementRef<HTMLElement>>('rolebar');

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
  /** The calm ports list's folded previews and block census read these —
   * the same maps the classic view hands its layout. */
  readonly occupantsBySection = input<ReadonlyMap<ShipModuleSection, readonly SummaryOccupant[]>>(new Map());
  readonly foldedModuleSections = input<ReadonlySet<ShipModuleSection>>(new Set());

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
  /** Where the arrival stands — `wait` until the first run decides (so no
   * canvas is created with the wrong timing), see {@link HoloPhase}. */
  readonly phase = signal<HoloPhase>('wait');
  /** The arrival's hero image, set only once it actually loaded. */
  readonly heroSrc = signal<string | null>(null);
  readonly soundOn = signal(this.readSoundPref());
  readonly mobileTabsEnabled = signal(this.readMobileTabsPref());
  readonly mobileTab = signal<'table' | 'data'>('table');
  /** The tile that pulses after a port selection (concept pe4-pulse). */
  readonly pulseTile = signal<Perspective | null>(null);
  /** The strip's last power sheet — the signature tile reads IR / EM off it. */
  readonly powerSheet = signal<PowerSheet | null>(null);

  // slot: patch-delta outputs, surfaced to the pins/inspector/KPI band
  readonly patchGhosts = signal<HoloPatchKpiGhosts | null>(null);
  readonly patchPortPins = signal<Readonly<Record<string, PortPinBadge>> | null>(null);
  readonly patchComparisonBuild = signal<CodexBuild | null>(null);

  /** 3D model availability, answered by the skin catalog (never by a mounted
   * viewer, which would only exist once the user is already in 3D). */
  readonly has3d = signal(false);
  private skinsSeq = 0;

  /** The panels' bodies exist from the reveal on, so they rise WITH it. */
  readonly bodyReady = computed(() => this.phase() === 'reveal' || this.phase() === 'done');

  readonly staticKeys: readonly StaticKey[] = ['crew', 'mass', 'cargo'];

  constructor() {
    // The arrival (concept hv3-s1), keyed on the ship: every hull switch
    // re-runs it. Reduced motion or a repeat visit in the same session = a
    // hard cut. Otherwise the hero art is fetched (briefly — the table never
    // waits long for it), shown, and dissolved into the table while the
    // outline materialises and the pins pop in.
    effect((onCleanup) => {
      const slug = this.detail().classNameSlug;
      const timers: ReturnType<typeof setTimeout>[] = [];
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
        timers.forEach((t) => clearTimeout(t));
      });
      untracked(() => {
        this.heroSrc.set(null);
        if (this.reducedMotion() || this.seenThisSession()) {
          this.phase.set('done');
          this.arrived.set(true);
          return;
        }
        this.arrived.set(false);
        const reveal = (): void =>
          untracked(() => {
            if (cancelled) return;
            this.phase.set('reveal');
            this.startCountUp();
            timers.push(
              setTimeout(() => {
                if (cancelled) return;
                this.phase.set('done');
                this.heroSrc.set(null);
                this.arrived.set(true);
                // Only now is the ship "seen" — the host must not mark it before
                // the stage arrived, or the arrival never plays (wave 5 A3.1).
                this.arrivedShip.emit(slug);
              }, REVEAL_MS),
            );
          });
        // A render is a hero; the game's flat top-down icon is not (a white
        // cut-out filling the table) — that one already IS the ghost hull.
        const src = this.heroArt().find((u) => !!u && u !== this.previewSilhouette()) ?? null;
        if (!src || typeof Image === 'undefined') {
          reveal();
          return;
        }
        this.phase.set('wait');
        let settled = false;
        const img = new Image();
        const giveUp = setTimeout(() => {
          if (settled) return;
          settled = true;
          reveal();
        }, HERO_WAIT_MS);
        timers.push(giveUp);
        img.onload = () => {
          if (settled || cancelled) return;
          settled = true;
          clearTimeout(giveUp);
          this.heroSrc.set(src);
          this.phase.set('hero');
          timers.push(setTimeout(reveal, HERO_HOLD_MS));
        };
        img.onerror = () => {
          if (settled || cancelled) return;
          settled = true;
          clearTimeout(giveUp);
          reveal();
        };
        img.src = src;
      });
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

    // The Einsatz bar's ink follows the active segment (and re-measures when
    // the lead values under the labels change the segment widths).
    effect((onCleanup) => {
      this.activeMissionId();
      this.missionSegments();
      const bar = this.rolebar()?.nativeElement;
      if (!bar || typeof requestAnimationFrame !== 'function') return;
      const raf = requestAnimationFrame(() => this.placeInk(bar));
      onCleanup(() => cancelAnimationFrame(raf));
    });

    // Sizes other rules depend on: the ink (bar width), the toast's and the
    // sticky tiles' clearance above the strip, the tiles' own height.
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'function') return;
      const root = this.host.nativeElement;
      const stage = root.querySelector<HTMLElement>('.holo-stage');
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const h = Math.round(el.getBoundingClientRect().height);
          if (el.matches('sc-codex-holo-strip')) stage?.style.setProperty('--holo-strip-h', `${h}px`);
          else if (el.matches('.below-persp')) el.style.setProperty('--persp-h', `${h}px`);
          else if (el.matches('.rolebar')) this.placeInk(el);
        }
      });
      for (const sel of ['sc-codex-holo-strip', '.below-persp', '.rolebar']) {
        const el = root.querySelector(sel);
        if (el) ro.observe(el);
      }
      this.destroyRef.onDestroy(() => ro.disconnect());
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
    this.destroyRef.onDestroy(() => {
      if (toastTimer) clearTimeout(toastTimer);
    });
  }

  readonly undoToast = signal<JournalEntry | null>(null);
  /** The toast names the part as the journal names it NOW — a swap lands as
   * the raw class name while its payload loads, then resolves to the name. */
  readonly undoToastLabel = computed(() => {
    const t = this.undoToast();
    if (!t) return '';
    return displayItemName(this.journal().find((e) => e.port === t.port)?.label ?? t.label);
  });
  undoToastAction(): void {
    const t = this.undoToast();
    if (!t) return;
    this.reverted.emit(t.paths);
    this.undoToast.set(null);
  }

  /** Slides the Einsatz bar's ink under the active segment; keeps that
   * segment in view when the bar scrolls (narrow tables, phones). */
  private placeInk(bar: HTMLElement): void {
    const on = bar.querySelector<HTMLElement>('.r.on');
    if (!on) {
      bar.style.setProperty('--ink-w', '0px');
      return;
    }
    bar.style.setProperty('--ink-x', `${on.offsetLeft}px`);
    bar.style.setProperty('--ink-w', `${on.offsetWidth}px`);
    const scroller = bar.parentElement;
    if (scroller && scroller.scrollWidth > scroller.clientWidth + 1) {
      const left = Math.max(0, on.offsetLeft - (scroller.clientWidth - on.offsetWidth) / 2);
      scroller.scrollTo({ left, behavior: this.reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  /** The strip's power sheet goes up to the host AND feeds the signature tile. */
  onSheetChange(sheet: PowerSheet): void {
    this.powerSheet.set(sheet);
    this.sheetChange.emit(sheet);
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

  /** The title without the maker's own first word — the kicker names the maker. */
  readonly shortName = computed(() => shipNameWithoutMaker(this.displayName(), this.manufacturerName()));

  /** Above the name: maker · career · role, whatever the extract knows. */
  readonly kicker = computed(() => {
    const chips = this.heroChips();
    const parts = [this.manufacturerName(), ...['career', 'role'].map((k) => chips.find((c) => c.key === k)?.text ?? null)]
      .filter((p): p is string => !!p && p.trim().length > 0);
    return [...new Set(parts)].join(' · ') || null;
  });

  /** What the table surface currently shows. */
  readonly eyebrowKey = computed(() =>
    this.viewMode() === '3d' ? 'codex.holo.stage.eyebrow3d'
    : this.viewMode() === 'schema' ? 'codex.holo.stage.eyebrowSchema'
    : 'codex.holo.stage.eyebrowTop',
  );

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
  staticLabelKey(key: StaticKey): string {
    return key === 'crew' ? 'codex.holo.stage.staticCrew' : key === 'mass' ? 'codex.holo.stage.staticMass' : 'codex.holo.stage.staticCargo';
  }

  staticChip(key: StaticKey): string {
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
  staticChipTitle(key: StaticKey): string | null {
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
      const pct = m.id === this.activeMissionId() && rank?.overall != null ? `P${Math.round(rank.overall)}` : null;
      return { id: m.id, labelKey: m.labelKey, sub, pct, disabledKey: missionDisabledReasonKey(m.id, caps) };
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

  /** The ports that pin the table — one per port the ports list shows (never
   * from `anchors ∪ unresolved`, per wave1-redteam.md: the silhouette may
   * place a pin, it never decides which ports exist). Ships with no loadout
   * blocks fall back to the extract's raw item ports, de-duplicated (wave 5
   * A2.4: `track pin.portName` must stay unique). */
  private readonly pinSource = computed<{ raw: string; known: { slot: LayoutSlot; index: number; section: ShipModuleSection } | null }[]>(() => {
    const byRaw = this.slotByRawPort();
    if (byRaw.size > 0) return [...byRaw.entries()].map(([raw, known]) => ({ raw, known }));
    const seenRaw = new Set<string>();
    return ((this.detail()?.ports ?? []) as readonly CodexItemPort[])
      .filter((p) => !!p.portName && !seenRaw.has(p.portName) && seenRaw.add(p.portName))
      .map((p) => ({ raw: p.portName!, known: null }));
  });

  /** The fallback ring, as an ellipse that hugs the traced hull's bbox (in %
   * of the canvas) — or the plain ring when there is no silhouette. Pins
   * without an anchor sit on it in list order, starting at the nose. */
  private readonly fallbackRing = computed<PinRing>(() => {
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

  /** The ring the estimated pins actually ride on (null when every pin is
   * anchored): a crowded ring (capital ships, 40+ ports) widens until
   * neighbouring dots no longer touch — ~7 % of the canvas per pin. */
  readonly pinRing = computed<PinRing | null>(() => {
    const s = this.silhouette();
    const anchored = new Set(s ? s.anchors.map((a) => a.portId) : []);
    const n = this.pinSource().filter(({ raw }) => !anchored.has(raw)).length;
    if (n === 0) return null;
    const ring = { ...this.fallbackRing() };
    const needMean = (n * 7) / (2 * Math.PI);
    const mean = Math.sqrt((ring.rx * ring.rx + ring.ry * ring.ry) / 2);
    if (mean < needMean) {
      const maxRx = Math.min(54, ring.cx + 4, 104 - ring.cx);
      const maxRy = Math.min(54, ring.cy + 4, 104 - ring.cy);
      ring.rx = Math.min(maxRx, Math.max(ring.rx, Math.sqrt(Math.max(0, 2 * needMean * needMean - ring.ry * ring.ry))));
      const mean2 = Math.sqrt((ring.rx * ring.rx + ring.ry * ring.ry) / 2);
      if (mean2 < needMean) ring.ry = Math.min(maxRy, Math.max(ring.ry, Math.sqrt(Math.max(0, 2 * needMean * needMean - ring.rx * ring.rx))));
    }
    return ring;
  });

  readonly pins = computed<StagePin[]>(() => {
    const s = this.silhouette();
    const byPort = new Map<string, SilhouetteAnchor>(s ? s.anchors.map((a) => [a.portId, a]) : []);
    const source = this.pinSource();
    const ring = this.pinRing();
    // Estimated positions are spread evenly ALONG the ring (not by angle), in
    // list order from the nose clockwise — see `ringPositions`.
    const spots = ring ? ringPositions(ring, source.filter(({ raw }) => !byPort.has(raw)).length) : [];
    let nextIndex = 0;
    let spot = 0;
    // A narrow ring (a slim hull — the X1, a Cutter) leaves the flank labels
    // no room to point inward: both sides met over the hull and collided.
    // There they point OUTWARD, into the free table; on a wide ring the
    // outside is the frame edge, so they point inward as before.
    const narrow = !!ring && ring.rx < 30;
    const sideFor = (x: number, y: number, estimated: boolean): StagePin['side'] => {
      // Near the top/bottom of the ring the neighbours sit side by side, so
      // the label goes above/below the dot.
      if (y <= 18) return 'below';
      if (y >= 82) return 'above';
      if (estimated && narrow) return x < 50 ? 'left' : 'right';
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
          label: slot?.name ? displayItemName(slot.name) : (slot?.port ?? humanizeClassName(raw)),
          short: stat ? formatEquippedStat(stat) : slot?.statChip ?? null,
          tone: (known?.section === 'missiles' ? 'gold' : 'accent') as 'accent' | 'gold',
          slot,
          section: known?.section ?? null,
        };
        if (anchor) return { ...base, x: anchor.x, y: anchor.y, side: sideFor(anchor.x, anchor.y, false), resolved: true };
        const p = spots[spot++] ?? { x: 50, y: 50 };
        return { ...base, x: p.x, y: p.y, side: sideFor(p.x, p.y, true), resolved: false };
      })
      .sort((a, b) => a.index - b.index);
  });

  /** The inspector's list: the pins grouped by loadout block, in pin order. */
  readonly pinGroups = computed<PinGroup[]>(() => {
    const groups = new Map<string, StagePin[]>();
    for (const p of this.pins()) {
      const key = p.section ?? 'other';
      const hit = groups.get(key);
      if (hit) hit.push(p);
      else groups.set(key, [p]);
    }
    return [...groups.entries()].map(([key, pins]) => ({
      key,
      labelKey: key === 'other' ? 'codex.holo.stage.pinGroupOther' : `codex.moduleSection.${key}`,
      pins,
    }));
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

  /** The patch Δ badge of the pin under inspection, if the comparison has one. */
  readonly inspectedPatchPin = computed<PortPinBadge | null>(() => {
    const port = this.inspectedPort();
    return port ? (this.patchPortPins()?.[port] ?? null) : null;
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

  // ── Count-up (concept cine-countup): with the reveal the headline numbers
  // run from the previously viewed ship's stock value (read off the SAME
  // cohort sheets the ranking uses — nothing invented) to this ship's value,
  // ~700 ms, so a ship switch shows WHICH numbers moved. Without a previous
  // ship there is nothing to compare — the numbers simply stand (a run up
  // from zero says nothing). Reduced motion = cut. ──
  private readonly countUpProgress = signal(1);
  private countUpFrom: Partial<Record<KpiStripCell['key'], number>> = {};
  private countUpRaf: number | null = null;

  private startCountUp(): void {
    if (this.reducedMotion() || typeof requestAnimationFrame !== 'function') return;
    const prev = this.recentlyViewedShips().find((cn) => cn !== this.detail().classNameSlug);
    const cohort = this.rankCohort();
    const sheet = prev && cohort ? cohort.find((c) => c.className === prev)?.sheet : undefined;
    if (!sheet) return;
    this.countUpFrom = {};
    for (const c of this.allKpiCells()) {
      const from = (sheet as Record<string, number | null | undefined>)[c.key];
      // A key the previous ship has no value for stands still instead of
      // running up from an invented zero.
      this.countUpFrom[c.key] = from ?? c.value ?? 0;
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
        displayName: c.name?.trim() || humanizeClassName(c.className),
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

  /** The signature tile's sub-values when the KPI sheet has none: IR and EM
   * as the strip's power sheet computes them (the dock's raw numbers). */
  private readonly signatureFactSubs = computed(() => {
    const facts = this.powerSheet()?.facts ?? [];
    return (['ir', 'em'] as const)
      .map((k) => facts.find((f) => f.key === k))
      .filter((f): f is NonNullable<typeof f> => !!f && f.value != null)
      .map((f) => ({ key: f.key, shortKey: `codex.energy.fact.${f.key}`, text: formatNumber(Math.round(f.value!)), ghost: null }));
  });

  /** The tiles as the child renders them — every string resolved here, so
   * the count-up, the ghosts and the formatter stay in one place. */
  readonly perspectiveViews = computed<HoloPerspectiveView[]>(() =>
    this.perspectiveTiles().map((t) => {
      const subs = t.subs.map((c) => ({ key: c.key as string, shortKey: `codex.kpi.short.${c.key}`, text: this.fmtCell(c), ghost: this.ghostFor(c.key) }));
      return {
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
        subs: t.id === 'signature' && subs.length === 0 ? this.signatureFactSubs() : subs,
      };
    }),
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
}
