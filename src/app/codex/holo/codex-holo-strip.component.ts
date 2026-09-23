// Holotable sticky bottom strip (concept 2026-09-20, iteration 10 `strip_final`,
// wave2 scope A). Layout: Einsatz -> arrow -> Offensive/Verteidigung/Bewegung
// mini perspective tiles -> ring joint (no label) -> Signatur & Kühlung -> an
// open/close toggle ONLY (no energy segment while collapsed). Expanded panel
// under the right end carries SCM/NAV + "Schleichen" preset, the pip stacks,
// the cooling gauge AND the energy summary (inventory #52 in full).
//
// Reuses `codex-power.ts` (the SAME model `sc-codex-energy-dock` computes
// from) rather than re-deriving the reactor/cooling maths, and
// `codex-build-compare.ts`'s `PERSPECTIVE_KPIS` (the SAME grouping the
// patch-Δ view uses) to sort `KpiStripCell`s into the three mini tiles —
// see wave1-core-web.md / wave0-research.md §A row 25/52 for the sources.
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { ICON_PATHS } from '../codex-category-icon.component';
import { PERSPECTIVE_KPIS, Perspective } from '../codex-build-compare';
import { formatNumber } from '../codex-format';
import { formatEquippedStat } from '../codex-equipped-stats';
import { KpiStripCell } from '../codex-kpi-sets';
import {
  DEFAULT_POWER_DRAFT,
  PowerDraftState,
  decodePowerParam,
  dockPositionStorageKey,
  encodePowerParam,
  parseLocalPowerDraft,
  powerStorageKey,
  serializeLocalPowerDraft,
} from '../codex-loadout-draft';
import { MISSIONS, MissionId, ShipCapabilities, missionById } from '../codex-mission';
import {
  FlightMode,
  PowerColumnKey,
  PowerFactKey,
  PowerGroup,
  PowerGroupRow,
  PowerLevels,
  PowerPreset,
  PowerSheet,
  clickPowerPip,
  computePowerSheet,
  coolerUnitCount,
  isFlightMode,
  migrateLegacyCoolerDraft,
  parsePowerGroups,
  parsePowerLevels,
  resetPowerState,
  togglePowerGroup,
} from '../codex-power';
import { RankResult } from '../codex-rank';
import type { SummaryOccupant } from '../ship-summary-panels';

const GROUP_ICON: Readonly<Record<PowerGroup, string>> = {
  weapons: 'weapon',
  shields: 'shield',
  thrusters: 'thruster',
  coolers: 'cooler',
  radar: 'radar',
  life: 'lifeSupport',
  quantum: 'quantum',
  tractor: 'tractor',
};

/** The two rank axes that overlap {@link PowerFactKey} 1:1 — used for the
 * "class-rank pips" beside Signatur & Kühlung. `em`/`coolant` have no rank
 * axis of their own (chosen attribute: pips reflect ir+crossSection only). */
const SIGNATURE_RANK_KEYS: readonly ('ir' | 'crossSection')[] = ['ir', 'crossSection'];

const PERSPECTIVE_TILES: readonly Perspective[] = ['offensive', 'defensive', 'movement'];

/** Cell order inside a strip tile — the headline first (concept round 10:
 * Alpha · Salve · Dauer | Schild-HP · Regen | Boost · SCM). */
const STRIP_TILE_ORDER: Readonly<Record<Perspective, readonly string[]>> = {
  offensive: ['alpha', 'burstDps', 'sustainedDps', 'missiles'],
  defensive: ['shieldHp', 'shieldRegen', 'hullHp', 'effectiveHp', 'armorHp'],
  movement: ['boost', 'scm', 'maxSpeed', 'agility', 'quantumRange', 'quantumSpeed', 'spool', 'mass', 'cargo'],
  signature: ['ir', 'emMax', 'crossSection', 'emIdle'],
};

interface PerspectiveTile {
  perspective: Perspective;
  labelKey: string;
  percentile: number | null;
  cells: readonly KpiStripCell[];
}

let uidSeq = 0;

@Component({
  selector: 'sc-codex-holo-strip',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-strip" [class.open]="expanded()">
      <div class="hs-row">
        <div class="seg einsatz">
          <span class="lab">{{ 'codex.holo.strip.einsatz' | translate }}</span>
          <span class="val">◈ {{ activeMissionLabel() | translate }}</span>
          @if (rankResult(); as r) {
            <span class="sub">{{ 'codex.holo.strip.shipCount' | translate: { n: r.cohortSize } }}@if (r.overall != null) { · <span class="pct pulse">P{{ roundPct(r.overall) }}</span> }</span>
          } @else if (rankCohortLoading()) {
            <span class="sub gapv">{{ 'codex.kpi.gap' | translate }}</span>
          }
        </div>

        <span class="arrow" aria-hidden="true">→</span>

        @for (tile of perspectiveTiles(); track tile.perspective) {
          <div class="seg tile" [attr.data-p]="tile.perspective">
            <span class="lab"><span class="lt">{{ tile.labelKey | translate }}</span>@if (tile.percentile != null) { <span class="pct">P{{ tile.percentile }}</span> }</span>
            <div class="tile-vals">
              @for (c of tile.cells; track c.key) {
                <span class="tv">
                  <span class="k">{{ ('codex.kpi.short.' + c.key) | translate }}</span>
                  <span class="v pulse">{{ fmtCell(c) }}</span>
                  @if (deltaTone(c); as tone) {
                    <span class="d" [class.up]="tone === 'up'" [class.down]="tone === 'down'"
                      >{{ c.delta!.raw > 0 ? '+' : '−' }}{{ fmt(absDelta(c)) }}</span
                    >
                  }
                </span>
              }
            </div>
          </div>
        }

        <span class="joint" aria-hidden="true"></span>

        <div class="seg sig" data-p="signature">
          <span class="lab"><span class="lt">{{ 'codex.holo.strip.signature' | translate }}</span>@if (signaturePercentile(); as p) { <span class="pct">P{{ p }}</span> }</span>
          <span class="rankpips" [attr.aria-label]="'codex.holo.strip.signatureRank' | translate: { n: signatureRankFill() }">
            @for (n of pipFive; track n) {
              <i [class.on]="n <= signatureRankFill()"></i>
            }
          </span>
          <span class="tipw fact">
            <button type="button" class="tip-trigger">{{ 'codex.energy.fact.ir' | translate }}</button>
            <span class="v pulse">{{ fmtKm(irFact()?.value) }}<small>km</small></span>
            <span class="tipbox" role="tooltip">{{ fmtM(irFact()?.value) }}&nbsp;m</span>
          </span>
          <span class="tipw fact">
            <button type="button" class="tip-trigger">{{ 'codex.energy.fact.em' | translate }}</button>
            <span class="v pulse">{{ fmtKm(emFact()?.value) }}<small>km</small></span>
            <span class="tipbox" role="tooltip">{{ fmtM(emFact()?.value) }}&nbsp;m</span>
          </span>
          <span class="tipw fact">
            <button type="button" class="tip-trigger">{{ 'codex.energy.fact.crossSection' | translate }}</button>
            <span class="v pulse">{{ fmtKm(csFact()?.value) }}<small>km</small></span>
            <span class="tipbox" role="tooltip">{{ fmtM(csFact()?.value) }}&nbsp;m</span>
          </span>
          <span class="tipw fact">
            <button type="button" class="tip-trigger">{{ 'codex.holo.strip.cooling' | translate }}</button>
            <span class="v pulse">{{
              sheet().coolant.used == null
                ? '—'
                : ('codex.holo.strip.coolingValue' | translate: { used: sheet().coolant.used, total: sheet().coolant.total })
            }}</span>
          </span>
        </div>

        <button
          type="button"
          class="hs-toggle"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="panelId"
          [title]="(expanded() ? 'codex.holo.strip.collapse' : 'codex.holo.strip.expand') | translate"
          (click)="toggleExpanded()"
        >
          <span aria-hidden="true">{{ expanded() ? '▾' : '▴' }}</span>
          <span class="sr-only">{{ (expanded() ? 'codex.holo.strip.collapse' : 'codex.holo.strip.expand') | translate }}</span>
        </button>
      </div>

      @if (expanded()) {
        <div class="hs-panel" [id]="panelId" (keydown.escape)="dismissTooltips()" (focusin)="reopenTooltips()" (pointerenter)="reopenTooltips()">
          <div class="hp-modes">
            <div class="seg-pick" role="radiogroup" [attr.aria-label]="'codex.energy.mode.label' | translate">
              @for (m of modes; track m) {
                <button type="button" class="m" [class.on]="mode() === m" role="radio" [attr.aria-checked]="mode() === m" (click)="setMode(m)">
                  {{ ('codex.energy.mode.' + m) | translate }}
                </button>
              }
            </div>
            <button type="button" class="m preset" [class.on]="preset() === 'stealth'" (click)="setPreset('stealth')">
              {{ 'codex.holo.strip.stealthPreset' | translate }}<small>{{ 'codex.holo.strip.presetTag' | translate }}</small>
            </button>
            <button type="button" class="m preset" [class.on]="preset() === 'auto'" (click)="setPreset('auto')">
              {{ 'codex.energy.preset.auto' | translate }}
            </button>
          </div>

          @if (sheet().available) {
            <div class="hp-pips" [style.--pips]="maxPips()">
              @for (row of sheet().groups; track row.key) {
                <div class="hp-col" [class.off]="row.state === 'off'" [class.act]="row.state === 'active'" [class.absent]="row.state === 'absent'">
                  <div
                    class="stack"
                    role="group"
                    [attr.aria-label]="row.labelKey | translate: row.labelParams"
                    (keydown.arrowUp)="stepPipFocus($event, 1)"
                    (keydown.arrowDown)="stepPipFocus($event, -1)"
                  >
                    @for (pip of row.pips; track $index) {
                      <button
                        type="button"
                        class="pip"
                        [class.on]="pip.kind === 'on'"
                        [class.min]="pip.kind === 'min'"
                        [attr.data-n]="pip.numeral"
                        [attr.aria-pressed]="pip.kind !== 'empty'"
                        [attr.aria-label]="
                          'codex.energy.pip.level' | translate: { group: (row.labelKey | translate: row.labelParams), n: $index + 1, m: row.capacity }
                        "
                        [disabled]="!pipsEnabled(row)"
                        (click)="clickPip(row, $index + 1)"
                      ></button>
                    } @empty {
                      <span class="pip ghost" aria-hidden="true"></span>
                    }
                  </div>
                  <div class="tipw">
                    <button type="button" class="grp-btn" [attr.aria-pressed]="row.cut" [attr.aria-label]="(row.cut ? 'codex.energy.toggleOn' : 'codex.energy.toggleOff') | translate: { group: row.labelKey | translate: row.labelParams }" (click)="toggleGroup(row.key)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">
                        <path [attr.d]="iconPath(row.group)" />
                      </svg>
                    </button>
                    <div class="tipbox" role="tooltip">
                      <b>{{ row.tooltipTitleKey | translate: row.labelParams }}</b>
                      <p>{{ row.tooltipBodyKey | translate }}</p>
                    </div>
                  </div>
                </div>
              }
            </div>
          } @else {
            <p class="gapv">{{ 'codex.energy.gap.noReactorData' | translate }}</p>
          }

          <div class="hp-right">
            <div class="hp-cooling tipw">
              <svg viewBox="0 0 64 64" aria-hidden="true">
                <circle class="tr" cx="32" cy="32" r="26" />
                @if (sheet().coolant.percent !== null) {
                  <circle class="va" [class.over]="sheet().coolant.percent! > 100" cx="32" cy="32" r="26" [attr.stroke-dasharray]="coolDash(sheet().coolant.percent!)" />
                }
                <text class="p" x="32" y="31">{{ sheet().coolant.percent !== null ? sheet().coolant.percent + ' %' : '—' }}</text>
                <text class="l" x="32" y="42">{{ 'codex.holo.strip.cooling' | translate }}</text>
              </svg>
              <div class="hp-cool-txt">
                @if (sheet().coolant.used != null) {
                  <span class="v">{{ 'codex.holo.strip.coolingValue' | translate: { used: sheet().coolant.used, total: sheet().coolant.total } }}</span>
                  <span class="k">{{ 'codex.holo.strip.cooling' | translate }}</span>
                } @else {
                  <span class="gapv">{{ 'codex.energy.gap.noCoolingData' | translate }}</span>
                }
              </div>
            </div>

            <div class="hp-summary">
              @if (sheet().available) {
                <span class="v">{{ sheet().budgetUsed }}&nbsp;/&nbsp;{{ sheet().budgetTotal }} <small>{{ 'codex.energy.unit.segments' | translate }}</small></span>
                <span class="ok" [class.no]="!sheet().ready" [attr.title]="(sheet().ready ? 'codex.energy.readiness.shortOk' : 'codex.energy.readiness.shortNo') | translate">
                  {{ sheet().ready ? '✓' : '✕' }} {{ (sheet().ready ? 'codex.energy.readiness.shortOk' : 'codex.energy.readiness.shortNo') | translate }}
                </span>
              } @else {
                <span class="gapv">—</span>
              }
              <span class="mode">{{ ('codex.energy.mode.' + mode()) | translate }}</span>
              <button type="button" class="m reset" (click)="reset()">{{ 'codex.energy.preset.reset' | translate }}</button>
            </div>
            @if (sheet().available) {
              <p class="draft-note">{{ 'codex.energy.draftNote' | translate }}</p>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; position: sticky; inset-block-end: 0; z-index: 14;
        --hs-mono: var(--font-monospace, 'Share Tech Mono', monospace);
        --p-offensive: var(--sc-accent);
        --p-defensive: var(--cat-game, #c07888);
        --p-movement: var(--sc-success);
        --p-signature: var(--accent-gold, #c8a84b); }
      .holo-strip {
        background: color-mix(in srgb, var(--sc-bg-0) 94%, transparent);
        backdrop-filter: blur(6px);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-bg-0));
        border-block-end: 0;
        border-radius: 4px 4px 0 0;
        box-shadow: 0 -10px 30px rgb(0 0 0 / 0.5);
        color: var(--sc-fg-0);
        font-size: max(12px, var(--sc-fs-floor));
      }
      .hs-row { display: flex; align-items: stretch; gap: 0; padding: 0; overflow-x: auto; min-block-size: 62px; }
      .seg { display: flex; flex-direction: column; justify-content: center; gap: 3px; padding: 7px 10px; min-width: 0; flex: none;
        border-inline-end: 1px solid var(--sc-border); border-block-start: 2px solid transparent; }
      .seg[data-p="offensive"] { border-block-start-color: var(--p-offensive); }
      .seg[data-p="defensive"] { border-block-start-color: var(--p-defensive); }
      .seg[data-p="movement"] { border-block-start-color: var(--p-movement); }
      .seg[data-p="signature"] { border-block-start-color: var(--p-signature); }
      .seg .lab { display: inline-flex; align-items: baseline; gap: 8px; font-family: var(--sc-font-display); font-size: max(8px, var(--sc-fs-floor));
        letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2); white-space: nowrap; }
      .einsatz { background: color-mix(in srgb, var(--sc-accent) 7%, transparent); min-inline-size: 132px; }
      .einsatz .val { font-family: var(--sc-font-display); font-size: max(11.5px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
      .einsatz .sub { font-family: var(--hs-mono); font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .pct { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; color: var(--sc-fg-1); letter-spacing: 0; font-size: max(9.5px, var(--sc-fs-floor)); }
      .seg[data-p="offensive"] .pct { color: var(--p-offensive); }
      .seg[data-p="defensive"] .pct { color: var(--p-defensive); }
      .seg[data-p="movement"] .pct { color: var(--p-movement); }
      .seg[data-p="signature"] .pct { color: var(--p-signature); }
      .arrow { align-self: center; color: var(--sc-fg-2); flex: none; padding: 0 6px; }
      .tile-vals { display: flex; gap: 10px; flex-wrap: nowrap; }
      .tv { display: flex; flex-direction: column; gap: 1px; }
      .tv .k { font-family: var(--sc-font-display); font-size: max(7.5px, var(--sc-fs-floor)); color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.12em; white-space: nowrap; }
      .tv .v { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; font-size: 14px; line-height: 1.1; color: var(--sc-fg-0); white-space: nowrap; }
      .d { font-family: var(--hs-mono); font-size: max(9.5px, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; }
      .d.up { color: var(--sc-success); }
      .d.down { color: var(--sc-danger); }
      /* the ring joint on the colour bridge — no label (concept it.8). */
      .joint { align-self: center; inline-size: 16px; block-size: 16px; border-radius: 50%; margin-inline: 6px;
        border: 2px solid var(--p-signature); flex: none;
        background: radial-gradient(circle, color-mix(in srgb, var(--p-signature) 35%, transparent), transparent 70%);
        box-shadow: 0 0 10px color-mix(in srgb, var(--p-signature) 45%, transparent); }
      .sig { flex-direction: row; align-items: center; gap: 10px; flex: 0 1 auto; }
      .sig .lab { align-self: center; }
      .rankpips { display: inline-flex; gap: 2px; align-self: center; }
      .rankpips i { display: block; inline-size: 4px; block-size: 10px; border-radius: 1px;
        background: color-mix(in srgb, var(--sc-fg-2) 25%, transparent); font-style: normal; }
      .rankpips i.on { background: var(--p-signature); }
      .fact { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; }
      .fact .v { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; font-size: 14px; line-height: 1.1; white-space: nowrap; }
      .fact .v small { color: var(--sc-fg-2); margin-inline-start: 3px; font-size: 10px; }
      .tip-trigger { border: none; background: transparent; padding: 0; margin: 0; font: inherit; cursor: help; font-family: var(--sc-font-display);
        font-size: max(7.5px, var(--sc-fs-floor)); color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.12em; }
      .hs-toggle {
        align-self: stretch; margin-inline-start: auto; flex: none;
        min-inline-size: var(--sc-tap-min, 44px); min-block-size: var(--sc-tap-min);
        border: none; border-inline-start: 1px solid var(--sc-border); background: transparent;
        color: var(--sc-accent); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px;
      }
      .hs-toggle:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .tipw { position: relative; }
      .tipbox { display: block; visibility: hidden; opacity: 0; transition: opacity 0.12s ease;
        position: absolute; inset-block-end: calc(100% + 8px); inset-inline-start: 50%; transform: translateX(-50%);
        inline-size: max-content; max-inline-size: 180px; padding: 6px 8px; background: var(--sc-bg-2);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0)); border-radius: 4px;
        font-size: max(11px, var(--sc-fs-floor)); z-index: 20; }
      .tipw:hover .tipbox, .tipw:focus-within .tipbox { visibility: visible; opacity: 1; }
      .gapv { color: var(--sc-fg-2); }

      /* Expanded: modes | pips | cooling (concept round 6 "Energie-Zeile":
         Modi links, Pips Mitte, Kühlung rechts — one instrument, one row). */
      .hs-panel { border-block-start: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent);
        padding: 12px 14px; display: grid; grid-template-columns: 180px 1fr 250px; gap: 22px; align-items: center; }
      .hp-modes { display: grid; gap: 6px; padding-inline-end: 22px; border-inline-end: 1px solid var(--sc-border); }
      .seg-pick { display: grid; gap: 6px; }
      .m { display: flex; align-items: center; justify-content: space-between; gap: 8px; border: 1px solid var(--sc-border); border-radius: 3px;
        background: transparent; color: var(--sc-fg-1); padding: 5px 10px; min-block-size: var(--sc-tap-min, 30px); cursor: pointer;
        font-family: var(--sc-font-display); font-size: max(9.5px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; text-align: start; }
      .m small { font-family: var(--hs-mono); letter-spacing: 0; text-transform: none; font-size: 9px; color: var(--sc-fg-2); }
      .m.on { color: var(--sc-accent); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .m.preset { border-style: dashed; border-color: rgba(var(--accent-gold-rgb, 200, 168, 75), 0.5); color: var(--p-signature); }
      .m.preset.on { background: rgba(var(--accent-gold-rgb, 200, 168, 75), 0.12); border-style: solid; border-color: var(--p-signature); }
      .m.reset { justify-content: center; padding: 3px 8px; min-block-size: 26px; font-size: max(8.5px, var(--sc-fs-floor)); }
      .hp-pips { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; --pip-h: 9px; --pip-gap: 2px; --pip-w: 22px; --pips: 1; }
      .hp-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .stack { display: flex; flex-direction: column-reverse; gap: var(--pip-gap);
        block-size: calc(var(--pips) * var(--pip-h) + (var(--pips) - 1) * var(--pip-gap)); min-block-size: 30px; }
      .stack .pip { inline-size: var(--pip-w); block-size: var(--pip-h); border: none; border-radius: 2px;
        background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); cursor: pointer; padding: 0; }
      .stack .pip.on { background: var(--sc-accent); }
      .stack .pip.min { background: var(--sc-warn); }
      .hp-col.off .stack .pip { background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent); }
      .hp-col.absent .stack .pip { background: color-mix(in srgb, var(--sc-fg-2) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 30%, transparent); }
      .grp-btn { min-inline-size: var(--sc-tap-min); min-block-size: var(--sc-tap-min); border: 1px solid transparent;
        border-radius: 3px; background: transparent; color: var(--sc-fg-2); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; }
      .hp-col.act .grp-btn { color: var(--sc-accent); }
      .ico { width: 16px; height: 16px; }
      .hp-right { display: grid; gap: 6px; padding-inline-start: 22px; border-inline-start: 1px solid var(--sc-border); }
      .hp-cooling { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: center; }
      .hp-cooling svg { width: 64px; height: 64px; display: block; }
      .hp-cooling .tr { fill: none; stroke: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); stroke-width: 7; }
      .hp-cooling .va { fill: none; stroke: var(--sc-accent); stroke-width: 7; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
      .hp-cooling .va.over { stroke: var(--sc-danger); }
      .hp-cooling text { font-family: var(--hs-mono); font-size: 12px; fill: var(--sc-fg-0); text-anchor: middle; }
      .hp-cooling text.l { font-family: var(--sc-font-display); font-size: 5.5px; letter-spacing: 0.12em; fill: var(--sc-fg-2); text-transform: uppercase; }
      .hp-cool-txt { display: grid; gap: 1px; }
      .hp-cool-txt .v { font-family: var(--hs-mono); font-size: 14px; color: var(--sc-fg-0); }
      .hp-cool-txt .k { font-family: var(--sc-font-display); font-size: max(8px, var(--sc-fs-floor)); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-2); }
      .hp-summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-variant-numeric: tabular-nums; color: var(--sc-fg-1); }
      .hp-summary .v { font-family: var(--hs-mono); font-size: 13px; color: var(--sc-fg-0); }
      .hp-summary .v small { font-size: 10px; color: var(--sc-fg-2); }
      .hp-summary .mode { font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.12em; font-size: max(8.5px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .hp-summary .ok { font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-success, #4caf50); }
      .hp-summary .ok.no { color: var(--sc-danger, #ff5252); }
      .draft-note { margin: 0; font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
      @media (max-width: 1100px) {
        .hs-panel { grid-template-columns: 1fr; gap: 12px; }
        .hp-modes { padding-inline-end: 0; border-inline-end: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .seg-pick { grid-template-columns: 1fr 1fr; grid-column: 1 / -1; }
        .hp-right { padding-inline-start: 0; border-inline-start: 0; }
      }

      /* concept it.1 fb-ready count-up pulse — reduced away below. */
      .pulse { transition: color 0.4s ease; }

      /* Phone: the sticky KPI row keeps one value per perspective (concept
         mo5-stack "sticky Kennzahl-Zeile"); the rest lives in the expanded sheet. */
      @media (max-width: 900px) {
        .tile-vals .tv + .tv { display: none; }
        .sig .fact + .fact { display: none; }
        .arrow, .joint { display: none; }
        .seg { padding: 6px 8px; }
        .einsatz { min-inline-size: 0; }
        .einsatz .sub { display: none; }
        .sig { gap: 8px; }
        .sig .lab { max-inline-size: 64px; white-space: normal; line-height: 1.15; }
      }
      @media (max-width: 640px) {
        .holo-strip { position: fixed; inset-inline: 0; inset-block-end: 0; border-radius: 0; }
        .hs-row { min-block-size: 52px; }
        .seg { padding: 5px 7px; flex: 1 1 0; }
        .seg .lab .lt { display: none; }
        .seg .lab { gap: 0; }
        .tile-vals .tv .k { display: none; }
        .rankpips { display: none; }
        .sig .lab { max-inline-size: none; }
        .tip-trigger { display: none; }
        .einsatz .val { font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.08em; }
        .hs-toggle { min-inline-size: 36px; }
        .hs-panel { position: fixed; inset-inline: 0; inset-block-end: 0; max-block-size: 70vh; overflow-y: auto;
          background: var(--sc-bg-1); border-block-start: 1px solid var(--sc-accent); }
      }
      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; animation: none !important; }
      }
    `,
  ],
})
export class CodexHoloStripComponent {
  // ── mirrors sc-codex-energy-dock's inputs 1:1 ──────────────────────────
  readonly occupants = input.required<readonly SummaryOccupant[]>();
  readonly shipStats = input<Record<string, Record<string, string | number | boolean | null>> | null>(null);
  readonly shipClassName = input.required<string>();
  readonly schemaVersion = input<number | null>(null);
  readonly userId = input<string | null>(null);
  readonly crossSection = input<number | null>(null);
  readonly sheetChange = output<PowerSheet>();

  // ── mirrors sc-codex-kpi-band's input 1:1 ──────────────────────────────
  readonly cells = input.required<readonly KpiStripCell[]>();

  // ── mirrors sc-codex-mission-bar's inputs/output 1:1 ───────────────────
  readonly active = input.required<MissionId>();
  readonly capabilities = input<ShipCapabilities | null>(null);
  readonly missionChange = output<MissionId>();

  /** Not on any of the three mirrored components — the only percentile
   * source in the codebase is `sc-codex-rank-card`'s own `result`/`loading`
   * inputs, reused verbatim rather than re-deriving a percentile here
   * (chosen attribute, documented in the wave2 handoff). */
  readonly rankResult = input<RankResult | null>(null);
  readonly rankCohortLoading = input(false);

  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  protected readonly modes: readonly FlightMode[] = ['scm', 'nav'];
  protected readonly pipFive = [1, 2, 3, 4, 5];

  private readonly uid = `holo-strip-${++uidSeq}`;
  protected readonly panelId = `${this.uid}-panel`;

  private readonly cutGroups = signal<ReadonlySet<PowerColumnKey>>(new Set());
  private readonly levels = signal<PowerLevels>({});
  protected readonly mode = signal<FlightMode>('scm');
  protected readonly preset = signal<PowerPreset>('auto');
  protected readonly expanded = signal<boolean>(false);
  protected readonly tipsHidden = signal(false);

  private previousSheet: PowerSheet | null = null;

  protected readonly sheet = computed<PowerSheet>(() => {
    const result = computePowerSheet({
      occupants: this.occupants(),
      shipStats: this.shipStats(),
      schemaVersion: this.schemaVersion(),
      mode: this.mode(),
      preset: this.preset(),
      cutGroups: this.cutGroups(),
      levels: this.levels(),
      previous: this.previousSheet,
    });
    this.previousSheet = result;
    return result;
  });

  protected readonly maxPips = computed(() => Math.max(1, ...this.sheet().groups.map((g) => g.pips.length)));

  protected readonly irFact = computed(() => this.sheet().facts.find((f) => f.key === 'ir'));
  protected readonly emFact = computed(() => this.sheet().facts.find((f) => f.key === 'em'));
  protected readonly csFact = computed(() => {
    const base = this.sheet().facts.find((f) => f.key === 'crossSection');
    const override = this.crossSection();
    if (!base) return base;
    if (override == null || base.value != null) return base;
    return { ...base, value: override, gapKey: null };
  });

  protected readonly activeMissionLabel = computed(() => missionById(this.active()).labelKey);

  /** groups `cells()` (already computed against the active mission) into the
   * three mini tiles via the SAME classification `buildPerspectiveDeltas`
   * uses for the patch-Δ view — never a second, drifting grouping. */
  protected readonly perspectiveTiles = computed<PerspectiveTile[]>(() => {
    const cells = this.cells();
    const rank = this.rankResult();
    return PERSPECTIVE_TILES.map((perspective) => {
      const keys = new Set(PERSPECTIVE_KPIS[perspective]);
      const order = STRIP_TILE_ORDER[perspective];
      const tileCells = cells
        .filter((c) => keys.has(c.key) && c.value != null)
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .slice(0, 3);
      const axes = rank ? rank.axes.filter((a) => keys.has(a.key) && a.percentile != null) : [];
      const percentile = axes.length ? Math.round(axes.reduce((s, a) => s + a.percentile!, 0) / axes.length) : null;
      return { perspective, labelKey: `codex.holo.strip.${perspective}`, percentile, cells: tileCells };
    });
  });

  /** Mean percentile of the signature axes the active rank profile carries. */
  protected readonly signaturePercentile = computed<number | null>(() => {
    const rank = this.rankResult();
    if (!rank) return null;
    const keys = new Set(PERSPECTIVE_KPIS.signature);
    const axes = rank.axes.filter((a) => keys.has(a.key) && a.percentile != null);
    return axes.length ? Math.round(axes.reduce((s, a) => s + a.percentile!, 0) / axes.length) : null;
  });

  /** 0..5 pips, from the mean percentile of the two rank axes that overlap
   * the signature facts (ir + crossSection — see {@link SIGNATURE_RANK_KEYS}). */
  protected readonly signatureRankFill = computed(() => {
    const rank = this.rankResult();
    if (!rank) return 0;
    const axes = rank.axes.filter((a) => SIGNATURE_RANK_KEYS.includes(a.key as 'ir' | 'crossSection') && a.percentile != null);
    if (!axes.length) return 0;
    const mean = axes.reduce((s, a) => s + a.percentile!, 0) / axes.length;
    return Math.max(0, Math.min(5, Math.round(mean / 20)));
  });

  /** Last ship class the local power state (`cutGroups`/`levels`/`mode`/
   * `preset`) was restored for — reset to `null` before every host reuses
   * this component instance for a different ship, `restoreState()` re-runs
   * against the *new* ship's own storage key instead of carrying A's state
   * into B's `persistDraft()` writes (wave5 red-team P0, strip is reused
   * across `/codex/ship/A -> /codex/ship/B` navigations). */
  private restoredFor: string | null = null;

  constructor() {
    effect(() => {
      const shipKey = this.shipClassName();
      this.userId();
      if (this.restoredFor === shipKey) return;
      this.restoredFor = shipKey;
      untracked(() => this.restoreState());
    });
    effect(() => {
      this.sheetChange.emit(this.sheet());
    });
  }

  private storageGet(key: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private storageSet(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
    } catch {
      /* private mode / disabled storage — draft state simply does not persist */
    }
  }

  private restoreState(): void {
    const shipKey = this.shipClassName();
    const local = parseLocalPowerDraft(this.storageGet(powerStorageKey(shipKey)));
    let urlDraft: PowerDraftState | null = null;
    try {
      const raw = this.route?.snapshot?.queryParamMap.get('pw') ?? null;
      urlDraft = decodePowerParam(raw);
    } catch {
      urlDraft = null;
    }
    const draft = urlDraft ?? local ?? DEFAULT_POWER_DRAFT;
    const migrated = migrateLegacyCoolerDraft(
      parsePowerGroups(draft.cutGroups),
      parsePowerLevels(draft.levels),
      coolerUnitCount(this.occupants()),
    );
    this.cutGroups.set(migrated.cutGroups);
    this.levels.set(migrated.levels);
    this.mode.set(isFlightMode(draft.mode) ? draft.mode : 'scm');
    this.preset.set(draft.preset === 'stealth' ? 'stealth' : 'auto');

    // A remembered "open" never survives onto a phone: the expanded sheet
    // covers 70vh there (concept mo5: the phone strip opens as a bottom
    // sheet on demand), so the page must never load with the table hidden.
    const expKey = `${dockPositionStorageKey(this.userId())}:strip-open`;
    const phone = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
    this.expanded.set(!phone && this.storageGet(expKey) === 'true');
  }

  private currentDraft(): PowerDraftState {
    return {
      cutGroups: [...this.cutGroups()],
      levels: { ...this.levels() } as Record<string, number>,
      mode: this.mode(),
      preset: this.preset(),
      dock: DEFAULT_POWER_DRAFT.dock,
    };
  }

  private persistDraft(): void {
    const shipKey = this.shipClassName();
    const draft = this.currentDraft();
    this.storageSet(powerStorageKey(shipKey), serializeLocalPowerDraft(shipKey, draft));
    if (!this.router) return;
    const pw = encodePowerParam(draft);
    try {
      void this.router.navigate([], {
        relativeTo: this.route ?? undefined,
        queryParams: { pw },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
    } catch {
      /* navigation not available in this host context (e.g. a dev harness) */
    }
  }

  protected iconPath(group: PowerGroup): string {
    return ICON_PATHS[GROUP_ICON[group]] ?? ICON_PATHS['generic'];
  }

  protected fmt(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return formatNumber(v);
  }

  /** The cell's value with its unit — the SAME formatter the KPI band uses. */
  protected fmtCell(c: KpiStripCell): string {
    return c.value == null ? '—' : formatEquippedStat({ labelKey: c.labelKey, value: c.value, format: c.format });
  }

  protected roundPct(v: number): number {
    return Math.round(v);
  }

  protected fmtKm(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return (v / 1000).toFixed(1);
  }

  protected fmtM(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return formatNumber(v);
  }

  protected minPct(pct: number | null): number {
    if (pct === null) return 0;
    return Math.min(100, Math.max(0, pct));
  }

  /** stroke-dasharray for the r=26 cooling ring. */
  protected coolDash(pct: number): string {
    const c = 2 * Math.PI * 26;
    const on = (this.minPct(pct) / 100) * c;
    return `${on.toFixed(1)} ${(c - on).toFixed(1)}`;
  }

  protected absDelta(c: KpiStripCell): number {
    return Math.abs(c.delta!.raw);
  }

  protected deltaTone(c: KpiStripCell): 'up' | 'down' | null {
    const delta = c.delta;
    if (!delta || delta.raw === 0) return null;
    return delta.good ? 'up' : 'down';
  }

  protected dismissTooltips(): void {
    this.tipsHidden.set(true);
  }

  protected reopenTooltips(): void {
    if (this.tipsHidden()) this.tipsHidden.set(false);
  }

  protected pipsEnabled(row: PowerGroupRow): boolean {
    return row.state !== 'absent' && row.state !== 'noChannel' && row.capacity > 0;
  }

  protected clickPip(row: PowerGroupRow, level: number): void {
    if (!this.pipsEnabled(row)) return;
    const next = clickPowerPip(this.cutGroups(), this.levels(), row, level);
    this.cutGroups.set(next.cutGroups);
    this.levels.set(next.levels);
    this.persistDraft();
  }

  protected stepPipFocus(event: Event, dir: 1 | -1): void {
    const stack = event.currentTarget as HTMLElement | null;
    if (!stack) return;
    const pips = Array.from(stack.querySelectorAll<HTMLButtonElement>('button.pip:not([disabled])'));
    const at = pips.findIndex((b) => b === document.activeElement);
    if (at < 0) return;
    const to = pips[at + dir];
    if (!to) return;
    event.preventDefault();
    to.focus();
  }

  protected toggleGroup(key: PowerColumnKey): void {
    this.cutGroups.set(togglePowerGroup(this.cutGroups(), key));
    this.persistDraft();
  }

  protected setMode(mode: FlightMode): void {
    this.mode.set(mode);
    this.persistDraft();
  }

  protected setPreset(preset: PowerPreset): void {
    this.preset.set(preset);
    this.levels.set({});
    this.persistDraft();
  }

  protected reset(): void {
    const next = resetPowerState();
    this.cutGroups.set(next.cutGroups);
    this.levels.set(next.levels);
    this.mode.set(next.mode);
    this.preset.set(next.preset);
    this.persistDraft();
  }

  protected toggleExpanded(): void {
    const next = !this.expanded();
    this.expanded.set(next);
    this.storageSet(`${dockPositionStorageKey(this.userId())}:strip-open`, String(next));
  }
}
