import { BetaService } from '../../core/beta.service';
import { logWarn } from '../../core/log';
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
import { NgTemplateOutlet } from '@angular/common';
import { ShipSkinsService } from '../ship-skins.service';
import { RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import { CodexDetail } from '../codex.service';
import { CodexItemPort } from '../codex.types';
import type { StageCountChip } from '../detail/codex-detail.types';
import { HoloSilhouette, SilhouetteAnchor } from '../holo-silhouette';
import { MISSIONS, MissionId, missionDisabledReasonKey } from '../codex-mission';
import type { ShipCapabilities } from '../codex-mission';
import { KpiStripCell } from '../codex-kpi-sets';
import { formatEquippedStat, formatEquippedStatNumber } from '../codex-equipped-stats';
import { CodexRankCardComponent } from '../codex-rank-card.component';
import {
  RankClassId,
  RankProfileId,
  RankResult,
  RankScope,
  RankShipInput,
  rankClassLabelKey,
  rankClassPluralKey,
  rankMissionNoteKey,
  rankProfileForMission,
} from '../codex-rank';
import {
  CodexHardpointLayoutComponent,
  LayoutSection,
  LayoutSlot,
  LayoutTarget,
} from '../codex-hardpoint-layout.component';
import { SHIP_MODULE_SECTION_ORDER, ShipModuleSection, isConfigurableSection } from '../ship-module-sections';
import { ShipFactGroup } from '../codex-analysis-panels.component';
import { KpiSheet, OffensivePanel, DefensivePanel } from '../codex-loadout-stats';
import { BuildRef, PERSPECTIVE_KPIS, PERSPECTIVES, Perspective, PortOccupantMap } from '../codex-build-compare';
import { displayItemName, formatNumber, humanizeClassName } from '../codex-format';
import { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { CodexHoloStripComponent } from './codex-holo-strip.component';
import { CodexHoloEinsatzComponent } from './codex-holo-einsatz.component';
import { HangarPickerComponent, HangarPickerItem } from '../stage/hangar-picker.component';
import {
  CodexHoloPatchComponent,
  HoloPatchComparisonSide,
  HoloPatchKpiGhosts,
  PortPinBadge,
} from './codex-holo-patch.component';
import { CodexHoloSharedBannerComponent, HoloSharedBanner } from './codex-holo-shared-banner.component';
import { CodexHoloRankStateComponent } from './codex-holo-rank-state.component';
export type { HoloSharedBanner } from './codex-holo-shared-banner.component';
import { CodexHoloPerspectivesComponent, HoloGhost, HoloPerspectiveView } from './codex-holo-perspectives.component';
import { CodexHoloTableComponent, type HoloDeckView } from './codex-holo-table.component';
import { buildDeckPlans } from '../deck-plan';
import type { Lang, ShipDeck } from '../codex.types';
import { CodexHoloInspectorComponent, partFocusOf } from './codex-holo-inspector.component';
import { CodexHoloChangesComponent } from './codex-holo-changes.component';
import { missionColor, missionRelevantSections } from './codex-holo-mission';
import type { CalloutValue, PlacementRow, PlacementSelection } from '../asset-package/asset-package-viewer.component';
import type { HotspotScope } from '../asset-package/asset-package.model';
import { CodexLoadoutSaveBarComponent } from '../codex-loadout-save-bar.component';
import { HoloPhase, JournalEntry, PinGroup, PinRing, StagePin, ringPositions, shipNameWithoutMaker, spreadStackedPins } from './codex-holo-model';
import type { CodexKind } from '../codex.service';
import { anchorKey } from './codex-holo-leader';
import type { CodexBuild } from '../codex.types';
import type { PowerSheet } from '../codex-power';
import type { SummaryOccupant } from '../ship-summary-panels';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HoloHotkeyAction, HoloSurface, holoHotkeyFor, holoHotkeyLabel, nextHoloSurface } from './codex-holo-hotkeys';
import { ShipBlueprintService } from '../ship-blueprint/ship-blueprint.service';
import { type BlueprintViewName, blueprintView } from '../ship-blueprint/ship-blueprint.model';
import { AssetPackageService } from '../asset-package/asset-package.service';
import { FeedbackSpotDirective } from '../../feedback/feedback-spot.directive';

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

/** One choice of the strip's Einsatz picker: every mission with its lead KPI. */
interface MissionSegment {
  id: MissionId;
  labelKey: string;
  sub: string;
  disabledKey: string | null;
}

/** The panel's three tabs (concept glas3). */
export type HoloPanelTab = 'parts' | 'rank' | 'changes';

/** What the bottom row shows (concept holotisch-feinschliff C6): the Akte, or one of the table's surfaces. */
export type HoloView = 'akte' | HoloSurface;
/** The parts filters of the bottom row (multi-select; "Alle Teile" is the hotspot scope on top). */
export type HoloPartFilter = 'weapons' | 'missiles' | 'components' | 'other';

const PART_FILTER_OF: Readonly<Record<ShipModuleSection, HoloPartFilter>> = {
  weapons: 'weapons',
  remoteTurrets: 'weapons',
  pod: 'weapons',
  missiles: 'missiles',
  shields: 'components',
  powerPlants: 'components',
  quantum: 'components',
  radar: 'components',
  coolers: 'components',
  lifeSupport: 'components',
  countermeasures: 'other',
  structure: 'other',
};
const ALL_PART_FILTERS: readonly HoloPartFilter[] = ['weapons', 'missiles', 'components', 'other'];
const PART_FILTER_CHIPS: readonly { id: HoloPartFilter; labelKey: string }[] = [
  { id: 'weapons', labelKey: 'codex.holo.stage.filterWeapons' },
  { id: 'missiles', labelKey: 'codex.holo.stage.filterMissiles' },
  { id: 'components', labelKey: 'codex.holo.stage.filterComponents' },
  { id: 'other', labelKey: 'codex.holo.stage.filterOther' },
];

/** One thumbnail of the bottom row: id = the view, or `deck:<key>` for a deck (Innen). */
interface ViewThumb {
  id: string;
  labelKey: string | null;
  label: string;
  disabledKey: string | null;
  icon: { box: string; paths: readonly string[] };
  view: HoloView;
  deck: string | null;
}
const HULL_TOP = 'M400 26 L432 130 L560 250 L560 292 L448 262 L438 340 L470 372 L470 390 L400 376 L330 390 L330 372 L362 340 L352 262 L240 292 L240 250 L368 130 Z';
const VIEW_ICONS: Readonly<Record<HoloView | 'deck', { box: string; paths: readonly string[] }>> = {
  akte: { box: '0 0 60 36', paths: ['M26 9 L46 20 L42 25 L28 21 L16 25 L14 20 Z'] },
  '3d': { box: '0 0 60 36', paths: ['M30 5 L47 21 L43 27 L30 22 L17 27 L13 21 Z', 'M30 9 L33 20 L27 20 Z'] },
  simple: { box: '0 0 800 420', paths: [HULL_TOP, 'M400 102 a18 18 0 1 0 0.1 0 Z', 'M300 222 a18 18 0 1 0 0.1 0 Z', 'M500 222 a18 18 0 1 0 0.1 0 Z'] },
  top: { box: '0 0 800 420', paths: [HULL_TOP] },
  side: { box: '0 0 60 36', paths: ['M6 20 L22 15 L44 14 L54 19 L44 23 L12 23 Z'] },
  front: { box: '0 0 60 36', paths: ['M30 11 L40 17 L53 19 L40 22 L30 26 L20 22 L7 19 L20 17 Z'] },
  deck: { box: '0 0 60 36', paths: ['M24 6 L36 6 L37 22 L32 31 L28 31 L23 22 Z'] },
};
/** Which column of "Bauteile im Detail" a section stands in: the strip area it moves. */
const PART_AREAS: readonly { id: Perspective; sections: readonly ShipModuleSection[] }[] = [
  { id: 'offensive', sections: ['weapons', 'remoteTurrets', 'missiles', 'pod'] },
  { id: 'defensive', sections: ['shields', 'countermeasures', 'structure'] },
  { id: 'movement', sections: ['quantum', 'powerPlants'] },
  { id: 'signature', sections: ['coolers', 'radar', 'lifeSupport'] },
];

/** Einordnung first and open by default; focusing a part switches to Bauteile (concept r1, note 4). */
const PANEL_TABS: readonly { id: HoloPanelTab; labelKey: string; icon: string }[] = [
  { id: 'rank', labelKey: 'codex.holo.stage.einordnung', icon: 'M12 3l8 4.5v9L12 21l-8-4.5v-9z' },
  { id: 'parts', labelKey: 'codex.holo.stage.tab.parts', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { id: 'changes', labelKey: 'codex.holo.stage.tab.changes', icon: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5M12 8v4l3 2' },
];

type StaticKey = 'crew' | 'mass' | 'cargo';

const SOUND_PREF_KEY = 'sc.codex.holo.sound';
/** The Schema sub-view the reader picked. No entry = the default: 3D where the hull has it. */
const SURFACE_PREF_KEY = 'sc.codex.holo.surface';

/** The holodeck's UI tones (cx-sound). */
export type HoloTone = 'blip' | 'switch' | 'arrive';
interface ToneNote { at: number; dur: number; from: number; to: number; gain: number; wave: OscillatorType }
/** Every gain stays at or below 0.05 — UI sounds sit under speech and music. */
export const HOLO_TONES: Readonly<Record<HoloTone, readonly ToneNote[]>> = {
  blip: [{ at: 0, dur: 0.12, from: 880, to: 880, gain: 0.05, wave: 'sine' }],
  switch: [{ at: 0, dur: 0.09, from: 520, to: 660, gain: 0.035, wave: 'triangle' }],
  arrive: [
    { at: 0, dur: 0.9, from: 220, to: 440, gain: 0.025, wave: 'sine' },
    { at: 0.35, dur: 0.6, from: 660, to: 990, gain: 0.02, wave: 'sine' },
  ],
};
const MOBILE_TABS_PREF_KEY = 'sc.codex.holo.mobileTabs';
const UNDO_TOAST_MS = 6000;
/** Arrival timing (concept hv3-s1: "keine 5 Sekunden"): how long the hero art
 * may take to arrive before the table goes on without it, how long it holds,
 * and the reveal itself — every entrance animation of the reveal ends inside it. */
const HERO_WAIT_MS = 450;
const HERO_HOLD_MS = 520;
const REVEAL_MS = 1300;
/** After the session's first ship the arrival is a short settle, the values are there at once (d-arrival short). */
const SHORT_ARRIVAL_MS = 400;
let fullArrivalPlayed = false;
/** Specs start every arrival as the session's first. */
export function resetHoloArrivalSession(): void {
  fullArrivalPlayed = false;
}
/** Above this many pins the labels leave the canvas for the numbered key —
 * on a ring of ~250 px radius, 8 labels of 120–220 px is the most that
 * stays legible without collisions (wave 5 A2.4). */
const DENSE_PIN_COUNT = 8;

/** What a pin says: for a gun mount the gun it holds, the part a pilot asks about; else the occupant. */
function pinLabel(slot: LayoutSlot | null, section: ShipModuleSection | null, raw: string): string {
  const held = section === 'weapons' ? slot?.children?.find((c) => !!c.name) : undefined;
  if (held?.name) return (held.count > 1 ? held.count + '× ' : '') + displayItemName(held.name);
  return slot?.name ? displayItemName(slot.name) : (slot?.port ?? humanizeClassName(raw));
}

/** The headline key per perspective, in preference order (first with a value wins). */
const PERSPECTIVE_LEAD: Readonly<Record<Perspective, readonly KpiStripCell['key'][]>> = {
  offensive: ['sustainedDps', 'burstDps', 'alpha', 'missiles'],
  defensive: ['shieldHp', 'hullHp', 'effectiveHp', 'shieldRegen', 'armorHp'],
  movement: ['boost', 'scm', 'maxSpeed', 'agility', 'quantumRange', 'mass', 'cargo'],
  signature: ['ir', 'emLoad', 'crossSection', 'emIdle'],
};

/**
 * The Holotable stage (concept 2026-09-20, rounds 1–10). Purely
 * presentational: every value comes in as an input from
 * `codex-detail.component.ts`, which keeps owning the modals, swap picker,
 * weapon detail, compare tray, draft persistence and hover-sync
 * `activePorts` for BOTH views.
 *
 * Layout (concept 2026-11-06, glas3): one title row, the model on the page
 * background (`sc-codex-holo-table`, no frame) beside ONE glass panel with the
 * tabs Bauteile (`sc-codex-holo-inspector`), Einordnung and Änderungen; the strip
 * closes the first screen and stays on the viewport's bottom edge; below it the
 * calm ports list, four perspective tiles and the details drawer. The stage
 * computes every pin and owns the arrival phase; the children only render.
 */
@Component({
  selector: 'sc-codex-holo-stage',
  standalone: true,
  imports: [FeedbackSpotDirective,
    NgTemplateOutlet,
    TranslatePipe,
    RouterLink,
    CodexRankCardComponent,
    CodexHardpointLayoutComponent,
    CodexHoloPerspectivesComponent,
    CodexHoloStripComponent,
    CodexHoloEinsatzComponent,
    HangarPickerComponent,
    CodexHoloPatchComponent,
    CodexHoloSharedBannerComponent,
    CodexHoloRankStateComponent,
    CodexHoloTableComponent,
    CodexHoloInspectorComponent,
    CodexHoloChangesComponent,
    CodexLoadoutSaveBarComponent,
    ScTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="holo-stage" [class.reduced-motion]="reducedMotion()" [class.arrived]="arrived()" [class.first]="!hadBody()"
             [class.ph-wait]="phase() === 'wait'" [class.ph-hero]="phase() === 'hero'" [class.ph-reveal]="phase() === 'reveal'"
             [attr.data-mission]="activeMissionId()" [style.--holo-e]="missionHue()">

      <!-- ── Head (concept holotisch-feinschliff r4 d1): name + models left,
           Einsatz top centre, the hangar button right. No patch picker here —
           the patch choice lives in the card's Änderungen tab (C18). ── -->
      <div class="holo-topbar" [scFeedbackSpot]="'feedbackSpot.headline'">
        <div class="ht-left">
          <!-- Keyed on the name: a hull switch re-enters the title with it. -->
          @for (name of [shortName()]; track name) {
            <div class="ht-title">
              @if (manufacturerName(); as maker) { <span class="ht-kicker">{{ maker }}</span> }
              <h1 class="ht-name" tabindex="0" [scTooltip]="eyebrowTitle()" scTooltipTier="label">{{ name }}</h1>
            </div>
          }
          <!-- slot [htModels]: the model variants as real anchors, only when they exist (C3). -->
          <div class="ht-models"><ng-content select="[htModels]" /></div>
        </div>
        <div class="ht-centre">
          <sc-codex-holo-einsatz
            [active]="activeMissionId()"
            [missions]="missionSegments()"
            [defaultLabelKey]="rankClassLabel()"
            [cohortLabel]="cohortLabel()"
            (missionChange)="missionChange.emit($event)" />
        </div>
        <!-- slot [htOwn]: the one hangar button (count + shown loadout ▾, C5). -->
        <div class="ht-right">
          <div class="sc-head-strip" role="group" [attr.aria-label]="'codex.head.stripAria' | translate"><ng-content select="[htOwn]" /></div>
        </div>
      </div>

      <!-- A shared link's loadout on the table, read-only until adopted (#646). -->
      @if (sharedBanner(); as sb) {
        <sc-codex-holo-shared-banner [banner]="sb" [adopting]="adoptingShared()"
          (adopt)="adoptShared.emit()" (exit)="exitShared.emit()" (retry)="retryShared.emit()" />
      }

      <!-- Mobile "Tisch | Daten" tab control (user decision 5, default = stacked) -->
      @if (mobileTabsEnabled()) {
        <div class="mobile-tabs" role="tablist">
          <button type="button" role="tab" [attr.aria-selected]="mobileTab() === 'table'" (click)="mobileTab.set('table')">{{ 'codex.holo.stage.tabTable' | translate }}</button>
          <button type="button" role="tab" [attr.aria-selected]="mobileTab() === 'data'" (click)="mobileTab.set('data')">{{ 'codex.holo.stage.tabData' | translate }}</button>
        </div>
      }

      <div class="holo-body" [class.mobile-hide-table]="mobileTabsEnabled() && mobileTab() !== 'table'" [class.mobile-hide-data]="mobileTabsEnabled() && mobileTab() !== 'data'">
        <!-- ── The model: no frame, it lies on the page with its glow ── -->
        <section class="holo-table mobile-table" [scFeedbackSpot]="'codex.holo.stage.tabTable'">
          <!-- Table head: one flow row above the surface, nothing overlaps the dots. -->
          <div class="table-head">
            <!-- slot: hangar-tab (round 16-17, N4): the same HangarPicker as
                 the Codex landing and the classic hero. -->
            @if (!shellBeta()) {
              <div class="hangar-dock">
                <sc-hangar-picker
                  kind="ship"
                  [docked]="true"
                  [items]="hangarPickerItems()"
                  (pick)="hangarPick.emit($event)"
                  (open)="hangarOpen.emit()" />
              </div>
            }
            @if (!silhouette() && viewMode() === 'holo') {
              <p class="no-geometry-badge" tabindex="0" [scTooltip]="'codex.holo.stage.noGeometryReason' | translate" scTooltipTier="label">{{ 'codex.holo.noGeometry' | translate }}</p>
            }
          </div>
          <!-- slot [holoAkte]: the Akte view (description card on the RSI image, C20), over the table while "Akte" is the view. -->
          <div class="holo-akte" [class.on]="activeView() === 'akte'" [attr.aria-hidden]="activeView() !== 'akte'" [attr.inert]="activeView() !== 'akte' ? '' : null">
            <ng-content select="[holoAkte]" />
          </div>
          <sc-codex-holo-table
            [class.under-akte]="activeView() === 'akte'"
            [attr.inert]="activeView() === 'akte' ? '' : null"
            [pins]="tablePins()"
            [labelPins]="labelPins()"
            [schemaView]="schemaView()"
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
            [activePorts]="tableActivePorts()"
            [inspectedPort]="inspectedPort()"
            [selectedPart]="viewerSelectedPort()"
            [swappablePorts]="swappablePorts()"
            [relevantPorts]="relevantPorts()"
            [calloutValues]="calloutValues()"
            [calloutTitle]="calloutTitle()"
            [(hotspotScope)]="hotspotScope"
            [patchPortPins]="patchPortPins()"
            [deckPlan]="tableDeck()"
            [displayName]="displayName()"
            [dense]="dense()"
            [hasUnresolved]="hasUnresolvedPins()"
            [phase]="phase()"
            [still]="reducedMotion()"
            (hovered)="hovered.emit($event)"
            (pinInspect)="inspectPin($event)"
            (partSelected)="onPartSelected($event)"
            (partSwap)="onPartSwap($event)"
            (previewError)="previewFailed.set(true)"
            (locatable)="onModelLocatable($event)" />
        </section>

        <!-- ── One sheet of glass: Bauteile | Einordnung | Änderungen ── -->
        <aside class="holo-panel mobile-data" [scFeedbackSpot]="'codex.holo.stage.inspector'">
          <!-- The ownership card (concept codex-kopf-besitz C5): Haben? / Dein Exemplar, above the tabs. -->
          <ng-content select="[htCard]" />
          <div class="ptabs" role="tablist" [attr.aria-label]="'codex.holo.stage.inspector' | translate" [style.--i]="panelTabIndex()" (keydown)="onTabKey($event)">
            <span class="pill" aria-hidden="true"></span>
            @for (t of panelTabs; track t.id) {
              <button type="button" role="tab" class="ptab" [id]="'holo-tab-' + t.id" [class.on]="panelTab() === t.id"
                      [attr.aria-selected]="panelTab() === t.id" [attr.aria-controls]="'holo-tabpanel'"
                      [attr.tabindex]="panelTab() === t.id ? 0 : -1" (click)="panelTab.set(t.id)">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="t.icon" /></svg>
                {{ t.labelKey | translate }}
                @if (t.id === 'changes' && journal().length > 0) { <span class="tcount">{{ journal().length }}</span> }
              </button>
            }
          </div>
          <div class="pbody" id="holo-tabpanel" role="tabpanel" tabindex="-1" [attr.aria-labelledby]="'holo-tab-' + panelTab()">
            <!-- slot: the patch choice (C18) — moved out of the head into the Änderungen tab.
                 Stays alive across tab switches (its comparison feeds the strip's ghosts and the pins). -->
            @if (buildRef(); as ab) {
              <div class="patch-slot" [hidden]="panelTab() !== 'changes'">
                <sc-codex-holo-patch
                  [hotkey]="hkLabel.patch"
                  [dockDelta]="true"
                  [className]="detail().classNameSlug"
                  [channel]="channel()"
                  [activeBuild]="ab"
                  [activeKpiSheet]="activeKpiSheet()"
                  [activeOccupants]="activeOccupants()"
                  [resolveComparisonSide]="resolveComparisonSide()"
                  (kpiGhosts)="patchGhosts.set($event)"
                  (portPins)="patchPortPins.set($event)"
                  (comparisonBuild)="onPatchCompared($event)" />
              </div>
            }
            @if (bodyReady()) {
              @switch (panelTab()) {
                @case ('parts') {
                  <sc-codex-holo-inspector
                    [target]="inspectorTarget()"
                    [isRawPort]="inspectorIsRawPort()"
                    [patchPin]="inspectedPatchPin()"
                    [inspectedPort]="inspectedPort()"
                    [section]="inspectedSection()"
                    [shipName]="displayName()"
                    [index]="inspectedIndex()"
                    [total]="pins().length"
                    [pinGroups]="pinGroups()"
                    [activePorts]="activePorts()"
                    [readOnly]="readOnly()"
                    [relevantPorts]="relevantPorts()"
                    [modelPorts]="modelPortSet()"
                    [allParts]="hotspotScope() === 'all'"
                    [packageRows]="packageRows()"
                    (closed)="closeInspector()"
                    (pinInspect)="inspectPin($event)"
                    (hovered)="hovered.emit($event)"
                    (swapRequested)="swapRequested.emit($event)"
                    (inspected)="inspected.emit($event)"
                    (reverted)="reverted.emit($event)"
                    (rowPick)="onRowPick($event)"
                    (rowFocus)="onRowFocus($event)"
                    (rowEye)="assetViewer()?.togglePlacement($event)" />
                }
                @case ('rank') {
                  <div class="rankbody" [scFeedbackSpot]="'codex.holo.stage.einordnung'">
                    <div class="rh">
                      @if (rankResult()?.overall != null) {
                        <strong>{{ rankResult()!.bandKey! | translate }}</strong>
                        <span>{{ rankResult()!.overall }} %</span>
                      } @else {
                        <strong>{{ roleName() ?? (rankClassLabel() | translate) }}</strong>
                      }
                    </div>
                    <div class="statics">
                      @for (k of staticKeys; track k) {
                        <div tabindex="0" [scTooltip]="staticChipTitle(k)" scTooltipTier="label">
                          <span class="k">{{ staticLabelKey(k) | translate }}</span>
                          <span class="v">{{ staticChip(k) }}</span>
                        </div>
                      }
                    </div>
                    <!-- No ranking yet: what the panel is doing / why it is empty. -->
                    @if (!rankResult()) {
                      <sc-codex-holo-rank-state [loading]="rankLoading()" [failed]="rankFailed()" (retry)="retryRank.emit()" />
                    } @else {
                      <sc-codex-rank-card
                        [holo]="true"
                        [shipName]="displayName()"
                        [sizeClass]="null"
                        [result]="rankResult()"
                        [loading]="rankLoading()"
                        [profile]="rankProfile()"
                        [scope]="rankScope()"
                        [disabledReasons]="rankDisabledReasons()"
                        [shipClass]="rankShipClass()"
                        [roleName]="roleName()"
                        [missionNoteKey]="missionNoteKey()"
                        (profileChange)="rankProfileChange.emit($event)"
                        (scopeChange)="rankScopeChange.emit($event)" />
                    }
                    <a class="cohort-link" routerLink="/codex/index" [queryParams]="{ kind: 'ship' }">
                      {{ 'codex.holo.stage.cohortLink' | translate }} ›
                    </a>
                  </div>
                }
                @case ('changes') {
                  <sc-codex-holo-changes [journal]="journal()" [readOnly]="readOnly()" (reverted)="reverted.emit($event)">
                    <div class="patchdiff">
                      @if (patchDeltaBody(); as tpl) {
                        <ng-container [ngTemplateOutlet]="tpl" />
                      } @else {
                        <div class="sub"><span>{{ 'codex.holo.stage.patchDiff' | translate }}</span><i></i></div>
                        <p class="patchhint">{{ 'codex.holo.stage.patchDiffHint' | translate }}</p>
                      }
                    </div>
                  </sc-codex-holo-changes>
                }
              }
            }
          </div>
          <button type="button" class="pdetails" (click)="openDetailsDrawer()" [attr.aria-expanded]="detailsOpen()">
            {{ (detailsOpen() ? 'codex.holo.stage.detailsHide' : 'codex.holo.stage.detailsShow') | translate }}
          </button>
        </aside>

        <!-- ── The one bottom row (r4 d1, C6): Akte › views (Außen | Innen),
             a single choice; then the parts filters, multi-select chips. ── -->
        <div class="holo-views mobile-table" [scFeedbackSpot]="'codex.holo.stage.viewsAria'">
          <div class="vw" role="radiogroup" tabindex="-1" [attr.aria-label]="'codex.holo.stage.viewsAria' | translate"
               [attr.aria-keyshortcuts]="hkLabel.view" (keydown)="onViewKey($event)">
            @for (g of viewGroups(); track g.id; let first = $first) {
              @if (!first) { <span class="vw-div" aria-hidden="true"></span> }
              <div class="vw-grp" role="group" [attr.aria-label]="g.labelKey ? (g.labelKey | translate) : null">
                <span class="vw-gl" aria-hidden="true">{{ g.labelKey ? (g.labelKey | translate) : '' }}</span>
                <div class="vw-row">
                  @for (v of g.items; track v.id) {
                    <button type="button" class="vw-thumb" role="radio" [attr.data-view]="v.id"
                            [class.on]="v.id === activeViewId()" [attr.aria-checked]="v.id === activeViewId()"
                            [attr.tabindex]="v.id === activeViewId() ? 0 : -1"
                            [attr.aria-disabled]="v.disabledKey ? true : null" [class.dis]="!!v.disabledKey"
                            [scTooltip]="v.disabledKey ? (v.disabledKey | translate) : null" scTooltipTier="label"
                            (click)="pickView(v)">
                      <i class="vw-ic" [class.akte]="v.id === 'akte'" aria-hidden="true">
                        <svg [attr.viewBox]="v.icon.box" preserveAspectRatio="xMidYMid meet">
                          @for (d of v.icon.paths; track $index) { <path [attr.d]="d" /> }
                        </svg>
                      </i>
                      <span class="vw-l">{{ v.labelKey ? (v.labelKey | translate) : v.label }}</span>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
          <span class="vw-sep" aria-hidden="true"></span>
          <div class="vf" role="group" [attr.aria-label]="'codex.holo.stage.filtersAria' | translate">
            <span class="vw-gl">{{ 'codex.holo.stage.filterParts' | translate }}</span>
            <div class="vf-row">
              @for (f of partFilterChips; track f.id) {
                <button type="button" class="vf-chip" [class.on]="partFilter().has(f.id)" [attr.aria-pressed]="partFilter().has(f.id)"
                        [attr.aria-disabled]="activeView() === 'akte' ? true : null" (click)="togglePartFilter(f.id)">
                  <span class="ck" aria-hidden="true"></span>{{ f.labelKey | translate }}
                </button>
              }
              <button type="button" class="vf-chip all" [class.on]="hotspotScope() === 'all'" [attr.aria-pressed]="hotspotScope() === 'all'"
                      [attr.aria-disabled]="activeView() === 'akte' ? true : null" (click)="toggleAllParts()">
                <span class="ck" aria-hidden="true"></span>{{ 'codex.holo.stage.filterAll' | translate }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- ── Below (concept holotisch-unten r1, d2): on the strip's own
           columns — a side column as wide as the Einsatz (Beschreibung, Wo zu
           kaufen, Varianten; projected [htSide]) and the parts in four columns
           over the strip's four areas, then the details. ─────────────── -->
      <div class="holo-below mobile-data">
        <aside class="below-side"><ng-content select="[htSide]" /></aside>
        <div class="below-head sh" [scFeedbackSpot]="'codex.detail.columnLoadout'">
          <span class="t">{{ 'codex.holo.below.parts' | translate }}</span>
          <span class="n">{{ 'codex.holo.below.partsCount' | translate: { n: pins().length } }}</span>
          <span class="rule"></span>
        </div>
        @for (a of partAreas(); track a.id) {
          <section class="below-area" [attr.data-p]="a.id" [attr.aria-label]="a.labelKey | translate">
            <h3 class="area-h">{{ a.labelKey | translate }}</h3>
            @if (a.sections.length > 0) {
              <sc-codex-hardpoint-layout
                [calm]="true"
                [nestGroups]="false"
                [sections]="a.sections"
                [foldedSections]="foldedModuleSections()"
                [occupantsBySection]="occupantsBySection()"
                [locatablePorts]="locatablePorts()"
                [activePorts]="activePorts()"
                (reverted)="reverted.emit($event)"
                (hovered)="hovered.emit($event)"
                (inspected)="inspected.emit($event)"
                (swapRequested)="swapRequested.emit($event)" />
            } @else {
              <p class="area-empty">{{ 'codex.holo.below.areaEmpty' | translate }}</p>
            }
          </section>
        }

        <!-- ── Details drawer (everything with no other home) ──────────── -->
        <section class="holo-details" [scFeedbackSpot]="'feedbackSpot.details'">
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
            <div class="details-body" animate.leave="fold-leave">
              <ng-content></ng-content>
            </div>
          }
        </section>
      </div>

      <!-- Toasts above the strip: the undo (concept fb-journal: "Undo gern
           einfach als toast") and the L key's "Link kopiert" (#644). -->
      <div class="toasts">
        <!-- Unsaved changes: above the strip, whatever the panel or the scroll position do. -->
        @if (draftChangedCount() > 0 && !readOnly()) {
          <sc-codex-loadout-save-bar
            class="draft-float"
            animate.enter="toast-enter" animate.leave="toast-leave"
            [changed]="draftChangedCount()"
            [saveable]="saveableCount()"
            [saving]="saving()"
            [error]="saveError()"
            [inHangar]="inHangar()"
            (save)="saveDraft.emit()"
            (discard)="discardDraft.emit()"
            (addAndSave)="saveDraft.emit()" />
        }
        @if (undoToast()) {
          <div class="undo-toast" role="status" animate.enter="toast-enter" animate.leave="toast-leave">
            <span>{{ 'codex.holo.stage.journalChanged' | translate: { label: undoToastLabel() } }}</span>
            <button type="button" class="btn quiet" (click)="undoToastAction()">{{ 'codex.holo.stage.undo' | translate }}</button>
          </div>
        }
        @if (copyToast(); as ct) {
          <div class="undo-toast copy-toast" [class.failed]="ct === 'failed'" [attr.role]="ct === 'failed' ? 'alert' : 'status'"
               animate.enter="toast-enter" animate.leave="toast-leave">
            <span>{{ ct === 'ok' ? '✓ ' + ('codex.detail.linkCopied' | translate) : ('codex.holo.share.copyFailed' | translate) }}</span>
          </div>
        }
      </div>

      <!-- A failed save must never depend on the arrival or the panel:
           when the floating save bar is not on screen, the stage says it. -->
      @if (saveErrorElsewhere(); as err) {
        <p class="save-err" role="alert">{{ err }}</p>
      }

      <!-- Perspektiven at the very end (concept r1-dock-open "both"): at the
           page's end they stand on their own, docked onto the sticky strip;
           the strip's arrow opens the same four areas anywhere as its dock. -->
      <sc-codex-holo-perspectives
        class="below-persp mobile-data"
        layout="row"
        [docked]="true"
        [scFeedbackSpot]="'codex.holo.stage.perspectives'"
        [tiles]="perspectiveViews()"
        [missionLabelKey]="missionLabelKey()"
        [cohortSize]="rankResult()?.cohortSize ?? null"
        [pulse]="pulseTile()"
        [offensivePanel]="offensivePanel()"
        [defensivePanel]="defensivePanel()"
        [shipFactGroups]="shipFactGroups()" />

      <!-- slot: strip — sticky bottom (mobile: sticky KPI row via its own CSS) -->
      <sc-codex-holo-strip
        [occupants]="occupants()"
        [shipStats]="shipStats()"
        [shipClassName]="shipClassName()"
        [schemaVersion]="schemaVersion()"
        [userId]="userId()"
        [crossSection]="crossSection()"
        [cells]="allKpiCells()"
        [capabilities]="shipCapabilities()"
        (sheetChange)="onSheetChange($event)">
        <sc-codex-holo-perspectives
          hsDock
          class="in-dock"
          layout="row"
          [tiles]="perspectiveViews()"
          [missionLabelKey]="missionLabelKey()"
          [cohortSize]="rankResult()?.cohortSize ?? null"
          [pulse]="pulseTile()"
          [offensivePanel]="offensivePanel()"
          [defensivePanel]="defensivePanel()"
          [shipFactGroups]="shipFactGroups()" />
      </sc-codex-holo-strip>
    </section>
  `,
  styles: [
`
  .save-err { margin: 0; padding: 8px 12px; border: 1px solid var(--sc-danger); border-radius: var(--holo-r, 6px); color: var(--sc-danger); }
  :host { display: block; }
  .holo-stage {
  --f: var(--sc-fs-floor); --d: var(--sc-font-display); --m: var(--font-monospace, "Share Tech Mono", monospace);
  --l1: var(--sc-border); --l2: var(--border-default, color-mix(in srgb, var(--sc-accent) 30%, transparent));
  --hair: color-mix(in srgb, var(--sc-accent) 24%, transparent);
  --glass: color-mix(in srgb, var(--sc-bg-1) 55%, transparent); --ink: color-mix(in srgb, var(--sc-bg-0) 78%, transparent);
  --holo-gold: var(--accent-gold, #c8a84b); --holo-gold-rgb: var(--accent-gold-rgb, 200, 168, 75);
  --a4: color-mix(in srgb, var(--sc-accent) 4%, transparent); --a5: color-mix(in srgb, var(--sc-accent) 5%, transparent); --a7: color-mix(in srgb, var(--sc-accent) 7%, transparent); --a10: color-mix(in srgb, var(--sc-accent) 10%, transparent); --a12: color-mix(in srgb, var(--sc-accent) 12%, transparent); --a14: color-mix(in srgb, var(--sc-accent) 14%, transparent); --a22: color-mix(in srgb, var(--sc-accent) 22%, transparent); --a28: color-mix(in srgb, var(--sc-accent) 28%, transparent); --a40: color-mix(in srgb, var(--sc-accent) 40%, transparent); --a50: color-mix(in srgb, var(--sc-accent) 50%, transparent); --a55: color-mix(in srgb, var(--sc-accent) 55%, transparent); --a80: color-mix(in srgb, var(--sc-accent) 80%, transparent);
  --e-out: var(--holo-e-out); --e-io: var(--holo-e-io);
  --panel-w: clamp(320px, 22.2vw, 360px);
  /* The fixed right card and the Akte card share one height (concept holotisch-feinschliff C14/C20). */
  --holo-card-h: min(100%, 540px);
  /* The strip's columns, shared by everything below the first screen (concept
     r1 d2): a narrow lead column (Einsatz on the strip; Beschreibung + Wo zu
     kaufen above it), the four areas evenly, the strip's arrow. */
  --holo-lead-w: clamp(150px, 15%, 230px); --holo-ctl-w: max(44px, var(--sc-tap-min, 0px));
  --holo-cols: var(--holo-lead-w) repeat(4, minmax(0, 1fr)) var(--holo-ctl-w) var(--holo-fab-clear, 0px);
  display: flex; flex-direction: column; gap: 6px;
  }
  .btn, .mobile-tabs button, .statics .k, .sub, .sh, .details-toggle, .switch { font-family: var(--d); text-transform: uppercase; }
  .rule { flex: 1; height: 1px; background: var(--l1); }
  .btn { min-height: var(--sc-tap-min, 32px); padding: 5px 12px; border-radius: 3px; border: 1px solid var(--l2); background: var(--a10);
  color: var(--sc-fg-0); cursor: pointer; font-size: max(11px, var(--f)); letter-spacing: 0.08em; transition: border-color 160ms ease, color 160ms ease; }
  .btn.quiet { background: none; border-color: var(--l1); color: var(--sc-fg-1); }
  .btn:hover, .btn:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); }
  @keyframes rise { from { opacity: 0; transform: translateY(var(--holo-rise)); } }
  @keyframes fade-in { from { opacity: 0; } }

  /* ── Head (r4 d1): name + models | Einsatz centred | hangar button ── */
  .holo-topbar { position: relative; z-index: 6; display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 6px 14px; min-height: 40px; }
  .ht-left { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ht-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ht-name { margin: 0; font-weight: 500; font-size: clamp(20px, 1.25vw, 24px); line-height: 1.15; letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-0);
  white-space: nowrap; animation: name-in 520ms var(--e-out) backwards; }
  .ht-kicker { min-width: 0; font-size: max(11px, var(--f)); letter-spacing: 0.04em; color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  animation: fade-in 480ms ease-out 120ms backwards; }
  .ht-models { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
  .ht-models:empty { display: none; }
  /* Opens like a projected line: clip-path only, the row never re-lays out while the name arrives. */
  @keyframes name-in { from { opacity: 0; clip-path: inset(0 100% 0 0); } }
  .ht-centre { justify-self: center; min-width: 0; }
  .ht-right { justify-self: end; display: flex; justify-content: flex-end; align-items: center; gap: 10px; min-width: 0; max-width: 100%; flex-wrap: wrap; }
  .mobile-tabs { display: none; gap: 6px; }
  .mobile-tabs button { flex: 1; min-height: var(--sc-tap-min, 32px); padding: 6px 10px; border-radius: 3px; border: 1px solid var(--l2); background: var(--glass); color: var(--sc-fg-1); cursor: pointer;
  font-size: max(10px, var(--f)); letter-spacing: 0.14em; transition: color 160ms ease, border-color 160ms ease; }
  .mobile-tabs button[aria-selected="true"] { color: var(--sc-accent); border-color: var(--sc-accent); }

  /* ── Model | panel. Exactly the height the first screen has left above the
     strip; the stage measures --holo-top, the page frame owns the width. ── */
  /* Row 1: the table | the fixed card (as high as the Akte card, --holo-card-h); row 2: the views row over the full width, docked on the strip. */
  .holo-body { display: grid; grid-template-columns: minmax(0, 1fr) var(--panel-w); grid-template-rows: minmax(0, 1fr) auto; column-gap: 16px; row-gap: 8px; align-items: stretch;
  height: calc(100dvh - var(--holo-top, 170px) - var(--holo-strip-h, 82px) - 8px); min-height: 460px; }
  /* The glow, not a frame: the Einsatz hue under the model, the page shows through. */
  .holo-table { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .holo-table::before { content: ''; position: absolute; inset: -40px -10px; z-index: 0; pointer-events: none;
  background: radial-gradient(ellipse 46% 44% at 50% 52%, color-mix(in srgb, var(--holo-e, var(--sc-accent)) 16%, transparent), transparent 100%);
  transition: background var(--holo-t-base) ease; }
  /* One sheet of glass, one hairline. */
  .holo-panel { position: relative; z-index: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden;
  align-self: start; height: var(--holo-card-h);
  border: 1px solid var(--hair); border-radius: 16px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }

  /* ── Tabs: a glowing pill slides under the word ── */
  .ptabs { position: relative; flex: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 10px 10px 0; min-height: max(38px, var(--sc-tap-min, 0px));
  border: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent); border-radius: 19px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--sc-bg-2) 85%, transparent), color-mix(in srgb, var(--sc-bg-0) 85%, transparent)); }
  .pill { position: absolute; inset-block: 0; inset-inline-start: 0; width: calc(100% / 3); border-radius: 19px; pointer-events: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 46%, transparent), color-mix(in srgb, var(--sc-accent) 20%, transparent));
  box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 45%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--sc-accent) 60%, transparent);
  transform: translateX(calc(var(--i, 0) * 100%)); transition: transform 180ms var(--e-out); }
  .ptab { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 0; padding: 0 4px; background: none; border: 0; border-radius: 19px; cursor: pointer;
  color: var(--sc-fg-2); font: inherit; font-size: max(12px, var(--f)); white-space: nowrap; transition: color 180ms ease; }
  .ptab svg { width: 1.15em; height: 1.15em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .ptab:hover, .ptab.on { color: var(--sc-fg-0); }
  .ptab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  .tcount { font-family: var(--m); font-size: max(10px, var(--f)); color: var(--sc-accent); }
  .ptab.on .tcount { color: var(--sc-fg-0); }
  .pbody { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 12px 16px; animation: rise var(--rise-dur, 300ms) var(--e-out) var(--rise-delay, 60ms) backwards;
  transition: opacity var(--holo-t-fast) var(--e-io); }
  .ph-reveal .pbody { --rise-dur: 560ms; --rise-delay: 260ms; }
  .holo-stage:not(.first):is(.ph-wait, .ph-hero) :is(.holo-below, .pbody) { opacity: 0.35; }
  .pbody:focus-visible { outline: none; }
  .pdetails { flex: none; display: block; width: 100%; min-height: max(30px, var(--sc-tap-min, 0px)); background: none; border: 0; border-block-start: 1px solid var(--hair); color: var(--sc-fg-2); cursor: pointer;
  font: inherit; font-size: max(11px, var(--f)); transition: color 160ms ease; }
  .pdetails:hover { color: var(--sc-accent); }
  .pdetails:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }

  /* ── Tab Einordnung ── */
  .rankbody { display: grid; gap: 10px; min-width: 0; }
  .rh { display: flex; align-items: baseline; gap: 10px; min-width: 0; flex-wrap: wrap; }
  .rh strong { display: inline-block; font-size: 22px; font-weight: 500; letter-spacing: 0.02em; color: var(--sc-fg-0); line-height: 1.15; }
  .rh strong::first-letter { text-transform: uppercase; }
  .rh span { font-family: var(--m); font-size: 14px; color: var(--sc-fg-1); }
  .statics { display: flex; gap: 18px; min-width: 0; }
  .statics div { display: grid; gap: 1px; min-width: 0; }
  .statics .k { font-family: inherit; text-transform: none; font-size: max(9.5px, var(--f)); color: var(--sc-fg-2); white-space: nowrap; }
  .statics .v { font-family: var(--m); font-size: 12.5px; color: var(--sc-fg-0); white-space: nowrap; }
  /* Touch: the focusable chips carry the tooltip, so they are tap targets. */
  @media (pointer: coarse) { .statics div { min-width: var(--sc-tap-min); min-height: var(--sc-tap-min); align-content: center; } }
  .sub { font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); display: flex; align-items: center; gap: 8px; }
  .sub i { flex: 1; height: 1px; background: var(--hair); }
  /* Touch: the focusable title reaches the tap minimum. */
  @media (pointer: coarse) {
    .ht-name { min-height: var(--sc-tap-min); line-height: var(--sc-tap-min); }
  }
  .cohort-link { font-size: max(10.5px, var(--f)); color: var(--sc-fg-2); text-decoration: none; text-align: center; transition: color 160ms ease; }
  .cohort-link:hover { color: var(--sc-accent); }
  .patchdiff { display: grid; gap: 8px; min-width: 0; }
  .patchdiff ::ng-deep .delta-table { font-size: max(11px, var(--f)); }
  .patchdiff ::ng-deep .delta-table th, .patchdiff ::ng-deep .delta-table td { padding: 4px 3px; }
  .patchdiff ::ng-deep .delta-head { flex-wrap: wrap; }
  .patchdiff ::ng-deep .admin-schema-row { box-sizing: border-box; max-width: 100%; overflow-wrap: anywhere; }
  .patchhint { margin: 0; font-size: max(12px, var(--f)); color: var(--sc-fg-2); }

  /* ── Table head: the classic shell's hangar dock and the no-geometry note; nothing else (C1, C2) ── */
  .table-head { position: relative; z-index: 5; flex: none; display: flex; align-items: center; gap: 12px; padding: 0 4px; }
  .table-head:empty { display: none; }
  .hangar-dock { flex: none; display: flex; align-items: center; }
  .no-geometry-badge { margin: 0; cursor: help; font-size: max(10px, var(--f)); color: var(--sc-fg-2); }
  /* The Akte (slot [holoAkte]) lies over the table; the table keeps its size under it (no canvas re-layout). */
  .holo-akte { position: absolute; inset: 0; z-index: 4; display: none; min-width: 0; min-height: 0; }
  .holo-akte.on { display: flex; flex-direction: column; }
  .under-akte { visibility: hidden; }

  /* ── The bottom row (r4 d1, C6): views = one choice as thumbnails, filters = multi-select chips ── */
  .holo-views { grid-column: 1 / -1; grid-row: 2; position: relative; z-index: 2; display: flex; align-items: flex-end; gap: 12px; min-width: 0;
  padding: 6px 10px 7px; margin-bottom: calc(-1 * 8px); border: 1px solid color-mix(in srgb, var(--sc-accent) 42%, transparent); border-bottom: 0;
  border-radius: 12px 12px 0 0; background: color-mix(in srgb, var(--sc-bg-0) 88%, var(--sc-accent) 4%); }
  .vw { display: flex; align-items: flex-end; gap: 6px; min-width: 0; flex: none; }
  .vw-grp { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .vw-gl { font-family: var(--d); font-size: max(9px, var(--f)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); padding-inline-start: 2px; min-height: 1.2em; white-space: nowrap; }
  .vw-row { display: flex; gap: 5px; }
  .vw-div { width: 1px; align-self: stretch; background: var(--l1); margin: 0 3px; }
  .vw-thumb { flex: none; width: 62px; display: flex; flex-direction: column; align-items: stretch; gap: 3px; padding: 0; background: none; border: 0; cursor: pointer; color: var(--sc-fg-2); font: inherit; }
  .vw-ic { display: block; height: 36px; border: 1px solid var(--l1); border-radius: 7px; background: color-mix(in srgb, var(--sc-bg-1) 90%, transparent); overflow: hidden;
  transition: border-color 160ms ease, box-shadow 160ms ease; }
  .vw-ic svg { display: block; width: 100%; height: 100%; }
  .vw-ic path { fill: var(--a12); stroke: color-mix(in srgb, var(--sc-accent) 70%, var(--sc-fg-0)); stroke-width: 1.2; vector-effect: non-scaling-stroke; }
  .vw-ic.akte { background: linear-gradient(170deg, var(--sc-bg-1), color-mix(in srgb, var(--holo-gold) 45%, var(--sc-bg-1)) 60%, color-mix(in srgb, var(--holo-gold) 70%, var(--sc-bg-1))); }
  .vw-l { font-size: max(10px, var(--f)); text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .vw-thumb:hover:not(.dis) .vw-ic { border-color: var(--l2); }
  .vw-thumb:hover:not(.dis) .vw-l { color: var(--sc-fg-0); }
  .vw-thumb.on .vw-ic { border-color: var(--sc-accent); box-shadow: 0 0 0 1px var(--sc-accent); }
  .vw-thumb.on .vw-l { color: var(--sc-fg-0); }
  .vw-thumb.dis { opacity: 0.42; cursor: not-allowed; }
  .vw-thumb:focus-visible { outline: none; }
  .vw-thumb:focus-visible .vw-ic { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  /* Views | filters: a full-height rule; the filters read as their own kind (chips with a check). */
  .vw-sep { width: 1px; align-self: stretch; background: var(--l2); }
  .vf { flex: 1; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; min-width: 0; }
  .vf-row { display: flex; gap: 6px; flex-wrap: nowrap; justify-content: flex-end; padding-bottom: 4px; min-width: 0; }
  .vf-chip { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 11px 0 8px; border: 1px solid var(--l1); border-radius: 13px; background: none;
  color: var(--sc-fg-2); font: inherit; font-size: max(11.5px, var(--f)); white-space: nowrap; cursor: pointer; transition: color 160ms ease, border-color 160ms ease, background 160ms ease; }
  .vf-chip .ck { width: 10px; height: 10px; border: 1px solid currentColor; border-radius: 3px; flex: none; }
  .vf-chip.on { color: var(--sc-fg-0); border-color: var(--sc-accent); background: var(--a22); }
  .vf-chip.on .ck { background: var(--sc-accent); border-color: var(--sc-accent); box-shadow: inset 0 0 0 2px var(--sc-bg-0); }
  .vf-chip.all { border-style: dashed; }
  .vf-chip.all.on { border-style: solid; }
  .vf-chip:hover:not([aria-disabled="true"]) { color: var(--sc-fg-0); border-color: var(--l2); }
  .vf-chip[aria-disabled="true"] { opacity: 0.4; cursor: not-allowed; }
  .vf-chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  @media (pointer: coarse) { .vf-chip { height: var(--sc-tap-min, 44px); } }
  /* The fixed card's patch slot (C18): only on the Änderungen tab. */
  .patch-slot { margin-bottom: 10px; }
  .patch-slot[hidden] { display: none; }
  /* On a desktop the panel's part list replaces the dense key under the table: one list, not two. */
  @media (min-width: 1001px) { .holo-stage ::ng-deep .pin-key { display: none; } }

  /* ── Below: side column | four area columns (the strip's columns) ── */
  .holo-below { display: grid; grid-template-columns: var(--holo-cols); column-gap: 0; row-gap: 8px; align-items: start; margin-top: 10px; }
  .below-side { grid-column: 1; grid-row: 1 / span 3; position: sticky; top: 84px; display: flex; flex-direction: column; gap: 10px; min-width: 0; padding-inline-end: 12px; }
  .below-side:empty { display: none; }
  .below-head { grid-column: 2 / 6; grid-row: 1; margin-bottom: 0; }
  .below-head .n { font-family: var(--m); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
  .below-area { grid-row: 2; min-width: 0; padding: 4px 10px 8px; border-inline-start: 1px solid var(--l1); box-shadow: inset 0 2px 0 var(--p); }
  .below-area[data-p="offensive"] { --p: var(--holo-p-offensive); }
  .below-area[data-p="defensive"] { --p: var(--holo-p-defensive); }
  .below-area[data-p="movement"] { --p: var(--holo-p-movement); }
  .below-area[data-p="signature"] { --p: var(--holo-p-signature); border-inline-end: 1px solid var(--l1); }
  .area-h { margin: 6px 0 4px; font-family: var(--d); font-weight: 400; text-transform: uppercase; font-size: max(9.5px, var(--f)); letter-spacing: 0.14em; color: var(--p, var(--sc-accent)); }
  .area-empty { margin: 4px 0; font-size: max(11.5px, var(--f)); color: var(--sc-fg-2); }
  .holo-below .holo-details { grid-column: 2 / 6; grid-row: 3; min-width: 0; }
  /* At the page's end the perspectives sit right on the strip. */
  .below-persp { margin-top: 14px; margin-bottom: 0; }
  /* The stage is a flex column with gap: 6px; the panel cancels it toward the strip so the two meet without a seam (feedback #4). */
  @media (min-width: 901px) { .below-persp { margin-bottom: -6px; } }
  .holo-stage.first:is(.ph-wait, .ph-hero) .holo-below { opacity: 0; }
  .first.ph-reveal .holo-below { animation: rise 600ms var(--e-out) 440ms backwards; }
  .holo-below { transition: opacity var(--holo-t-fast) var(--e-io); }
  .sh { display: flex; align-items: center; gap: 10px; font-size: max(9.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-accent); margin-bottom: 8px; min-height: 28px; }
  .sh .t { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
  .holo-details .sh { margin-bottom: 0; flex-wrap: wrap; }
  .details-toggle { background: none; border: 1px solid var(--l2); border-radius: 3px; color: var(--sc-fg-1); cursor: pointer; padding: 5px 12px; min-height: var(--sc-tap-min, 32px);
  font-size: max(9.5px, var(--f)); letter-spacing: 0.14em; transition: color 160ms ease, border-color 160ms ease; }
  .details-toggle:hover, .details-toggle[aria-expanded="true"] { color: var(--sc-accent); border-color: var(--sc-accent); }
  /* The drawer unfolds to its own height and folds back — the content below
     glides instead of jumping. Clipped only while it moves: at rest a select
     menu inside must still overflow it. Without interpolate-size support the
     height step is skipped and only the fade remains. */
  .details-body { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; interpolate-size: allow-keywords;
  animation: unfold var(--holo-t-base) var(--e-out) backwards; }
  .fold-leave { animation: fold var(--holo-t-fast) var(--e-io) forwards; }
  @keyframes unfold { from { height: 0; margin-top: 0; opacity: 0; overflow: clip; } to { overflow: clip; } }
  @keyframes fold { from { overflow: clip; } to { height: 0; margin-top: 0; opacity: 0; overflow: clip; } }
  .switch { display: inline-flex; align-items: center; gap: 8px; font-size: max(8.5px, var(--f)); letter-spacing: 0.14em; color: var(--sc-fg-2); cursor: pointer; min-height: var(--sc-tap-min, 24px); white-space: nowrap; }
  .switch.mobile-only { display: none; }
  .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .switch .track { width: 28px; height: 14px; border-radius: 7px; border: 1px solid var(--l2); background: var(--sc-bg-0); position: relative; transition: background 160ms ease, border-color 160ms ease; }
  .switch .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 8px; height: 8px; border-radius: 50%; background: var(--sc-fg-2); transition: transform 200ms var(--e-out), background 160ms ease; }
  .switch input:checked + .track { background: color-mix(in srgb, var(--sc-accent) 30%, var(--sc-bg-0)); border-color: var(--sc-accent); }
  .switch input:checked + .track::after { transform: translateX(14px); background: var(--sc-accent); }
  .switch input:focus-visible + .track { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
  /* The toast rides above the strip, whatever height the strip has. */
  .toasts { position: fixed; bottom: calc(var(--holo-strip-h, 64px) + 16px + var(--holo-strip-lift, 0px)); left: 50%; translate: -50% 0; z-index: 20;
  display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; }
  .draft-float { pointer-events: auto; width: min(560px, calc(100vw - 32px)); padding: 8px 12px; background: var(--sc-bg-0); border: 1px solid var(--sc-accent);
  border-radius: 4px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.4), 0 0 0 1px var(--a10); }
  .undo-toast { pointer-events: auto;
  display: flex; align-items: center; gap: 10px; background: var(--sc-bg-0); border: 1px solid var(--sc-accent);
  border-radius: 4px; padding: 8px 12px; font-size: max(12px, var(--f)); color: var(--sc-fg-0); box-shadow: 0 8px 24px rgb(0 0 0 / 0.4), 0 0 0 1px var(--a10); }
  .copy-toast.failed { border-color: var(--sc-danger); }
  .toast-enter { animation: toast-in var(--holo-t-base) var(--e-out); }
  .toast-leave { animation: toast-out var(--holo-t-fast) var(--e-io) forwards; }
  @keyframes toast-in { from { opacity: 0; transform: translateY(12px); } }
  @keyframes toast-out { to { opacity: 0; transform: translateY(8px); } }

  /* Narrower: two area columns, the side column after the parts. */
  @media (max-width: 1180px) {
  .holo-below { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .below-head, .holo-below .holo-details { grid-column: 1 / -1; grid-row: auto; }
  .below-area { grid-row: auto; }
  .below-area[data-p="defensive"], .below-area[data-p="signature"] { border-inline-end: 1px solid var(--l1); }
  .below-side { grid-column: 1 / -1; grid-row: auto; order: 5; position: static; padding-inline-end: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); align-items: start; }
  .holo-below .holo-details { order: 6; }
  }
  @media (max-width: 640px) {
  .holo-below { grid-template-columns: minmax(0, 1fr); }
  .below-area[data-p] { border-inline-end: 1px solid var(--l1); }
  }
  /* Tablet and phone: the panel goes under the model, its full width, and grows with its content. */
  @media (max-width: 1000px) {
  .holo-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; height: auto; min-height: 0; }
  .holo-panel { overflow: visible; height: auto; align-self: stretch; }
  /* The row stands under the table on its own: rounded all round, views and filters wrap onto two lines. */
  .holo-views { flex-wrap: wrap; margin-bottom: 0; border-bottom: 1px solid color-mix(in srgb, var(--sc-accent) 42%, transparent); border-radius: 12px; }
  .vw { max-width: 100%; overflow-x: auto; }
  .vw-sep { display: none; }
  .vf { flex-basis: 100%; align-items: flex-start; }
  .vf-row { overflow-x: auto; justify-content: flex-start; max-width: 100%; }
  .pbody { overflow: visible; }
  }
  /* A phone on its side: the model takes the whole height of the screen. */
  @media (orientation: landscape) and (max-width: 1000px) and (max-height: 500px) {
  .holo-table ::ng-deep .silhouette-frame { min-height: calc(100dvh - 52px); }
  }
  @media (max-width: 640px) {
  .holo-stage { padding-bottom: calc(72px + var(--holo-strip-lift, 0px)); }
  /* Beta shell: the search capsule floats at the bottom edge, the strip rides above it. */
  :host-context([data-layout]) .holo-stage { --holo-strip-lift: calc(var(--sc-float-bottom) + var(--sc-bar-h)); }
  .mobile-tabs { display: flex; }
  .switch.mobile-only { display: inline-flex; }
  .holo-topbar { grid-template-columns: auto minmax(0, 1fr); }
  .ht-left { grid-column: 1 / -1; }
  .ht-centre { justify-self: start; }
  .ht-right { justify-content: flex-end; }
  .holo-body { gap: 10px; }
  .table-head { flex-wrap: wrap; gap: 6px; padding: 0; }
  .holo-below { grid-template-columns: 1fr; }
  .holo-body.mobile-hide-table .mobile-table { display: none; }
  .holo-body.mobile-hide-data .mobile-data { display: none; }
  .toasts { width: calc(100% - 32px); }
  .undo-toast { width: 100%; justify-content: space-between; }
  }
  .reduced-motion *, .reduced-motion *::before, .reduced-motion *::after { animation: none !important; transition: none !important; }
  @media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
  }
  `],
})
export class CodexHoloStageComponent {
  private readonly t = inject(TranslateService);
  /** Beta shell: the hangar button in the table head is retired (concept r1-flag). */
  protected readonly shellBeta = inject(BetaService).isEnabled('shell');
  private readonly skins = inject(ShipSkinsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly patchChooser = viewChild(CodexHoloPatchComponent);
  private readonly tableRef = viewChild(CodexHoloTableComponent);
  /** The asset package viewer, once the table shows one: its parts and eye toggles. */
  readonly assetViewer = computed(() => this.tableRef()?.assetViewer() ?? null);
  /** The patch comparison, as the patch chooser renders it; null until a build is picked. */
  readonly patchDeltaBody = computed(() => {
    const p = this.patchChooser();
    return p && p.perspectives() ? p.deltaBody() ?? null : null;
  });
  /** Badge text per hotkey action ("L") — the template's kbd and aria-keyshortcuts. */
  readonly hkLabel: Readonly<Record<HoloHotkeyAction, string>> = {
    copyLink: holoHotkeyLabel('copyLink'),
    patch: holoHotkeyLabel('patch'),
    view: holoHotkeyLabel('view'),
  };

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
  /** The ship's decks with rooms (#797) — Schema "Einfach" offers them as chips. */
  readonly decks = input<readonly ShipDeck[] | null>(null);
  readonly deckLang = input<Lang>('en');
  readonly tailModuleSections = input<readonly LayoutSection[]>([]);
  /** The calm ports list's folded previews and block census read these —
   * the same maps the classic view hands its layout. */
  readonly occupantsBySection = input<ReadonlyMap<ShipModuleSection, readonly SummaryOccupant[]>>(new Map());
  readonly foldedModuleSections = input<ReadonlySet<ShipModuleSection>>(new Set());

  /** Open the details drawer on arrival: a link leads to something inside it. */
  readonly openDetails = input(false);

  // ── Silhouette / 3D / schema (in-place, user decision 2) ──────────
  readonly silhouette = input<HoloSilhouette | null>(null);
  readonly shipClassName = input<string>('');
  readonly hardpointPortRefs = input<readonly HardpointPortRef[]>([]);
  readonly hardpointFrame = input<HardpointFrame | null>(null);
  readonly hardpointMarkers = input<readonly HardpointMarker[]>([]);
  private readonly blueprints = inject(ShipBlueprintService);
  private readonly packages = inject(AssetPackageService);
  /** The hull has a drawing: side and front exist only there. */
  readonly drawingAvailable = computed(() => !!this.blueprints.urls(this.shipClassName())?.full);
  /** The top view needs a blueprint drawing or the extractor's hardpoint frame. */
  readonly schemaAvailable = computed(() => !!this.hardpointFrame() || this.drawingAvailable());

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
  /** The cohort read failed — the panel offers a retry instead of an empty chart. */
  readonly rankFailed = input(false);
  readonly retryRank = output<void>();
  readonly rankProfile = input<RankProfileId>('combat');
  readonly rankScope = input<RankScope>('sizeClass');
  /** The ship's class: names the default Einsatz, picks its axes. */
  readonly rankShipClass = input<RankClassId>('combat');
  /** The strip's default label ("Kampfschiff"): a ship opens on its class. */
  readonly rankClassLabel = computed(() => rankClassLabelKey(this.rankShipClass()));
  /** The role as the page shows it ("Leichter Jäger"). */
  readonly roleName = computed(() => this.heroChips().find((c) => c.key === 'role')?.text?.trim() || null);
  readonly missionNoteKey = computed(() => rankMissionNoteKey(this.activeMissionId()));
  /** The default Einsatz is the class, every other one its own word. */
  readonly missionLabelKey = computed(() => (this.activeMissionId() === 'all' ? this.rankClassLabel() : 'codex.mission.' + this.activeMissionId()));
  readonly missionHue = computed(() => missionColor(this.activeMissionId()));
  /** Who the Einsatz cell compares with: "26 × Leichter Jäger", "41 Kampfschiffe", "120 Schiffe". */
  readonly cohortLabel = computed<string | null>(() => {
    const r = this.rankResult();
    if (!r) return null;
    const n = r.cohortSize;
    const role = this.roleName();
    if (r.scope === 'role' && role) return this.t.instant('codex.holo.strip.cohortRole', { n, role });
    if (r.scope === 'career') return `${n} ${this.t.instant(rankClassPluralKey(this.rankShipClass()))}`;
    return this.t.instant('codex.holo.strip.shipCount', { n });
  });
  readonly rankDisabledReasons = input<Partial<Record<RankProfileId, string | null>>>({});
  readonly rankCohort = input<readonly RankShipInput[] | null>(null);
  readonly recentlyViewedShips = input<readonly string[]>([]);

  // ── Perspectives (reuse today's analysis panels for "Alle Werte") ──
  readonly offensivePanel = input<OffensivePanel | null>(null);
  readonly defensivePanel = input<DefensivePanel | null>(null);
  readonly shipFactGroups = input<readonly ShipFactGroup[]>([]);

  // ── Patch chooser / Δ (slot: patch-delta) ──────────────────────────
  readonly channel = input('LIVE');
  readonly buildRef = input<BuildRef | null>(null);
  readonly activeKpiSheet = input<KpiSheet>({} as KpiSheet);
  readonly activeOccupants = input<PortOccupantMap>({});
  readonly resolveComparisonSide =
    input<(detail: CodexDetail) => HoloPatchComparisonSide | Promise<HoloPatchComparisonSide>>(async () => ({
      kpiSheet: {} as KpiSheet,
      occupants: {},
    }));

  // ── Shared link on the table (#646) ─────────────────────────────────
  /** A shared link's loadout is the draft: no swap, revert or save. */
  readonly readOnly = input(false);
  /** Draft paths already stored in the hangar config (e.g. after `?config=`). */
  readonly savedPorts = input<ReadonlySet<string>>(new Set());
  readonly sharedBanner = input<HoloSharedBanner | null>(null);
  readonly adoptingShared = input(false);
  readonly adoptShared = output<void>();
  readonly exitShared = output<void>();
  readonly retryShared = output<void>();

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

  // ── Outputs — the parent still owns every one of these ───────────
  readonly hovered = output<string[] | null>();
  readonly inspected = output<LayoutTarget>();
  readonly swapRequested = output<LayoutTarget>();
  readonly reverted = output<string[]>();
  readonly missionChange = output<MissionId>();
  readonly rankProfileChange = output<RankProfileId>();
  readonly rankScopeChange = output<RankScope>();
  readonly saveDraft = output<void>();
  readonly discardDraft = output<void>();
  readonly sheetChange = output<PowerSheet>();
  /** HangarPicker outputs (slot: hangar-tab, N4) — the parent owns the
   * subject switch (navigate + `markShipPicked`) and the hangar-open route. */
  readonly hangarPick = output<string>();
  readonly hangarOpen = output<void>();
  /** Ports the 3D model resolved (forwarded to the page's locatable set). */
  readonly locatable = output<string[]>();
  /** Ports the 3D model resolved — the component list's "has a position" test. */
  readonly modelPorts = signal<readonly string[]>([]);
  readonly modelPortSet = computed<ReadonlySet<string> | null>(() => {
    const ports = this.modelPorts();
    return this.viewMode() === '3d' && ports.length > 0 ? new Set(ports) : null;
  });
  /** What the table lights up: the shared hover and the part under inspection. */
  readonly tableActivePorts = computed<readonly string[]>(() => {
    const inspected = this.inspectedPort();
    return inspected ? [...new Set([...this.activePorts(), inspected])] : this.activePorts();
  });

  onModelLocatable(ports: string[]): void {
    this.modelPorts.set(ports);
    this.locatable.emit(ports);
  }
  /** The arrival transformation finished for this hull (slug) — the host
   * records it as "seen this session" so a return visit cuts straight in. */
  readonly arrivedShip = output<string>();

  // ── Local, purely-presentational view state ───────────────────────
  /** The surface the reader chose; null = the default (3D once its model is ready). */
  readonly chosenSurface = signal<HoloSurface | null>(null);
  /** The default's switch to 3D has happened for this hull. */
  private readonly auto3d = signal(false);
  /** The model's bytes are in the cache, so 3D opens without a blank frame. */
  private readonly model3dReady = signal(false);
  /** This hull's drawing carries a front view (older uploads do not). */
  private readonly frontAvailable = signal(false);
  /** Where the Schema button leads back to. */
  readonly lastSchemaSurface = signal<Exclude<HoloSurface, '3d'>>('simple');
  /** What the table shows: the choice, as far as this hull can show it. */
  readonly surface = computed<HoloSurface>(() => {
    const c = this.chosenSurface() ?? (this.auto3d() ? '3d' : 'simple');
    const can: Record<HoloSurface, boolean> = {
      '3d': this.has3d(),
      simple: true,
      top: this.schemaAvailable(),
      side: this.drawingAvailable(),
      front: this.frontAvailable(),
    };
    return can[c] ? c : 'simple';
  });
  readonly viewMode = computed<'holo' | '3d' | 'schema'>(() => {
    const s = this.surface();
    return s === '3d' ? '3d' : s === 'simple' ? 'holo' : 'schema';
  });
  readonly schemaView = computed<BlueprintViewName>(() => {
    const s = this.surface();
    return s === 'side' || s === 'front' ? s : 'top';
  });
  /** Schema's sub-views with the reason a hull cannot show one. */
  readonly schemaOptions = computed(() => {
    const unavailable = 'codex.holo.stage.viewSchemaUnavailable';
    const option = (id: Exclude<HoloSurface, '3d'>, labelKey: string, disabledKey: string | null) => ({ id, labelKey, disabledKey });
    return [
      option('simple', 'codex.holo.stage.surfaceSimple', null),
      option('top', 'codex.holo.stage.surfaceTop', this.schemaAvailable() ? null : unavailable),
      option('side', 'codex.holo.stage.surfaceSide', this.drawingAvailable() ? null : unavailable),
      option('front', 'codex.holo.stage.surfaceFront', this.frontAvailable() ? null : 'codex.holo.stage.surfaceFrontPending'),
    ];
  });
  /** The pins of the simple view: only what can be swapped, the list keeps the rest. */
  readonly tablePins = computed<StagePin[]>(() => {
    const all = this.pins();
    const swappable = all.filter((p) => !!p.slot && !!p.section && isConfigurableSection(p.section));
    return (swappable.length > 0 ? swappable : all).filter((p) => this.pinPassesFilter(p));
  });
  /** The pins the table may label: every pin the parts filters let through. */
  readonly labelPins = computed<StagePin[]>(() => this.pins().filter((p) => this.pinPassesFilter(p)));

  // ── The bottom row (concept holotisch-feinschliff r4 d1, C6): Akte › views › parts filters ──
  /** The Akte lies over the table; any other view closes it. */
  readonly akteOpen = signal(false);
  /** The view the row has on: the Akte or the table's surface. */
  readonly activeView = computed<HoloView>(() => (this.akteOpen() ? 'akte' : this.surface()));
  /** The checked thumbnail: a deck reads `deck:<key>`, Außen "Einfach" only while no deck is on. */
  readonly activeViewId = computed(() => {
    const v = this.activeView();
    const deck = this.deckView();
    return v === 'simple' && deck && this.tableDeck() ? `deck:${deck}` : v;
  });
  /** Every view change, for the page (the Akte surface, the share link). */
  readonly viewChange = output<HoloView>();
  /** The parts filters that are on; all four by default. */
  readonly partFilter = signal<ReadonlySet<HoloPartFilter>>(new Set(ALL_PART_FILTERS));
  readonly partFilterChips = PART_FILTER_CHIPS;

  private pinPassesFilter(p: StagePin): boolean {
    const f = this.partFilter();
    if (f.size === ALL_PART_FILTERS.length) return true;
    return f.has(p.section ? PART_FILTER_OF[p.section] : 'other');
  }

  /** The row's three groups: Akte | Außen (3D, Einfach, Oben, Seite, Front) | Innen (decks, only with rooms). */
  readonly viewGroups = computed<readonly { id: string; labelKey: string | null; items: readonly ViewThumb[] }[]>(() => {
    const thumb = (view: HoloView, labelKey: string, disabledKey: string | null): ViewThumb => ({
      id: view, labelKey, label: '', disabledKey, icon: VIEW_ICONS[view], view, deck: null,
    });
    const schema = new Map(this.schemaOptions().map((o) => [o.id, o.disabledKey]));
    const outside: ViewThumb[] = [
      thumb('3d', 'codex.holo.stage.view3d', this.has3d() ? null : 'codex.holo.stage.view3dUnavailable'),
      thumb('simple', 'codex.holo.stage.surfaceSimple', null),
      thumb('top', 'codex.holo.stage.surfaceTop', schema.get('top') ?? null),
      thumb('side', 'codex.holo.stage.surfaceSide', schema.get('side') ?? null),
      thumb('front', 'codex.holo.stage.surfaceFront', schema.get('front') ?? null),
    ];
    const inside: ViewThumb[] = this.deckChips()
      .filter((c): c is { key: string; label: string; labelKey: string | null } => c.key !== null)
      .map((c) => ({ id: `deck:${c.key}`, labelKey: c.labelKey, label: c.label, disabledKey: null, icon: VIEW_ICONS.deck, view: 'simple', deck: c.key }));
    return [
      { id: 'akte', labelKey: null, items: [thumb('akte', 'codex.holo.stage.viewAkte', null)] },
      { id: 'outside', labelKey: 'codex.holo.stage.deckOutside', items: outside },
      ...(inside.length > 0 ? [{ id: 'inside', labelKey: 'codex.holo.stage.deckInside', items: inside }] : []),
    ];
  });

  /** A thumbnail: the Akte, a surface (Außen) or a deck (Innen, on "Einfach"). A disabled one only shows its reason. */
  pickView(v: ViewThumb): void {
    if (v.disabledKey) return;
    const before = this.activeViewId();
    if (v.view === 'akte') {
      if (!this.akteOpen() && this.soundOn()) this.tone('switch');
      this.akteOpen.set(true);
    } else {
      this.akteOpen.set(false);
      if (v.deck) {
        this.pickSurface('simple');
        this.pickDeck(v.deck);
      } else {
        this.deckView.set(null);
        this.pickSurface(v.view);
      }
    }
    if (this.activeViewId() !== before) this.viewChange.emit(this.activeView());
  }

  /** Arrow keys walk the views like one radio group, skipping the disabled ones. */
  onViewKey(ev: KeyboardEvent): void {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    const edge = ev.key === 'Home' ? 'first' : ev.key === 'End' ? 'last' : null;
    if (!step && !edge) return;
    const items = this.viewGroups().flatMap((g) => g.items).filter((i) => !i.disabledKey);
    if (items.length === 0) return;
    ev.preventDefault();
    const at = items.findIndex((i) => i.id === this.activeViewId());
    const next = edge === 'first' ? items[0] : edge === 'last' ? items[items.length - 1] : items[(at + step + items.length) % items.length];
    this.pickView(next);
    const host = this.host.nativeElement.querySelector<HTMLElement>(`.vw-thumb[data-view="${next.id}"]`);
    host?.focus({ preventScroll: true });
  }

  /** A parts chip on/off; the last one on stays on (an empty table helps no one). */
  togglePartFilter(id: HoloPartFilter): void {
    if (this.activeView() === 'akte') return;
    const next = new Set(this.partFilter());
    if (next.has(id)) {
      if (next.size === 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    this.partFilter.set(next);
  }

  /** "Alle Teile": every raw port on the model and every row in the panel. */
  toggleAllParts(): void {
    if (this.activeView() === 'akte') return;
    this.hotspotScope.set(this.hotspotScope() === 'all' ? 'swappable' : 'all');
  }

  /** The swappable parts' ports, the one rule for the dots in 3D and in Einfach. */
  readonly swappablePorts = computed<ReadonlySet<string>>(() => new Set(this.tablePins().map((p) => p.portName)));

  /** The ports the picked Einsatz keeps lit; null = no focus, nothing goes quiet. */
  readonly relevantPorts = computed<ReadonlySet<string> | null>(() => {
    const sections = missionRelevantSections(this.activeMissionId());
    if (!sections) return null;
    const out = new Set<string>();
    for (const s of this.allSections()) {
      if (!sections.includes(s.section)) continue;
      for (const slot of s.slots) out.add(slot.rawPort ?? slot.port);
    }
    return out.size > 0 ? out : null;
  });

  private static readSurfacePref(): HoloSurface | null {
    try {
      const v = localStorage.getItem(SURFACE_PREF_KEY);
      return v === 'simple' || v === 'top' || v === 'side' || v === 'front' ? v : null;
    } catch {
      return null;
    }
  }

  /** The reader picks a surface; a Schema sub-view is remembered across hulls, 3D is the default anyway. */
  pickSurface(next: HoloSurface): void {
    if (next !== this.surface() && this.soundOn()) this.tone('switch');
    this.chosenSurface.set(next);
    if (next !== '3d') this.lastSchemaSurface.set(next);
    try {
      if (next === '3d') localStorage.removeItem(SURFACE_PREF_KEY);
      else localStorage.setItem(SURFACE_PREF_KEY, next);
    } catch {
      /* private mode: the choice lasts for this hull */
    }
  }
  readonly detailsOpen = signal(false);
  /** The deck on the table in "Einfach"; null = Außen (the hull and its parts). */
  readonly deckView = signal<string | null>(null);
  /** Außen + one chip per deck with rooms; one deck = Außen/Innen; no rooms = none (r1-decks). */
  readonly deckChips = computed<readonly { key: string | null; label: string; labelKey: string | null }[]>(() => {
    const set = buildDeckPlans(this.decks(), this.deckLang());
    if (!set || set.decks.length === 0) return [];
    const outside = { key: null, label: '', labelKey: 'codex.holo.stage.deckOutside' };
    if (set.decks.length === 1) return [outside, { key: set.decks[0].key, label: '', labelKey: 'codex.holo.stage.deckInside' }];
    return [outside, ...set.decks.map((d) => ({ key: d.key, label: d.label, labelKey: null }))];
  });
  /** What the table draws for the picked deck; null = the hull. */
  readonly tableDeck = computed<HoloDeckView | null>(() => {
    const key = this.deckView();
    const decks = this.decks();
    if (!key || !decks || this.surface() !== 'simple' || !this.deckChips().some((c) => c.key === key)) return null;
    return { decks, lang: this.deckLang(), key };
  });
  pickDeck(key: string | null): void {
    if (key !== this.deckView() && this.soundOn()) this.tone('switch');
    this.deckView.set(key);
  }
  readonly inspectedPort = signal<string | null>(null);
  /** The placement a click on the model chose, when it says more than the slot's port (a gun on its mount). */
  private readonly viewerSelection = signal<string | null>(null);
  /** A part with no loadout slot behind it (under "Alle Teile"): the panel names it from the package. */
  private readonly looseSelection = signal<PlacementSelection | null>(null);
  /** What the viewer holds selected. */
  readonly viewerSelectedPort = computed(() => this.viewerSelection() ?? this.inspectedPort());
  /** "Alle Teile": every dot on the model and every row in the panel. */
  readonly hotspotScope = signal<HotspotScope>('swappable');
  readonly panelTabs = PANEL_TABS;
  readonly panelTab = signal<HoloPanelTab>('rank');
  readonly panelTabIndex = computed(() => PANEL_TABS.findIndex((t) => t.id === this.panelTab()));
  /** The package's rows, for the panel under "Alle Teile". */
  readonly packageRows = computed<readonly PlacementRow[]>(() => this.assetViewer()?.rows() ?? []);
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

  /** Set once the panels first had a body: a hull switch never empties them
   * again (the next ship's values simply replace the last one's), only a
   * first visit starts from an empty stage. */
  readonly hadBody = signal(false);
  /** The save error, when the inspector's save bar (rail open, arrival done,
   * a journal to save) is not there to show it. */
  readonly saveErrorElsewhere = computed(() => {
    const err = this.saveError();
    if (!err) return null;
    return this.draftChangedCount() > 0 && !this.readOnly() ? null : err;
  });
  readonly bodyReady = computed(() => this.phase() === 'reveal' || this.phase() === 'done' || this.hadBody());

  readonly staticKeys: readonly StaticKey[] = ['crew', 'mass', 'cargo'];

  constructor() {
    // A changed Einsatz (bar click, hotkey or URL) ticks when sound is on (cx-sound).
    let lastMission: MissionId | null = null;
    effect(() => {
      const m = this.activeMissionId();
      untracked(() => {
        if (lastMission !== null && m !== lastMission && this.soundOn()) this.tone('switch');
        lastMission = m;
      });
    });
    void this.blueprints.load();
    // Letter hotkeys (#644) in the CAPTURE phase: they run before the Codex
    // type-to-search listener and claim their key with preventDefault(), which
    // type-to-search respects — see codex-holo-hotkeys.ts.
    if (typeof document !== 'undefined') {
      const onKey = (ev: KeyboardEvent): void => this.onHotkey(ev);
      document.addEventListener('keydown', onKey, true);
      this.destroyRef.onDestroy(() => document.removeEventListener('keydown', onKey, true));
    }
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
          this.hadBody.set(true);
          this.arrived.set(true);
          return;
        }
        this.arrived.set(false);
        // The session's first ship gets the whole arrival, every later one a short settle.
        if (fullArrivalPlayed) {
          this.phase.set('done');
          this.hadBody.set(true);
          timers.push(
            setTimeout(() => {
              if (cancelled) return;
              this.arrived.set(true);
              this.arrivedShip.emit(slug);
            }, SHORT_ARRIVAL_MS),
          );
          return;
        }
        const reveal = (): void =>
          untracked(() => {
            if (cancelled) return;
            fullArrivalPlayed = true;
            this.phase.set('reveal');
            this.hadBody.set(true);
            this.startCountUp();
            if (this.soundOn()) this.tone('arrive');
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
        this.closeInspector();
        this.panelTab.set('rank');
        this.deckView.set(null);
        this.hotspotScope.set('swappable');
        this.partFilter.set(new Set(ALL_PART_FILTERS));
        const pref = CodexHoloStageComponent.readSurfacePref();
        this.chosenSurface.set(pref);
        if (pref && pref !== '3d') this.lastSchemaSurface.set(pref);
        this.auto3d.set(false);
        this.frontAvailable.set(false);
        this.modelPorts.set([]);
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
      untracked(() => {
        this.has3d.set(false);
        this.model3dReady.set(false);
      });
      if (!shipId) return;
      void this.skins.listSkins(shipId).then(({ skins }) => {
        if (seq !== this.skinsSeq) return;
        const available = skins.some((s) => !!s.modelPath);
        this.has3d.set(available);
      }).catch((error) => {
        logWarn('codex', 'holo skin catalog failed', { shipId, error });
        /* catalog unreachable — the toggle simply stays hidden */
      });
    });

    effect(() => {
      if (this.openDetails()) {
        untracked(() => {
          if (typeof requestAnimationFrame !== 'function') return;
          requestAnimationFrame(() => {
            const host: HTMLElement = this.host.nativeElement;
            (host.querySelector('#bezugsquelle') ?? host.querySelector('.holo-open'))?.scrollIntoView({ behavior: 'auto', block: 'start' });
          });
        });
      }
    });

    // Fetch the model while the arrival plays, so 3D never opens on a blank frame.
    effect(() => {
      const ship = this.shipClassName();
      if (!this.has3d() || !ship) return;
      const seq = this.skinsSeq;
      untracked(() => {
        void this.packages.preloadShip(ship).then(() => {
          if (seq === this.skinsSeq) this.model3dReady.set(true);
        });
      });
    });

    // The 3D hologram leads (2026-10-02): a hull with a model opens in 3D once
    // its arrival played and the model is ready, unless the reader picked a
    // view. Never under a pointer that is busy with a pin.
    effect(() => {
      if (this.chosenSurface() !== null || !this.has3d() || !this.model3dReady()) return;
      if (this.phase() !== 'done' || this.activePorts().length > 0) return;
      // A phone opens on Einfach, 3D on request: no model download on the way (d-start simple).
      if (typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches) return;
      untracked(() => this.auto3d.set(true));
    });

    // Does the drawing have a front view? Asked once Schema is on screen.
    effect(() => {
      const ship = this.shipClassName();
      if (this.surface() === '3d' || !this.drawingAvailable()) return;
      untracked(() => {
        void this.blueprints.drawing(ship, 'full').then((bp) => {
          if (ship === this.shipClassName()) this.frontAvailable.set(!!bp && !!blueprintView(bp, 'front'));
        });
      });
    });

    // Sizes other rules depend on: the first screen's height (where the body
    // starts, how tall the strip's row is), the toast's and the sticky tiles'
    // clearance above the strip, the tiles' own height.
    afterNextRender(() => {
      const root = this.host.nativeElement;
      const stage = root.querySelector<HTMLElement>('.holo-stage');
      const measureTop = (): void => this.measureTop();
      measureTop();
      window.addEventListener('resize', measureTop, { passive: true });
      this.destroyRef.onDestroy(() => window.removeEventListener('resize', measureTop));
      // Perspektiven panel + Einsatz bar are one box where they touch at the
      // page's end: --holo-join = 1 squares the bar's top corners and drops its
      // top edge/shadow (strip CSS, desktop only); floating over the page the
      // bar keeps its own rounded top.
      let joinRaf = 0;
      const measureJoin = (): void => {
        joinRaf = 0;
        const panel = root.querySelector<HTMLElement>('.below-persp');
        const bar = root.querySelector<HTMLElement>('sc-codex-holo-strip .holo-strip');
        if (!stage || !panel || !bar) return;
        const gap = bar.getBoundingClientRect().top - panel.getBoundingClientRect().bottom;
        stage.style.setProperty('--holo-join', gap <= 2 ? '1' : '0');
      };
      const queueJoin = (): void => { joinRaf ||= requestAnimationFrame(measureJoin); };
      queueJoin();
      document.addEventListener('scroll', queueJoin, { capture: true, passive: true });
      window.addEventListener('resize', queueJoin, { passive: true });
      this.destroyRef.onDestroy(() => {
        cancelAnimationFrame(joinRaf);
        document.removeEventListener('scroll', queueJoin, { capture: true });
        window.removeEventListener('resize', queueJoin);
      });
      if (typeof ResizeObserver !== 'function') return;
      // In the next frame: these sizes change layout, inside the callback that is a "ResizeObserver loop".
      let raf = 0;
      const pending = new Set<HTMLElement>();
      const flush = (): void => {
        raf = 0;
        for (const el of pending) {
          const h = Math.round(el.getBoundingClientRect().height);
          if (el.matches('.holo-strip')) stage?.style.setProperty('--holo-strip-h', `${h}px`);
          else if (el.matches('.hs-row')) stage?.style.setProperty('--holo-row-h', `${h}px`);
          else if (el.matches('.below-persp')) { el.style.setProperty('--persp-h', `${h}px`); queueJoin(); }
          else if (el.matches('.holo-topbar')) measureTop();
        }
        pending.clear();
      };
      const ro = new ResizeObserver((entries) => {
        for (const e of entries) pending.add(e.target as HTMLElement);
        raf ||= requestAnimationFrame(flush);
      });
      this.destroyRef.onDestroy(() => cancelAnimationFrame(raf));
      // The strip's inner bar, not its host: on a phone the bar is position:
      // fixed and the host collapses to 0px, which put the toast on the bar.
      for (const sel of ['sc-codex-holo-strip .holo-strip', 'sc-codex-holo-strip .hs-row', '.below-persp', '.holo-topbar']) {
        const el = root.querySelector(sel);
        if (el) ro.observe(el);
      }
      this.destroyRef.onDestroy(() => ro.disconnect());
    });

    // A shared banner above the body moves where the first screen starts.
    effect(() => {
      this.sharedBanner();
      if (typeof requestAnimationFrame === 'function') untracked(() => requestAnimationFrame(() => this.measureTop()));
    });

    this.destroyRef.onDestroy(() => {
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      if (this.copyToastTimer) clearTimeout(this.copyToastTimer);
      if (this.countUpRaf) cancelAnimationFrame(this.countUpRaf);
      void this.audioCtx?.close().catch(() => undefined);
    });

    // The "Einordnung" follows the Einsatz: the default takes the class's axes,
    // a picked Einsatz its own (concept r3). The parent keeps owning the signal.
    effect(() => {
      const wanted = rankProfileForMission(this.activeMissionId(), this.rankShipClass());
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
      // A shared link's loadout, or a config that was just put on the table,
      // is not an edit of the reader's — nothing to undo.
      if (added && !untracked(this.readOnly) && !untracked(this.savedPorts).has(added.port)) {
        this.undoToast.set(added);
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => this.undoToast.set(null), UNDO_TOAST_MS);
      }
    });
    this.destroyRef.onDestroy(() => {
      if (toastTimer) clearTimeout(toastTimer);
    });
  }

  /** Where the body starts on the page, however far it is scrolled: the first screen's height follows from it. */
  private measureTop(): void {
    const stage = this.host.nativeElement.querySelector<HTMLElement>('.holo-stage');
    const body = this.host.nativeElement.querySelector<HTMLElement>('.holo-body');
    if (!stage || !body) return;
    // Layout offsets, not the rect: the page's enter animation moves the rect for a moment.
    let y = 0;
    for (let el: HTMLElement | null = body; el; el = el.offsetParent as HTMLElement | null) y += el.offsetTop;
    const top = `${Math.round(y)}px`;
    if (stage.style.getPropertyValue('--holo-top') !== top) stage.style.setProperty('--holo-top', top);
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

  /** The strip's power sheet goes up to the host AND feeds the signature tile. */
  onSheetChange(sheet: PowerSheet): void {
    this.powerSheet.set(sheet);
    this.sheetChange.emit(sheet);
  }

  /** Esc closes the inspector (the digit pin keys are gone, concept holotisch-feinschliff C11). Inert while any dialog
   * (swap picker, weapon detail, …) is open — those own the keyboard (wave 5 B2.4). */
  @HostListener('document:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (document.querySelector('[role="dialog"], dialog[open]')) return;
    if (ev.key === 'Escape' && this.inspectedPort()) this.closeInspector();
  }

  /**
   * The holodeck's letter hotkeys (#644): L copies the page link (toast),
   * P opens / closes the patch chooser, V cycles holo → 3D → schema (sharing is the
   * corner's share FAB, concept codex-kopf-besitz C9). Ignored while a text field has focus, with a
   * chord, or while a dialog that is not the stage's own popover is open.
   */
  onHotkey(ev: KeyboardEvent): void {
    const action = holoHotkeyFor(ev, this.host.nativeElement);
    if (!action) return;
    ev.preventDefault();
    switch (action) {
      case 'copyLink':
        void this.copyLinkByKey();
        break;
      case 'patch':
        // The patch choice sits in the Änderungen tab (C18): the key opens that tab with it.
        this.panelTab.set('changes');
        this.patchChooser()?.toggle();
        break;
      case 'view':
        this.akteOpen.set(false);
        this.pickSurface(nextHoloSurface(this.surface(), {
          has3d: this.has3d(),
          top: this.schemaAvailable(),
          side: this.drawingAvailable(),
          front: this.frontAvailable(),
        }));
        break;
    }
  }

  /** L's own feedback: the address of this view, "copied" or "not allowed". */
  readonly copyToast = signal<'ok' | 'failed' | null>(null);
  private copyToastTimer: ReturnType<typeof setTimeout> | null = null;

  /** L (#644): copies this view's address — the same URL "Link kopieren" copies
   * — and says whether the clipboard took it (a refused copy is not silent). */
  async copyLinkByKey(): Promise<void> {
    let result: 'ok' | 'failed' = 'ok';
    try {
      await navigator.clipboard.writeText(location.href);
    } catch (error) {
      logWarn('codex', 'hotkey link copy failed', error);
      result = 'failed';
    }
    this.copyToast.set(result);
    if (this.copyToastTimer) clearTimeout(this.copyToastTimer);
    this.copyToastTimer = setTimeout(() => this.copyToast.set(null), result === 'ok' ? 2000 : 3500);
  }

  readonly eyebrowTitle = computed(() => {
    const career = this.heroChips().find((c) => c.key === 'career')?.text?.trim();
    return [this.manufacturerName(), this.displayName(), career].filter((p) => !!p).join(' · ');
  });

  /** The title without the maker's own first word — the kicker names the maker. */
  readonly shortName = computed(() => shipNameWithoutMaker(this.displayName(), this.manufacturerName()));

  private keepSimpleForPin(): void {
    // Working with the pins: the default's switch to 3D must not pull them away.
    if (this.chosenSurface() === null && this.surface() === 'simple') this.chosenSurface.set('simple');
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
    if (next) this.tone('blip');
  }

  /** One lazily created context for the whole stage — browsers cap live
   * AudioContexts (~6 in Chrome), a fresh one per click went silent after a
   * handful of pins (wave 5 B1.5). Closed on destroy. */
  private audioCtx: AudioContext | null = null;

  /**
   * Opt-in-only UI sound (default off, concept cx-sound): short, quiet WebAudio
   * tones, no audio asset. `blip` = a port picked / sound switched on,
   * `switch` = Einsatz or view changed, `arrive` = the holotable materialises
   * (a soft rising two-note shimmer under the reveal).
   */
  tone(kind: HoloTone): void {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = (this.audioCtx ??= new Ctx());
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      for (const n of HOLO_TONES[kind]) {
        const t0 = ctx.currentTime + n.at;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = n.wave;
        osc.frequency.setValueAtTime(n.from, t0);
        if (n.to !== n.from) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.dur);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(n.gain, t0 + Math.min(0.02, n.dur / 4));
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + n.dur + 0.02);
      }
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

  // ── The strip's Einsatz picker ────────────────────────────────────
  readonly missionSegments = computed<MissionSegment[]>(() => {
    const cells = this.allKpiCells();
    const caps = this.shipCapabilities();
    const portCount = this.pins().length;
    return MISSIONS.map((m) => {
      let sub: string;
      if (m.id === 'all') {
        sub = this.t.instant('codex.holo.stage.portsCount', { n: portCount });
      } else {
        const lead = m.kpis.map((k) => cells.find((c) => c.key === k)).find((c) => c && c.value != null);
        sub = lead ? `${this.fmtCell(lead)} ${this.t.instant('codex.kpi.short.' + lead.key)}` : this.t.instant('codex.kpi.gap');
      }
      return { id: m.id, labelKey: m.id === 'all' ? this.rankClassLabel() : m.labelKey, sub, disabledKey: missionDisabledReasonKey(m.id, caps) };
    });
  });

  // ── Ports list (below the table) ──────────────────────────────────
  readonly allSections = computed<readonly LayoutSection[]>(() => [
    ...this.primaryModuleSections(),
    ...this.tailModuleSections(),
  ]);
  /** The layout component wants a mutable array type; same content. */
  readonly allSectionsMutable = computed<LayoutSection[]>(() => [...this.allSections()]);

  /** The parts in four columns over the strip's four areas (concept r1 d2), each section where it counts. */
  readonly partAreas = computed(() =>
    PART_AREAS.map((a) => ({
      id: a.id,
      labelKey: `codex.holo.strip.${a.id}`,
      sections: this.allSections().filter((s) => a.sections.includes(s.section)),
    })),
  );

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

  /** The silhouette's anchors by port name (case-folded). An anchor exists
   * per hardpoint NODE — far more than the table pins (a Nomad: 96 anchors,
   * 17 pins); only a shown pin whose port name matches one sits on the hull.
   * The anchor's own portId wins over a helper of the same name. */
  private readonly anchorByPort = computed<Map<string, SilhouetteAnchor>>(() => {
    const out = new Map<string, SilhouetteAnchor>();
    const anchors = this.silhouette()?.anchors ?? [];
    for (const a of anchors) if (!out.has(anchorKey(a.portId))) out.set(anchorKey(a.portId), a);
    for (const a of anchors) if (a.helper && !out.has(anchorKey(a.helper))) out.set(anchorKey(a.helper), a);
    return out;
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
    const anchors = this.anchorByPort();
    const source = this.pinSource();
    const n = source.filter(({ raw }) => !anchors.has(anchorKey(raw))).length;
    if (n === 0) return null;
    const ring = { ...this.fallbackRing() };
    // With anchored pins on the table the labels move into columns beside the
    // hull (#642): the ring hugs the outline's width (2 % out instead of 8 %)
    // and stays inside the hull square — the columns sit beside the outline
    // and its dots, so a wide ring would only push them apart.
    if (n < source.length) {
      ring.rx = Math.min(ring.rx - 6, ring.cx - 4, 96 - ring.cx);
      ring.ry = Math.min(ring.ry, ring.cy - 4, 96 - ring.cy);
      return ring;
    }
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
    const byPort = this.anchorByPort();
    const source = this.pinSource();
    const ring = this.pinRing();
    // Estimated positions are spread evenly ALONG the ring (not by angle), in
    // list order from the nose clockwise — see `ringPositions`.
    const spots = ring ? ringPositions(ring, source.filter(({ raw }) => !byPort.has(anchorKey(raw))).length) : [];
    let spot = 0;
    const placed = source.map(({ raw }) => byPort.get(anchorKey(raw)) ?? spots[spot++] ?? { x: 50, y: 50 });
    // With anchors on the table, coinciding dots fan out and estimated ring
    // pins step off anchored ones, so no number hides under another
    // (`spreadStackedPins`). A ring-only table is already evenly spaced.
    const anchored = source.some(({ raw }) => byPort.has(anchorKey(raw)));
    const at = anchored ? spreadStackedPins(placed) : placed;
    let nextIndex = 0;
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
      .map(({ raw, known }, i) => {
        const slot = known?.slot ?? null;
        const index = known?.index ?? ++nextIndex;
        const anchor = byPort.get(anchorKey(raw));
        const stat = slot?.stats?.[0] ?? null;
        const base = {
          portName: raw,
          index,
          label: pinLabel(slot, known?.section ?? null, raw),
          short: stat ? formatEquippedStat(stat) : slot?.statChip ?? null,
          tone: (known?.section === 'missiles' ? 'gold' : 'accent') as 'accent' | 'gold',
          slot,
          section: known?.section ?? null,
        };
        const p = at[i];
        return { ...base, x: p.x, y: p.y, side: sideFor(p.x, p.y, !anchor), resolved: !!anchor };
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

  /** Too many pins for labels beside the dots — the numbered key takes over,
   * unless the table can place anchored pins' labels in leader columns (#642,
   * decided by the table, which knows its own size). */
  readonly dense = computed(() => this.tablePins().length > DENSE_PIN_COUNT);
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

  /** The inspected part has no loadout slot behind it (raw extract port, or a
   * part only "Alle Teile" lists): nothing to swap, the host's picker would no-op. */
  readonly inspectorIsRawPort = computed<boolean>(() => {
    const port = this.inspectedPort();
    if (!port) return false;
    return !this.allSections().some((s) => s.slots.some((sl) => (sl.rawPort ?? sl.port) === port));
  });

  /** The loadout block of the part under inspection. */
  readonly inspectedSection = computed<ShipModuleSection | null>(() => {
    const port = this.inspectedPort();
    if (!port) return null;
    return this.allSections().find((s) => s.slots.some((sl) => (sl.rawPort ?? sl.port) === port))?.section ?? null;
  });

  readonly inspectorTarget = computed<LayoutTarget | null>(() => {
    const port = this.inspectedPort();
    if (!port) return null;
    for (const section of this.allSections()) {
      const slot = section.slots.find((s) => (s.rawPort ?? s.port) === port);
      if (slot) return { slot, count: 1, child: null, rawPorts: [port] };
    }
    // A part of the package with no loadout slot: it still has a name and a page.
    const loose = this.looseSelection();
    if (loose?.portName === port) {
      const row = this.packageRows().find((r) => r.p.id === loose.id);
      const slot: LayoutSlot = {
        port,
        rawPort: port,
        className: loose.itemClass,
        kind: (row?.link?.[1] as CodexKind | undefined) ?? null,
        name: row?.name ?? loose.itemClass,
        size: row?.p.itemSize ?? null,
        grade: null,
        manufacturerCode: null,
        portSize: null,
      };
      return { slot, count: 1, child: null, rawPorts: [port] };
    }
    // A raw-port pin (ship without loadout sections, wave 5 B1.3): a minimal
    // target so the panel names the port instead of contradicting the selected
    // pin with its empty state.
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

  /** The selected part's callout: its size, then its two top values. */
  readonly calloutValues = computed<readonly CalloutValue[]>(() => {
    const it = this.inspectorTarget();
    if (!it) return [];
    const part = partFocusOf(it, this.inspectedSection());
    const out: CalloutValue[] = [];
    if (part.size != null) out.push({ label: this.t.instant('codex.holo.stage.partSize'), value: `S${part.size}` });
    for (const st of part.stats.slice(0, 3 - out.length)) out.push({ label: this.t.instant(st.labelKey), value: formatEquippedStat(st) });
    return out;
  });

  readonly calloutTitle = computed<string | null>(() => {
    const it = this.inspectorTarget();
    const name = it ? partFocusOf(it, this.inspectedSection()).name : null;
    return name ? displayItemName(name) : null;
  });

  closeInspector(): void {
    this.inspectedPort.set(null);
    this.viewerSelection.set(null);
    this.looseSelection.set(null);
  }

  /** A click on the model selected a part (or Escape cleared it): the panel follows. */
  onPartSelected(sel: PlacementSelection | null): void {
    if (!sel) {
      this.closeInspector();
      return;
    }
    const hasSlot = (port: string | null | undefined): boolean =>
      !!port && this.allSections().some((s) => s.slots.some((sl) => (sl.rawPort ?? sl.port) === port));
    // A gun on its mount: the slot belongs to the nearest ancestor that has one (parentPort is the parent's id).
    let slotPort: string | null = hasSlot(sel.portName) ? sel.portName : null;
    const byId = this.assetViewer()?.byId();
    for (let up = byId?.get(sel.id)?.parentPort; !slotPort && up; up = byId?.get(up)?.parentPort) {
      const port = byId?.get(up)?.portName;
      if (hasSlot(port)) slotPort = port!;
    }
    this.looseSelection.set(slotPort ? null : sel);
    this.viewerSelection.set(sel.id);
    this.panelTab.set('parts');
    this.selectInspected(slotPort ?? sel.portName);
  }

  /** The callout's swap icon: the same target „Bauteil tauschen“ acts on. */
  onPartSwap(sel: PlacementSelection): void {
    if (this.readOnly() || this.inspectorIsRawPort()) return;
    if (this.viewerSelection() !== sel.id) this.onPartSelected(sel);
    const it = this.inspectorTarget();
    if (it) this.swapRequested.emit(partFocusOf(it, this.inspectedSection()).target);
  }

  /** A row under "Alle Teile". */
  onRowPick(r: PlacementRow): void {
    this.onPartSelected({ id: r.p.id, portName: r.p.portName, itemClass: r.p.itemClass, swappable: false });
  }

  onRowFocus(r: PlacementRow | null): void {
    const v = this.assetViewer();
    if (!v) return;
    if (r) v.focus(r.p);
    else v.localFocus.set(null);
  }

  /** A picked build opens its comparison where it lives now. */
  onPatchCompared(build: CodexBuild | null): void {
    const had = this.patchComparisonBuild();
    this.patchComparisonBuild.set(build);
    if (build && build !== had) this.panelTab.set('changes');
  }

  /** The tabs are one control: arrows, Home and End walk them, focus follows. */
  onTabKey(ev: KeyboardEvent): void {
    const n = PANEL_TABS.length;
    const i = this.panelTabIndex();
    const next = ev.key === 'ArrowRight' ? (i + 1) % n : ev.key === 'ArrowLeft' ? (i - 1 + n) % n : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    ev.preventDefault();
    const id = PANEL_TABS[next].id;
    this.panelTab.set(id);
    this.host.nativeElement.querySelector<HTMLElement>(`#holo-tab-${id}`)?.focus();
  }

  /** The drawer opens from the panel, and the page goes to it. */
  openDetailsDrawer(): void {
    const open = !this.detailsOpen();
    this.detailsOpen.set(open);
    if (!open || typeof requestAnimationFrame !== 'function') return;
    requestAnimationFrame(() => {
      this.host.nativeElement.querySelector('.holo-details')?.scrollIntoView({ behavior: this.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    });
  }

  private pulseTimer: ReturnType<typeof setTimeout> | null = null;

  inspectPin(port: string): void {
    this.keepSimpleForPin();
    // A part has no marker inside a deck: back outside, where it sits.
    this.deckView.set(null);
    this.viewerSelection.set(null);
    this.looseSelection.set(null);
    this.panelTab.set('parts');
    this.selectInspected(this.inspectedPort() === port ? null : port);
  }

  private selectInspected(next: string | null): void {
    this.inspectedPort.set(next);
    if (next) {
      if (this.soundOn()) this.tone('blip');
      // Pulse the perspective the selected port belongs to (concept pe4-pulse).
      const section = this.slotByRawPort().get(next)?.section ?? null;
      const tile: Perspective | null =
        section === 'weapons' || section === 'missiles' || section === 'remoteTurrets' || section === 'pod' ? 'offensive'
        : section === 'shields' ? 'defensive'
        : section === 'quantum' ? 'movement'
        : section === 'coolers' || section === 'radar' ? 'signature'
        : null;
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      // A second pick inside the same tile must pulse again: drop the class
      // for one frame so the animation restarts instead of being swallowed.
      if (tile && this.pulseTile() === tile && typeof requestAnimationFrame === 'function') {
        this.pulseTile.set(null);
        requestAnimationFrame(() => this.pulseTile.set(tile));
      } else {
        this.pulseTile.set(tile);
      }
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
        leadFinalText: t.lead ? this.fmtCell(t.lead) : null,
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
