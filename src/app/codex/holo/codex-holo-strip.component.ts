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
  DestroyRef,
  ElementRef,
  HostListener,
  viewChild,
  afterNextRender,
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
import type { SummaryOccupant } from '../ship-summary-panels';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CountUp } from './count-up';
import { MISSION_ICON, missionColor } from './codex-holo-mission';

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
  cells: readonly KpiStripCell[];
}

/** One choice of the strip's Einsatz picker. */
export interface StripMission {
  id: MissionId;
  labelKey: string;
  sub: string;
  disabledKey: string | null;
}

let uidSeq = 0;

/** Per-viewer localStorage key of the minimised strip. */
export function stripMiniKey(userId: string | null | undefined): string {
  return `${dockPositionStorageKey(userId)}:strip-mini`;
}

@Component({
  selector: 'sc-codex-holo-strip',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="holo-strip" [class.open]="expanded()" [class.mini]="mini() && !phone">
      @if (missionOpen()) {
        <div class="mission-pop" role="radiogroup" [attr.aria-label]="'codex.mission.label' | translate" (keydown.escape)="closeMissions($event)">
          @for (m of missions(); track m.id) {
            <span style="display: contents" [scTooltip]="m.disabledKey ? (m.disabledKey | translate) : null" scTooltipTier="label">
              <button type="button" class="mp" role="radio" [class.on]="m.id === active()" [attr.aria-checked]="m.id === active()"
                      [disabled]="!!m.disabledKey" (click)="pickMission(m.id)">
                <span class="mp-l" [style.--h]="hueOf(m.id)"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="iconOf(m.id)" /></svg>{{ m.labelKey | translate }}</span>
                @if (!m.disabledKey) { <small>{{ m.sub }}</small> }
              </button>
            </span>
          }
        </div>
      }
      <div class="hs-row">
        <button type="button" class="seg einsatz" #missionBtn [attr.aria-haspopup]="'true'" [attr.aria-expanded]="missionOpen()"
                [attr.aria-label]="'codex.holo.strip.einsatzPick' | translate"
                [scTooltip]="'codex.holo.strip.einsatzPick' | translate" scTooltipTier="label"
                (click)="toggleMissions($event)" (keydown.escape)="missionOpen() && closeMissions($event)">
          <span class="lab">{{ 'codex.holo.strip.einsatz' | translate }}<span class="caret" aria-hidden="true">▴</span></span>
          <span class="val"><svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="activeMissionIcon()" /></svg>{{ activeMissionLabel() | translate }}</span>
          <span class="sub" [class.gapv]="!cohortLabel()">{{ cohortLabel() ?? ('codex.kpi.gap' | translate) }}</span>
        </button>

        @for (tile of perspectiveTiles(); track tile.perspective) {
          <i class="fade" aria-hidden="true"></i>
          <div class="seg tile" [attr.data-p]="tile.perspective">
            <span class="lab"><span class="lt">{{ tile.labelKey | translate }}</span></span>
            <div class="tile-vals">
              @for (c of tile.cells; track c.key) {
                <span class="tv" [class.flash]="flashKeys().has(c.key)">
                  <span class="k">{{ ('codex.kpi.short.' + c.key) | translate }}</span>
                  <span class="v">{{ fmtRolled(c) }}</span>
                  @if (deltaTone(c); as tone) {
                    <span class="d" [class.up]="tone === 'up'" [class.down]="tone === 'down'"
                      >{{ c.delta!.raw > 0 ? '+' : '−' }}{{ fmt(absDelta(c)) }}</span
                    >
                  }
                </span>
              } @empty {
                <!-- Nothing in this perspective has a value for this hull — say
                     so instead of leaving a label over an empty cell. -->
                <span class="tv none" tabindex="0" role="img" [scTooltip]="'codex.kpi.gap' | translate" scTooltipTier="label" [attr.aria-label]="'codex.kpi.gap' | translate"><span class="k">&nbsp;</span><span class="v">—</span></span>
              }
            </div>
          </div>
        }

        <i class="fade" aria-hidden="true"></i>

        <div class="seg tile sig" data-p="signature">
          <span class="lab"><span class="lt">{{ 'codex.holo.strip.signature' | translate }}</span></span>
          <div class="tile-vals">
          <span class="fact" tabindex="0" [scTooltip]="fmtM($safeNavigationMigration(irFact()?.value)) + '\u00a0m'" scTooltipTier="label">
            <span class="tip-trigger">{{ 'codex.energy.fact.ir' | translate }}</span>
            <span class="v pulse">{{ fmtKm(up('ir', irFact()?.value)) }}<small>km</small></span>
          </span>
          <span class="fact" tabindex="0" [scTooltip]="fmtM($safeNavigationMigration(emFact()?.value)) + '\u00a0m'" scTooltipTier="label">
            <span class="tip-trigger">{{ 'codex.energy.fact.em' | translate }}</span>
            <span class="v pulse">{{ fmtKm(up('em', emFact()?.value)) }}<small>km</small></span>
          </span>
          <span class="fact" tabindex="0" [scTooltip]="fmtM($safeNavigationMigration(csFact()?.value)) + '\u00a0m'" scTooltipTier="label">
            <span class="tip-trigger">{{ 'codex.energy.fact.crossSection' | translate }}</span>
            <span class="v pulse">{{ fmtKm(up('cs', csFact()?.value)) }}<small>km</small></span>
          </span>
          <span class="fact">
            <span class="tip-trigger">{{ 'codex.holo.strip.cooling' | translate }}</span>
            <span class="v pulse">{{
              sheet().coolant.used == null
                ? '—'
                : ('codex.holo.strip.coolingValue' | translate: { used: upInt('coolUsed', sheet().coolant.used), total: upInt('coolTotal', sheet().coolant.total) })
            }}</span>
          </span>
          </div>
        </div>

        <!-- Minimise (remembered per viewer): the strip folds to its Einsatz
             cell and these two controls, so nothing of it sits over the table.
             Not on a phone: there the strip is already one slim row. -->
        @if (!phone) {
        <button
          type="button"
          class="hs-mini"
          [attr.aria-pressed]="mini()"
          [attr.aria-label]="(mini() ? 'codex.holo.strip.restore' : 'codex.holo.strip.minimize') | translate"
          [scTooltip]="(mini() ? 'codex.holo.strip.restore' : 'codex.holo.strip.minimize') | translate"
          scTooltipTier="label"
          (click)="toggleMini()"
        ><span aria-hidden="true">{{ mini() ? '▭' : '–' }}</span></button>
        }
        <button
          type="button"
          class="hs-toggle"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="panelId"
          [scTooltip]="(expanded() ? 'codex.holo.strip.collapse' : 'codex.holo.strip.expand') | translate"
          scTooltipTier="label"
          (click)="toggleExpanded()"
        >
          <span class="chev" [class.open]="expanded()" aria-hidden="true">▴</span>
          <span class="sr-only">{{ (expanded() ? 'codex.holo.strip.collapse' : 'codex.holo.strip.expand') | translate }}</span>
        </button>
      </div>

      @if (expanded()) {
        <div class="hs-panel" [id]="panelId" animate.enter="hp-enter" animate.leave="hp-leave"
             (keydown.escape)="dismissTooltips()" (focusin)="reopenTooltips()" (pointerenter)="reopenTooltips()">
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
                  <div>
                    <button type="button" class="grp-btn"
                            [scTooltip]="(row.tooltipTitleKey | translate: row.labelParams) + ' · ' + (row.tooltipBodyKey | translate)" scTooltipTier="label"
                            [attr.aria-pressed]="row.cut" [attr.aria-label]="(row.cut ? 'codex.energy.toggleOn' : 'codex.energy.toggleOff') | translate: { group: row.labelKey | translate: row.labelParams }" (click)="toggleGroup(row.key)">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">
                        <path [attr.d]="iconPath(row.group)" />
                      </svg>
                    </button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <p class="gapv">{{ 'codex.energy.gap.noReactorData' | translate }}</p>
          }

          <div class="hp-right">
            <div class="hp-cooling">
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
                  <span class="gapv">{{ coolantGapKey() | translate }}</span>
                }
              </div>
            </div>

            <div class="hp-summary">
              @if (sheet().available) {
                <span class="v">{{ sheet().budgetUsed }}&nbsp;/&nbsp;{{ sheet().budgetTotal }} <small>{{ 'codex.energy.unit.segments' | translate }}</small></span>
                <span class="ok" [class.no]="!sheet().ready">
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
        --e-out: var(--holo-e-out);
        --hs-mono: var(--font-monospace, 'Share Tech Mono', monospace);
        --p-offensive: var(--holo-p-offensive);
        --p-defensive: var(--holo-p-defensive);
        --p-movement: var(--holo-p-movement);
        --p-signature: var(--holo-p-signature); }
      .holo-strip {
        padding-block-end: env(safe-area-inset-bottom, 0px);
        /* One capsule in the header's skin; its rim carries the Einsatz. */
        background: linear-gradient(180deg, color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)), color-mix(in srgb, var(--sc-accent) 3%, var(--sc-bg-0)));
        border: 1px solid color-mix(in srgb, var(--holo-e, var(--sc-accent)) 28%, transparent);
        border-block-end: 0;
        border-radius: 18px 18px 0 0;
        box-shadow: 0 -10px 30px rgb(0 0 0 / 0.5);
        transition: border-color var(--holo-t-base) ease;
        color: var(--sc-fg-0);
        font-size: max(12px, var(--sc-fs-floor));
      }
      /* --fab-clear: the feedback launcher owns the bottom-right corner
         (--sc-fab-lane in styles.scss) — where the strip reaches into that
         lane, its content stops short of it (measured, see the class). */
      .hs-row { display: flex; align-items: stretch; gap: 0; padding: 0; padding-inline-end: var(--fab-clear, 0px); overflow-x: auto;
        scrollbar-width: none; min-block-size: 64px; }
      .hs-row::-webkit-scrollbar { display: none; }
      .seg { display: flex; flex-direction: column; justify-content: center; gap: 2px; padding: 6px clamp(7px, 0.6vw, 11px); min-width: 0; flex: 1 1 auto; }
      .fade { flex: none; inline-size: 1px; margin-block: 10px; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--sc-accent) 40%, transparent), transparent); }
      .seg .lab { display: inline-flex; align-items: baseline; gap: 8px; font-family: var(--sc-font-display); font-size: max(9px, var(--sc-fs-floor));
        letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-accent); white-space: nowrap; }
      .einsatz { flex: 0 0 auto; min-inline-size: clamp(120px, 8vw, 150px); background: none; border: 0; border-start-start-radius: 18px; font: inherit; color: inherit; text-align: start; align-items: flex-start;
        cursor: pointer; transition: background 160ms ease; }
      .einsatz .lab { color: var(--sc-fg-2); }
      .einsatz:hover, .einsatz[aria-expanded='true'] { background: color-mix(in srgb, var(--holo-e, var(--sc-accent)) 14%, transparent); }
      .einsatz:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .caret { color: var(--sc-accent); font-size: 0.8em; letter-spacing: 0; }
      .mission-pop { position: absolute; inset-block-end: 100%; inset-inline-start: 0; margin-block-end: 6px; z-index: 5; display: grid; gap: 2px; padding: 6px; min-inline-size: 240px;
        background: var(--sc-bg-0); border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-bg-0)); border-radius: 4px; box-shadow: 0 -10px 30px rgb(0 0 0 / 0.5); }
      .mp { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 6px 10px; min-block-size: var(--sc-tap-min, 32px); background: none; border: 0; border-radius: 3px;
        color: var(--sc-fg-1); font: inherit; cursor: pointer; text-align: start; }
      .mp-l { display: inline-flex; align-items: center; gap: 8px; font-family: var(--sc-font-display); font-size: max(10.5px, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; }
      .mp-l svg { color: var(--h, currentColor); }
      .mp-l svg, .einsatz .val svg { inline-size: 1.15em; block-size: 1.15em; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .mp small { font-family: var(--hs-mono); font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }
      .mp:hover:not(:disabled) { color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .mp.on { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .mp:disabled { opacity: 0.4; cursor: not-allowed; }
      .mp:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .einsatz .val { display: flex; align-items: center; gap: 6px; max-inline-size: 100%; font-family: var(--sc-font-display); font-size: clamp(11.5px, 0.76vw, 14.5px); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
        color: var(--holo-e, var(--sc-accent)); line-height: 1.1; white-space: nowrap; transition: color var(--holo-t-base) ease; }
      .einsatz .sub { max-inline-size: 100%; font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tile-vals { display: flex; justify-content: space-between; gap: clamp(6px, 0.5vw, 9px); flex-wrap: nowrap; }
      .tv { display: flex; flex-direction: column; gap: 1px; }
      .tv .k { font-size: max(9px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }
      .tv .v { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; font-size: clamp(14px, 0.89vw, 17px); line-height: 1.1; color: var(--sc-fg-0); white-space: nowrap; letter-spacing: -0.02em;
        border-radius: 2px; transition: color 0.4s ease; }
      .tv.none .v { color: var(--sc-fg-2); }
      /* A value the pilot just changed (a swap, a revert) lights up once. */
      .tv.flash .v { animation: val-flash 900ms var(--e-out); }
      @keyframes val-flash { 0% { color: var(--sc-accent); text-shadow: 0 0 10px color-mix(in srgb, var(--sc-accent) 70%, transparent);
        background: color-mix(in srgb, var(--sc-accent) 16%, transparent); } }
      .d { font-family: var(--hs-mono); font-size: max(9.5px, var(--sc-fs-floor)); font-variant-numeric: tabular-nums; }
      .d.up { color: var(--sc-success); }
      .d.down { color: var(--sc-warning); }
      .fact { display: flex; flex-direction: column; gap: 1px; align-items: flex-start; }
      .fact .v { font-family: var(--hs-mono); font-variant-numeric: tabular-nums; font-size: clamp(14px, 0.89vw, 17px); line-height: 1.1; white-space: nowrap; letter-spacing: -0.02em; }
      .fact .v small { color: var(--sc-fg-2); margin-inline-start: 3px; font-size: max(10px, var(--sc-fs-floor)); }
      .fact[tabindex] { cursor: help; border-radius: var(--holo-r-xs); }
      .fact[tabindex]:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      /* Touch: a focusable fact (tooltip in metres) reaches the tap minimum. */
      @media (pointer: coarse) { .fact[tabindex] { min-block-size: var(--sc-tap-min); min-inline-size: var(--sc-tap-min); justify-content: center; } }
      .tip-trigger { font-size: max(9px, var(--sc-fs-floor)); color: var(--sc-fg-2); white-space: nowrap; }
      .hs-toggle {
        align-self: stretch; margin-inline-start: auto; flex: none;
        min-inline-size: var(--sc-tap-min, 44px); min-block-size: var(--sc-tap-min);
        border: none; border-inline-start: 1px solid var(--sc-border); background: transparent;
        color: var(--sc-accent); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px;
      }
      .hs-toggle:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .hs-toggle:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .hs-toggle { transition: background var(--holo-t-fast) ease; }
      .hs-toggle .chev { display: inline-block; transition: transform var(--holo-t-base) var(--e-out); }
      .hs-toggle .chev.open { transform: rotate(180deg); }
      .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
      .gapv { color: var(--sc-fg-2); }

      .hs-mini { align-self: stretch; flex: none; margin-inline-start: auto; min-inline-size: max(36px, var(--sc-tap-min, 0px)); border: none;
        border-inline-start: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg-2); cursor: pointer; font-size: 13px; }
      .hs-mini + .hs-toggle { margin-inline-start: 0; }
      .hs-mini:hover { color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .hs-mini:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      /* Minimised: only the Einsatz cell and the two controls, right-aligned
         as a small tab — the table keeps the whole viewport. */
      .holo-strip.mini { margin-inline-start: auto; inline-size: max-content; max-inline-size: 100%; }
      .holo-strip.mini .hs-row { min-block-size: 40px; }
      .holo-strip.mini .seg:not(.einsatz), .holo-strip.mini .fade, .holo-strip.mini .einsatz .sub { display: none; }
      /* Expanded: modes | pips | cooling (concept round 6 "Energie-Zeile":
         Modi links, Pips Mitte, Kühlung rechts — one instrument, one row). */
      /* Capped: a hull with many pip columns must not grow the sticky panel
         over the table (it scrolls inside instead). */
      .hs-panel { border-block-start: 1px solid color-mix(in srgb, var(--sc-accent) 20%, transparent);
        padding: 10px 14px; display: grid; grid-template-columns: 170px 1fr 240px; gap: 18px; align-items: center;
        max-block-size: min(36dvh, 300px); overflow-y: auto; overscroll-behavior: contain; }
      /* The panel unfolds out of the strip and folds back into it. */
      .hp-enter { animation: hp-in 260ms var(--e-out); }
      .hp-leave { animation: hp-out 180ms ease-in forwards; }
      @keyframes hp-in { from { opacity: 0; clip-path: inset(100% 0 0 0); } }
      @keyframes hp-out { to { opacity: 0; clip-path: inset(100% 0 0 0); } }
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
      .hp-pips { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px; --pip-h: 10px; --pip-gap: 3px; --pip-w: 26px; --pips: 1; }
      .hp-col { display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .stack { display: flex; flex-direction: column-reverse; gap: var(--pip-gap);
        block-size: calc(var(--pips) * var(--pip-h) + (var(--pips) - 1) * var(--pip-gap)); min-block-size: 30px; }
      .stack .pip { inline-size: var(--pip-w); block-size: var(--pip-h); border: none; border-radius: 2px;
        background: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); cursor: pointer; padding: 0;
        transition: background 160ms ease, box-shadow 160ms ease, transform 120ms ease; }
      .stack .pip:not(:disabled):hover { transform: scaleX(1.08); box-shadow: 0 0 0 1px color-mix(in srgb, var(--sc-accent) 55%, transparent); }
      .stack .pip.on { box-shadow: 0 0 6px color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      .stack .pip.on { background: var(--sc-accent); }
      .stack .pip.min { background: var(--sc-warning); }
      .hp-col.off .stack .pip { background: color-mix(in srgb, var(--sc-fg-2) 12%, transparent); }
      .hp-col.absent .stack .pip { background: color-mix(in srgb, var(--sc-fg-2) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 30%, transparent); }
      .grp-btn { min-inline-size: var(--sc-tap-min); min-block-size: var(--sc-tap-min); border: 1px solid transparent;
        border-radius: 3px; background: transparent; color: var(--sc-fg-2); cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center; }
      /* Touch: the global 48px button floor turned every 10px pip into a 48px
         block, and the fixed-height stack let them climb over the mode buttons
         above it. A pip keeps the bar shape (the stack is the target, one
         segment per level) and grows the way the energy dock's do. */
      @media (pointer: coarse) {
        .hp-pips { --pip-h: 16px; --pip-w: 30px; }
        .stack .pip { min-block-size: 0; min-inline-size: 0; }
      }
      .hp-col.act .grp-btn { color: var(--sc-accent); }
      .ico { width: 16px; height: 16px; }
      .hp-right { display: grid; gap: 6px; padding-inline-start: 22px; border-inline-start: 1px solid var(--sc-border); }
      .hp-cooling { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: center; }
      .hp-cooling svg { width: 64px; height: 64px; display: block; }
      .hp-cooling .tr { fill: none; stroke: color-mix(in srgb, var(--sc-fg-2) 22%, transparent); stroke-width: 7; }
      .hp-cooling .va { fill: none; stroke: var(--sc-accent); stroke-width: 7; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; }
      /* Overload, not a comparison: the cooling cannot hold what is asked of it
         — an error, not a hint (same rule as the energy dock). Stays danger red. */
      .hp-cooling .va.over { stroke: var(--sc-danger); }
      .hp-cooling text { font-family: var(--hs-mono); font-size: 12px; fill: var(--sc-fg-0); text-anchor: middle; }
      .hp-cooling text.l { font-family: var(--sc-font-display); font-size: 5.5px; letter-spacing: 0.14em; fill: var(--sc-fg-2); text-transform: uppercase; }
      .hp-cool-txt { display: grid; gap: 1px; }
      .hp-cool-txt .v { font-family: var(--hs-mono); font-size: 14px; color: var(--sc-fg-0); }
      .hp-cool-txt .k { font-family: var(--sc-font-display); font-size: max(8px, var(--sc-fs-floor)); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-fg-2); }
      .hp-summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-variant-numeric: tabular-nums; color: var(--sc-fg-1); }
      .hp-summary .v { font-family: var(--hs-mono); font-size: 13px; color: var(--sc-fg-0); }
      .hp-summary .v small { font-size: 10px; color: var(--sc-fg-2); }
      .hp-summary .mode { font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.14em; font-size: max(8.5px, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .hp-summary .ok { font-size: max(10px, var(--sc-fs-floor)); color: var(--sc-success); }
      .hp-summary .ok.no { color: var(--sc-danger); }
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
        .fade { display: none; }
        .seg { padding: 6px 8px; }
        .einsatz { min-inline-size: 0; }
        .einsatz .sub { display: none; }
        .sig .lab { max-inline-size: 64px; white-space: normal; line-height: 1.15; }
      }
      @media (max-width: 640px) {
        .holo-strip { position: fixed; inset-inline: 0 var(--sc-fab-clear-inline); /* ends before the launcher lane */ inset-block-end: var(--holo-strip-lift, 0px); border-radius: 12px 12px 0 0; }
        .hs-row { min-block-size: 52px; }
        /* The narrowest phones: symbol + class + the three perspectives; the page's Signatur tile keeps those values. */
        @media (max-width: 430px) { .sig, .sig + .fade { display: none; } .fade { display: none; } }
        .seg { padding: 5px 7px; flex: 1 1 0; }
        .tile-vals { min-inline-size: 0; }
        .tv .v, .fact .v { font-size: 12.5px; }
        .seg .lab .lt { display: none; }
        .seg .lab { gap: 0; }
        .tile-vals .tv .k { display: none; }
        .rankpips { display: none; }
        .sig .lab { max-inline-size: none; }
        .tip-trigger { display: none; }
        /* The mission segment sizes to its own label: as an equal flex share
           its nowrap "EINSATZ" / "◈ ALLES" spilled over the first value. */
        .einsatz { flex: none; }
        .einsatz .lab { letter-spacing: 0.08em; }
        .einsatz .val { font-size: max(10px, var(--sc-fs-floor)); letter-spacing: 0.08em; white-space: nowrap; }
        .hs-toggle { min-inline-size: max(36px, var(--sc-tap-min)); }
        .hs-panel { position: fixed; inset-inline: 0; inset-block-end: 0; max-block-size: 70vh; max-block-size: 70dvh; overflow-y: auto;
          /* The last row scrolls clear of the home indicator and the feedback launcher. */
          padding-block-end: calc(var(--sc-safe-bottom) + var(--sc-fab-size) + var(--sc-fab-gutter));
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
  /** The choices of the Einsatz picker, with their lead value. */
  readonly missions = input<readonly StripMission[]>([]);
  readonly missionOpen = signal(false);
  private readonly missionBtn = viewChild<ElementRef<HTMLElement>>('missionBtn');

  toggleMissions(ev: Event): void {
    ev.stopPropagation();
    this.missionOpen.update((v) => !v);
  }

  closeMissions(ev: Event): void {
    ev.stopPropagation();
    this.missionOpen.set(false);
    this.missionBtn()?.nativeElement.focus({ preventScroll: true });
  }

  pickMission(id: MissionId): void {
    this.missionOpen.set(false);
    this.missionChange.emit(id);
    this.missionBtn()?.nativeElement.focus({ preventScroll: true });
  }

  /** A click anywhere else closes the picker. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: Event): void {
    if (!this.missionOpen()) return;
    const pop = (ev.target as HTMLElement | null)?.closest?.('.mission-pop');
    if (!pop) this.missionOpen.set(false);
  }

  /** What the default Einsatz is called: the ship's class ("Kampfschiff"). */
  readonly defaultLabelKey = input<string | null>(null);
  /** Who the Einsatz cell compares with ("26 × Leichter Jäger"); null while the group loads. */
  readonly cohortLabel = input<string | null>(null);

  private readonly route = inject(ActivatedRoute, { optional: true });
  private readonly router = inject(Router, { optional: true });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly modes: readonly FlightMode[] = ['scm', 'nav'];

  private readonly uid = `holo-strip-${++uidSeq}`;
  protected readonly panelId = `${this.uid}-panel`;

  private readonly cutGroups = signal<ReadonlySet<PowerColumnKey>>(new Set());
  private readonly levels = signal<PowerLevels>({});
  protected readonly mode = signal<FlightMode>('scm');
  protected readonly preset = signal<PowerPreset>('auto');
  protected readonly expanded = signal<boolean>(false);
  /** A phone (≤ 640 px at load): the strip is one slim row, no minimise. */
  protected readonly phone = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
  /** Folded to its Einsatz cell — remembered per viewer (see {@link stripMiniKey}). */
  protected readonly mini = signal<boolean>(false);
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
  /** WHY the cooling load is empty — no coolers vs. no stated draw. */
  protected readonly coolantGapKey = computed(
    () => this.sheet().facts.find((f) => f.key === 'coolant')?.gapKey ?? 'codex.energy.gap.noCoolingData',
  );
  protected readonly csFact = computed(() => {
    const base = this.sheet().facts.find((f) => f.key === 'crossSection');
    const override = this.crossSection();
    if (!base) return base;
    if (override == null || base.value != null) return base;
    return { ...base, value: override, gapKey: null };
  });

  protected readonly activeMissionLabel = computed(() => (this.active() === 'all' && this.defaultLabelKey()) || missionById(this.active()).labelKey);
  protected readonly activeMissionIcon = computed(() => MISSION_ICON[this.active()]);
  protected iconOf(id: MissionId): string {
    return MISSION_ICON[id];
  }
  protected hueOf(id: MissionId): string {
    return missionColor(id);
  }

  /** groups `cells()` (already computed against the active mission) into the
   * three mini tiles via the SAME classification `buildPerspectiveDeltas`
   * uses for the patch-Δ view — never a second, drifting grouping. */
  protected readonly perspectiveTiles = computed<PerspectiveTile[]>(() => {
    const cells = this.cells();
    return PERSPECTIVE_TILES.map((perspective) => {
      const keys = new Set(PERSPECTIVE_KPIS[perspective]);
      const order = STRIP_TILE_ORDER[perspective];
      const tileCells = cells
        .filter((c) => keys.has(c.key) && c.value != null)
        .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
        .slice(0, 3);
      return { perspective, labelKey: `codex.holo.strip.${perspective}`, cells: tileCells };
    });
  });

  // ── Rolling values: a changed number runs from where it stood to where it
  // lands (~700 ms) — a hull switch shows WHICH numbers moved, a swap lights
  // the values it touched. The very first paint is a plain render; reduced
  // motion never rolls. ──
  private readonly still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly shown = new Map<string, number>();
  private shownShip: string | null = null;
  private rollFrom = new Map<string, number>();
  private rollRaf: number | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly rollProgress = signal(1);
  protected readonly flashKeys = signal<ReadonlySet<string>>(new Set());

  private startRoll(cells: readonly KpiStripCell[], ship: string): void {
    const first = this.shown.size === 0;
    const sameShip = this.shownShip === ship;
    const from = new Map<string, number>();
    const changed = new Set<string>();
    for (const c of cells) {
      if (c.value == null) continue;
      const prev = this.shown.get(c.key);
      if (prev !== undefined && prev !== c.value) {
        from.set(c.key, prev);
        changed.add(c.key);
      }
      this.shown.set(c.key, c.value);
    }
    this.shownShip = ship;
    // First appearance: every value counts up from zero (cx-countup) — no flash.
    if (first) for (const c of cells) if (c.value != null && c.value !== 0) from.set(c.key, 0);
    if (this.still || from.size === 0 || typeof requestAnimationFrame !== 'function') return;
    this.rollFrom = from;
    // Date.now, not the frame timestamp: fake clocks (and a throttled tab) advance it too.
    const start = Date.now();
    const ms = 700;
    if (this.rollRaf) cancelAnimationFrame(this.rollRaf);
    this.rollProgress.set(0);
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      this.rollProgress.set(1 - Math.pow(1 - t, 3));
      this.rollRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    this.rollRaf = requestAnimationFrame(tick);
    // Only a change on the SAME hull (a swap, a revert, a patch) flashes —
    // a hull switch changes everything, and lighting everything says nothing.
    if (sameShip) {
      this.flashKeys.set(changed);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.flashKeys.set(new Set()), 950);
    }
  }

  /** The cell's value mid-roll (or at rest) — the SAME formatter as `fmtCell`. */
  protected fmtRolled(c: KpiStripCell): string {
    const p = this.rollProgress();
    const from = this.rollFrom.get(c.key);
    if (c.value == null || p >= 1 || from === undefined) return this.fmtCell(c);
    return formatEquippedStat({ labelKey: c.labelKey, value: from + (c.value - from) * p, format: c.format });
  }

  /** How far the strip reaches into the feedback launcher's corner lane. */
  private measureFabClearance(): void {
    const el = this.host.nativeElement;
    const root = getComputedStyle(document.documentElement);
    const lane = (parseFloat(root.getPropertyValue('--sc-fab-inset')) || 24) + (parseFloat(root.getPropertyValue('--sc-fab-size')) || 56);
    const gutter = parseFloat(root.getPropertyValue('--sc-fab-gutter')) || 12;
    // The bar, not the host: on a phone the bar is fixed and the host collapses.
    const box = (el.querySelector('.holo-strip') ?? el).getBoundingClientRect();
    // clientWidth, not innerWidth: the launcher's `right` inset is measured
    // from the viewport WITHOUT the page's scrollbar.
    let free = document.documentElement.clientWidth - lane - gutter;
    // A detail page's share button rides beside the launcher, on whatever row the bar is.
    const dock = document.querySelector('sc-share-button .dock')?.getBoundingClientRect();
    if (dock && dock.width > 0 && dock.bottom > box.top && dock.top < box.bottom) free = Math.min(free, dock.left - gutter / 2);
    const clear = Math.max(0, Math.round(box.right - free));
    el.style.setProperty('--fab-clear', `${clear}px`);
  }

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
    // The minimised state is per VIEWER: re-read whenever the user resolves
    // (a deep link renders before the session does — the first read is anon).
    effect(() => {
      const key = stripMiniKey(this.userId());
      untracked(() => this.mini.set(this.storageGet(key) === 'true'));
    });
    effect(() => {
      this.sheetChange.emit(this.sheet());
    });
    effect(() => {
      const cells = this.cells();
      const ship = this.shipClassName();
      untracked(() => this.startRoll(cells, ship));
    });
    afterNextRender(() => {
      this.measureFabClearance();
      // The share button arrives with the route, after this first measure.
      const late = setTimeout(() => this.measureFabClearance(), 1500);
      this.destroyRef.onDestroy(() => clearTimeout(late));
      const onResize = () => this.measureFabClearance();
      window.addEventListener('resize', onResize, { passive: true });
      const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(onResize) : null;
      ro?.observe(this.host.nativeElement);
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('resize', onResize);
        ro?.disconnect();
      });
    });
    this.destroyRef.onDestroy(() => {
      if (this.rollRaf) cancelAnimationFrame(this.rollRaf);
      if (this.flashTimer) clearTimeout(this.flashTimer);
      this.counter.dispose();
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

    // The energy panel always starts closed: opened, it sits over the lower
    // part of the table, so a page must never LOAD with it open (holodeck
    // walkthrough 2026-10-08 — it covered ~40 % of a 900 px viewport). What
    // the viewer chooses to keep is the minimised strip (`mini`).
    this.expanded.set(false);
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

  /** Every other number of the strip counts up on appearance and rolls on change (cx-countup). */
  protected readonly counter = new CountUp(this.still);

  protected up(key: string, v: number | null | undefined): number | null {
    return v === null || v === undefined ? null : this.counter.value(key, v);
  }

  protected upInt(key: string, v: number | null | undefined): number | null {
    const n = this.up(key, v);
    return n === null ? null : Math.round(n);
  }

  /** One decimal in the page's number locale ("14,5" in German — never a
   * stray "14.5" beside every other comma-decimal on the page). */
  protected fmtKm(v: number | null | undefined): string {
    if (v === null || v === undefined) return '—';
    const km = Math.round(v / 100) / 10;
    const text = formatNumber(km);
    return Number.isInteger(km) ? `${text}${formatNumber(1.5).charAt(1)}0` : text;
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
    // Opening the panel from a minimised strip brings the strip back.
    if (next && this.mini()) this.toggleMini();
  }

  protected toggleMini(): void {
    const next = !this.mini();
    this.mini.set(next);
    if (next) this.expanded.set(false);
    this.storageSet(stripMiniKey(this.userId()), String(next));
  }
}
