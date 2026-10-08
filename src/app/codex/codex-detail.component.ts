import { logWarn } from '../core/log';
import { toErrorKey } from '../core/describe-error';
import { AccountPrefsService } from '../core/account-prefs.service';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslateService, TranslatePipe } from '@ngx-translate/core';
import {
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
  isReExtractPending,
} from './codex.types';
import {
  BlueprintRef,
  CODEX_KINDS,
  CodexDetail,
  CodexKind,
  CodexService,
  ResolvedEntity,
  pickLocalized,
  toLang,
} from './codex.service';
import { AddToSetComponent } from './set/add-to-set.component';
import { roleSlotForAttachType } from './codex-landing-kpi';
import { HangarService } from '../hangar/hangar.service';
import { HangarShipConfig } from '../hangar/hangar.types';
import { HangarPickerItem } from './stage/hangar-picker.component';
import { InfoNoteComponent } from '../shared/info-note.component';
import { DisplayStatGroup, toDisplayStatGroups } from './detail/stat-labels';
import { CodexShipStageComponent } from './detail/codex-ship-stage.component';
import { CodexVariantPickerComponent } from './detail/codex-variant-picker.component';
import { CodexShipActionsComponent } from './detail/codex-ship-actions.component';
import { CodexShipLinkFormComponent } from './detail/codex-ship-link-form.component';
import { CodexPortListComponent } from './detail/codex-port-list.component';
import { CodexSpecSheetComponent } from './detail/codex-spec-sheet.component';
import { CodexRecipeCardComponent, RecipeView } from './detail/codex-recipe-card.component';
import {
  HeroChip,
  Translate,
  ammoRangeOf,
  buildHeroChips,
  buildHeroFacts,
  buildShipFactGroups,
  buildStageCounts,
  fmtGm,
} from './detail/codex-detail-facts';
import { ShipLinkFormStore } from './detail/ship-link-form.store';
import { CodexLoadoutDraftStore } from './detail/codex-loadout-draft.store';
import {
  computeLoadoutStats,
  findStat,
  type ResolvedLoadoutLine,
} from '../hangar/loadout-stats';
import {
  DamageRow,
  HARDPOINT_CATEGORY_ORDER,
  HardpointCategory,
  SpecSection,
  StatRow,
  ammoDamage,
  categorizePort,
  cleanLocaleValue,
  curateComponentStats,
  flattenSpec,
  groupStatRows,
  humanizeClassName,
  formatCraftTime,
  formatNumber,
  formatQuality,
  formatQuantity,
  hasQualityRequirement,
  humanizePortType,
  ingredientRoleLabel,
  meaningfulRows,
  unescapeText,
} from './codex-format';
import {
  ammoClassNameFor,
  ammoClassNamesFor,
  damageChannelsOf,
  equippedStats,
  equippedStatsNoteKey,
  equippedTypeLabel,
  isWeaponMountPort,
  weaponStatsUnavailable,
} from './codex-equipped-stats';
import {
  ShipModuleSection,
  TAIL_SHIP_SECTIONS,
  classifyShipModule,
  shipModuleGroupOf,
  isConfigurableSection,
  isIndividualSection,
  shipPortFamily,
  classNamePositionFamily,
} from './ship-module-sections';

import {
  EmptyFit,
  Fact,
  GearRecipe,
  LoadoutItem,
  PortCompat,
  PortFit,
  PortGroup,
  ShipTechStats,
  StageCountChip,
} from './detail/codex-detail.types';
import { SkinOption, resolveSkinGroup } from './codex-skin-group';
import { EditionOption, resolveEditionGroup } from './codex-edition-group';
import { SummaryOccupant } from './ship-summary-panels';
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
  KpiShipInput,
  buildDefensivePanel,
  buildOffensivePanel,
  computeKpiSheet,
  crossSectionAxes,
  findArmorPayload,
} from './codex-loadout-stats';
import { CodexKpiBandComponent } from './codex-kpi-band.component';
import { CodexMissionBarComponent } from './codex-mission-bar.component';
import { buildKpiStrip, buildKpiStripForKeys, KpiStripCell } from './codex-kpi-sets';
import { isPassiveShield } from './codex-power';
import { groupOccupants } from './codex-fold-preview';
import type { PowerSheet } from './codex-power';
import { CodexEnergyDockComponent } from './codex-energy-dock.component';
import { CodexRankCardComponent } from './codex-rank-card.component';
import {
  RankProfileId,
  RankResult,
  RankScope,
  RankShipInput,
  RANK_SCOPE_ACCOUNT_KEY,
  parseRankScopePref,
  rankProfileDisabledReason,
  readRankScopePref,
  rankShip,
  resolveCareerLabel,
  writeRankScopePref,
} from './codex-rank';
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
import { CodexWeaponDetailComponent, WeaponDetailEntry } from './codex-weapon-detail.component';
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
import { ShipSkinViewerComponent } from './ship-skin-viewer.component';
import type { HardpointPortRef } from './hardpoint-port-ref';
import { CodexCategoryIconComponent } from './codex-category-icon.component';
import { FallbackImageComponent } from './fallback-image.component';
import { UpcomingShipsService } from './upcoming-ships.service';
import { ShipLinkService } from './ship-link.service';
import { AuthService } from '../auth/auth.service';
import { BuyOption, UexShopService } from './uex-shop.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NeuroFieldDirective } from '../core/neuro-field.directive';
import { HoloSilhouette } from './holo-silhouette';
import { CodexHoloStageComponent } from './holo/codex-holo-stage.component';
import { AssetPackageViewerComponent } from './asset-package/asset-package-viewer.component';
import { AssetPackageService } from './asset-package/asset-package.service';
import type { AssetPackageKind, AssetPackageRow } from './asset-package/asset-package.model';
import { ALL_KPI_KEYS } from './codex-build-compare';
import type { BuildRef, PortOccupantMap } from './codex-build-compare';
import type { HoloPatchComparisonSide } from './holo/codex-holo-patch.component';
import { PageHeaderComponent } from '../shared/page-header/page-header.component';
import { NavOriginService, PageCrumb, originTrail } from '../shared/page-header/nav-origin.service';
import { ClassChipComponent } from '../shared/class-chip/class-chip.component';

// Engine placeholders that identify no attach type — never build a fit on them.
const PLACEHOLDER_ATTACH_TYPE = new Set(['undefined', 'unknown', 'none', 'other']);

@Component({
  selector: 'sc-codex-detail',
  standalone: true,
  imports: [PageHeaderComponent, NeuroFieldDirective, RouterLink, TranslatePipe, CodexCompareTrayComponent, CodexHardpointLayoutComponent, CodexComponentModalComponent, CodexSwapPickerComponent, CodexWeaponDetailComponent, ShipHardpointMapComponent, ShipSkinViewerComponent, CodexCategoryIconComponent, FallbackImageComponent, CodexLoadoutSaveBarComponent, CodexKpiBandComponent, CodexMissionBarComponent, CodexOffensivePanelComponent, CodexDefensivePanelComponent, CodexShipPanelComponent, CodexRankCardComponent, CodexEnergyDockComponent, InfoNoteComponent, CodexHoloStageComponent, CodexShipStageComponent, CodexVariantPickerComponent, CodexShipActionsComponent, CodexShipLinkFormComponent, CodexPortListComponent, CodexSpecSheetComponent, CodexRecipeCardComponent, AssetPackageViewerComponent, NgTemplateOutlet, AddToSetComponent, ClassChipComponent],
  providers: [ShipLinkFormStore, CodexLoadoutDraftStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="detail-page">
      <sc-page-header class="crumbrow" [crumbs]="crumbs()" [rememberAs]="detail() ? displayName() : null">
        <div phAside class="crumb-aside">
        @if (kind() === 'ship' && dataPill(); as pill) {
          <span class="prov data-pill" [class.pending]="pill.pending">
            {{ 'codex.detail.dataPill' | translate: { build: pill.build, n: pill.schema } }}
            @if (pill.pending) { · {{ 'codex.detail.dataPillPending' | translate }} }
          </span>
        } @else if (kind() === 'ship' && provenance(); as p) {
          <span class="prov">
            {{ 'codex.provenance.build' | translate: { channel: p.channel, patch: p.patch, build: p.build } }}
          </span>
        }
        @if (kind() === 'ship') {
          <div class="holo-toggle" role="group" [attr.aria-label]="'codex.holo.toggle.group' | translate">
            <button type="button" class="ht-btn" [class.active]="!holoView()"
                    [attr.aria-pressed]="!holoView()"
                    (click)="holoView() && toggleHoloView()">
              {{ 'codex.holo.toggle.classic' | translate }}
            </button>
            <button type="button" class="ht-btn" [class.active]="holoView()"
                    [attr.aria-pressed]="holoView()"
                    (click)="!holoView() && toggleHoloView()">
              {{ 'codex.holo.toggle.holo' | translate }}
            </button>
          </div>
        }
        </div>
      </sc-page-header>

      @if (loading()) {
        <div class="sc-card skel-card sc-skel-field" scNeuroField></div>
      } @else if (error(); as err) {
        <div class="sc-card err" role="alert">
          <span><strong>{{ 'codex.error.title' | translate }}:</strong> {{ err | translate }}</span>
          @if (canRetry()) {
            <button type="button" class="retry" (click)="retryLoad()">{{ 'codex.error.retry' | translate }}</button>
          }
        </div>
      } @else if (!detail()) {
        <div class="sc-card empty">{{ 'codex.detail.notFound' | translate }}</div>
      } @else {
        <!-- Classic view. The Holotable view is the separate branch below;
             whatever both show (pickers, ship actions, link form, fixed
             systems, description, hardpoints, recipe, spec/raw) is a shared
             sub-component in detail/ or a shared ng-template at the end of
             this template, rendered in both branches (D17). -->
        @if (!(kind() === 'ship' && holoView())) {
        <!-- ── Masthead: hero | Einordnung, 1fr 1fr (MASTER §1/§3) ── -->
        <div class="m-top" [class.ship-mode]="kind() === 'ship'">
        <div class="hero-stack">
        <!-- ── Hero ───────────────────────────────────────────────────
             A ship gets the concept's BÜHNE (§2): the art fills the card, the
             manufacturer and the name sit on it top-left, the chips and the
             four frequent actions bottom-right. Everything that is not "which
             ship am I looking at?" — Ausführung, Lackierung, Port-Übersicht and
             the rarer actions — moved one row down into the flat tool row; the
             fact tiles moved into the Analyse card, quantum fuel and hydrogen
             included (they existed nowhere else on the page).
             Every other codex kind keeps the two-column hero it always had: it
             has no analysis card to move its facts into. ── -->
        <header class="hero sc-card" [class.bay]="kind() === 'ship'" [class.stage]="kind() === 'ship'">
          @if (kind() === 'ship') {
            <!-- Extracted to keep this file's component-style budget under the
                 Angular build budget (AUD-062) — same DOM, classes and
                 bindings as before, now behind sc-codex-ship-stage's own
                 inputs/outputs (see that component for detail). -->
            <sc-codex-ship-stage
              [kind]="detail()!.kind"
              [heroSub]="heroSub()"
              [heroArt]="heroArt()"
              [displayName]="displayName()"
              [heroView3d]="heroView3d()"
              [shipClassName]="shipClassName()"
              [hardpointPortRefs]="hardpointPortRefs()"
              [activePorts]="activePorts()"
              [has3dView]="has3dView()"
              [heroEyebrow]="heroEyebrow()"
              [heroChips]="heroChips()"
              [stageCounts]="stageCounts()"
              [shipPickerItems]="shipPickerItems()"
              (hovered)="setActivePorts($event)"
              (locatable)="glbLocatablePorts.set($event)"
              (artAvailable)="onArtAvailable($event)"
              (viewToggle)="toggleHeroView()"
              (hangarPick)="onShipPickerPick($event)"
              (hangarOpen)="onHangarPickerOpen()" />
          } @else {
          <figure class="hero-art" [class.icon-only]="heroArt().length === 0">
            <div class="art">
              <sc-fallback-image [candidates]="heroArt()" [alt]="displayName()" [eager]="true">
                <span class="art-fallback">
                  <sc-codex-icon class="hero-icon" [kind]="detail()!.kind" [sub]="heroSub()" [attachType]="heroAttachType()" />
                </span>
              </sc-fallback-image>
            </div>
          </figure>
          <div class="hero-body">
            <span class="kind-tag">{{ ('codex.kindSingular.' + detail()!.kind) | translate }}</span>
            <h1>{{ displayName() }}</h1>
            @if (manufacturerName(); as mfr) { <p class="mfr">{{ mfr }}</p> }
            <sc-class-chip class="cls" [value]="detail()!.classNameSlug" />

            <!-- Skin picker (feedback d5e39f86). The list collapses a weapon's
                 paint jobs into ONE entry, so this is where they stay
                 reachable. Native details for the fold; every option is a real
                 anchor to that record's own detail route, so a livery keeps a
                 shareable URL and middle-click still opens a tab. -->
            @if (skinOptions().length > 1) {
              <sc-codex-variant-picker variant="skin" [kind]="detail()!.kind" [currentSlug]="detail()!.classNameSlug"
                [options]="skinPickerOptions()" [current]="currentLivery()" />
            }

            <!-- Edition picker (feedback 77ecad2a). Same shape as the skin
                 picker above: a native details, options are real anchors. -->
            @if (editionOptions().length > 1) {
              <sc-codex-variant-picker variant="edition" [kind]="detail()!.kind" [currentSlug]="detail()!.classNameSlug"
                [options]="editionPickerOptions()" [current]="currentEdition()" />
            }

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

            <div class="hero-actions">
              <button type="button" class="pin" [class.pinned]="isPinned()" (click)="togglePin()">
                {{ isPinned() ? '★' : '☆' }} {{ (isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
              </button>
              <button type="button" class="pin" (click)="copyShareLink()">
                {{ 'codex.detail.actionCopyLink' | translate }}
                @if (linkCopied()) {
                  <span class="copy-toast" role="status">{{ 'codex.detail.linkCopied' | translate }}</span>
                }
              </button>
              <!-- L09: an on-foot piece goes into a set from its own page too. -->
              @if (fpsSetPiece(); as piece) {
                <sc-add-to-set [className]="piece.className" [kind]="piece.kind" [subType]="piece.subType"
                               [attachType]="piece.attachType" [itemName]="displayName()" />
              }
            </div>
          </div>
          }
        </header>

        @if (kind() === 'ship') {
          <!-- ── The four frequent actions, directly under the picture ─────
               They sat on the art until feedback 140dfb7e asked for every
               clickable thing except the 2D/3D switch to leave the image.
               One row, wraps on a phone. ── -->
          <div class="stage-actions">
            <button type="button" class="btn" [class.on]="isPinned()" (click)="togglePin()">
              <span aria-hidden="true">{{ isPinned() ? '★' : '☆' }}</span>
              {{ (isPinned() ? 'codex.compare.pinned' : 'codex.detail.actionCompare') | translate }}
            </button>
            <button type="button" class="btn" (click)="discardLoadoutDraft()">
              {{ 'codex.detail.actionFactoryLoadout' | translate }}
            </button>
            <button type="button" class="btn copy" (click)="copyShareLink()">
              {{ 'codex.detail.actionCopyLink' | translate }}
              @if (linkCopied()) {
                <span class="copy-toast" role="status">{{ 'codex.detail.linkCopied' | translate }}</span>
              }
            </button>
            <!-- Navigates, so it is an anchor and never a button (§2). -->
            <a class="btn on" [routerLink]="['/codex']" [queryParams]="{ kind: 'ship' }">
              {{ 'codex.detail.actionSwitchShip' | translate }} <span aria-hidden="true">⇄</span>
            </a>
          </div>

          <!-- ── WERKZEUGZEILE (decision 1, Variante B) ──────────────────
               One flat row under the actions: Ausführung, Lackierung and the
               rarer actions. Both pickers stay a single click away and their
               options are real anchors. The port overview moved up onto the
               stage (feedback 140dfb7e). ── -->
          <div class="toolrow">
            @if (editionOptions().length > 1) {
              <sc-codex-variant-picker class="in-toolrow" variant="edition" [kind]="detail()!.kind" [currentSlug]="detail()!.classNameSlug"
                [options]="editionPickerOptions()" [current]="currentEdition()" />
            }
            @if (skinOptions().length > 1) {
              <sc-codex-variant-picker class="in-toolrow" variant="skin" [kind]="detail()!.kind" [currentSlug]="detail()!.classNameSlug"
                [options]="skinPickerOptions()" [current]="currentLivery()" />
            }
            <sc-codex-ship-actions [classNameSlug]="detail()!.classNameSlug" [spacer]="true"
              [inHangar]="inHangar()" [addBusy]="addBusy()" [addFailed]="addFailed()"
              (addToHangar)="addToHangar()" />
          </div>

          <!-- Pin your own RSI pledge link (feedback f7d3bd9a). Private to
               you; an admin can publish one for everyone, never automatic. -->
          @if (shipLinkForm.open()) {
            <sc-codex-ship-link-form />
          }
        }
        </div>

        @if (kind() === 'ship') {
          <sc-codex-rank-card
            [shipName]="displayName()"
            [sizeClass]="null"
            [result]="rankResult()"
            [loading]="rankCohortLoading()"
            [profile]="rankProfile()"
            [scope]="rankScope()"
            [disabledReasons]="rankDisabledReasons()"
            (profileChange)="rankProfile.set($event)"
            (scopeChange)="setRankScope($event)" />
        }
        </div>


        <!-- ── Ships: KPI band + mission bar (PR C) ─────────────────
             Six headline numbers for the active mission, plus the profile
             chips that reorder/fold the loadout and analysis columns below.
             Supersedes the old three-panel "Kampfübersicht" (461288f9) — the
             new analysis column says the same things without duplicating
             the page. ───────────────────────────────────────────── -->
        @if (kind() === 'ship') {
          <sc-codex-kpi-band [cells]="kpiCells()" />
          <div class="mission-draft-bar">
            <sc-codex-mission-bar
              [active]="activeMissionId()"
              [capabilities]="shipCapabilities()"
              [changed]="draftChangedCount()"
              (missionChange)="setMission($event)" />
            <sc-codex-loadout-save-bar
              class="draft-controls"
              [changed]="draftChangedCount()"
              [saveable]="saveableEntries().length"
              [saving]="saving()"
              [error]="saveError()"
              [inHangar]="inHangar()"
              (save)="saveLoadoutDraft()"
              (discard)="discardLoadoutDraft()"
              (addAndSave)="saveLoadoutDraft()" />
          </div>
        }

        <!-- The old "Rumpf, Groesse und Flugeigenschaften" block stood here
             and is gone (decision 3, Variante A). It was a strict subset of the
             Analyse card's Schiff panel, which additionally explains every gap
             — and it was the wrong one: it summed the mass of the WERKS loadout
             while the card sums the mass of the ENTWURF, so after any swap the
             same page showed two different masses. One source now. -->

        <!-- ── Loadout | Analyse: two-column split (MASTER §1/§6/§7) ── -->
        <div class="m-cols" [class.single]="kind() !== 'ship' || moduleCount() < 4">
          <!-- ── Ship modules, configurable blocks first (461288f9), now
               mission-ordered/folded (PR C) ── -->
          @if (primaryModuleSections().length > 0) {
            <section class="sc-card block col-loadout">
              <h2 class="col-head">
                <span class="label">{{ 'codex.detail.columnLoadout' | translate }}</span>
                <span class="n">{{ moduleCount() }}</span>
                <!-- "What even IS a hardpoint?" — two paragraphs that used to
                     stand permanently between the heading and the modules
                     themselves. They answer a question you ask once, so they
                     moved behind the heading's own ⓘ (feedback dbdb2ffe:
                     *"Beschreibung oben in Loadout bitte als Tooltip
                     einfügen"*). sc-info-note is a real button with an Escape
                     and an outside-click dismiss, so the note is reachable by
                     keyboard and by touch — not a hover-only title. -->
                <sc-info-note class="head-note" [label]="'codex.detail.loadoutExplainerLabel' | translate">
                  <p>{{ 'codex.detail.hardpointExplainer' | translate }}</p>
                  <p>{{ 'codex.detail.moduleOrderHint' | translate }}</p>
                </sc-info-note>
                <span class="rule" aria-hidden="true"></span>
              </h2>
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
                [sections]="primaryModuleSections()"
                [sectionOrder]="moduleSectionOrder()"
                [foldedSections]="foldedModuleSections()"
                [occupantsBySection]="occupantsBySection()"
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
            <div class="analysis-col col-analyse">
              <h2 class="col-head">
                <span class="label">{{ 'codex.detail.columnAnalysis' | translate }}</span>
                <span class="n">3</span>
                <span class="rule" aria-hidden="true"></span>
              </h2>
              <sc-codex-offensive-panel [panel]="offensivePanel()" [startCollapsed]="offensiveStartsCollapsed()" />
              <sc-codex-defensive-panel [panel]="defensivePanel()" />
              <sc-codex-ship-panel [groups]="shipFactGroups()" />
            </div>
          }
        </div>

        <!-- ── Below the concept skeleton ─────────────────────────
             The concept draws exactly crumbrow › m-top › m-kpis ›
             m-mission › m-cols › mini-dock (#t1, confirmed by #f1/#h1).
             Everything this app adds on top lives BELOW that skeleton,
             so the KPI strip is the third block on the page and starts
             sticking near the top instead of a thousand pixels down. -->
        <!-- ── Ship liveries — always-on 3D view at hero level (#137 part 2) ──
             Moved directly beneath the hero so the interactive 3D model stays
             on-screen (RSI-site feel) instead of being buried below the spec
             sheet. The viewer itself keeps its deliberate lazy-load: expanded
             by default on desktop (the ~3 MB glb loads immediately), collapsed
             by default on mobile (opened on demand to spare cellular data).
             Comparison is intentionally NOT duplicated here — the existing
             floating compare tray (<sc-codex-compare-tray/>, pinned via the hero
             ★ action) is the single comparison surface.
             Placement is unchanged (decision 4, Variante C). The one thing
             that moves it is the hero's own 2D/3D switch: while the stage shows
             the model, this section steps aside so the ~3 MB glb is never
             loaded twice, and it comes straight back on the way to 2D. -->
        <!-- @defer makes the viewer (model-viewer + three, ~470 kB) its own
             chunk that only a ship page loads (AUD-048). No sized placeholder:
             the viewer itself renders nothing until its skin list arrives, so
             a reserved height would only add a jump for a ship without skins. -->
        @if (shipClassName(); as cls) {
          @if (!heroView3d()) {
            @defer (on immediate) {
              <sc-ship-skin-viewer
                [shipId]="cls"
                [hardpointPorts]="hardpointPortRefs()"
                [activePorts]="activePorts()"
                (hovered)="setActivePorts($event)"
                (locatable)="glbLocatablePorts.set($event)"
                (available)="onArtAvailable($event)" />
            }
          }
        }

        <ng-container [ngTemplateOutlet]="tailLoadout" />

        <!-- ── Description ───────────────────────────────────────── -->
        <ng-container [ngTemplateOutlet]="descriptionCard" />

        <!-- ── Where to buy (#254/#255): UEX Corp purchase locations for FPS
             armor pieces and personal weapons. Best-effort — the section only
             appears for the relevant kinds and quietly shows "no data" rather
             than an error state for anything unmatched. ───────────────── -->
        @if (itemPackage(); as pkg) {
          <section class="sc-card block pkg-block">
            <h2>{{ 'codex.assetPackage.title' | translate }}</h2>
            @defer (on viewport) {
              <sc-asset-package-viewer class="pkg-viewer" [row]="pkg" [still]="prefersReducedMotion()" />
            } @placeholder {
              <div class="pkg-viewer" aria-hidden="true"></div>
            }
          </section>
        }

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
                  <div class="stat"><span class="s-label">{{ s.i18nKey ? (s.i18nKey | translate) : s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
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
                  <div class="stat"><span class="s-label">{{ s.i18nKey ? (s.i18nKey | translate) : s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
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
                  <div class="stat"><span class="s-label">{{ s.i18nKey ? (s.i18nKey | translate) : s.key }}</span><span class="s-value">{{ s.value }}@if (s.unit) {<span class="s-unit"> {{ s.unit }}</span>}</span></div>
                }
              </div>
            }
          </section>
        }

        <!-- ── Hardpoints, grouped by category ───────────────────── -->
        @if (hardpointGroups().length > 0) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ detail()!.ports.length }}</span></h2>
            <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
            <sc-codex-port-list
              [groups]="hardpointGroups()"
              [frame]="hardpointFrame()"
              [showMap]="!hasLoadoutSection()"
              [markers]="hardpointMarkers()"
              [activePorts]="activePorts()"
              [locatablePorts]="locatablePorts()"
              [expandedPort]="expandedPort()"
              [compat]="compatByPort()"
              (portToggle)="togglePort($event)"
              (hovered)="setActivePorts($event)" />
          </section>
        }

        <!-- ── Crafting recipe: what this item costs to make (#187) ─ -->
        @if (recipeView(); as rv) {
          <sc-codex-recipe-card [recipe]="rv" />
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
        <sc-codex-spec-sheet
          [sections]="specSections()"
          [showSpec]="showSpec()"
          [showRaw]="showRaw()"
          [rawJson]="rawJson()"
          [provenance]="provenance()"
          (toggleSpec)="toggleSpec()"
          (toggleRaw)="toggleRaw()" />
        } @else {
          <sc-codex-holo-stage animate.enter="view-in"
            [detail]="detail()!"
            [displayName]="displayName()"
            [manufacturerName]="manufacturerName()"
            [stageCounts]="stageCounts()"
            [activePorts]="activePorts()"
            [locatablePorts]="locatablePorts()"
            [primaryModuleSections]="primaryModuleSections()"
            [tailModuleSections]="tailModuleSections()"
            [occupantsBySection]="occupantsBySection()"
            [foldedModuleSections]="foldedModuleSections()"
            [silhouette]="shipSilhouette()"
            [kpiCells]="kpiCells()"
            [activeMissionId]="activeMissionId()"
            [shipCapabilities]="shipCapabilities()"
            [draftChangedCount]="draftChangedCount()"
            [rankResult]="rankResult()"
            [rankLoading]="rankCohortLoading()"
            [rankProfile]="rankProfile()"
            [rankScope]="rankScope()"
            [rankDisabledReasons]="rankDisabledReasons()"
            [offensivePanel]="offensivePanel()"
            [defensivePanel]="defensivePanel()"
            [shipFactGroups]="shipFactGroups()"
            [reducedMotion]="prefersReducedMotion()"
            [seenThisSession]="holoSeenThisSession()"
            [rankCohort]="rankCohort()"
            [recentlyViewedShips]="recentlyViewedShips()"
            [hangarShipClassNames]="hangarShipClassNames()"
            [hardpointPortRefs]="hardpointPortRefs()"
            [hardpointFrame]="hardpointFrame()"
            [hardpointMarkers]="hardpointMarkers()"
            [shipClassName]="shipClassName()"
            [saveableCount]="saveableEntries().length"
            [saving]="saving()"
            [saveError]="saveError()"
            [inHangar]="inHangar()"
            [buildRef]="patchActiveBuild()"
            [channel]="build()?.channel ?? 'LIVE'"
            [activeKpiSheet]="stockKpiSheet()"
            [activeOccupants]="patchActiveOccupants()"
            [resolveComparisonSide]="resolvePatchComparisonSide"
            [myConfig]="activeHangarConfig()"
            [patchVersion]="build()?.patchVersion ?? ''"
            [occupants]="draftSummaryOccupants()"
            [shipStats]="shipPayload()?.stats ?? null"
            [schemaVersion]="build()?.schemaVersion ?? null"
            [userId]="currentUserId()"
            [crossSection]="crossSectionMax()"
            [heroChips]="heroChips()"
            [hangarPickerItems]="shipPickerItems()"
            (hangarPick)="onShipPickerPick($event)"
            (hangarOpen)="onHangarPickerOpen()"
            [allKpiCells]="allKpiCells()"
            [heroArt]="heroArt()"
            [previewSilhouette]="previewSilhouetteUrl()"
            (hovered)="setActivePorts($event)"
            (inspected)="openInspect($event)"
            (swapRequested)="openSwapPicker($event)"
            (reverted)="onRevertPaths($event)"
            (missionChange)="setMission($event)"
            (rankProfileChange)="rankProfile.set($event)"
            (rankScopeChange)="setRankScope($event)"
            (addToHangar)="addToHangar()"
            [addBusy]="addBusy()"
            [addFailed]="addFailed()"
            (saveDraft)="saveLoadoutDraft()"
            (discardDraft)="discardLoadoutDraft()"
            (configRefreshed)="activeHangarConfig.set($event)"
            (locatable)="glbLocatablePorts.set($event)"
            (sheetChange)="powerSheet.set($event)"
            (arrivedShip)="onHoloArrived($event)"
            [linkCopied]="linkCopied()"
            (copyShareLink)="copyShareLink()">
            <!-- Details drawer content, projected into the Holotable: the
                 shared sub-components in detail/ and the shared ng-templates,
                 rendered in both branches, on the SAME signals/methods as the
                 classic view (item B "present, not hidden behind a code
                 path"). -->
            <div class="holo-details-pickers">
              @if (editionOptions().length > 1) {
                <sc-codex-variant-picker variant="edition" [kind]="detail()!.kind" [currentSlug]="detail()!.classNameSlug"
                  [options]="editionPickerOptions()" [current]="currentEdition()" />
              }
              @if (skinOptions().length > 1) {
                <sc-codex-variant-picker variant="skin" [kind]="detail()!.kind" [currentSlug]="detail()!.classNameSlug"
                  [options]="skinPickerOptions()" [current]="currentLivery()" />
              }
              <sc-codex-ship-actions [classNameSlug]="detail()!.classNameSlug"
                [inHangar]="inHangar()" [addBusy]="addBusy()" [addFailed]="addFailed()"
                (addToHangar)="addToHangar()" />
              <!-- Pin to the compare tray (the classic view pins from its stage actions). -->
              <button type="button" class="pin" [class.pinned]="isPinned()" [attr.aria-pressed]="isPinned()" (click)="togglePin()">
                {{ isPinned() ? '★' : '☆' }} {{ (isPinned() ? 'codex.compare.pinned' : 'codex.compare.pin') | translate }}
              </button>
            </div>
            @if (shipLinkForm.open()) {
              <sc-codex-ship-link-form />
            }
            <ng-container [ngTemplateOutlet]="tailLoadout" />
            <ng-container [ngTemplateOutlet]="descriptionCard" />
            @if (recipeView(); as rv) {
              <sc-codex-recipe-card [recipe]="rv" />
            }
            @if (hardpointGroups().length > 0) {
              <section class="sc-card block">
                <h2>{{ 'codex.detail.hardpoints' | translate }} <span class="ct">{{ detail()!.ports.length }}</span></h2>
                <p class="hint">{{ 'codex.detail.hardpointsHint' | translate }}</p>
                <sc-codex-port-list
                  [groups]="hardpointGroups()"
                  [frame]="hardpointFrame()"
                  [showMap]="!hasLoadoutSection()"
                  [markers]="hardpointMarkers()"
                  [activePorts]="activePorts()"
                  [locatablePorts]="locatablePorts()"
                  [expandedPort]="expandedPort()"
                  [compat]="compatByPort()"
                  (portToggle)="togglePort($event)"
                  (hovered)="setActivePorts($event)" />
              </section>
            }
            <sc-codex-spec-sheet
              [sections]="specSections()"
              [showSpec]="showSpec()"
              [showRaw]="showRaw()"
              [rawJson]="rawJson()"
              [provenance]="provenance()"
              (toggleSpec)="toggleSpec()"
              (toggleRaw)="toggleRaw()" />
          </sc-codex-holo-stage>
        }
        <!-- The dock is the LAST element, as the concept places it
             (#f1/#h1: mini-dock closes m-wrap). It is position:sticky,
             so wherever it sits it keeps that much space in the flow —
             placed early that space is a hole between the mission bar
             and the columns; placed last there is nothing to hollow. -->
        @if (kind() === 'ship' && !holoView()) {
            <sc-codex-energy-dock
              [occupants]="draftSummaryOccupants()"
              [shipStats]="shipPayload()?.stats ?? null"
              [shipClassName]="shipClassName()"
              [schemaVersion]="build()?.schemaVersion ?? null"
              [userId]="currentUserId()"
              [crossSection]="crossSectionMax()"
              (sheetChange)="powerSheet.set($event)" />
        }
      }

      <sc-codex-compare-tray />

      <!-- Full stat sheet for one clicked module (461288f9). Rendered last so
           its fixed-position backdrop sits above everything on the page. -->
      <sc-codex-component-modal [entry]="inspected()" (closed)="closeInspect()" />
      <sc-codex-swap-picker [target]="swapTarget()" (closed)="swapTarget.set(null)" (picked)="onSwapPicked($event)" />
      <sc-codex-weapon-detail [entry]="weaponDetail()" (closed)="closeWeaponDetail()" />

      <!-- Shared by the classic view and the Holotable drawer, which renders
           them into its projected details (same view, so these rules stay
           in this component's style block). -->
      <!-- ── Zelle & feste Systeme — BELOW the paints block (feedback #236:
           the airframe is not a decision; see TAIL_SHIP_SECTIONS in
           ship-module-sections.ts — the countermeasures moved back up into
           the loadout card with #237, now that their rounds carry values).
           Same layout component as the loadout card above, fed the tail
           sections instead. -->
      <ng-template #tailLoadout>
        @if (tailModuleSections().length > 0) {
          <section class="sc-card block col-loadout col-loadout-tail">
            <h2 class="col-head">
              <span class="label">{{ 'codex.detail.columnFixed' | translate }}</span>
              <span class="n">{{ tailModuleCount() }}</span>
              <span class="rule" aria-hidden="true"></span>
              @if (hiddenEmptyCount() > 0) {
                <button type="button" class="ghost-toggle" (click)="toggleEmptyLoadout()">
                  {{ (showEmptyLoadout() ? 'codex.detail.hideEmptyPorts' : 'codex.detail.showEmptyPorts') | translate: { count: hiddenEmptyCount() } }}
                </button>
              }
            </h2>
            <sc-codex-hardpoint-layout
              [sections]="tailModuleSections()"
              [sectionOrder]="moduleSectionOrder()"
              [foldedSections]="foldedModuleSections()"
              [occupantsBySection]="occupantsBySection()"
              [locatablePorts]="locatablePorts()"
              [activePorts]="activePorts()"
              (reverted)="onRevertPaths($event)"
              (hovered)="setActivePorts($event)"
              (inspected)="openInspect($event)"
              (swapRequested)="openSwapPicker($event)" />
          </section>
        }
      </ng-template>
      <ng-template #descriptionCard>
        @if (description(); as d) {
          <section class="sc-card block">
            <h2>{{ 'codex.detail.description' | translate }}</h2>
            <p class="desc">{{ d }}</p>
          </section>
        }
      </ng-template>
    </section>
  `,
  styles: [`
    :host { display: block; }
    /* The full page frame (styles.scss, "PAGE FRAME") — no width of its own. */
    .detail-page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 90px; }
    /* The Holotable's strip is sticky IN the flow — no dock to leave room for. */
    .detail-page:has(sc-codex-holo-stage) { padding-bottom: 16px; }
    /* Card chrome, concept part-02:140 (.m-card): a 4px corner and a flat
       surface - the mock draws no glow at all. The app-wide .sc-card keeps its
       8px radius and its cyan halo everywhere else; only this page is redrawn,
       so the rule is scoped instead of edited globally. */
    .detail-page .sc-card,
    .detail-page .sc-card.block { border-radius: 4px; box-shadow: none; }
    .crumbrow { margin-bottom: 10px; }
    .crumb-aside { display: flex; align-items: center; gap: 10px 16px; flex-wrap: wrap; }
    .holo-toggle { display: flex; border: 1px solid var(--sc-border); border-radius: var(--holo-r); overflow: hidden; }
    .ht-btn { min-height: var(--sc-tap-min, 32px); padding: 4px 12px; background: var(--sc-bg-2); border: none; color: var(--sc-fg-1); cursor: pointer; font: inherit; font-size: max(11px, var(--sc-fs-floor));
      transition: background var(--holo-t-fast) ease, color var(--holo-t-fast) ease; }
    .ht-btn:not(.active):hover { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-2)); }
    .ht-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .ht-btn.active { background: var(--sc-accent); color: var(--sc-bg-0); }
    /* Switching into the Holotable fades it in — never a hard cut. */
    .view-in { animation: view-in var(--holo-t-base) var(--holo-e-out); }
    @keyframes view-in { from { opacity: 0; transform: translateY(var(--holo-rise)); } }
    @media (prefers-reduced-motion: reduce) { .view-in { animation: none; } .ht-btn { transition: none; } }

    /* Masthead: hero | Einordnung (MASTER §1/§3) */
    .m-top { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
    .m-top.ship-mode { grid-template-columns: 1fr 1fr; }

    /* Loadout | Analyse (MASTER §1/§6/§7) */
    .m-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
    .m-cols.single { grid-template-columns: 1fr; }
    /* Concept part-02:197 (.m-colhead): 10px at .16em, and MUTED - it is a
       divider label, not a headline, so the accent stays with the card titles
       it sits above. The count next to it is the mock's bordered 2px box
       (part-02:198), not a filled badge. */
    .col-head { margin: 0 0 5px; font-size: max(10px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.16em;
      padding-bottom: 0; color: var(--sc-fg-2);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .col-head .label { color: var(--sc-fg-2); }
    .col-head .n { display: inline-flex; align-items: center; justify-content: center;
      padding: 0 4px; border-radius: 2px; background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-size: max(10px, var(--sc-fs-floor)); }
    .col-head .rule { flex: 1 1 auto; height: 1px; background: var(--sc-border); }
    .col-head .ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    /* The loadout explainer's ⓘ sits with the heading, not with the rule that
       runs out to the card edge — and its note carries running prose, so the
       heading's uppercase/tracking must not leak into it. */
    .col-head .head-note { flex: 0 0 auto; text-transform: none; letter-spacing: normal; }
    .col-head .head-note p { margin: 0 0 6px; }
    .col-head .head-note p:last-child { margin-bottom: 0; }
    .col-analyse { display: flex; flex-direction: column; gap: 12px; }

    @media (max-width: 1100px) {
      .m-top.ship-mode { grid-template-columns: 1fr; }
      .m-cols { grid-template-columns: 1fr; }
    }

    /* Mission + draft bar (MASTER §5): the lens chips share their row with the
       loadout draft's persistence/discard/apply controls. */
    .mission-draft-bar { display: flex; align-items: center; justify-content: space-between;
      gap: 12px; flex-wrap: wrap; }
    .mission-draft-bar sc-codex-mission-bar { flex: 1 1 auto; min-width: 0; }
    .draft-controls { flex: 0 0 auto; }

    /* The ship stage's own hero chip row (.hchip, career/role/crew/cargo/mass)
       moved to sc-codex-ship-stage (AUD-062) along with everything else the
       stage renders — nothing else on this page uses that class. */

    /* Data provenance pill: gold when a re-extract is pending (MASTER §2/§11). */
    .data-pill.pending { color: var(--sc-warn); border: 1px dashed color-mix(in srgb, var(--sc-warn) 45%, transparent);
      border-radius: 999px; padding: 3px 10px; background: color-mix(in srgb, var(--sc-warn) 10%, transparent); }

    /* The hero and the tool row are one unit and share the masthead's left
       half, so the row sits directly under the stage rather than in the next
       grid track. */
    .hero-stack { display: flex; flex-direction: column; gap: 10px; min-width: 0; }

    /* ── BUEHNE (concept section 2) ── sc-codex-ship-stage (AUD-062) renders
       with display:contents inside this header, so its content becomes this
       grid's own items; only the card chrome (the 246px grid, the bottom-wash
       pseudo) stays here — the stage's own rules moved with its template. */
    .hero.stage { display: grid; grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(56px, 1fr) auto; position: relative;
      min-height: 246px; padding: 12px 14px;
      overflow: hidden; background: var(--sc-bg-1); }
    /* The art is the card; everything readable sits in the band at its foot,
       so the wash comes up from the bottom instead of across the diagonal —
       the same shape a codex fleet tile uses for its caption. */
    .hero.stage::before { content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(to top, color-mix(in srgb, var(--sc-bg-0) 94%, transparent) 0%,
        color-mix(in srgb, var(--sc-bg-0) 72%, transparent) 34%, transparent 68%); }

    /* The four frequent actions in their own row directly under the stage. */
    .stage-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    /* The one button on this page (concept section 2, part-02:159). Never the
       hot accent: nothing here is admin-gated. A 3px rectangle with a 10px
       uppercase label at .12em - the mock's button, not a pill.
       The hero actions used to keep a compact size of their own right here;
       they no longer need to, because this rule IS the concept's button at
       every occurrence, so the four German labels on the half-width hero and
       the ones in the tool row are one and the same control. */
    .btn, .pin { position: relative; display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 8px; min-height: 48px;
      border: 1px solid var(--sc-border); border-radius: 3px;
      background: color-mix(in srgb, var(--sc-bg-0) 72%, transparent);
      color: var(--sc-fg-2); font-family: var(--sc-font-display); text-decoration: none;
      font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase;
      cursor: pointer; }
    /* The mock draws this button about 24px tall. A mouse gets exactly that;
       coarse pointers - and therefore the mobile gate, which emulates one -
       keep the 48px floor declared above. */
    @media (pointer: fine) {
      .btn, .pin { min-height: 24px; }
    }
    .btn:hover, .pin:hover { color: var(--sc-fg-0);
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); }
    .btn.on, .pin.pinned { color: var(--sc-accent);
      border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
    .btn:focus-visible, .pin:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .btn:disabled, .pin:disabled { opacity: 0.38; cursor: not-allowed; }
    .btn.quiet { text-transform: none; letter-spacing: 0; background: transparent; }

    /* The 2D/3D switch (.view-switch) moved to sc-codex-ship-stage — see
       codex-ship-stage.component.ts. */

    /* ── WERKZEUGZEILE ────────────────────────────────────────────────────
       One flat row, no card: Ausfuehrung, Lackierung, then the rarer actions
       pushed to the end (the module census sits on the stage now). */
    .toolrow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      padding: 6px 2px; border-top: 1px solid var(--sc-border); }
    /* The spacer that pushes the rarer actions to the row's end lives in
       sc-codex-ship-actions (display:contents keeps it in this flex row). */
    /* The pickers' tool-row sizing lives in sc-codex-variant-picker
       (:host(.in-toolrow)). */

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
    /* Non-ship previews are 64px UI renders: shown at native size they sat as a
       speck in a 320px frame. Scale them up to a readable hero size. */
    .hero:not(.bay) .hero-art { --sc-img-w: min(60%, 168px); }
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
    .hero-art .hero-icon { width: 100%; min-height: 120px; }
    .hero-body { padding: 22px 24px 22px 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    .kind-tag { align-self: flex-start; font-size: max(0.64rem, var(--sc-fs-floor)); padding: 3px 10px; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.1em;
      background: color-mix(in srgb, var(--sc-accent) 16%, transparent); border: 1px solid color-mix(in srgb, var(--sc-accent) 35%, transparent); color: var(--sc-accent); }
    .hero-body h1 { margin: 2px 0 0; font-size: 1.7rem; line-height: 1.15; overflow-wrap: anywhere; }
    .hero-body .mfr { margin: 0; color: var(--sc-fg-1); font-size: 0.96rem; overflow-wrap: anywhere; }
    .cls { align-self: flex-start; }

    /* Skin / edition picker: sc-codex-variant-picker owns its rules. */

    .facts { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
    .fact { display: flex; flex-direction: column; gap: 1px; padding: 6px 12px; border-radius: 8px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); }
    .fact.accent { border-color: color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    .f-label { font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2); }
    .f-value { font-size: 0.9rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); }
    .fact.accent .f-value { color: var(--sc-accent); }

    /* Module census (bottom-right of the stage): .loadout-summary/.ls-* moved
       to sc-codex-ship-stage along with the template that uses them — no
       other section on this page renders that vocabulary. */

    .hero-actions { display: flex; align-items: center; gap: 14px; margin-top: auto; padding-top: 12px; flex-wrap: wrap; }
    .copy-toast { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%);
      background: var(--sc-bg-1, #14161b); color: var(--sc-fg-1); border: 1px solid var(--sc-accent);
      border-radius: var(--radius-sm, 4px); padding: 2px 8px; font-size: max(0.7rem, var(--sc-fs-floor)); white-space: nowrap; pointer-events: none; }

    /* .ship-link-form / .sl-*: sc-codex-ship-link-form. */
    .prov { font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }

    /* Generic block. The card title is the mock's .m-h2 (part-02:141):
       10.5px at .14em, semibold, accent. */
    .block { padding: 16px 18px; }
    .pkg-viewer { display: block; height: clamp(18rem, 45vh, 32rem); }
    .block h2 { margin: 0 0 12px; font-size: max(10.5px, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.14em; font-weight: 600; color: var(--sc-accent);
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .block h2 .ct { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .desc { margin: 0; color: var(--sc-fg-1); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }

    /* Stat grid (components / weapons), grouped by purpose */
    .sg-head { margin: 14px 0 8px; font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em;
      color: var(--sc-fg-1); display: flex; align-items: center; gap: 8px; }
    .sg-head::after { content: ''; flex: 1; height: 1px; background: var(--sc-border); }
    .sg-head:first-of-type { margin-top: 0; }
    /* The category icon's weapon orange — one orange for "offense", well clear of the admin red. */
    .sg-head[data-purpose="offense"] { color: var(--sc-offense); }
    .sg-head[data-purpose="defense"] { color: var(--sc-accent); }
    .stat-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
    .stat-grid + .sg-head { margin-top: 14px; }
    /* min-width + anywhere: armour and FPS weapons carry long unbroken labels
       and values ("Radiation Resistance.Maximum Radiation Capacity",
       "playerhits_armour_light") that pushed the tile out of its track — on a
       phone the whole detail page then scrolled sideways (feedback #196). */
    .stat { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); min-width: 0; }
    .s-label { font-size: max(0.66rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .s-value { font-size: 1.05rem; color: var(--sc-fg-0); font-family: var(--sc-font-display); overflow-wrap: anywhere; }
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
    .dmg[data-ch="physical"] .dmg-fill { background: var(--sc-offense); }
    .dmg[data-ch="thermal"] .dmg-fill { background: #ff5252; }
    .dmg[data-ch="distortion"] .dmg-fill { background: #a674ff; }
    .dmg[data-ch="biochemical"] .dmg-fill { background: #5fd35f; }
    .dmg[data-ch="stun"] .dmg-fill { background: #f0c419; }
    .dmg-val { font-size: 0.84rem; text-align: right; color: var(--sc-fg-0); font-family: var(--sc-font-display); }

    /* Hardpoint groups (.hp-*, .compat): sc-codex-port-list. */

    /* Size / grade / type tokens inside a slot row. The mock draws these as
       .sz and .gr (part-02:216-217): a bordered 2px box, 10px, no fill and no
       uppercasing - a part name or a humanised type must not be shouted. */
    .chip { font-size: max(10px, var(--sc-fs-floor)); padding: 0 3px; border-radius: 2px; background: transparent; color: var(--sc-fg-1); border: 1px solid var(--sc-border); white-space: nowrap; }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.82rem; }
    .hint { color: var(--sc-fg-2); margin: 0 0 12px; font-size: max(0.74rem, var(--sc-fs-floor)); }
    /* Data-gap disclosure: visible enough to be read, quiet enough not to
       look like an app error — the data is missing, nothing is broken. */
    .hint.warn { border-left: 2px solid color-mix(in srgb, var(--sc-warn, #e8a33d) 60%, transparent);
      padding-left: 8px; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
    .compat-link:hover { text-decoration: underline; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }

    .ghost-toggle { margin-left: auto; padding: 3px 10px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-border);
      color: var(--sc-fg-2); font-family: inherit; font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: none; letter-spacing: 0; cursor: pointer; }
    .ghost-toggle:hover { color: var(--sc-accent); border-color: var(--sc-accent); }

    /* Spec sheet + raw payload (.raw-block, .spec*, .sp-key/.sp-val, .raw):
       sc-codex-spec-sheet. */

    .skel-card { height: 260px; }
    /* No own padding: .sc-card's density scale (--sc-pad-1) tightens it on phones. */
    .err { color: var(--sc-danger); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .err .retry { margin-left: auto; padding: 6px 14px; border-radius: 6px; background: transparent; border: 1px solid var(--sc-danger); color: var(--sc-danger); cursor: pointer; font-family: inherit; }
    .err .retry:hover { background: color-mix(in srgb, var(--sc-danger) 12%, transparent); }
    .err .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }
    .empty { text-align: center; padding: 40px; color: var(--sc-fg-2); }

    @media (max-width: 760px) {
      .hero { grid-template-columns: 1fr; }
      .hero-art { min-height: 180px; }
      .hero-body { padding: 20px; }
      .dmg { grid-template-columns: 84px 1fr 56px; }
      /* A phone has no room for four overlays on one picture: the stage keeps
         the art and the name, and hands chips and actions to normal flow
         underneath it. Nothing is dropped, nothing overlaps. The stage's own
         rules for this breakpoint live in sc-codex-ship-stage now; only the
         card chrome (grid → flex, the wash's height) stays here. */
      .hero.stage { display: flex; flex-direction: column; min-height: 0; padding: 0; gap: 0; }
      .hero.stage::before { inset: 0 0 auto 0; height: 190px; }
      .stage-actions .btn { flex: 1 1 auto; justify-content: center; }
    }
    @media (max-width: 400px) {
      .hero-body { padding: 16px; }
      .hero-body h1 { font-size: 1.4rem; }
      .stat-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
    }
  `],
})
/**
 * The codex detail page (/codex/:kind/:className): every catalog kind, and for
 * ships the classic view plus the Holotable.
 *
 * What lives where (D17, AUD-090):
 * - detail/codex-detail.types.ts — the page's shared types (StageCountChip, …)
 * - detail/codex-ship-stage.component.ts — the ship hero stage (AUD-062)
 * - detail/codex-variant-picker.component.ts — skin and edition pickers
 * - detail/codex-ship-actions.component.ts + codex-ship-link-form.component.ts
 *   — tool-row actions and the RSI pledge-link form, state in
 *   detail/ship-link-form.store.ts (provided here)
 * - detail/codex-port-list.component.ts — the Hardpoints card body
 * - detail/codex-spec-sheet.component.ts, codex-recipe-card.component.ts
 * - detail/codex-detail-facts.ts — pure builders for facts, chips, the Schiff
 *   panel and the stage census
 * - detail/codex-loadout-draft.store.ts — the loadout draft: state, hydration,
 *   URL/localStorage mirror, save (provided here)
 * This component keeps loading, the derived loadout views and the wiring.
 */
export class CodexDetailComponent implements OnInit {
  private readonly svc = inject(CodexService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly t = inject(TranslateService);
  private readonly hangar = inject(HangarService);
  // RSI ship-matrix artwork — the hero's primary art source for ships.
  private readonly rsi = inject(UpcomingShipsService);
  // User-supplied RSI pledge links (feedback f7d3bd9a): the page loads them per
  // ship; the form and the actions read them through ShipLinkFormStore.
  private readonly shipLinks = inject(ShipLinkService);
  private readonly auth = inject(AuthService);
  private readonly uexShop = inject(UexShopService);
  private readonly draftStore = inject(CodexLoadoutDraftStore);

  readonly detail = signal<CodexDetail | null>(null);
  private readonly navOrigin = inject(NavOriginService);
  /**
   * Codex › where the reader came from (the index with its filters, the FPS
   * list, the ship a component was opened from) — or, on a deep link, the
   * index of this entry's category.
   */
  readonly crumbs = computed<PageCrumb[]>(() => {
    const kind = this.kind() ?? (this.route.snapshot.paramMap.get('kind') as CodexKind | null);
    const fallback: PageCrumb | null =
      kind && CODEX_KINDS.includes(kind)
        ? { labelKey: `codex.kinds.${kind}`, link: '/codex/index', queryParams: { kind } }
        : null;
    return originTrail(this.navOrigin, fallback);
  });
  readonly kind = computed(() => this.detail()?.kind ?? null);
  /** Ship pages only: whether this ship is already in the user's hangar. */
  readonly inHangar = computed(() => {
    const d = this.detail();
    return !!d && this.hangar.ships().some((s) => s.shipClassName === d.classNameSlug);
  });
  /**
   * Which view the hero stage shows. 2D is the default — the store render is
   * the picture of the ship, and it costs nothing. The switch on the card
   * swaps in the interactive model, and the standalone livery section below
   * steps aside while it does, so only one glb is ever live (see the template).
   */
  readonly heroView3d = signal(false);
  /** The skin catalog actually has a 3D model — no model, no switch. */
  readonly has3dView = signal(false);

  toggleHeroView(): void {
    this.heroView3d.update((v) => !v);
  }

  /**
   * Availability LATCHES. A freshly mounted viewer reports "no model" for one
   * turn while its catalog request is still in flight — and the viewer remounts
   * every time the switch is pressed, because it moves between the stage and
   * the livery section. Without the latch the switch would vanish under the
   * user's finger the moment they pressed it, stranding them in 3D. Cleared
   * only when the page loads a different ship (see load()).
   */
  onArtAvailable(available: boolean): void {
    if (available) this.has3dView.set(true);
  }

  /**
   * The Holotable / classic view toggle. Default = the Holotable (the only
   * ship view from 0.115.0 until the classic one came back as an opt-in).
   * Persisted per user in localStorage; the URL `?view=classic` mirrors the
   * non-default choice and WINS on load (as does `?view=holo`), so a shared
   * deep-link always lands in the view it was copied from. Ship kind only —
   * every other codex kind never reads or writes this at all, so their pages
   * stay byte-for-byte unaffected regardless of what is in storage.
   */
  readonly holoView = signal(true);
  private static readonly HOLO_VIEW_STORAGE_KEY = 'sc.codex.holoView';
  /** Wave 2 arrival animation: cut to "already arrived" on a repeat visit
   * within the same tab session (concept: "repeat visit in the session =
   * cut only"). */
  private readonly holoSeenShips = signal<ReadonlySet<string>>(new Set<string>());

  private initHoloView(_className: string): void {
    const fromUrl = this.route.snapshot.queryParamMap.get('view');
    if (fromUrl === 'holo') {
      this.holoView.set(true);
    } else if (fromUrl === 'classic') {
      this.holoView.set(false);
    } else {
      try {
        this.holoView.set(localStorage.getItem(CodexDetailComponent.HOLO_VIEW_STORAGE_KEY) !== 'classic');
      } catch {
        this.holoView.set(true);
      }
      // The stored preference is mirrored INTO the url (wave 5 A1.2): what
      // the visitor sees is what "Link kopieren" hands on — a recipient with
      // no stored preference must land in the same view.
      if (!this.holoView()) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { view: 'classic' },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    }
    // "Seen this session" is recorded by the stage once its arrival played
    // (`onHoloArrived`) — never here, or the arrival would be cut on the very
    // first visit (wave 5 A3.1).
  }

  /** The Holotable finished its arrival for `slug` — a return visit within
   * this tab session cuts straight to the table. */
  onHoloArrived(slug: string): void {
    this.holoSeenShips.update((seen) => new Set(seen).add(slug));
  }

  /** Wave 2.5 (item 8/slot: hangar-tab + top-3): this user's OTHER hangar
   * ships, by slug — same format as `classNameSlug`/`recentlyViewedShips`
   * (`inHangar` above already compares `s.shipClassName` to a slug 1:1). */
  readonly hangarShipClassNames = computed(() => this.hangar.ships().map((s) => s.shipClassName));

  /** Wave 2.5 (slot: patch-delta): the currently-shown build, as the
   * `BuildRef` shape `sc-codex-holo-patch` wants. */
  readonly patchActiveBuild = computed<BuildRef | null>(() => {
    const b = this.build();
    return b ? { id: b.id, patchVersion: b.patchVersion } : null;
  });

  /** Wave 2.5 (slot: patch-delta): STOCK port→className map (never the
   * draft — see `stockKpiSheet`'s comment). */
  readonly patchActiveOccupants = computed<PortOccupantMap>(() => {
    const out: Record<string, string | null> = {};
    for (const l of this.loadoutAll()) {
      if (l.port) out[l.port] = l.className;
    }
    return out;
  });

  /** Wave 2.5 (slot: patch-delta) — the `resolveComparisonSide` adapter
   * `sc-codex-holo-patch` needs (wave2-patch-share.md §A): a pure-enough
   * function of an ARBITRARY `CodexDetail`, generalised from this page's own
   * `kpiShipInput`/`summaryOccupants` shaping. Simplification (discretion,
   * reported in wave2-stage.md): top-level stock mounts only — a swapped
   * mount's OWN nested sub-slots (`carriedOccupants`) and per-round ammo
   * payloads are not resolved for the comparison side, since neither the
   * KPI headline figures nor the port-occupant Δ (`comparePortOccupants`,
   * which only ever needs one className per TOP-LEVEL port) depend on them.
   */
  readonly resolvePatchComparisonSide = async (detail: CodexDetail): Promise<HoloPatchComparisonSide> => {
    const payload = detail.payload as ShipPayload;
    const entries = payload.defaultLoadout ?? [];
    const classNames = [...new Set(entries.map((e) => e.entityClassName).filter((c): c is string => !!c))];
    const payloads = await this.svc.getEntityPayloads(classNames);
    const occupants: Record<string, string | null> = {};
    const summary: SummaryOccupant[] = [];
    for (const e of entries) {
      if (!e.itemPortName) continue;
      occupants[e.itemPortName] = e.entityClassName ?? null;
      const hit = e.entityClassName ? payloads.get(e.entityClassName) : undefined;
      const pl = hit?.payload ?? null;
      const occ = {
        entityKind: (pl as { entityKind?: string } | null)?.entityKind ?? hit?.kind ?? null,
        componentKind: (pl as { kind?: string } | null)?.kind ?? null,
        subType: (pl as { subType?: string } | null)?.subType ?? null,
        attachType: (pl as { attachType?: string } | null)?.attachType ?? null,
      };
      const section = classifyShipModule(e.itemPortName, occ) as ShipModuleSection;
      summary.push({ section, kind: hit?.kind ?? null, payload: pl, ammoPayload: undefined, count: 1, passive: false });
    }
    const kpiShipInput: KpiShipInput = { flight: payload.flight, stats: payload.stats ?? null };
    return { kpiSheet: computeKpiSheet(summary, kpiShipInput), occupants };
  };

  /** Wave 2.5 (slot: share) — this ship's active hangar config, loaded
   * best-effort so `sc-codex-holo-share` can offer a share link / follow
   * hint. `null` when signed out, not in the hangar, or not yet loaded. */
  readonly activeHangarConfig = signal<HangarShipConfig | null>(null);

  private async loadActiveHangarConfig(classNameSlug: string): Promise<void> {
    if (!this.auth.user()) return;
    // The hangar list is what answers "is this ship mine?" — on a deep link
    // it is still loading here, so wait for it or the share popover never
    // sees the config (wave 5 A1.3).
    if (this.hangar.ships().length === 0) await this.hangar.loadAll();
    if (this.detail()?.classNameSlug !== classNameSlug) return;
    const ship = this.hangar.shipByClassName(classNameSlug);
    if (!ship) return;
    const configs = await this.hangar.listConfigs(ship.id);
    if (this.detail()?.classNameSlug !== classNameSlug) return;
    this.activeHangarConfig.set(configs.find((c) => c.isActive) ?? configs[0] ?? null);
  }

  toggleHoloView(): void {
    const next = !this.holoView();
    this.holoView.set(next);
    try {
      localStorage.setItem(CodexDetailComponent.HOLO_VIEW_STORAGE_KEY, next ? 'holo' : 'classic');
    } catch {
      /* localStorage unavailable — the toggle still works for this tab */
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { view: next ? null : 'classic' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  readonly holoSeenThisSession = computed(() => {
    const cls = this.detail()?.classNameSlug;
    return !!cls && this.holoSeenShips().has(cls);
  });

  /** `prefers-reduced-motion` = hard cut, no arrival transformation, no
   * cinematic pieces (Wave 2 arrival rule). Read once — the media query
   * itself does not change mid-session in any browser that matters here. */
  readonly prefersReducedMotion = signal(
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false,
  );

  /**
   * Wave 2.5 (user decision 1): "recently viewed" ship slugs, most-recent
   * first, capped at 20 — the Holotable "Einordnung" top-3 candidate pool.
   * A tiny, purely-local read history; never sent anywhere.
   */
  private static readonly RECENT_SHIPS_KEY = 'sc.codex.recentShips';
  private static readonly RECENT_SHIPS_CAP = 20;
  readonly recentlyViewedShips = signal<string[]>([]);

  private loadRecentShips(): string[] {
    try {
      const raw = localStorage.getItem(CodexDetailComponent.RECENT_SHIPS_KEY);
      const list = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }

  private recordRecentShip(classNameSlug: string): void {
    const existing = this.loadRecentShips().filter((s) => s !== classNameSlug);
    const next = [classNameSlug, ...existing].slice(0, CodexDetailComponent.RECENT_SHIPS_CAP);
    this.recentlyViewedShips.set(next);
    try {
      localStorage.setItem(CodexDetailComponent.RECENT_SHIPS_KEY, JSON.stringify(next));
    } catch {
      /* localStorage unavailable — the in-memory list still works this tab */
    }
  }

  readonly loading = signal(true);
  /** i18n key, never raw text. */
  readonly error = signal<string | null>(null);
  readonly showRaw = signal(false);
  /** Add-to-hangar in flight (AUD-065): locks the buttons, blocks a double insert. */
  readonly addBusy = signal(false);
  /** The last add-to-hangar failed (AUD-268): shows the translated alert. */
  readonly addFailed = signal(false);
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
  // State and actions live in ShipLinkFormStore (provided below, shared by
  // the classic view and the Holotable drawer).
  readonly shipLinkForm = inject(ShipLinkFormStore);
  /** Copy-link toast state (MASTER §2 / R-t1): a plain timed signal, no shared toast service exists yet. */
  readonly linkCopied = signal(false);
  private linkCopiedTimer: ReturnType<typeof setTimeout> | null = null;
  private cohortTimer: ReturnType<typeof setTimeout> | null = null;

  // The livery family of this entity, base record first (feedback d5e39f86).
  // Fewer than two entries means "nothing to pick" and hides the picker.
  readonly skinOptions = signal<SkinOption[]>([]);
  /** The picked entry's livery name, or null while the base record is open. */
  readonly currentLivery = computed(
    () =>
      this.skinOptions().find((o) => o.classNameSlug === this.detail()?.classNameSlug)
        ?.liveryName ?? null,
  );

  // The edition family of this ship, base record first (feedback 77ecad2a).
  // Fewer than two entries means "nothing to pick" and hides the picker.
  readonly editionOptions = signal<EditionOption[]>([]);
  /** The picked entry's edition name, or null while the base record is open. */
  readonly currentEdition = computed(
    () =>
      this.editionOptions().find((o) => o.classNameSlug === this.detail()?.classNameSlug)
        ?.editionName ?? null,
  );

  /** Picker rows for sc-codex-variant-picker (skin / edition family). */
  readonly skinPickerOptions = computed(() =>
    this.skinOptions().map((o) => ({ classNameSlug: o.classNameSlug, label: o.liveryName })),
  );
  readonly editionPickerOptions = computed(() =>
    this.editionOptions().map((o) => ({ classNameSlug: o.classNameSlug, label: o.editionName })),
  );

  // Reverse ingredient lookup: crafting blueprints that consume this entity.
  readonly usedInBlueprints = signal<BlueprintRef[]>([]);

  // 3D asset package of a non-ship entity (FPS weapon, ship component/weapon/
  // missile/rack). Null = no package → the section is simply absent; a failed
  // lookup hides it too (logged) — only manifest/GLB failures show an error.
  readonly itemPackage = signal<AssetPackageRow | null>(null);
  private readonly assetPackages = inject(AssetPackageService);

  private async loadItemPackage(kind: CodexKind, className: string, seq: number): Promise<void> {
    this.itemPackage.set(null);
    const kinds: AssetPackageKind[] = kind === 'weapon' ? ['fps_weapon', 'item'] : ['item', 'fps_weapon'];
    try {
      const row = await this.assetPackages.findRow(kinds, className);
      if (seq === this.loadSeq) this.itemPackage.set(row);
    } catch (err) {
      logWarn('codex-detail', 'asset package lookup failed', { className, err });
    }
  }

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
  /**
   * The recipe, labelled for sc-codex-recipe-card. Reads lang() so a language
   * switch relabels the material slots, as the template did before.
   */
  readonly recipeView = computed<RecipeView | null>(() => {
    const r = this.recipe();
    this.lang();
    if (!r) return null;
    return {
      craftTime: r.craftTimeSec != null ? this.fmtCraft(r.craftTimeSec) : null,
      blueprintSlug: r.classNameSlug,
      rows: r.ingredients.map((i) => ({
        key: i.ingredientIndex,
        name: this.ingredientName(i),
        role: this.ingredientRole(i) || null,
        qty: i.quantity != null ? this.fmtQty(i.quantity) : null,
        minQuality: this.needsQuality(i.minQuality) ? this.fmtQuality(i.minQuality) : null,
      })),
    };
  });

  // Hardpoint slot-compatibility: which port is expanded + its lazy item list.
  readonly expandedPort = signal<number | null>(null);
  private readonly compatMap = signal<Map<number, PortCompat>>(new Map());
  /** Read-only view for sc-codex-port-list; togglePort/setCompat write it. */
  readonly compatByPort = this.compatMap.asReadonly();

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

  // ── loadout draft (PR B — 06-fallen.md) ─────────────────────────────────────
  // State and mutations live in CodexLoadoutDraftStore (provided below); the
  // page reads them through these names, which the template, the Holotable
  // bindings and the specs use.
  readonly draft = this.draftStore.draft;
  private readonly draftPayloads = this.draftStore.draftPayloads;
  private readonly draftAmmoPayloads = this.draftStore.draftAmmoPayloads;
  private readonly draftResolved = this.draftStore.draftResolved;
  private readonly unresolvableDraftPaths = this.draftStore.unresolvableDraftPaths;
  readonly saving = this.draftStore.saving;
  readonly saveError = this.draftStore.saveError;

  // Ship tech stats derived from the stock loadout's component payloads (#137):
  // quantum range/speed + fuel capacities. Best-effort — null when unresolvable.
  private readonly techStats = signal<ShipTechStats | null>(null);

  // Star Citizen content exists in both DE and EN (DE is ~97.6% genuinely
  // translated, not an English copy). We render datamined CONTENT (names,
  // descriptions, manufacturer, role) in the app language with EN as the
  // guaranteed fallback, reacting to language switches. (UC-08)
  private readonly lang = signal<Lang>(toLang(this.t.getCurrentLang() || this.t.getFallbackLang()));

  constructor() {
    this.draftStore.connect({
      detail: this.detail,
      loadoutEntities: this.loadoutEntities,
      loadoutAll: this.loadoutAll,
      joinablePorts: this.joinablePorts,
      onSaved: (config) => this.activeHangarConfig.set(config),
    });
    this.shipLinkForm.connect(
      computed(() => {
        const d = this.detail();
        return d?.kind === 'ship' ? d.classNameSlug : null;
      }),
    );
    this.destroyRef.onDestroy(() => {
      if (this.linkCopiedTimer) clearTimeout(this.linkCopiedTimer);
      if (this.cohortTimer) clearTimeout(this.cohortTimer);
    });
    this.t.onLangChange
      .pipe(takeUntilDestroyed())
      .subscribe((e) => this.lang.set(toLang(e.lang)));
  }

  /**
   * Params are SUBSCRIBED, not snapshotted: `codex/:kind/:className` links to
   * itself — from the compatible-items list, and now from the skin picker — and
   * the router reuses this component across a params-only navigation, so a
   * snapshot read leaves the URL pointing at the new entity while the page
   * still renders the old one. The first emission is synchronous, so a deep
   * link behaves exactly as before.
   */
  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const kind = params.get('kind') as CodexKind | null;
      const className = params.get('className');
      // An unknown category (/codex/foo/x) used to query a table named
      // "undefined" and print the raw database message.
      if (!kind || !className || !CODEX_KINDS.includes(kind)) {
        this.lastRequest = null;
        this.error.set('codex.detail.invalidRoute');
        this.loading.set(false);
        return;
      }
      this.lastRequest = { kind, className };
      // Deep links land here without ever touching the list, so the RSI art map
      // would otherwise be empty and every ship hero would fall back to the
      // datamined silhouette. `feed` is a signal — the hero repaints when it
      // lands, and a failed fetch is absorbed by the service.
      if (kind === 'ship') void this.rsi.ensureLoaded();
      void this.load(kind, className);
    });
  }

  /** The entity the route asked for last — what "retry" loads again. */
  private lastRequest: { kind: CodexKind; className: string } | null = null;
  /** Bumped per load: a quick switch (livery, edition) must not end on the older answer. */
  private loadSeq = 0;

  canRetry(): boolean {
    return this.lastRequest !== null;
  }

  retryLoad(): void {
    if (this.lastRequest) void this.load(this.lastRequest.kind, this.lastRequest.className);
  }

  private async load(kind: CodexKind, className: string): Promise<void> {
    const seq = ++this.loadSeq;
    if (kind === 'ship') this.initHoloView(className);
    // A new ship is a new answer to "is there a model?" — see onArtAvailable.
    this.has3dView.set(false);
    this.heroView3d.set(false);
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
    this.shipLinkForm.reset();
    this.buyOptions.set([]);
    this.buyLoading.set(false);
    this.buyError.set(false);
    this.draftStore.reset();
    this.activeMissionId.set('all');
    this.skinOptions.set([]);
    this.editionOptions.set([]);
    this.rankCohort.set(null);
    this.rankCohortLoading.set(false);
    this.shipSilhouette.set(null);
    try {
      const d = await this.svc.getDetail(kind, className);
      if (seq !== this.loadSeq) return;
      this.detail.set(d);
      if (d) {
        await Promise.all([
          this.resolveLoadoutEntities(d, seq),
          this.resolveLocale(d, seq),
          this.resolveShipTech(d, seq),
        ]);
        if (seq !== this.loadSeq) return;
        if (kind === 'ship') {
          this.activeMissionId.set(loadStoredMission(d.classNameSlug) ?? 'all');
        }
        if (kind === 'ship') this.draftStore.restoreDraftFromUrlOrStorage(className);
        if (kind === 'item' || kind === 'weapon') void this.loadWhereToBuy(d);
        void this.loadSkinGroup(kind, d.classNameSlug);
        if (kind === 'ship') void this.loadEditionGroup(kind, d.classNameSlug);
        // Ships are not crafting ingredients; skip the reverse lookup for them.
        if (kind !== 'ship') void this.loadUsedInBlueprints(d.classNameSlug, seq);
        if (kind === 'weapon' || kind === 'component' || kind === 'item' || kind === 'ammunition') {
          void this.loadItemPackage(kind, d.classNameSlug, seq);
        } else {
          this.itemPackage.set(null);
        }
        // Ships are not craftable either, so skip the forward lookup as well.
        if (kind !== 'ship') void this.loadRecipe(d.classNameSlug, seq);
        // Ship pages: hangar membership backs the add-to-hangar action.
        if (kind === 'ship' && this.hangar.ships().length === 0) void this.hangar.loadAll();
        // Ship pages: resolve the pinned pledge link (own > global). Best
        // effort — a missing link just falls back to the RSI ships listing.
        if (kind === 'ship') void this.shipLinks.loadForShip(d.classNameSlug);
        // Ship pages: the Einordnung cohort. It reads the WHOLE fleet, so it
        // must never race the ship's own queries for the connection — kicked
        // off only once the browser has had a turn, and it yields while it
        // scores (see CodexService.getRankCohort). Measured live on
        // 2026-09-05: started inline it starved the page for tens of seconds.
        if (kind === 'ship') {
          if (this.cohortTimer) clearTimeout(this.cohortTimer);
          this.cohortTimer = setTimeout(() => void this.loadRankCohort(), 0);
        }
        // Holotable stage: the silhouette (Wave 2). Best-effort, current
        // build only — a missing/invalid row renders the §C3 placeholder,
        // never a client-side guess (parseHoloSilhouette already enforces
        // that in the service).
        if (kind === 'ship') {
          void this.svc.silhouette?.('ship', d.classNameSlug)?.then((s) => this.shipSilhouette.set(s));
          this.recentlyViewedShips.set(this.loadRecentShips());
          this.recordRecentShip(d.classNameSlug);
          this.activeHangarConfig.set(null);
          void this.loadActiveHangarConfig(d.classNameSlug);
        }
      }
    } catch (err) {
      if (seq === this.loadSeq) this.error.set(toErrorKey('codex', 'detail', err, { ...this.lastRequest }));
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  /**
   * Every follow-up read of load() takes its `seq` and only writes while that
   * load is still the current one: a quick livery or edition switch must not
   * end on the previous entity's tech stats, loadout, recipe or "used in" list
   * (harden scan, 2026-09-25).
   */
  private isCurrentLoad(seq: number): boolean {
    return seq === this.loadSeq;
  }

  /** Resolve raw @-keys on the row (currently the ship role) to localized text. */
  private async resolveLocale(d: CodexDetail, seq: number): Promise<void> {
    const keys: string[] = [];
    const role = d.row['role'];
    if (typeof role === 'string' && role.startsWith('@')) keys.push(role);
    if (keys.length === 0) return;
    const resolved = await this.svc.resolveLocaleKeys(keys, this.lang());
    if (this.isCurrentLoad(seq)) this.localeMap.set(resolved);
  }

  // ── hardpoint slot compatibility ────────────────────────────────────────────

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
        error: toErrorKey('codex', 'compatible items', e, { port: port.portIndex }),
        items: [],
      });
    }
  }

  private setCompat(idx: number, v: PortCompat): void {
    const m = new Map(this.compatMap());
    m.set(idx, v);
    this.compatMap.set(m);
  }

  private async resolveLoadoutEntities(d: CodexDetail, seq: number): Promise<void> {
    if (d.kind !== 'ship') return;
    const entries = (d.payload as ShipPayload | undefined)?.defaultLoadout ?? [];
    // Sub-items too — a gun that only exists inside a mount still needs its
    // name, size and manufacturer resolved.
    const entities = await this.svc.resolveEntities(stockLoadoutClassNames(entries));
    if (this.isCurrentLoad(seq)) this.loadoutEntities.set(entities);
  }

  /**
   * Derive ship tech facts (#137 part 1) from the STOCK loadout's component
   * payloads: quantum jump range / drive speed and the summed hydrogen /
   * quantum fuel tank capacities. Reuses the hangar's loadout-stats math so
   * codex and hangar always agree. Best-effort: failures leave the hero
   * facts without tech chips instead of breaking the page.
   */
  private async resolveShipTech(d: CodexDetail, seq: number): Promise<void> {
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
      if (!this.isCurrentLoad(seq)) return;
      // Publish the payloads first: the per-hardpoint stat readout depends only
      // on them, so it must survive a failure in the aggregate tech math below.
      this.loadoutPayloads.set(payloads);
      await this.resolveLoadoutAmmo(payloads, seq);
      if (!this.isCurrentLoad(seq)) return;
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
    } catch (error) {
      logWarn('codex', 'ship tech failed', error);
      // tech chips are a bonus — never fail the detail page for them
    }
  }

  /**
   * Resolve the projectile ("ammo") payloads for the weapons in a stock
   * loadout. Since extractor schema 6 each weapon payload names its round
   * (`weaponParams.ammoClassName` — the link that gives a countermeasure
   * launcher its decoy's values, feedback #237); older builds fall back to
   * the `<weaponClass>_AMMO` name convention. One batched query, and whatever
   * does not exist simply yields no projectile stats.
   */
  private async resolveLoadoutAmmo(
    payloads: Map<string, { kind: CodexKind; payload: unknown }>,
    seq: number,
  ): Promise<void> {
    const weaponClasses = [...payloads.entries()]
      .filter(([, v]) => (v.payload as { entityKind?: string } | null)?.entityKind === 'weapon')
      .map(([className]) => className);
    const ammoNames = ammoClassNamesFor(weaponClasses, (cn) => payloads.get(cn)?.payload);
    if (ammoNames.length === 0) return;
    try {
      const ammo = await this.svc.getAmmoPayloads(ammoNames);
      if (this.isCurrentLoad(seq)) this.ammoPayloads.set(ammo);
    } catch (error) {
      logWarn('codex', 'ammo lookup failed', { ammo: ammoNames.length, error });
      // projectile stats are a bonus — a failed lookup just hides those rows
    }
  }

  /**
   * The livery family this entity belongs to (feedback d5e39f86). The list
   * shows one entry per weapon, so the paint jobs it swallowed have to be
   * reachable from here — `resolveSkinGroup` re-derives the same family from a
   * prefix read, and returns null (→ no picker) for the ordinary case of an
   * entity with no liveries. Best effort: a failed read just hides the picker.
   */
  private async loadSkinGroup(kind: CodexKind, className: string): Promise<void> {
    try {
      const siblings = await this.svc.listSkinSiblings(kind, className);
      // Switching skins re-enters load() while this read is in flight; a late
      // answer must not paint the previous entity's family.
      if (this.detail()?.classNameSlug !== className) return;
      this.skinOptions.set(resolveSkinGroup(siblings, className) ?? []);
    } catch (error) {
      logWarn('codex', 'skin group failed', { className, error });
      this.skinOptions.set([]);
    }
  }

  /**
   * The edition family this ship belongs to (feedback 77ecad2a). The grid shows
   * one entry per hull, so the duplicate records and marketing editions it
   * swallowed have to be reachable from here — `resolveEditionGroup` re-derives
   * the same family from a prefix read, and returns null (→ no picker) for the
   * ordinary case of a ship that ships exactly once. Best effort: a failed read
   * just hides the picker.
   */
  private async loadEditionGroup(kind: CodexKind, className: string): Promise<void> {
    try {
      const siblings = await this.svc.listEditionSiblings(kind, className);
      // Switching editions re-enters load() while this read is in flight; a
      // late answer must not paint the previous ship's family.
      if (this.detail()?.classNameSlug !== className) return;
      this.editionOptions.set(resolveEditionGroup(siblings, className) ?? []);
    } catch (error) {
      logWarn('codex', 'edition group failed', { className, error });
      this.editionOptions.set([]);
    }
  }

  /** Reverse lookup: crafting blueprints that consume this entity as an ingredient. */
  private async loadUsedInBlueprints(className: string, seq: number): Promise<void> {
    let used: BlueprintRef[] = [];
    try {
      used = await this.svc.blueprintsUsingIngredient(className);
    } catch (error) {
      logWarn('codex', 'used-in lookup failed', { className, error });
      // supplementary — a failed lookup just hides the list
    }
    if (this.isCurrentLoad(seq)) this.usedInBlueprints.set(used);
  }

  /** Forward lookup: the recipe that produces this entity, with its materials. */
  private async loadRecipe(className: string, seq: number): Promise<void> {
    try {
      const bp = await this.svc.getCraftingRecipe(className);
      if (!this.isCurrentLoad(seq)) return;
      this.recipe.set(bp ? {
        classNameSlug: bp.classNameSlug,
        craftTimeSec: (bp.row['craft_time_seconds'] as number | null) ?? null,
        ingredients: bp.ingredients,
      } : null);
    } catch (error) {
      logWarn('codex', 'recipe lookup failed', error);
      // Crafting data is supplementary — a failed lookup just hides the panel.
      if (this.isCurrentLoad(seq)) this.recipe.set(null);
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
    } catch (error) {
      logWarn('codex', 'where to buy failed', error);
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

  /** The material's slot — CIG's slot name, readable; '' when the row names none. */
  ingredientRole(i: CodexBlueprintIngredient): string {
    return ingredientRoleLabel(i.role, (key) => this.t.instant(key));
  }

  // ── derived views ──────────────────────────────────────────────────────────
  /**
   * The on-foot piece this page shows, in the shape "add to set" needs — an
   * FPS weapon or a personal armour piece; null for anything a set cannot hold.
   */
  readonly fpsSetPiece = computed<{
    className: string;
    kind: 'weapon' | 'item';
    subType: string | null;
    attachType: string | null;
  } | null>(() => {
    const d = this.detail();
    if (!d) return null;
    const subType = (d.row['sub_type'] as string | null) ?? null;
    const attachType = (d.row['attach_type'] as string | null) ?? null;
    if (d.kind === 'weapon' && d.row['weapon_class'] === 'FPS') {
      return { className: d.classNameSlug, kind: 'weapon', subType, attachType: null };
    }
    if (d.kind === 'item' && roleSlotForAttachType(attachType)) {
      return { className: d.classNameSlug, kind: 'item', subType, attachType };
    }
    return null;
  });

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

  /** The game's flat top-down vehicle icon for the Holotable's default silhouette (null = none in this extract). */
  readonly previewSilhouetteUrl = computed<string | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    return this.svc.previewUrl((d.payload as BaseEntityPayload | undefined)?.previewImage);
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

  /** Char_Armor_* attach_type of the current entity, for the hero icon's part glyph. */
  heroAttachType(): string | null {
    return (this.detail()?.row['attach_type'] as string | null) ?? null;
  }

  // Original class_name (e.g. 'DRAK_Cutlass_Black') for the skin selector —
  // matches public.ship_skins.ship_id. Empty string for non-ships (hides it).
  readonly shipClassName = computed(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return '';
    const raw = d.row?.['class_name'];
    return typeof raw === 'string' && raw ? raw : d.classNameSlug;
  });

  /**
   * HangarPicker chain for the ship hero (round 16-17, N4) — same source and
   * shape as the Codex landing's ship stage: `HangarService.recentShips()`
   * (top 3, persisted, falls back to the first 3 owned hulls). `HangarShip`
   * carries its class name in the same slug form the route param and
   * `classNameSlug` already use, so a pick needs no extra lookup.
   */
  readonly shipPickerItems = computed<HangarPickerItem[]>(() => {
    const current = this.detail()?.classNameSlug ?? null;
    return this.hangar.recentShips().map((s) => ({
      id: s.shipClassName,
      label: s.customName ?? humanizeClassName(s.shipClassName),
      active: s.shipClassName === current,
    }));
  });

  /** HangarPicker `pick` (N4/M6): switch to the picked hull and record it as recently chosen. */
  onShipPickerPick(classNameSlug: string): void {
    this.hangar.markShipPicked(classNameSlug);
    // Stay in the view the user is in (wave 5 A1.2): a pick from the
    // classic stage lands on the next hull's classic stage.
    void this.router.navigate(['/codex', 'ship', classNameSlug], {
      queryParams: this.holoView() ? {} : { view: 'classic' },
    });
  }

  /** HangarPicker `open` — neither the classic hero nor the Holotable dock has
   * an overlay yet (same gap as the Codex landing, M3/M4 out of this scope);
   * both open the hangar page. */
  onHangarPickerOpen(): void {
    void this.router.navigateByUrl('/hangar');
  }

  private readonly dimensions = computed<Dimensions | null>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return null;
    const dim = (d.payload as ShipPayload | undefined)?.dimensions ?? null;
    if (!dim || (!dim.length && !dim.width && !dim.height)) return null;
    return dim;
  });

  /** Compact hero facts — kind-aware, only meaningful values (buildHeroFacts). */
  readonly facts = computed<Fact[]>(() => {
    const d = this.detail();
    if (!d) return [];
    return buildHeroFacts(
      {
        detail: d,
        dimensions: d.kind === 'ship' ? this.dimensions() : null,
        techStats: d.kind === 'ship' ? this.techStats() : null,
        ammoRange: d.kind === 'ammunition' ? ammoRangeOf(d) : null,
      },
      this.translate,
    );
  });

  /** TranslateService.instant as a plain function for the fact builders. */
  private readonly translate: Translate = (key, params) => this.t.instant(key, params);

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

  // Decision stats grouped by what the thing is FOR (Slice 3) — not a flat
  // dump. `toDisplayStatGroups` (AUD-060) hides engine internals that slip
  // past codex-format.ts's own noise filter and attaches an i18n key for
  // every stat label the dictionary knows, leaving the rest on the existing
  // humanized fallback.
  readonly componentStatGroups = computed<DisplayStatGroup[]>(() =>
    toDisplayStatGroups(groupStatRows(this.componentStats())),
  );
  readonly weaponParamGroups = computed<DisplayStatGroup[]>(() =>
    toDisplayStatGroups(groupStatRows(this.weaponParams())),
  );
  readonly armorStatGroups = computed<DisplayStatGroup[]>(() =>
    toDisplayStatGroups(groupStatRows(this.armorStats())),
  );

  /** Group headers only help once the stats span ≥2 buckets. */
  showStatGroupHeaders(groups: DisplayStatGroup[]): boolean {
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
        factoryClassName: ev.rawPorts && ev.rawPorts.length > 0 ? this.draftStore.stockValueForPath(ev.rawPorts[0]) : null,
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
      factoryClassName: ev.rawPorts && ev.rawPorts.length > 0 ? this.draftStore.stockValueForPath(ev.rawPorts[0]) : null,
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

  readonly draftChangedCount = this.draftStore.draftChangedCount;
  readonly saveableEntries = this.draftStore.saveableEntries;

  /** "Übernehmen" / "Slot leeren" from the picker — closes it, then drafts every covered path. */
  onSwapPicked(pick: SwapPick): void {
    this.swapTarget.set(null);
    this.draftStore.applySwap(pick);
  }

  /** Revert the row's own draft entries (the ↺ button). */
  onRevertPaths(paths: string[]): void {
    this.draftStore.onRevertPaths(paths);
  }

  isDraftClassPending(className: string | null): boolean {
    return this.draftStore.isDraftClassPending(className);
  }

  /** Write the draft into the ship's active hangar config (CodexLoadoutDraftStore). */
  saveLoadoutDraft(): Promise<void> {
    return this.draftStore.saveLoadoutDraft();
  }

  /** `codex.detail.actionCopyLink` (MASTER §2 / concept #t1): share the current
   *  URL and flash a small toast. Best-effort — clipboard access can be denied
   *  by the browser, in which case we simply skip the toast. */
  async copyShareLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
    } catch {
      return;
    }
    this.linkCopied.set(true);
    if (this.linkCopiedTimer) clearTimeout(this.linkCopiedTimer);
    this.linkCopiedTimer = setTimeout(() => this.linkCopied.set(false), 2000);
  }

  discardLoadoutDraft(): void {
    this.draftStore.discardLoadoutDraft();
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
        ammoPayload: l.className ? ammo.get(ammoClassNameFor(l.className, payload) ?? '') : undefined,
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

  /**
   * A shield bay the game never shows the pilot: its item port carries the
   * `invisible` flag in the hull's port definition (`codex_item_ports.flags`).
   * That is the only port-level signal the game files offer for a "logical"
   * third generator (4263fed1) — the Nomad's three bays are all `editable`
   * there, so this stays false for it and the resource-draw rule decides.
   * Older catalog builds ingested the flags column empty → always false.
   */
  private passiveByPort(section: ShipModuleSection, portName: string | null): boolean {
    if (section !== 'shields' || !portName) return false;
    const port = this.detail()?.ports.find((p) => p.portName === portName);
    return !!port?.flags?.some((f) => f.replace(/^\$/, '').toLowerCase() === 'invisible');
  }

  /** Aggregation input for the Damage / Defence / Power panels. */
  private readonly summaryOccupants = computed<SummaryOccupant[]>(() =>
    this.resolvedLoadout().flatMap((r) => [
      {
        section: r.section,
        kind: r.kind,
        payload: r.payload,
        ammoPayload: r.ammoPayload,
        count: 1,
        passive: this.passiveByPort(r.section, r.item.port),
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
  readonly draftSummaryOccupants = computed<SummaryOccupant[]>(() =>
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
          passive: this.passiveByPort(r.section, r.item.port),
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

  /** Public since Wave 2.5: the patch-Δ trigger's `activeKpiSheet` input is
   * this EXACT stock sheet, never the viewer's unsaved draft (patch-share
   * handoff §A: "compares two PATCHES, not the draft against a patch"). */
  readonly stockKpiSheet = computed(() =>
    computeKpiSheet(this.summaryOccupants(), this.kpiShipInput()),
  );
  private readonly currentKpiSheet = computed(() =>
    computeKpiSheet(this.draftSummaryOccupants(), this.kpiShipInput()),
  );

  /** The energy dock's current allocation state — null until the dock has run
   * once (or on ships too old to compute one, R3/MASTER §8a). */
  readonly powerSheet = signal<PowerSheet | null>(null);

  /** The six KPI-band cells for the active mission, stock vs. current draft,
   * with the dock's live effects applied (MASTER §4/§12). */
  readonly kpiCells = computed<KpiStripCell[]>(() => {
    if (this.kind() !== 'ship') return [];
    return buildKpiStrip(this.activeMission(), this.stockKpiSheet(), this.currentKpiSheet(), this.powerSheet());
  });

  /** Every sheet key as a strip cell (Holotable perspectives + strip): the
   * same stock-vs-draft delta and dock effects as the six-cell band, so a
   * tile never shows a number the band would not. */
  readonly allKpiCells = computed<KpiStripCell[]>(() => {
    if (this.kind() !== 'ship') return [];
    return buildKpiStripForKeys(ALL_KPI_KEYS, this.stockKpiSheet(), this.currentKpiSheet(), this.powerSheet());
  });

  // ── Einordnung (MASTER §3) ───────────────────────────────────────────────
  readonly rankProfile = signal<RankProfileId>('combat');
  // The comparison group the user picked last (Alle / Karriere / Rolle) is
  // remembered across ships and visits; "Alle Schiffe" is the default. A ship
  // that lacks the remembered group shows "Alle" for itself without
  // overwriting the choice (`RankResult.scope` vs. this signal).
  // Signed in, the account's copy (profiles.ui_prefs) wins once it has loaded,
  // so the choice follows the user to another browser.
  readonly rankScope = signal<RankScope>(readRankScopePref());
  private readonly accountPrefs = inject(AccountPrefsService);
  private readonly rankScopeFromAccount = effect(() => {
    const fromAccount = parseRankScopePref(this.accountPrefs.prefs()?.[RANK_SCOPE_ACCOUNT_KEY]);
    if (fromAccount && fromAccount !== untracked(this.rankScope)) {
      this.rankScope.set(fromAccount);
      writeRankScopePref(fromAccount);
    }
  });

  setRankScope(scope: RankScope): void {
    this.rankScope.set(scope);
    writeRankScopePref(scope);
    this.accountPrefs.set(RANK_SCOPE_ACCOUNT_KEY, scope);
  }

  /** The cohort — every buyable ship's stock KPI sheet, fetched once per
   * build (cached in `CodexService.getRankCohort`) and never blocking the
   * page: the card renders its loading skeleton, then its gap state if the
   * fetch failed, and only ever a real percentile once this lands. */
  /** Public since Wave 2.5: the Holotable "Einordnung" top-3 (item 1) ranks
   * candidate ships against this SAME cohort data — never a second fetch. */
  readonly rankCohort = signal<RankShipInput[] | null>(null);
  readonly rankCohortLoading = signal(false);

  /** Holotable silhouette (Wave 2), current build only, ship kind only. */
  readonly shipSilhouette = signal<HoloSilhouette | null>(null);

  private async loadRankCohort(): Promise<void> {
    this.rankCohortLoading.set(true);
    try {
      const cohort = await this.svc.getRankCohort();
      // A degenerate cohort (nothing resolved, or every sheet came back all
      // null — the getEntityPayloads/getAmmoPayloads failure mode this card
      // must never mask) would otherwise render a percentile against zero
      // real occupants. Keep the honest gap state instead.
      const hasRealSheet = cohort.some((ship) =>
        Object.values(ship.sheet).some((v) => v !== null && v !== undefined),
      );
      this.rankCohort.set(cohort.length > 0 && hasRealSheet ? cohort : null);
    } catch (error) {
      logWarn('codex', 'rank cohort failed', error);
      this.rankCohort.set(null); // honest gap state — never a fake cohort of one.
    } finally {
      this.rankCohortLoading.set(false);
    }
  }

  private readonly rankShipInput = computed<RankShipInput | null>(() => {
    if (this.kind() !== 'ship') return null;
    const className = this.shipClassName();
    if (!className) return null;
    const career = resolveCareerLabel((this.detail()?.payload as ShipPayload | undefined)?.career ?? null);
    const roleRaw = this.detail()?.row?.['role'];
    const role = typeof roleRaw === 'string' && roleRaw.trim() ? roleRaw.trim() : null;
    return { className, sizeClass: null, career, role, sheet: this.currentKpiSheet() };
  });

  readonly rankResult = computed<RankResult | null>(() => {
    const target = this.rankShipInput();
    const cohort = this.rankCohort();
    if (!target || !cohort) return null;
    return rankShip(target, cohort, { profile: this.rankProfile(), scope: this.rankScope() });
  });

  readonly rankDisabledReasons = computed<Partial<Record<RankProfileId, string | null>>>(() => {
    if (this.kind() !== 'ship') return {};
    const cargo = this.currentKpiSheet().cargo ?? null;
    const career = resolveCareerLabel((this.detail()?.payload as ShipPayload | undefined)?.career ?? null);
    const input = { className: this.shipClassName(), sizeClass: null, career, sheet: { cargo } };
    return {
      combat: rankProfileDisabledReason('combat', input),
      defence: rankProfileDisabledReason('defence' as RankProfileId, input),
      transport: rankProfileDisabledReason('transport', input),
    };
  });

  /** The ship's whole payload (dock needs `.stats` for the resource model). */
  readonly shipPayload = computed<ShipPayload | null>(() => {
    const d = this.detail();
    return d && d.kind === 'ship' ? (d.payload as ShipPayload) : null;
  });

  readonly build = computed(() => this.svc.build());

  readonly currentUserId = computed<string | null>(() => this.auth.user()?.id ?? null);

  /** Max of the three cross-section axes — the dock's single comparable input. */
  readonly crossSectionMax = computed<number | null>(() => {
    const p = this.shipPayload();
    if (!p) return null;
    const axes = crossSectionAxes(p.stats as Record<string, Record<string, unknown>> | undefined);
    const vals = [axes.x, axes.y, axes.z].filter((v): v is number => v != null);
    return vals.length > 0 ? Math.max(...vals) : null;
  });

  /** Data provenance pill (MASTER §2/§11): the build's schema version, gold
   * with "Re-Extract ausstehend" when this app expects a newer one. */
  readonly dataPill = computed<{ build: string; schema: number; pending: boolean } | null>(() => {
    const b = this.build();
    if (!b) return null;
    return {
      build: `${b.patchVersion}-${b.channel}.${b.buildNumber}`,
      schema: b.schemaVersion,
      pending: isReExtractPending(b.schemaVersion),
    };
  });

  /** Hero chip row (MASTER §2): career, cargo (gold/ghost), mass in tonnes —
   * on top of the existing `facts()` (role/crew/dimensions/quantum). */
  /**
   * "AEGIS DYNAMICS · ABFANGJÄGER" — maker and role on one line, exactly how a
   * codex fleet tile captions the same ship. The role is dropped from the chip
   * row in the template so it is not stated twice.
   */
  protected readonly heroEyebrow = computed<string | null>(() => {
    const mfr = this.manufacturerName();
    const role = this.heroChips().find((c) => c.key === 'role')?.text ?? null;
    return [mfr, role].filter(Boolean).join(' · ') || null;
  });

  /** The ship stage's chips (buildHeroChips). */
  readonly heroChips = computed<HeroChip[]>(() =>
    buildHeroChips(
      {
        detail: this.detail(),
        localeMap: this.localeMap(),
        hasCargo: () => this.shipCapabilities().hasCargo,
      },
      this.translate,
    ),
  );

  /** Mount-chain sections (D11): the mount ITSELF (VariPuck gimbal, missile
   * rack, remote-turret base) carries no alpha and exists only to hold what's
   * chained inside it. The concept's fold-peek is a single chip about the
   * WEAPON — "3× S3 CF-337 Panther Repeater", no mount chip anywhere in the
   * peek (part-06.html:314-316) — so a mount whose port resolved a carried
   * child is excluded from these sections here; its child still gets pushed
   * below, in the same section, via `carriedOccupants`. */
  private static readonly MOUNT_CHAIN_SECTIONS: ReadonlySet<ShipModuleSection> = new Set([
    'weapons',
    'remoteTurrets',
    'missiles',
  ]);

  /** Occupants grouped by module section (draft-overlaid) for the fold preview
   * inside each `<details>` summary (MASTER §6). Built straight from the
   * resolved loadout (not `draftSummaryOccupants`) so a mount can be dropped
   * from the mount-chain sections without a mount occupant leaking through —
   * see `MOUNT_CHAIN_SECTIONS` above — and identical occupants are folded
   * into one grouped entry (`3× S3 …`, D10) before the fold-peek ever sees
   * them. */
  readonly occupantsBySection = computed<ReadonlyMap<ShipModuleSection, readonly SummaryOccupant[]>>(() => {
    const out = new Map<ShipModuleSection, SummaryOccupant[]>();
    const push = (o: SummaryOccupant) => {
      const hit = out.get(o.section);
      if (hit) hit.push(o);
      else out.set(o.section, [o]);
    };
    for (const r of this.resolvedLoadout()) {
      const configurable = isConfigurableSection(r.section);
      const draftEntry = configurable ? this.draft().get(r.item.port) : undefined;
      const item = { kind: r.kind, payload: r.payload, ammoPayload: r.ammoPayload };
      const overlay = this.draftOverlayFor(r.item.port, draftEntry, item);
      const pending = overlay.state === 'pending';
      const isMount =
        CodexDetailComponent.MOUNT_CHAIN_SECTIONS.has(r.section) && r.item.carried.size > 0;
      if (!isMount) {
        push({
          section: r.section,
          kind: overlay.item.kind,
          payload: pending ? null : overlay.item.payload,
          ammoPayload: pending ? undefined : overlay.item.ammoPayload,
          count: 1,
          passive: this.passiveByPort(r.section, r.item.port),
        });
      }
      if (draftEntry === undefined) {
        for (const occ of this.carriedOccupants(r.section, r.item.carried)) push(occ);
      }
    }
    const grouped = new Map<ShipModuleSection, readonly SummaryOccupant[]>();
    for (const [section, occupants] of out) grouped.set(section, groupOccupants(occupants));
    return grouped;
  });

  /**
   * `moduleSections`, split into the two cards the ship page actually
   * renders: the main loadout card (everything a pilot can act on, the
   * countermeasures with their round's values included since schema 6 —
   * feedback #237) and a second, TAIL card below the paint/skin viewer for
   * `structure` (feedback #236, see `TAIL_SHIP_SECTIONS`).
   */
  readonly primaryModuleSections = computed(() =>
    this.moduleSections().filter((s) => !TAIL_SHIP_SECTIONS.has(s.section)),
  );
  readonly tailModuleSections = computed(() =>
    this.moduleSections().filter((s) => TAIL_SHIP_SECTIONS.has(s.section)),
  );

  /**
   * Rendered loadout BLOCKS in a set of sections — fewer than four collapses
   * the Loadout | Analyse split into one column (MASTER §1) and this is the
   * number the column head prints. Slot count is the wrong unit (a hull with
   * 3 blocks and 10 slots must still collapse), and so is the section count
   * now that five sections share the "Antrieb & Systeme" block: the concept
   * counts what a reader counts, which is headings.
   */
  private moduleGroupCount(sections: readonly LayoutSection[]): number {
    return new Set(
      sections.filter((s) => s.slots.length > 0).map((s) => shipModuleGroupOf(s.section)),
    ).size;
  }

  /** Blocks in the main loadout card — drives its "n" badge and the
   *  Loadout | Analyse column split (only the primary card participates). */
  readonly moduleCount = computed(() => this.moduleGroupCount(this.primaryModuleSections()));
  /** Blocks in the tail card's own "n" badge. */
  readonly tailModuleCount = computed(() => this.moduleGroupCount(this.tailModuleSections()));

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

  /** Schiff panel — flight/mass/systems/signature/hull, grouped, gaps honoured (buildShipFactGroups). */
  readonly shipFactGroups = computed<ShipFactGroup[]>(() => {
    const d = this.detail();
    if (!d || d.kind !== 'ship') return [];
    return buildShipFactGroups(
      {
        detail: d,
        dimensions: this.dimensions(),
        techStats: this.techStats(),
        kpiSheet: this.currentKpiSheet(),
        occupants: this.draftSummaryOccupants(),
      },
      this.translate,
    );
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
        ammoPayload: this.draftAmmoPayloads().get(
          ammoClassNameFor(draftValue, payloadHit?.payload) ?? '',
        ),
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
    const payloads = this.loadoutPayloads();
    const ammo = this.ammoPayloads();
    const slots = carriedSlots(
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
    // The gun in the gimbal is the weapon this ship shoots with, so it gets the
    // same identity and stat run a top-level occupant does — the concept draws
    // it as a full row, not as a name under a mount (part-06.html:320-324).
    return slots.map((slot) => {
      if (!slot.className) return slot;
      const hit = resolved.get(slot.className);
      const payloadHit = payloads.get(slot.className);
      const item = {
        kind: payloadHit?.kind ?? hit?.kind ?? null,
        payload: payloadHit?.payload ?? null,
        ammoPayload: ammo.get(ammoClassNameFor(slot.className, payloadHit?.payload) ?? ''),
      };
      return {
        ...slot,
        grade: hit?.grade ?? null,
        manufacturerCode: hit?.manufacturerCode ?? null,
        damageChannels: damageChannelsOf(item.payload, item.ammoPayload),
        stats: equippedStats(item),
        statsMissing: weaponStatsUnavailable(item),
        statsNoteKey: equippedStatsNoteKey(item),
      };
    });
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
        ammoPayload: ammo.get(ammoClassNameFor(className, hit.payload) ?? ''),
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
        ? fmtGm(tech.quantum.jumpRangeMm)
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
      // The variant identity uses each carried child's POSITION FAMILY too —
      // a rack's own missile sub-ports can be as side-specific as the rack
      // itself (feedback #235), so two racks loaded with the same missile
      // must still fold together even if the extract names the sub-ports'
      // occupant class per side.
      const variantKey = children
        .map((c) => `${classNamePositionFamily(c.className)}:${c.count}`)
        .join(',');
      // Grouped by the occupant's POSITION FAMILY, not its raw class name —
      // CIG gives some symmetric mounts (a Nomad's two MSD-442 missile racks)
      // distinct per-side class names while a gimbal mount's stays
      // position-agnostic, so raw-class grouping folded the weapons but never
      // the racks (feedback #235: 'wie bei der Bewaffnung'). `grade` still
      // guards two genuinely different grades of the same base part apart.
      const groupKey = `${classNamePositionFamily(l.className) || ' '}|${l.size ?? ''}|${l.grade ?? ''}|${variantKey}`;

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
        statsNoteKey: overlay.state === 'pending' ? null : equippedStatsNoteKey(overlay.item),
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
        deltaPct: overlay.state === 'changed' ? this.headlineStatDeltaPct(item, overlay.item) : null,
        // Passive generator: desaturated, "nicht am Netz" (MASTER §6, B-C19).
        // `isPassiveShield` reads the resource block — or the port's own
        // `invisible` flag (4263fed1) — so on a schema-2 build (no
        // `ItemResourceComponentParams`, empty flags) every row honestly
        // stays 'active'.
        roleKey:
          r.section === 'shields' && overlay.className
            ? isPassiveShield({
                section: r.section,
                kind: overlay.item.kind,
                payload: overlay.item.payload,
                ammoPayload: overlay.item.ammoPayload,
                count: 1,
                passive: this.passiveByPort(r.section, l.port),
              })
              ? 'codex.module.badge.passive'
              : 'codex.module.badge.active'
            : null,
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
      notes: this.sectionNotes(section, slots),
    }));
  });

  // The shield block used to tag each row "Generator" or "Steuermodul" because
  // the control module sat inside it (1add86a4). 32659942 moved the controller
  // into the airframe — every row in the block is a shield again, so the tag
  // has nothing left to disambiguate and is gone with it.

  /**
   * Percent change of the headline stat (`stats[0]`, same key on both sides)
   * a changed slot causes versus its stock occupant — the module row's right
   * figure carries this as a delta chip (MASTER §6). `null` when either side
   * has no usable numeric headline stat, or the labels don't match (nothing
   * to compare).
   */
  private headlineStatDeltaPct(
    stockItem: { kind: CodexKind | null; payload: unknown; ammoPayload: unknown },
    draftItem: { kind: CodexKind | null; payload: unknown; ammoPayload: unknown },
  ): number | null {
    const from = equippedStats(stockItem)[0];
    const to = equippedStats(draftItem)[0];
    if (!from || !to || from.labelKey !== to.labelKey) return null;
    if (from.value === 0 || !Number.isFinite(from.value) || !Number.isFinite(to.value)) return null;
    const pct = Math.round(((to.value - from.value) / Math.abs(from.value)) * 100);
    return pct === 0 ? null : pct;
  }

  /** What a block can and cannot tell a pilot, said next to that block. */
  private sectionNotes(section: ShipModuleSection, slots: LayoutSlot[] = []): SectionNote[] {
    if (section === 'weapons' && this.emptyWeaponMounts() > 0) {
      return [{ key: 'codex.equipped.armamentMissing', params: { count: this.emptyWeaponMounts() } }];
    }
    if (section === 'shields') {
      const notes: SectionNote[] = [{ key: 'codex.moduleSection.shieldsNote' }];
      // The passive-shield explainer only earns its place once the block
      // actually holds one — three interchangeable generators, one of them
      // free of charge but riding on the others (MASTER §6 / B §2).
      const generatorCount = slots.filter((s) => s.className).length;
      const hasPassive = slots.some((s) => s.roleKey === 'codex.module.badge.passive');
      if (hasPassive || generatorCount > 1) {
        notes.push({ key: 'codex.module.shieldNote' });
      }
      return notes;
    }
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

  // ── component overlay (461288f9) ────────────────────────────────────────────
  /** The occupant currently open in the full-stat overlay, or null. */
  readonly inspected = signal<ComponentInspectEntry | null>(null);

  /** The weapon currently open in the P4K-sourced detail window (MASTER §10) —
   * `ⓘ` on a weapon row opens THIS instead of the generic component modal;
   * every other kind still uses `inspected`. */
  readonly weaponDetail = signal<WeaponDetailEntry | null>(null);

  closeWeaponDetail(): void {
    this.weaponDetail.set(null);
  }

  /**
   * Open the overlay for a clicked card. A sub-slot with nothing resolvable in
   * it has no stats to show, so it stays inert rather than opening an empty
   * window. Weapons open the dedicated detail window (MASTER §10) instead of
   * the generic component modal — it is the only one that groups by P4K
   * struct and marks what the game files do not carry.
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
    const resolvedKind = hit?.kind ?? source.kind;
    const ammoPayload = this.ammoPayloads().get(
      ammoClassNameFor(source.className, hit?.payload) ?? '',
    );
    if (resolvedKind === 'weapon') {
      this.weaponDetail.set({
        className: source.className,
        name: source.name || humanizeClassName(source.className),
        port: source.port,
        size: source.size,
        grade: source.grade,
        manufacturerCode: source.manufacturerCode,
        payload: hit?.payload ?? null,
        ammoPayload,
      });
      return;
    }
    this.inspected.set({
      className: source.className,
      kind: resolvedKind,
      name: source.name || humanizeClassName(source.className),
      port: source.port,
      count: ev.count,
      size: source.size,
      grade: source.grade,
      manufacturerCode: source.manufacturerCode,
      typeLabel: source.typeLabel,
      payload: hit?.payload ?? null,
      ammoPayload,
    });
  }

  closeInspect(): void {
    this.inspected.set(null);
  }

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

  /** Module census on the stage (feedback 140dfb7e) — see buildStageCounts. */
  readonly stageCounts = computed<StageCountChip[]>(() =>
    this.kind() === 'ship' ? buildStageCounts(this.kind(), this.moduleSections()) : [],
  );

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

  /**
   * Empty ports the toggle would reveal. Only the FIXED block folds anything
   * away now — every configurable section shows all of its hardpoints — so
   * counting a configurable empty here would promise rows the toggle never adds.
   */
  readonly hiddenEmptyCount = computed(
    () =>
      this.resolvedLoadout().filter((r) => r.section === 'structure' && !r.item.className).length,
  );

  readonly rawJson = computed(() => {
    const d = this.detail();
    return d ? JSON.stringify(d.payload, null, 2) : '';
  });

  // ── template helpers ─────────────────────────────────────────────────────────
  humanizePort(name: string | null): string {
    return name ? humanizePortType(name) : '—';
  }
  fmt(n: number): string {
    return formatNumber(n);
  }
  fmtQty(n: number): string {
    return formatQuantity(n);
  }
  fmtQuality(q: number | null): string {
    return formatQuality(q);
  }
  /** A recipe slot's quality floor that actually rules materials out (0 and 1 do not). */
  needsQuality(q: number | null): boolean {
    return hasQualityRequirement(q);
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
  /** Opens / closes the RSI pledge-link form (ShipLinkFormStore). */
  toggleLinkForm(): void {
    this.shipLinkForm.toggle();
  }

  async addToHangar(): Promise<void> {
    const d = this.detail();
    if (d?.kind !== 'ship') return;
    // A second click while the insert is in flight must not add the ship twice.
    if (this.addBusy()) return;
    this.addBusy.set(true);
    this.addFailed.set(false);
    try {
      const ship = await this.hangar.addShip(d.classNameSlug, 'owned');
      // UC-07: jump straight into the configurator instead of leaving a dead row.
      if (ship) await this.router.navigate(['/hangar/ship', ship.id]);
      else this.addFailed.set(true);
    } catch {
      this.addFailed.set(true);
    } finally {
      this.addBusy.set(false);
    }
  }

  toggleRaw(): void {
    this.showRaw.update((v) => !v);
  }
  toggleEmptyLoadout(): void {
    this.showEmptyLoadout.update((v) => !v);
  }
}
