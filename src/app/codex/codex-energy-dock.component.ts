// The energy mini-dock (MASTER §8 / UI spec §9, iteration 8 `#h1`).
// -----------------------------------------------------------------------------
// Self-contained: owns the cut set, flight mode, preset, dock position, the
// minimised flag and the `previous` sheet used for the fact deltas. The shell
// only needs to place `<sc-codex-energy-dock>` and listen to `(sheetChange)`.
//
// Storage/URL contract (MASTER §8, `codex-loadout-draft.ts`):
//   * cut groups / mode / preset are PER-SHIP  → `powerStorageKey(shipClassName)`
//     + the `pw` URL query param (shareable, `replaceUrl`).
//   * dock position is PER-USER                → `dockPositionStorageKey(userId)`.
//   * the minimised flag rides next to the position, in its own sibling key —
//     it has no `PowerDraftState` field of its own (that shape is frozen for
//     the `pw` param's round-trip) so it gets `${dockPositionStorageKey}:min`.
// All storage access is try/catch guarded (private browsing, SSR, disabled
// storage must never crash the dock).
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
import { TranslateModule } from '@ngx-translate/core';

import { ICON_PATHS } from './codex-category-icon.component';
import { formatNumber } from './codex-format';
import { kpiLowerIsBetter } from './codex-loadout-stats';
import {
  DockPosition,
  FlightMode,
  PowerFact,
  PowerFactKey,
  PowerGroup,
  PowerPreset,
  PowerSheet,
  computePowerSheet,
  isDockPosition,
  isFlightMode,
  parsePowerGroups,
  resetPowerState,
  togglePowerGroup,
} from './codex-power';
import {
  DEFAULT_POWER_DRAFT,
  PowerDraftState,
  decodePowerParam,
  dockPositionStorageKey,
  encodePowerParam,
  parseDockPosition,
  parseLocalPowerDraft,
  powerStorageKey,
  serializeDockPosition,
  serializeLocalPowerDraft,
} from './codex-loadout-draft';
import type { SummaryOccupant } from './ship-summary-panels';

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

const FACT_ICON: Readonly<Record<string, string>> = {
  ir: 'ir',
  em: 'em',
  crossSection: 'crossSection',
};

/** KPI keys where {@link kpiLowerIsBetter} carries the same semantics as this
 * fact's own `lowerIsBetter` — only 'ir' and 'crossSection' overlap the KPI
 * key set (`em`/`coolant` do not exist there), so only those two borrow the
 * shared decider; the rest keep the value `computePowerSheet` already put on
 * the fact (MEDIUM-2). */
const FACT_KPI_OVERLAP: Readonly<Partial<Record<PowerFactKey, 'ir' | 'crossSection'>>> = {
  ir: 'ir',
  crossSection: 'crossSection',
};

/** Inside the dock a rising value is bad when `lowerIsBetter`; falling is bad
 * otherwise. Returns the CSS-facing tone directly — `.d.up` is always
 * `--sc-success` and `.d.down` is always `--sc-danger` (UI spec §0), so "up"
 * here means "good outcome", not "the number went up". */
function deltaTone(delta: number | null, lowerIsBetter: boolean): 'up' | 'down' | null {
  if (delta === null || delta === 0) return null;
  const rising = delta > 0;
  return rising === lowerIsBetter ? 'down' : 'up';
}

let uidSeq = 0;

@Component({
  selector: 'sc-codex-energy-dock',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="mini-dock"
      [class.min]="minimised()"
      [class.gap]="!sheet().available"
      [class.tips-hidden]="tipsHidden()"
      [attr.data-min]="minimised()"
      [attr.data-pos]="position()"
      (keydown.escape)="dismissTooltips()"
      (focusin)="reopenTooltips()"
      (pointerenter)="reopenTooltips()"
    >
      <div class="md-head">
        <h3>{{ 'codex.energy.title' | translate }}</h3>
        @if (sheet().available) {
          <span class="bud" [attr.aria-label]="'codex.energy.budgetLabel' | translate"
            >{{ sheet().budgetUsed }}<small>&nbsp;/&nbsp;{{ sheet().budgetTotal }} {{ 'codex.energy.unit.segments' | translate }}</small></span
          >
        } @else {
          <span class="bud gapv" [attr.aria-label]="'codex.energy.budgetLabel' | translate">—</span>
        }

        <div class="act">
          <div class="pos-pick" role="radiogroup" [attr.aria-label]="'codex.energy.position.title' | translate">
            @for (pos of positions; track pos) {
              <button
                type="button"
                [class.on]="position() === pos"
                role="radio"
                [attr.aria-checked]="position() === pos"
                [title]="'codex.energy.position.' + pos | translate"
                [attr.aria-label]="'codex.energy.position.' + pos | translate"
                (click)="setPosition(pos)"
              >
                {{ posGlyph[pos] }}
              </button>
            }
          </div>
          <button
            type="button"
            class="md-min"
            [attr.aria-expanded]="!minimised()"
            [attr.aria-controls]="bodyId"
            (click)="toggleMinimised()"
          >
            <span aria-hidden="true">{{ minimised() ? '▴' : '—' }}</span>
            {{ (minimised() ? 'codex.energy.expand' : 'codex.energy.minimise') | translate }}
          </button>
        </div>
      </div>

      @if (isReExtractGap()) {
        <div class="md-gap gaptag" [id]="bodyId">
          @for (key of sheet().gapKeys; track key) {
            <span>{{ key | translate }}</span>
          }
        </div>
      } @else if (minimised()) {
        <div class="md-strip" [id]="bodyId">
          <span>{{ 'codex.energy.fact.ir' | translate }} {{ fmt(irFact()?.value) }}</span>
          <span>{{ 'codex.energy.fact.em' | translate }} {{ fmt(emFact()?.value) }}</span>
          <span>{{ 'codex.energy.fact.crossSection' | translate }} {{ fmt(csFact()?.value) }}</span>
          <span>{{ 'codex.energy.fact.coolingLoad' | translate }} {{ sheet().coolant.percent === null ? '—' : ('codex.energy.coolingPercent' | translate: { pct: sheet().coolant.percent }) }}</span>
          <span class="ok" [class.no]="!sheet().ready">{{ (sheet().ready ? 'codex.energy.readiness.shortOk' : 'codex.energy.readiness.shortNo') | translate }}</span>
        </div>
      } @else {
        <div class="md-body" [id]="bodyId">
          @if (sheet().available) {
          <div class="md-pips">
            @for (row of sheet().groups; track row.group) {
              <div class="md-col" [class.off]="row.state === 'off'" [class.act]="row.state === 'active'">
                <div class="stack">
                  @for (pip of row.pips; track $index) {
                    <b
                      [class.on]="pip.kind === 'on'"
                      [class.min]="pip.kind === 'min'"
                      [class.top]="pip.numeral !== null"
                      [attr.data-n]="pip.numeral"
                    ></b>
                  }
                </div>
                <div class="tipw">
                  <button
                    type="button"
                    class="grp-btn"
                    [attr.aria-pressed]="row.cut"
                    [attr.aria-describedby]="tipId(row.group) + ' ' + metaId(row.group)"
                    [attr.aria-label]="(row.cut ? 'codex.energy.toggleOn' : 'codex.energy.toggleOff') | translate: { group: row.labelKey | translate }"
                    (click)="toggleGroup(row.group)"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">
                      <path [attr.d]="iconPath(row.group)" />
                    </svg>
                  </button>
                  <div class="tipbox" [id]="tipId(row.group)" role="tooltip">
                    <b>{{ row.tooltipTitleKey | translate }}</b>
                    <p>{{ row.tooltipBodyKey | translate }}</p>
                    @if (row.state === 'noChannel') {
                      <p class="gapv">{{ 'codex.energy.gap.noChannelInMode' | translate }}</p>
                    }
                  </div>
                </div>
                <span class="visually-hidden" [id]="metaId(row.group)"
                  >{{ 'codex.energy.allocated' | translate: { n: row.allocated } }} · {{ 'codex.energy.minimum' | translate: { n: row.minimum } }}</span
                >
                <div class="grp-state" [class.off]="row.state === 'off'">
                  @if (row.stateLabelKey) {
                    {{ row.stateLabelKey | translate }}
                  } @else {
                    {{ row.allocated }}
                  }
                </div>
              </div>
            }
          </div>

          <div class="vr"></div>
          } @else {
            <div class="md-gap-inline gaptag">
              <span>{{ 'codex.energy.gap.noReactorData' | translate }}</span>
            </div>
          }

          <div class="md-facts">
            @for (f of simpleFacts(); track f.key) {
              <div class="md-fact tipw">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">
                  <path [attr.d]="factIconPath(f.key)" />
                </svg>
                <button type="button" class="tip-trigger k" [attr.aria-describedby]="factTipId(f.key)">{{ factTooltipTitle(f.key) | translate }}</button>
                <span class="v">{{ fmt(f.value) }}</span>
                @if (deltaTone(f.delta, factLowerIsBetter(f)); as tone) {
                  <span class="d" [class.up]="tone === 'up'" [class.down]="tone === 'down'">{{ f.delta! > 0 ? '+' : '' }}{{ fmt(f.delta) }}</span>
                }
                <div class="tipbox" [id]="factTipId(f.key)" role="tooltip">
                  <b>{{ factTooltipTitle(f.key) | translate }}</b>
                  <p>{{ f.tooltipKey | translate }}</p>
                </div>
              </div>
            }

            <div class="md-heat tipw">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico ico-heat" aria-hidden="true">
                <path [attr.d]="glyphPath('heat')" />
              </svg>
              <button type="button" class="tip-trigger k" [attr.aria-describedby]="heatTipId">{{ 'codex.energy.fact.coolingLoad' | translate }}</button>
              @if (sheet().coolant.percent !== null) {
                <div class="t" [class.over]="sheet().coolant.percent! > 100">
                  <div class="fill" [style.width.%]="minPct(sheet().coolant.percent)"></div>
                </div>
                <span class="v">{{ 'codex.energy.coolingPercent' | translate: { pct: sheet().coolant.percent } }}</span>
                <span class="sub">{{ 'codex.energy.coolingValue' | translate: { used: sheet().coolant.used, total: sheet().coolant.total } }}</span>
              } @else {
                <span class="gapv">{{ 'codex.energy.gap.noCoolingData' | translate }}</span>
              }
              <div class="tipbox" [id]="heatTipId" role="tooltip">
                <b>{{ 'codex.energy.fact.coolingLoad' | translate }}</b>
                <p>{{ 'codex.energy.tooltip.coolingLoad' | translate }}</p>
              </div>
            </div>

            <div class="md-ok" [class.no]="!sheet().ready">
              <span aria-hidden="true">{{ sheet().ready ? '✓' : '✕' }}</span>
              {{ sheet().readinessKey | translate }}
            </div>
          </div>
        </div>

        <div class="md-foot">
          <div class="seg" role="radiogroup" [attr.aria-label]="'codex.energy.mode.label' | translate">
            @for (m of modes; track m) {
              <button type="button" [class.on]="mode() === m" role="radio" [attr.aria-checked]="mode() === m" (click)="setMode(m)">
                {{ ('codex.energy.mode.' + m) | translate }}
              </button>
            }
          </div>
          <button type="button" [class.on]="preset() === 'stealth'" (click)="setPreset('stealth')">
            {{ 'codex.energy.preset.stealth' | translate }}
          </button>
          <button type="button" [class.on]="preset() === 'auto'" (click)="setPreset('auto')">
            {{ 'codex.energy.preset.auto' | translate }}
          </button>
          <button type="button" (click)="reset()">{{ 'codex.energy.preset.reset' | translate }}</button>
        </div>

        @if (sheet().cutGroups.size > 0) {
          <p class="draft-note">{{ 'codex.energy.draftNote' | translate }}</p>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .mini-dock {
        position: sticky;
        inset-block-end: 12px;
        z-index: 14;
        inline-size: fit-content;
        max-inline-size: 100%;
        margin-inline: auto;
        background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
        border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
        border-radius: 4px;
        box-shadow: 0 14px 40px rgb(0 0 0 / 0.6);
        font-size: max(12px, var(--sc-fs-floor));
        color: var(--sc-fg-0);
      }
      .mini-dock[data-pos='left'] {
        margin-inline: 0 auto;
      }
      .mini-dock[data-pos='right'] {
        margin-inline: auto 0;
      }
      .md-head {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px 6px;
      }
      .md-head h3 {
        font-size: max(12px, var(--sc-fs-floor));
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--sc-accent);
        margin: 0;
      }
      .bud {
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }
      .bud small {
        font-size: max(11px, var(--sc-fs-floor));
        color: var(--sc-fg-2);
      }
      .act {
        margin-inline-start: auto;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pos-pick {
        display: inline-flex;
        border: 1px solid var(--sc-border);
        border-radius: 4px;
        overflow: hidden;
      }
      .pos-pick button {
        min-inline-size: max(28px, var(--sc-tap-min));
        min-block-size: max(24px, var(--sc-tap-min));
        border: none;
        border-inline-start: 1px solid var(--sc-border);
        background: transparent;
        color: var(--sc-fg-2);
        cursor: pointer;
      }
      .pos-pick button:first-child {
        border-inline-start: none;
      }
      .pos-pick button.on {
        color: var(--sc-accent);
        background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      }
      .md-min {
        border: 1px solid var(--sc-border);
        border-radius: 4px;
        background: transparent;
        color: var(--sc-fg-2);
        padding: 4px 8px;
        min-block-size: var(--sc-tap-min);
        cursor: pointer;
      }
      .md-body {
        display: grid;
        grid-template-columns: auto 1px auto;
        gap: 12px;
        padding: 2px 12px 8px;
      }
      .md-pips {
        display: flex;
        gap: 10px;
      }
      .vr {
        background: color-mix(in srgb, var(--sc-accent) 16%, transparent);
      }
      .md-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .stack {
        display: flex;
        flex-direction: column-reverse;
        gap: 2px;
        min-block-size: 40px;
        justify-content: flex-start;
      }
      .stack b {
        display: block;
        position: relative;
        inline-size: 22px;
        block-size: max(9px, var(--sc-fs-floor));
        border-radius: 2px;
        background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent);
        overflow: visible;
      }
      .md-col.off .stack b {
        background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent);
      }
      .stack b.on {
        background: var(--sc-accent);
      }
      .stack b.min {
        background: var(--sc-warn);
      }
      .stack b.top::after {
        content: attr(data-n);
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: max(11px, var(--sc-fs-floor));
        font-variant-numeric: tabular-nums;
        color: color-mix(in srgb, var(--sc-bg-0) 85%, #000);
      }
      .grp-btn {
        min-inline-size: max(28px, var(--sc-tap-min));
        min-block-size: max(28px, var(--sc-tap-min));
        border: 1px solid var(--sc-border);
        border-radius: 4px;
        background: transparent;
        color: var(--sc-fg-2);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .md-col.act .grp-btn {
        color: var(--sc-accent);
      }
      .md-col.off .grp-btn {
        color: color-mix(in srgb, var(--sc-fg-2) 55%, var(--sc-bg-0));
      }
      .grp-btn:hover {
        border-color: color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
        background: color-mix(in srgb, var(--sc-accent) 15%, transparent);
      }
      .ico {
        width: 16px;
        height: 16px;
      }
      .grp-state {
        font-size: max(11px, var(--sc-fs-floor));
        font-variant-numeric: tabular-nums;
        color: var(--sc-fg-2);
      }
      .grp-state.off {
        color: var(--sc-danger);
      }
      .tipw {
        position: relative;
      }
      .tipbox {
        display: block;
        visibility: hidden;
        opacity: 0;
        transition: opacity 0.12s ease;
        position: absolute;
        inset-block-end: calc(100% + 8px);
        inset-inline-start: 50%;
        transform: translateX(-50%);
        inline-size: 230px;
        padding: 8px 10px;
        background: var(--sc-bg-2);
        border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
        border-radius: 4px;
        box-shadow: 0 10px 28px rgb(0 0 0 / 0.6);
        font-size: max(12px, var(--sc-fs-floor));
        z-index: 20;
      }
      .tipbox b {
        display: block;
        font-size: max(11px, var(--sc-fs-floor));
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--sc-accent);
        margin: 0 0 4px;
      }
      .tipbox p {
        margin: 0;
        color: var(--sc-fg-1);
      }
      .tipbox p.gapv {
        margin-block-start: 4px;
      }
      .tipw:hover .tipbox,
      .tipw:focus-within .tipbox {
        visibility: visible;
        opacity: 1;
      }
      .mini-dock.tips-hidden .tipbox {
        visibility: hidden !important;
        opacity: 0 !important;
      }
      .tip-trigger {
        border: none;
        background: transparent;
        padding: 0;
        margin: 0;
        font: inherit;
        cursor: help;
      }
      .md-col .ico,
      .md-heat {
        cursor: help;
      }
      .md-facts {
        display: grid;
        grid-template-columns: repeat(3, auto);
        gap: 4px 14px;
        align-content: start;
      }
      .md-fact {
        display: flex;
        align-items: baseline;
        gap: 6px;
      }
      .md-fact .ico {
        align-self: center;
        color: var(--sc-fg-2);
      }
      .md-fact .k,
      .md-heat .k {
        font-size: max(11px, var(--sc-fs-floor));
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--sc-fg-2);
      }
      .md-fact .v {
        font-size: 13px;
        font-variant-numeric: tabular-nums;
      }
      .d {
        font-size: max(11px, var(--sc-fs-floor));
        font-variant-numeric: tabular-nums;
      }
      .d.up {
        color: var(--sc-success);
      }
      .d.down {
        color: var(--sc-danger);
      }
      .md-heat {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .md-heat .ico {
        width: 13px;
        height: 13px;
        color: var(--sc-fg-2);
      }
      .md-heat .t {
        inline-size: 120px;
        block-size: 4px;
        border-radius: 2px;
        background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent);
        overflow: hidden;
      }
      .md-heat .fill {
        block-size: 100%;
        background: var(--sc-warn);
      }
      .md-heat .t.over .fill {
        background: var(--sc-danger);
      }
      .md-ok {
        grid-column: 1 / -1;
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: max(12px, var(--sc-fs-floor));
        color: var(--sc-success);
      }
      .md-ok.no {
        color: var(--sc-warn);
      }
      .md-strip {
        display: flex;
        gap: 14px;
        padding: 0 12px 8px;
        font-size: max(12px, var(--sc-fs-floor));
      }
      .md-strip .ok {
        color: var(--sc-success);
      }
      .md-strip .ok.no {
        color: var(--sc-warn);
      }
      .md-foot {
        display: flex;
        gap: 6px;
        padding: 6px 12px 8px;
        border-block-start: 1px solid color-mix(in srgb, var(--sc-accent) 12%, transparent);
        flex-wrap: wrap;
      }
      .md-foot button,
      .seg button {
        border: 1px solid var(--sc-border);
        border-radius: 4px;
        background: transparent;
        color: var(--sc-fg-1);
        padding: 4px 8px;
        min-block-size: var(--sc-tap-min);
        cursor: pointer;
      }
      .seg {
        display: inline-flex;
        border: 1px solid var(--sc-border);
        border-radius: 4px;
        overflow: hidden;
      }
      .seg button {
        border: none;
        border-inline-start: 1px solid var(--sc-border);
        border-radius: 0;
      }
      .seg button:first-child {
        border-inline-start: none;
      }
      .md-foot button.on,
      .seg button.on {
        color: var(--sc-accent);
        background: color-mix(in srgb, var(--sc-accent) 18%, transparent);
      }
      .draft-note {
        margin: 0;
        padding: 0 12px 8px;
        font-size: max(11px, var(--sc-fs-floor));
        color: var(--sc-fg-2);
      }
      .md-gap {
        padding: 0 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        color: var(--sc-warn);
        font-size: max(12px, var(--sc-fs-floor));
      }
      .gaptag {
        border: 1px dashed color-mix(in srgb, var(--sc-warn) 40%, transparent);
        border-radius: 4px;
        padding: 6px 8px;
        margin: 0 12px 8px;
      }
      .md-gap-inline {
        grid-column: span 2;
        display: flex;
        align-items: center;
        color: var(--sc-warn);
        font-size: max(12px, var(--sc-fs-floor));
      }
      @media (max-width: 820px) {
        .md-gap-inline {
          grid-column: 1;
        }
      }
      .gapv {
        color: var(--sc-fg-2);
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }

      @media (max-width: 820px) {
        .md-body {
          grid-template-columns: 1fr;
        }
        .vr {
          display: none;
        }
      }
      @media (max-width: 640px) {
        .mini-dock {
          position: fixed;
          inset-inline: 0;
          inset-block-end: 0;
          margin: 0;
          border-radius: 0;
          inline-size: 100%;
          max-inline-size: 100%;
          padding-block-end: env(safe-area-inset-bottom);
        }
        .md-pips {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
        }
        .pos-pick {
          display: none;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        * {
          transition: none !important;
        }
      }
    `,
  ],
})
export class CodexEnergyDockComponent {
  readonly occupants = input.required<readonly SummaryOccupant[]>();
  readonly shipStats = input<Record<string, Record<string, string | number | boolean | null>> | null>(null);
  readonly shipClassName = input.required<string>();
  readonly schemaVersion = input<number | null>(null);
  readonly userId = input<string | null>(null);
  readonly crossSection = input<number | null>(null);
  readonly sheetChange = output<PowerSheet>();

  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });

  protected readonly positions: readonly DockPosition[] = ['left', 'center', 'right'];
  protected readonly modes: readonly FlightMode[] = ['scm', 'nav'];
  protected readonly posGlyph: Readonly<Record<DockPosition, string>> = {
    left: '◧',
    center: '▣',
    right: '◨',
  };

  private readonly uid = `energy-dock-${++uidSeq}`;
  protected readonly bodyId = `${this.uid}-body`;

  private readonly cutGroups = signal<ReadonlySet<PowerGroup>>(new Set());
  /** `protected` — the footer template reads these to mark the active SCM/NAV
   * and Auto/Schleichen buttons; AOT template type-checking needs at least
   * `protected` visibility for a member a component's own template touches. */
  protected readonly mode = signal<FlightMode>('scm');
  protected readonly preset = signal<PowerPreset>('auto');
  protected readonly position = signal<DockPosition>('center');
  protected readonly minimised = signal<boolean>(false);

  /** Carries the last emitted sheet across recomputes for the fact deltas (R-B7).
   * A plain instance field, not a signal — `computed()` may not write signals,
   * but a private cache read/written inside its own body is the standard
   * "previous value" trick and stays perfectly pure w.r.t. its dependencies. */
  private previousSheet: PowerSheet | null = null;

  protected readonly sheet = computed<PowerSheet>(() => {
    const result = computePowerSheet({
      occupants: this.occupants(),
      shipStats: this.shipStats(),
      schemaVersion: this.schemaVersion(),
      mode: this.mode(),
      preset: this.preset(),
      cutGroups: this.cutGroups(),
      previous: this.previousSheet,
    });
    this.previousSheet = result;
    return result;
  });

  /** true when the build is too old for any resource data at all — the
   * compact `.gaptag` replaces the whole body. `codex.energy.gap.noReactorData`
   * (resource data exists, just no reactor) keeps the facts and footer instead
   * (MEDIUM-5). */
  protected readonly isReExtractGap = computed(
    () => !this.sheet().available && this.sheet().gapKeys.includes('codex.energy.gap.reExtractPending'),
  );

  /** hides every tooltip until the next focus/pointer interaction (MEDIUM-7). */
  protected readonly tipsHidden = signal(false);

  protected readonly irFact = computed(() => this.sheet().facts.find((f) => f.key === 'ir'));
  protected readonly emFact = computed(() => this.sheet().facts.find((f) => f.key === 'em'));
  protected readonly csFact = computed<PowerFact | undefined>(() => {
    const base = this.sheet().facts.find((f) => f.key === 'crossSection');
    const override = this.crossSection();
    if (!base) return base;
    if (override == null || base.value != null) return base;
    return { ...base, value: override, gapKey: null };
  });

  protected simpleFacts(): PowerFact[] {
    const out: PowerFact[] = [];
    const ir = this.irFact();
    const em = this.emFact();
    const cs = this.csFact();
    if (ir) out.push(ir);
    if (em) out.push(em);
    if (cs) out.push(cs);
    return out;
  }

  private restored = false;

  constructor() {
    // Required inputs are not yet bound during the constructor (NG0950) — the
    // first `effect()` run happens once Angular has set them, which is the
    // earliest point "read on init" can mean. Guarded to run exactly once;
    // later input changes (a different ship reusing the same instance) do not
    // re-import a stale draft over live user interaction.
    effect(() => {
      this.shipClassName();
      this.userId();
      if (this.restored) return;
      this.restored = true;
      untracked(() => this.restoreState());
    });

    // `sheet` is a `computed()` — its consumer node forbids signal writes
    // (`OutputEmitterRef.emit` calls listeners synchronously, and the shell's
    // natural `(sheetChange)="powerSheet.set($event)"` wiring would throw
    // NG0600 the moment the template first reads `sheet()`). An `effect()`
    // is the write-capable counterpart Angular 21 gives computeds for exactly
    // this "notify on every recompute" shape (HIGH-1).
    effect(() => {
      this.sheetChange.emit(this.sheet());
    });
  }

  private matchesNarrowViewport(): boolean {
    try {
      return typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches;
    } catch {
      return false;
    }
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
    this.cutGroups.set(parsePowerGroups(draft.cutGroups));
    this.mode.set(isFlightMode(draft.mode) ? draft.mode : 'scm');
    this.preset.set(draft.preset === 'stealth' ? 'stealth' : 'auto');

    const posKey = dockPositionStorageKey(this.userId());
    const savedPos = parseDockPosition(this.storageGet(posKey));
    const pos = savedPos ?? (isDockPosition(draft.dock) ? draft.dock : null) ?? DEFAULT_POWER_DRAFT.dock;
    this.position.set(pos);

    const savedMin = this.storageGet(`${posKey}:min`);
    // Phone default (UI spec §13 / MASTER §13): the bottom-sheet dock starts
    // minimised on a narrow viewport UNLESS the user already chose a state —
    // an explicit `false` (they expanded it once) must stick, not just `true`.
    const narrow = this.matchesNarrowViewport();
    this.minimised.set(savedMin !== null ? savedMin === 'true' : narrow);
  }

  private currentDraft(): PowerDraftState {
    return {
      cutGroups: [...this.cutGroups()],
      mode: this.mode(),
      preset: this.preset(),
      dock: this.position(),
    };
  }

  /** Persist the per-ship draft (localStorage + `pw` query param, replaceUrl). */
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

  protected glyphPath(key: string): string {
    return ICON_PATHS[key] ?? ICON_PATHS['generic'];
  }

  protected factIconPath(key: PowerFactKey): string {
    return this.glyphPath(FACT_ICON[key] ?? 'generic');
  }

  protected factTooltipTitle(key: PowerFactKey): string {
    // 'coolant' has no dedicated tooltipTitle key — it renders its own
    // `codex.energy.fact.coolingLoad` heading in the heat block, not through
    // `simpleFacts()` (MEDIUM-1).
    return `codex.energy.tooltipTitle.${key}`;
  }

  /** Only 'ir' and 'crossSection' overlap the shared KPI decider; the rest
   * keep the value `computePowerSheet` already put on the fact (MEDIUM-2). */
  protected factLowerIsBetter(f: PowerFact): boolean {
    const kpiKey = FACT_KPI_OVERLAP[f.key];
    return kpiKey ? kpiLowerIsBetter(kpiKey) : f.lowerIsBetter;
  }

  protected tipId(group: PowerGroup): string {
    return `${this.uid}-tip-${group}`;
  }

  protected metaId(group: PowerGroup): string {
    return `${this.uid}-meta-${group}`;
  }

  protected factTipId(key: PowerFactKey): string {
    return `${this.uid}-fact-tip-${key}`;
  }

  protected readonly heatTipId = `${this.uid}-heat-tip`;

  protected fmt(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    return formatNumber(v);
  }

  protected minPct(pct: number | null): number {
    if (pct === null) return 0;
    return Math.min(100, Math.max(0, pct));
  }

  protected deltaTone(delta: number | null, lowerIsBetter: boolean): 'up' | 'down' | null {
    return deltaTone(delta, lowerIsBetter);
  }

  protected dismissTooltips(): void {
    this.tipsHidden.set(true);
  }

  protected reopenTooltips(): void {
    if (this.tipsHidden()) this.tipsHidden.set(false);
  }

  protected toggleGroup(group: PowerGroup): void {
    this.cutGroups.set(togglePowerGroup(this.cutGroups(), group));
    this.persistDraft();
  }

  protected setMode(mode: FlightMode): void {
    this.mode.set(mode);
    this.persistDraft();
  }

  protected setPreset(preset: PowerPreset): void {
    this.preset.set(preset);
    this.persistDraft();
  }

  protected reset(): void {
    const next = resetPowerState();
    this.cutGroups.set(next.cutGroups);
    this.mode.set(next.mode);
    this.preset.set(next.preset);
    this.persistDraft();
  }

  protected setPosition(pos: DockPosition): void {
    this.position.set(pos);
    this.storageSet(dockPositionStorageKey(this.userId()), serializeDockPosition(pos));
    this.persistDraft();
  }

  protected toggleMinimised(): void {
    const next = !this.minimised();
    this.minimised.set(next);
    this.storageSet(`${dockPositionStorageKey(this.userId())}:min`, String(next));
  }
}
