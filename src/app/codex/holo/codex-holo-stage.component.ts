import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { CodexDetail } from '../codex.service';
import { CodexItemPort } from '../codex.types';
import type { StageCountChip } from '../codex-detail.component';
import { HoloSilhouette, SilhouetteAnchor } from '../holo-silhouette';
import { MissionId } from '../codex-mission';
import type { ShipCapabilities } from '../codex-mission';
import { KpiStripCell } from '../codex-kpi-sets';
import { CodexKpiBandComponent } from '../codex-kpi-band.component';
import { CodexMissionBarComponent } from '../codex-mission-bar.component';
import { CodexRankCardComponent } from '../codex-rank-card.component';
import {
  RankProfileId,
  RankResult,
  RankScope,
} from '../codex-rank';
import {
  CodexHardpointLayoutComponent,
  LayoutSection,
  LayoutTarget,
} from '../codex-hardpoint-layout.component';
import { ShipModuleSection } from '../ship-module-sections';
import {
  CodexDefensivePanelComponent,
  CodexOffensivePanelComponent,
  CodexShipPanelComponent,
  ShipFactGroup,
} from '../codex-analysis-panels.component';
import { OffensivePanel, DefensivePanel } from '../codex-loadout-stats';
import { PERSPECTIVE_KPIS, PERSPECTIVES, Perspective } from '../codex-build-compare';

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
 * anchors ∪ unresolved"). */
interface StagePin {
  portName: string;
  x: number;
  y: number;
  resolved: boolean;
}

/** One "Alle Werte" perspective tile. */
interface PerspectiveTile {
  id: Perspective;
  titleKey: string;
  gaugePct: number | null;
  cells: readonly KpiStripCell[];
}

const SOUND_PREF_KEY = 'sc.codex.holo.sound';

/**
 * The Holotable stage (Wave 2 · frontend). Purely presentational: every
 * value comes in as an input from `codex-detail.component.ts`, which keeps
 * owning the modals, swap picker, weapon detail, compare tray, energy dock,
 * draft persistence and hover-sync `activePorts` for BOTH views (item A).
 *
 * Integration slots for the Wave 2.5 sibling agents (item C) are left as
 * literal HTML comments — see wave2-stage.md for the exact contract each one
 * needs from this component's inputs/outputs.
 */
@Component({
  selector: 'sc-codex-holo-stage',
  standalone: true,
  imports: [
    TranslateModule,
    RouterLink,
    CodexKpiBandComponent,
    CodexMissionBarComponent,
    CodexRankCardComponent,
    CodexHardpointLayoutComponent,
    CodexOffensivePanelComponent,
    CodexDefensivePanelComponent,
    CodexShipPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="holo-stage" [class.reduced-motion]="reducedMotion()" [class.arrived]="arrived()">
      <!-- ── Einsatz bar = table header (no second profile selector) ── -->
      <header class="holo-einsatz">
        <p class="holo-eyebrow">
          @if (manufacturerName(); as mfr) { {{ mfr }} · }{{ displayName() }}
        </p>
        @if (stageCounts().length > 0) {
          <ul class="holo-chips">
            @for (s of stageCounts(); track s.group) {
              <li class="chip">
                {{ s.labelKey | translate: { n: s.count } }}
                @if (s.detailKey) { <span class="chip-detail">{{ s.detailKey | translate: { n: s.detailCount } }}</span> }
              </li>
            }
          </ul>
        }
        <sc-codex-kpi-band [cells]="kpiCells()" />
        <sc-codex-mission-bar
          [active]="activeMissionId()"
          [capabilities]="shipCapabilities()"
          [changed]="draftChangedCount()"
          (missionChange)="missionChange.emit($event)" />
      </header>

      <div class="holo-body">
        <!-- ── Left rail: Einordnung ─────────────────────────────── -->
        <aside class="holo-rail holo-left" [class.collapsed]="leftCollapsed()">
          <button type="button" class="rail-collapse" (click)="leftCollapsed.set(!leftCollapsed())"
                  [attr.aria-expanded]="!leftCollapsed()"
                  [attr.aria-label]="'codex.holo.stage.railToggle' | translate"
                  [title]="'codex.holo.stage.railToggle' | translate">◂</button>
          <div class="rail-body">
            <h2 class="rail-head">{{ 'codex.holo.stage.einordnung' | translate }}</h2>
            @if (rankResult(); as r) {
              <p class="watermark">{{ ('codex.mission.' + activeMissionId()) | translate }}</p>
            }
            <sc-codex-rank-card
              [shipName]="displayName()"
              [sizeClass]="null"
              [result]="rankResult()"
              [loading]="rankLoading()"
              [profile]="rankProfile()"
              [scope]="rankScope()"
              [disabledReasons]="rankDisabledReasons()"
              (profileChange)="rankProfileChange.emit($event)"
              (scopeChange)="rankScopeChange.emit($event)" />
            <a class="cohort-link" routerLink="/codex" [queryParams]="{ kind: 'ship' }">
              {{ 'codex.holo.stage.cohortLink' | translate }}
            </a>
            <!-- "Top-3 of the cohort" (named ships) is NOT built here — no
                 signal today carries a ranked ship list, only percentiles
                 (RankResult has no per-ship rows). Inventing names would
                 violate the "never invented" data rule; see wave2-stage.md
                 § Questions for the user. -->
          </div>
        </aside>

        <!-- ── Table: silhouette + pins + inspector ─────────────────── -->
        <section class="holo-table">
          <div class="table-toggles">
            <button type="button" class="tbl-toggle" (click)="viewMode.set('holo')" [class.active]="viewMode() === 'holo'">{{ 'codex.holo.stage.view3d' | translate }}</button>
            <button type="button" class="tbl-toggle" (click)="viewMode.set('schema')" [class.active]="viewMode() === 'schema'">{{ 'codex.holo.stage.viewSchema' | translate }}</button>
            <button type="button" class="tbl-toggle" (click)="copyShareLink.emit()">{{ 'codex.holo.stage.viewShare' | translate }}</button>
          </div>

          <!-- holo-slot: hangar-tab (needs: detail().classNameSlug, inHangar(), addToHangar output) -->

          <div class="silhouette-frame" #silhouetteFrame>
            @if (silhouette(); as s) {
              <svg class="silhouette" [attr.viewBox]="s.viewBox" preserveAspectRatio="xMidYMid meet" role="img"
                   [attr.aria-label]="'codex.holo.stage.silhouetteAria' | translate: { name: displayName() }">
                <path class="hull" [attr.d]="s.path" fill-rule="evenodd" />
              </svg>
            } @else {
              <div class="silhouette-placeholder" role="img" [attr.aria-label]="'codex.holo.noGeometry' | translate">
                <span class="ring"></span>
              </div>
              <p class="no-geometry-badge" [title]="'codex.holo.stage.noGeometryReason' | translate">
                {{ 'codex.holo.noGeometry' | translate }}
              </p>
            }
            @for (pin of pins(); track pin.portName) {
              <button
                type="button"
                class="pin"
                [class.unresolved]="!pin.resolved"
                [class.active]="activePorts().includes(pin.portName)"
                [style.left.%]="pin.x"
                [style.top.%]="pin.y"
                [attr.aria-pressed]="inspectedPort() === pin.portName"
                [attr.title]="pin.resolved ? pin.portName : ('codex.holo.pinUnresolved' | translate)"
                (mouseenter)="hovered.emit([pin.portName])"
                (mouseleave)="hovered.emit(null)"
                (click)="inspectPin(pin.portName)">
                <span class="sr-only">{{ pin.portName }}</span>
              </button>
            }
          </div>

          @if (inspectorTarget(); as it) {
            <div class="inspector" role="dialog" [attr.aria-label]="'codex.holo.stage.inspector' | translate">
              <button type="button" class="inspector-close" (click)="inspectedPort.set(null)"
                      [attr.aria-label]="'codex.swap.close' | translate">✕</button>
              <p class="inspector-port">{{ it.slot.port }}</p>
              <div class="inspector-actions">
                <button type="button" class="btn" (click)="swapRequested.emit(it)">
                  {{ 'codex.swap.open' | translate }}
                </button>
                <button type="button" class="btn quiet" (click)="inspected.emit(it)">
                  {{ 'codex.inspect.openStats' | translate }}
                </button>
              </div>
            </div>
          }
        </section>

        <!-- ── Right rail: Ports (calm list, no boxes) ──────────────── -->
        <aside class="holo-rail holo-right" [class.collapsed]="rightCollapsed()">
          <button type="button" class="rail-collapse" (click)="rightCollapsed.set(!rightCollapsed())"
                  [attr.aria-expanded]="!rightCollapsed()"
                  [attr.aria-label]="'codex.holo.stage.railToggle' | translate"
                  [title]="'codex.holo.stage.railToggle' | translate">▸</button>
          <div class="rail-body">
            <h2 class="rail-head">{{ 'codex.holo.stage.ports' | translate }}</h2>
            @for (group of allSections(); track group.section) {
              <div class="port-group">
                <button type="button" class="port-group-head" (click)="toggleGroupOpen(group.section)"
                        [attr.aria-expanded]="isGroupOpen(group.section)">
                  <span>{{ shipModuleGroupLabelKeyFor(group.section) | translate }}</span>
                  <span class="detail-toggle">{{ (isGroupOpen(group.section) ? 'codex.holo.stage.detailHide' : 'codex.holo.stage.detailShow') | translate }}</span>
                </button>
                @if (isGroupOpen(group.section)) {
                  <div class="port-group-body">
                    <label class="density-toggle">
                      <input type="checkbox" [checked]="isGroupDense(group.section)"
                             (change)="toggleGroupDense(group.section)" />
                      {{ 'codex.holo.stage.density' | translate }}
                    </label>
                    <sc-codex-hardpoint-layout
                      [sections]="[group]"
                      [locatablePorts]="locatablePorts()"
                      [activePorts]="activePorts()"
                      (reverted)="reverted.emit($event)"
                      (hovered)="hovered.emit($event)"
                      (inspected)="inspected.emit($event)"
                      (swapRequested)="swapRequested.emit($event)" />
                  </div>
                }
              </div>
            }
          </div>
        </aside>
      </div>

      <!-- holo-slot: strip (needs: kpiCells(), draftChangedCount(), open/close state — sticky bottom strip, below the table on desktop / sticky KPI slot on mobile) -->

      <!-- ── Perspectives ──────────────────────────────────────────── -->
      <section class="holo-perspectives">
        @for (tile of perspectiveTiles(); track tile.id) {
          <article class="perspective-tile">
            <h3>{{ tile.titleKey | translate }}</h3>
            @if (tile.gaugePct != null) {
              <div class="gauge" role="img" [attr.aria-label]="tile.gaugePct + '%'">
                <span class="gauge-fill" [style.width.%]="tile.gaugePct"></span>
              </div>
            } @else {
              <p class="gauge-gap">{{ 'codex.kpi.gap' | translate }}</p>
            }
            <ul class="tile-values">
              @for (c of tile.cells.slice(0, 3); track c.key) {
                <li>
                  <span class="tv-label">{{ c.labelKey | translate }}</span>
                  <span class="tv-value">{{ c.value != null ? c.value : '—' }}</span>
                </li>
              }
            </ul>
            <button type="button" class="tile-expand" (click)="toggleTileOpen(tile.id)"
                    [attr.aria-expanded]="isTileOpen(tile.id)">
              {{ (isTileOpen(tile.id) ? 'codex.holo.stage.allValuesHide' : 'codex.holo.stage.allValues') | translate }}
            </button>
            @if (isTileOpen(tile.id)) {
              <div class="tile-full">
                @if (tile.id === 'offensive') {
                  <sc-codex-offensive-panel [panel]="offensivePanel()" [startCollapsed]="false" />
                } @else if (tile.id === 'defensive') {
                  <sc-codex-defensive-panel [panel]="defensivePanel()" />
                } @else {
                  <sc-codex-ship-panel [groups]="shipFactGroups()" [startCollapsed]="false" />
                }
              </div>
            }
          </article>
        }
      </section>

      <!-- ── Change journal ────────────────────────────────────────── -->
      @if (journal().length > 0) {
        <section class="holo-journal">
          <h3>{{ 'codex.holo.stage.journal' | translate }}</h3>
          <ul>
            @for (e of journal(); track e.port) {
              <li>
                <span>{{ e.label }}</span>
                <span class="journal-state">{{ ('codex.loadout.draftState.' + e.state) | translate }}</span>
                <button type="button" class="btn quiet" (click)="reverted.emit(e.paths)">
                  {{ 'codex.loadout.revert' | translate }}
                </button>
              </li>
            }
          </ul>
          <button type="button" class="btn quiet" (click)="reverted.emit(journalAllPaths())">
            {{ 'codex.detail.actionFactoryLoadout' | translate }}
          </button>
        </section>
      }

      <!-- ── Details drawer (everything with no other home) ──────────── -->
      <section class="holo-details">
        <button type="button" class="details-toggle" (click)="detailsOpen.set(!detailsOpen())"
                [attr.aria-expanded]="detailsOpen()">
          {{ (detailsOpen() ? 'codex.holo.stage.detailsHide' : 'codex.holo.stage.detailsShow') | translate }}
        </button>
        @if (detailsOpen()) {
          <div class="details-body">
            <ng-content></ng-content>
          </div>
        }
      </section>

      <!-- holo-slot: patch-delta (needs: detail().classNameSlug, currently-active build id — inside the inspector) -->
      <!-- holo-slot: share (needs: copyShareLink output, current share URL — inside the Teilen popover) -->

      <p class="sound-setting">
        <label>
          <input type="checkbox" [checked]="soundOn()" (change)="toggleSound()" />
          {{ 'codex.holo.stage.sound' | translate }}
        </label>
      </p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .holo-stage { display: flex; flex-direction: column; gap: var(--sc-gap-1, 16px); }
    .holo-einsatz { display: flex; flex-direction: column; gap: 8px; }
    .holo-eyebrow { margin: 0; font-size: 12px; color: var(--sc-fg-1); }
    .holo-chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .holo-chips .chip { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--sc-bg-2); border: 1px solid var(--sc-border); color: var(--sc-fg-1); }
    .chip-detail { color: var(--sc-fg-2); margin-inline-start: 4px; }
    .holo-body { display: grid; grid-template-columns: 300px 1fr 300px; gap: var(--sc-gap-1, 16px); align-items: start; }
    @media (max-width: 1100px) {
      .holo-body { grid-template-columns: 44px 1fr 44px; }
      .holo-rail:not(.collapsed) { grid-column: 1 / -1; order: 3; }
    }
    @media (max-width: 768px) {
      .holo-body { grid-template-columns: 1fr; }
      .holo-rail { order: initial; }
    }
    .holo-rail { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; padding: var(--sc-pad-2, 12px); position: relative; }
    .holo-rail.collapsed .rail-body { display: none; }
    .rail-collapse { position: absolute; top: 8px; inset-inline-end: 8px; background: none; border: 1px solid var(--sc-border);
      border-radius: 4px; color: var(--sc-fg-1); min-height: var(--sc-tap-min, 32px); min-width: 32px; cursor: pointer; }
    .rail-head { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--sc-accent); }
    .watermark { margin: 0 0 8px; font-size: 11px; color: var(--sc-fg-2); font-style: italic; }
    .cohort-link { display: inline-block; margin-top: 8px; color: var(--sc-accent); font-size: 12px; }

    .holo-table { position: relative; background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; padding: var(--sc-pad-2, 12px); min-height: 360px; }
    .table-toggles { position: absolute; top: 8px; inset-inline-end: 8px; display: flex; gap: 6px; opacity: 0; transition: opacity 160ms ease; z-index: 2; }
    .holo-table:hover .table-toggles, .holo-table:focus-within .table-toggles { opacity: 1; }
    .tbl-toggle { min-height: var(--sc-tap-min, 32px); padding: 4px 8px; background: var(--sc-bg-2); border: 1px solid var(--sc-border);
      border-radius: 6px; color: var(--sc-fg-1); cursor: pointer; font-size: 11px; }
    .tbl-toggle.active { color: var(--sc-accent); border-color: var(--sc-accent); }

    .silhouette-frame { position: relative; width: 100%; min-height: 320px; display: flex; align-items: center; justify-content: center; }
    .silhouette { width: 100%; height: 320px; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 45%, transparent)); }
    .silhouette .hull { fill: color-mix(in srgb, var(--sc-accent) 12%, transparent); stroke: var(--sc-accent); stroke-width: 2; }
    .arrived .silhouette .hull { animation: holo-reveal 1.6s ease-out; }
    @keyframes holo-reveal { from { opacity: 0; } to { opacity: 1; } }
    .reduced-motion .silhouette .hull { animation: none; }
    .silhouette-placeholder { width: 220px; height: 220px; display: flex; align-items: center; justify-content: center; }
    .silhouette-placeholder .ring { width: 180px; height: 180px; border: 2px dashed var(--sc-border); border-radius: 50%; }
    .no-geometry-badge { position: absolute; bottom: 8px; inset-inline-start: 8px; margin: 0; font-size: 10px; color: var(--sc-fg-2); }

    .pin { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
      background: var(--sc-accent); border: 2px solid var(--sc-bg-0); cursor: pointer; padding: 0; }
    .pin.unresolved { background: transparent; border: 2px dashed var(--sc-fg-2); }
    .pin.active { box-shadow: 0 0 0 4px color-mix(in srgb, var(--sc-accent) 35%, transparent); }

    .inspector { position: absolute; bottom: 8px; inset-inline-end: 8px; width: min(260px, 90%); background: var(--sc-bg-0);
      border: 1px solid var(--sc-accent); border-radius: 8px; padding: 10px; z-index: 3; }
    .inspector-close { position: absolute; top: 4px; inset-inline-end: 6px; background: none; border: none; color: var(--sc-fg-2); cursor: pointer; min-height: var(--sc-tap-min, 24px); }
    .inspector-port { margin: 0 0 8px; font-size: 12px; color: var(--sc-fg-0); }
    .inspector-actions { display: flex; gap: 8px; }

    .port-group { border-top: 1px solid var(--sc-border); padding: 8px 0; }
    .port-group:first-child { border-top: none; }
    .port-group-head { display: flex; justify-content: space-between; width: 100%; background: none; border: none;
      color: var(--sc-fg-0); cursor: pointer; font: inherit; font-size: 12px; padding: 4px 0; min-height: var(--sc-tap-min, 32px); }
    .detail-toggle { color: var(--sc-accent); font-size: 11px; }
    .density-toggle { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--sc-fg-2); margin-bottom: 6px; }

    .holo-perspectives { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--sc-gap-2, 10px); }
    @media (max-width: 768px) { .holo-perspectives { grid-template-columns: 1fr 1fr; } }
    .perspective-tile { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; padding: var(--sc-pad-3, 10px); }
    .perspective-tile h3 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-accent); }
    .gauge { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--sc-fg-2) 16%, transparent); overflow: hidden; }
    .gauge-fill { display: block; height: 100%; background: var(--sc-accent); }
    .gauge-gap { margin: 0; font-size: 10px; color: var(--sc-fg-2); font-style: italic; }
    .tile-values { list-style: none; margin: 6px 0; padding: 0; font-size: 11px; color: var(--sc-fg-1); }
    .tile-values li { display: flex; justify-content: space-between; }
    .tile-expand { background: none; border: none; color: var(--sc-accent); font-size: 11px; cursor: pointer; padding: 0; min-height: var(--sc-tap-min, 24px); }

    .holo-journal { background: var(--sc-bg-1); border: 1px solid var(--sc-border); border-radius: 8px; padding: var(--sc-pad-2, 12px); }
    .holo-journal ul { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .holo-journal li { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .journal-state { color: var(--sc-fg-2); font-size: 10px; }

    .holo-details { border-top: 1px solid var(--sc-border); padding-top: 8px; }
    .details-toggle { background: none; border: 1px solid var(--sc-border); border-radius: 6px; color: var(--sc-fg-1);
      cursor: pointer; padding: 6px 10px; min-height: var(--sc-tap-min, 32px); font-size: 12px; }
    .details-body { margin-top: 10px; display: flex; flex-direction: column; gap: 12px; }

    .sound-setting { margin: 0; font-size: 11px; color: var(--sc-fg-2); }
    .btn { min-height: var(--sc-tap-min, 32px); padding: 4px 10px; border-radius: 6px; border: 1px solid var(--sc-border);
      background: var(--sc-bg-2); color: var(--sc-fg-0); cursor: pointer; font: inherit; }
    .btn.quiet { background: none; }
  `],
})
export class CodexHoloStageComponent {
  // ── Identity / chrome ────────────────────────────────────────────
  readonly detail = input.required<CodexDetail>();
  readonly displayName = input.required<string>();
  readonly manufacturerName = input<string | null>(null);
  readonly stageCounts = input<readonly StageCountChip[]>([]);

  // ── Hover-sync / ports ───────────────────────────────────────────
  readonly activePorts = input<readonly string[]>([]);
  readonly locatablePorts = input<readonly string[]>([]);
  readonly primaryModuleSections = input<readonly LayoutSection[]>([]);
  readonly tailModuleSections = input<readonly LayoutSection[]>([]);

  // ── Silhouette ───────────────────────────────────────────────────
  readonly silhouette = input<HoloSilhouette | null>(null);

  // ── Einsatz bar / KPI ────────────────────────────────────────────
  readonly kpiCells = input<readonly KpiStripCell[]>([]);
  readonly activeMissionId = input.required<MissionId>();
  readonly shipCapabilities = input.required<ShipCapabilities>();
  readonly draftChangedCount = input(0);

  // ── Rank / radar ─────────────────────────────────────────────────
  readonly rankResult = input<RankResult | null>(null);
  readonly rankLoading = input(false);
  readonly rankProfile = input<RankProfileId>('combat');
  readonly rankScope = input<RankScope>('sizeClass');
  readonly rankDisabledReasons = input<Partial<Record<RankProfileId, string | null>>>({});

  // ── Perspectives (reuse today's analysis panels for "Alle Werte") ──
  readonly offensivePanel = input<OffensivePanel | null>(null);
  readonly defensivePanel = input<DefensivePanel | null>(null);
  readonly shipFactGroups = input<readonly ShipFactGroup[]>([]);

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
  readonly copyShareLink = output<void>();

  // ── Local, purely-presentational view state ───────────────────────
  readonly leftCollapsed = signal(false);
  readonly rightCollapsed = signal(false);
  readonly viewMode = signal<'holo' | 'schema'>('holo');
  readonly detailsOpen = signal(false);
  readonly inspectedPort = signal<string | null>(null);
  private readonly openGroups = signal<ReadonlySet<ShipModuleSection>>(new Set());
  private readonly denseGroups = signal<ReadonlySet<ShipModuleSection>>(new Set());
  private readonly openTiles = signal<ReadonlySet<Perspective>>(new Set());
  readonly arrived = signal(false);
  readonly soundOn = signal(this.readSoundPref());

  constructor() {
    effect(() => {
      // Reduced motion = hard cut (no transformation). A repeat visit in the
      // same session also cuts straight to the arrived state (concept:
      // "repeat visit in the session = cut only").
      if (this.reducedMotion() || this.seenThisSession()) {
        this.arrived.set(true);
        return;
      }
      const t = setTimeout(() => this.arrived.set(true), 1600);
      return () => clearTimeout(t);
    });
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

  /** Opt-in-only UI sound: a short WebAudio oscillator blip, no audio asset. */
  private blip(): void {
    try {
      const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
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

  // ── Ports list (right rail) ───────────────────────────────────────
  readonly allSections = computed<readonly LayoutSection[]>(() => [
    ...this.primaryModuleSections(),
    ...this.tailModuleSections(),
  ]);

  isGroupOpen(section: ShipModuleSection): boolean {
    return this.openGroups().has(section);
  }
  toggleGroupOpen(section: ShipModuleSection): void {
    const next = new Set(this.openGroups());
    next.has(section) ? next.delete(section) : next.add(section);
    this.openGroups.set(next);
  }
  isGroupDense(section: ShipModuleSection): boolean {
    return this.denseGroups().has(section);
  }
  toggleGroupDense(section: ShipModuleSection): void {
    const next = new Set(this.denseGroups());
    next.has(section) ? next.delete(section) : next.add(section);
    this.denseGroups.set(next);
  }
  shipModuleGroupLabelKeyFor(section: ShipModuleSection): string {
    return `codex.moduleSection.${section}`;
  }

  // ── Silhouette pins — derived from detail().ports, per the red-team note
  // (wave1-redteam.md: "Wave 2 derives pins from detail.ports, not from
  // anchors ∪ unresolved") ───────────────────────────────────────────
  readonly pins = computed<StagePin[]>(() => {
    const s = this.silhouette();
    const ports: readonly CodexItemPort[] = this.detail()?.ports ?? [];
    if (!s) return [];
    const byPort = new Map<string, SilhouetteAnchor>(s.anchors.map((a) => [a.portId, a]));
    let fallbackIndex = 0;
    return ports
      .filter((p) => !!p.portName)
      .map((p) => {
        const anchor = byPort.get(p.portName!);
        if (anchor) {
          return { portName: p.portName!, x: anchor.x, y: anchor.y, resolved: true };
        }
        // Deterministic fallback ring position for a port with no anchor and
        // no `unresolved[]` entry either (§C3: "same as unresolved").
        const n = ports.length || 1;
        const angle = (Math.PI * 2 * fallbackIndex) / n;
        fallbackIndex += 1;
        return {
          portName: p.portName!,
          x: 50 + 48 * Math.cos(angle),
          y: 50 + 48 * Math.sin(angle),
          resolved: false,
        };
      });
  });

  readonly inspectorTarget = computed<LayoutTarget | null>(() => {
    const port = this.inspectedPort();
    if (!port) return null;
    for (const section of this.allSections()) {
      const slot = section.slots.find((s) => (s.rawPort ?? s.port) === port);
      if (slot) return { slot, count: 1, child: null, rawPorts: [port] };
    }
    return null;
  });

  inspectPin(port: string): void {
    this.inspectedPort.set(this.inspectedPort() === port ? null : port);
  }

  // ── Perspectives ─────────────────────────────────────────────────
  readonly perspectiveTiles = computed<PerspectiveTile[]>(() => {
    const cells = this.kpiCells();
    const rank = this.rankResult();
    return PERSPECTIVES.map((id) => {
      const keys = PERSPECTIVE_KPIS[id];
      const tileCells = cells.filter((c) => (keys as readonly string[]).includes(c.key));
      const ranked = rank
        ? rank.axes.filter((a) => (keys as readonly string[]).includes(a.key) && a.percentile != null)
        : [];
      const gaugePct = ranked.length > 0
        ? Math.round(ranked.reduce((sum, a) => sum + (a.percentile ?? 0), 0) / ranked.length)
        : null;
      return {
        id,
        titleKey: `codex.holo.stage.perspective.${id}`,
        gaugePct,
        cells: tileCells,
      };
    });
  });

  isTileOpen(id: Perspective): boolean {
    return this.openTiles().has(id);
  }
  toggleTileOpen(id: Perspective): void {
    const next = new Set(this.openTiles());
    next.has(id) ? next.delete(id) : next.add(id);
    this.openTiles.set(next);
  }

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
