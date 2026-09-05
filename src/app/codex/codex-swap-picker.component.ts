import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ScSegmentedComponent, ScSegmentOption } from '../shared/segmented-control.component';
import { ScColumnMenuComponent } from '../shared/column-menu.component';
import { CodexKind, CodexService, CompatibleItem } from './codex.service';
import { ammoClassNameFor, ammoClassNamesFor, formatEquippedStat } from './codex-equipped-stats';
import {
  ColumnDef,
  ColumnFacet,
  ColumnFilterChip,
  ColumnMenuState,
  EMPTY_COLUMN_MENU_STATE,
  SortDir,
  activeFilterChips,
  applyColumnMenu,
  clearAllColumnFilters,
  clearColumnFilter,
  columnFacets,
  setColumnSort,
  setNumericFilter,
  toggleColumnSort,
  toggleFacetValue,
  clearSecondaryColumnSort,
} from './table-column-menu';
import {
  DAMAGE_FAMILY_LABEL_KEY,
  DEFAULT_SWAP_COLUMNS,
  DEFAULT_SWAP_COLUMN_CHOOSER,
  NAME_SORT_KEY,
  SWAP_VALUE_CATALOGUE,
  SwapBaseline,
  SwapCandidate,
  SwapColumnChooser,
  SwapScope,
  SwapValueDef,
  applySwapScope,
  baselineClassName,
  buildSwapCandidate,
  defaultSwapColumnsFor,
  isWeaponCandidateSet,
  resetSwapColumns,
  swapCell,
  swapCellState,
  swapDeltaColumn,
  swapMissingSourceColumns,
  swapScopeOptions,
  swapValueBars,
  swapValueDef,
  toggleSwapColumn,
} from './swap-table';

/**
 * The hardpoint a picker was opened for. Assembled by the ship detail page from
 * either a module row or one of its sub-slots (the gun inside a gimbal mount),
 * so both open the same table.
 */
export interface SwapTarget {
  /** Humanized hardpoint label; may stand for several identical ports. */
  port: string;
  /** How many identical hardpoints the choice would apply to (≥1). */
  count: number;
  /** What is installed right now — the EQUIPPED row and the default Δ baseline. */
  className: string | null;
  kind: CodexKind | null;
  name: string | null;
  size: number | null;
  /**
   * The class name the ship SHIPS WITH from the factory — the `Ab Werk` Δ
   * baseline (MASTER §9). `null` when the host cannot resolve it (an unfitted
   * bay, or a hull with no stock entry for this port).
   */
  factoryClassName?: string | null;
  /**
   * What the hardpoint ACCEPTS, for a bay that ships empty. Normally the list
   * is derived from the installed item's `attachType`, which an unfitted bay
   * cannot provide — so the ship page supplies it here instead, either from the
   * hardpoint's own `codex_item_ports` entry or from an identical, fitted bay
   * on the same hull (admin request 1add86a4: the Nomad's third shield slot).
   */
  attachTypes?: string[] | null;
  /**
   * True when `attachTypes` came from a sibling hardpoint rather than from this
   * one — the picker says so, so an inference is never read as a fact.
   */
  fitInferred?: boolean;
  /**
   * Every RAW dotted path this target covers (Falle 3, R5) — one for a plain
   * hardpoint, several for a grouped row, dotted `parent.child` for a sub-slot.
   * This is what a draft entry is actually keyed by.
   */
  rawPorts?: string[];
  /** Raw (un-humanized) engine type strings the target's port declares. */
  rawTypes?: string[];
}

/** Supabase rejects very long `in.()` lists — hydrate payloads in batches. */
const HYDRATE_CHUNK = 100;

/** What "picked" emits — the HOST decides what to do with it. */
export interface SwapPick {
  className: string | null;
  target: SwapTarget;
}

const COLUMN_STORAGE_KEY = 'scc-codex-picker-cols:v1';

/** Sentinel `typeFilter()` value for "no restriction" — a real attach type never equals it. */
const TYPE_ALL = '__all__';

/** Column keys the picker reads off the candidate directly, not off `.stats`. */
const DIRECT_ACCESSORS: Record<string, (c: SwapCandidate) => number | string | null> = {
  [NAME_SORT_KEY]: (c) => c.name,
  'codex.picker.col.grade': (c) => c.grade,
  'codex.picker.col.manufacturer': (c) => c.manufacturerCode,
  'codex.picker.col.damageType': (c) => c.damageChannels[0] ?? null,
  'codex.picker.col.archetype': (c) => c.archetype,
  'codex.picker.col.size': (c) => c.size,
};

/** Best-effort unit suffix for a column head — never invents a unit the value doesn't have. */
function unitKeyFor(key: string, def: SwapValueDef): string | null {
  const byKey: Record<string, string> = {
    'codex.picker.col.mass': 'codex.picker.unit.kg',
    'codex.picker.col.power': 'codex.picker.unit.seg',
    'codex.equipped.fireRate': 'codex.picker.unit.perMin',
    'codex.picker.col.aimYaw': 'codex.picker.unit.deg',
    'codex.picker.col.aimRate': 'codex.picker.unit.degPerSec',
  };
  if (byKey[key]) return byKey[key];
  switch (def.format) {
    case 'perSec':
      return 'codex.picker.unit.perSec';
    case 'seconds':
      return 'codex.picker.unit.s';
    case 'mps':
      return 'codex.picker.unit.mps';
    case 'percent':
      return 'codex.picker.unit.percent';
    default:
      return null;
  }
}

/**
 * The swap picker (admin request 461288f9, redesigned per MASTER §9 / iteration
 * 7 `#g3` + iteration 8 `#h3` values): a centred window over a dimmed, blurred
 * veil listing everything that fits a hardpoint as a searchable, filterable,
 * sortable comparison table with a Δ baseline switch and a column chooser.
 *
 * It never writes anything itself: the HOST (codex-detail's draft state) owns
 * turning a pick into a persisted change, so the same table works whether the
 * host writes to a draft, a hangar config, or nothing at all (06-fallen.md
 * Falle 5). Column sort/filter is delegated to the generic `sc-column-menu` +
 * `table-column-menu.ts` pair so the pattern is reusable elsewhere.
 */
@Component({
  selector: 'sc-codex-swap-picker',
  standalone: true,
  imports: [TranslateModule, ScSegmentedComponent, ScColumnMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (target(); as t) {
      <div class="pick-veil" [attr.title]="'codex.picker.hint' | translate" (click)="closed.emit()">
        <p class="pick-hint">{{ 'codex.picker.hint' | translate }}</p>
        <article #dialog class="pick-win" role="dialog" aria-modal="true"
                 aria-labelledby="pick-title"
                 (click)="$event.stopPropagation()" (keydown)="onKeydown($event)">
          <header class="pick-head">
            <div class="pick-titles">
              <h2 id="pick-title">{{ 'codex.picker.title' | translate: { port: t.port, size: t.size ?? '' } }}</h2>
              @if (t.name) {
                <p class="pick-installed">{{ 'codex.picker.installed' | translate: { name: t.name } }}</p>
              } @else {
                <p class="pick-installed">{{ 'codex.swap.installedNone' | translate }}</p>
              }
              @if (t.count > 1) {
                <p class="pick-applies">{{ 'codex.swap.appliesToMany' | translate: { count: t.count, port: t.port } }}</p>
              } @else {
                <p class="pick-applies">{{ 'codex.swap.appliesToOne' | translate: { port: t.port } }}</p>
              }
            </div>
            <button type="button" class="pick-clear" (click)="clearSlot()">
              {{ 'codex.swap.clearSlot' | translate }}
            </button>
            <button type="button" class="pick-close" (click)="closed.emit()"
                    [attr.aria-label]="'codex.picker.close' | translate">✕</button>
          </header>

          @if (t.fitInferred) {
            <p class="pick-hint inferred">{{ 'codex.swap.fitInferred' | translate }}</p>
          }

          @if (loading()) {
            <p class="pick-msg">{{ 'codex.swap.loading' | translate }}</p>
          } @else if (error()) {
            <p class="pick-msg err">{{ 'codex.swap.failed' | translate }}</p>
          } @else if (candidates().length === 0) {
            <p class="pick-msg">{{ 'codex.swap.none' | translate }}</p>
          } @else {
            <div class="pick-scope">
              <label class="pick-search">
                <span class="sr-only">{{ 'codex.picker.searchLabel' | translate }}</span>
                <input #search type="search" autocomplete="off" [value]="query()"
                       (input)="setQuery($event)"
                       [attr.placeholder]="'codex.picker.searchPlaceholder' | translate" />
              </label>

              <div class="pick-seg">
                <span class="pick-seg-label">{{ 'codex.picker.compareWith' | translate }}</span>
                <sc-segmented [options]="scopeOptions()" [value]="scope()"
                              [ariaLabel]="'codex.picker.compareWith' | translate"
                              (valueChange)="scope.set($any($event))" />
              </div>

              <div class="pick-seg">
                <span class="pick-seg-label">{{ 'codex.picker.deltaAgainst' | translate }}</span>
                <sc-segmented [options]="baselineOptions()" [value]="baseline()"
                              [ariaLabel]="'codex.picker.deltaAgainst' | translate"
                              (valueChange)="baseline.set($any($event))" />
                <span class="pick-preview-hint">{{ 'codex.swap.previewHint' | translate }}</span>
              </div>

              @if (showTypeFilter()) {
                <div class="pick-seg">
                  <span class="pick-seg-label">{{ 'codex.swap.typeFilter' | translate }}</span>
                  <sc-segmented [options]="typeFilterOptions()" [value]="typeFilter()"
                                [ariaLabel]="'codex.swap.typeFilter' | translate"
                                (valueChange)="typeFilter.set($any($event))" />
                </div>
              }

              <p class="pick-count">{{ 'codex.picker.count' | translate: { n: rows().length, total: candidates().length } }}</p>

              <details class="pick-cols">
                <summary class="pick-cols-sum">{{ 'codex.picker.columns' | translate }} ▾</summary>
                <div class="pick-cols-pop">
                  @for (v of catalogue; track v.key) {
                    @if (v.key !== NAME_KEY && !unavailable().has(v.key)) {
                      <label class="pc-row">
                        <input type="checkbox" [checked]="wantedColumns().includes(v.key)"
                               (change)="toggleColumn(v.key)" />
                        {{ v.key | translate }}
                      </label>
                    }
                  }
                  @if (unavailable().size > 0) {
                    <fieldset class="pc-unavail-group" disabled>
                      <legend class="pc-unavail">{{ 'codex.picker.columnsUnavailable' | translate }}</legend>
                      @for (v of catalogue; track v.key) {
                        @if (unavailable().has(v.key)) {
                          <label class="pc-row off">
                            <input type="checkbox" [checked]="wantedColumns().includes(v.key)" disabled />
                            {{ v.key | translate }}
                          </label>
                        }
                      }
                    </fieldset>
                  }
                  <button type="button" class="pc-reset" (click)="resetColumns()">
                    {{ 'codex.picker.menu.clear' | translate }}
                  </button>
                </div>
              </details>
            </div>

            @if (rows().length === 0) {
              <p class="pick-msg">{{ 'codex.swap.noMatch' | translate }}</p>
            } @else {
              <div class="pick-scroll">
                <table class="wt" role="grid">
                  <thead>
                    <tr>
                      <th scope="col" class="c-name" [attr.aria-sort]="ariaSort(NAME_KEY)" [attr.title]="sortRankTitle(NAME_KEY)">
                        <sc-column-menu
                          [label]="('codex.picker.col.name' | translate)"
                          kind="categorical"
                          [sortDir]="sortDirOf(NAME_KEY)"
                          [facets]="facetsOf(NAME_KEY)"
                          [hasFilter]="hasFilter(NAME_KEY)"
                          [menuOpenLabel]="'codex.picker.menu.open' | translate: { column: ('codex.picker.col.name' | translate) }"
                          [sortLabel]="'codex.picker.menu.sort' | translate"
                          [ascLabel]="'codex.picker.menu.asc' | translate"
                          [descLabel]="'codex.picker.menu.desc' | translate"
                          [filterLabel]="'codex.picker.menu.filter' | translate"
                          [clearLabel]="'codex.picker.menu.clear' | translate"
                          [secondarySortLabel]="secondarySortEligible(NAME_KEY) ? ('codex.picker.menu.secondary' | translate) : ''"
                          [secondaryActive]="isSecondarySort(NAME_KEY)"
                          (headClick)="onHeadClick(NAME_KEY, $event)"
                          (sortPick)="onSortPick(NAME_KEY, $event)"
                          (facetToggle)="onFacetToggle(NAME_KEY, $event)"
                          (clearFilter)="onClearFilter(NAME_KEY)"
                          (secondarySortToggle)="onSecondarySortToggle(NAME_KEY)" />
                      </th>
                      @for (col of displayColumns(); track col.key) {
                        <th scope="col" class="c-num" [attr.aria-sort]="ariaSort(col.key)" [attr.title]="sortRankTitle(col.key)">
                          <sc-column-menu
                            [label]="colLabel(col)"
                            [unit]="colUnit(col)"
                            [kind]="col.categorical ? 'categorical' : 'numeric'"
                            [sortDir]="sortDirOf(col.key)"
                            [range]="rangeOf(col.key)"
                            [facets]="facetsOf(col.key)"
                            [hasFilter]="hasFilter(col.key)"
                            [menuOpenLabel]="'codex.picker.menu.open' | translate: { column: (col.key | translate) }"
                            [sortLabel]="'codex.picker.menu.sort' | translate"
                            [ascLabel]="'codex.picker.menu.asc' | translate"
                            [descLabel]="'codex.picker.menu.desc' | translate"
                            [rangeLabel]="'codex.picker.menu.range' | translate"
                            [fromLabel]="'codex.picker.menu.from' | translate"
                            [toLabel]="'codex.picker.menu.to' | translate"
                            [filterLabel]="'codex.picker.menu.filter' | translate"
                            [clearLabel]="'codex.picker.menu.clear' | translate"
                            [secondarySortLabel]="secondarySortEligible(col.key) ? ('codex.picker.menu.secondary' | translate) : ''"
                            [secondaryActive]="isSecondarySort(col.key)"
                            (headClick)="onHeadClick(col.key, $event)"
                            (sortPick)="onSortPick(col.key, $event)"
                            (rangeChange)="onRangeChange(col.key, $event)"
                            (facetToggle)="onFacetToggle(col.key, $event)"
                            (clearFilter)="onClearFilter(col.key)"
                            (secondarySortToggle)="onSecondarySortToggle(col.key)" />
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (c of rows(); track c.className) {
                      <tr class="pick-row" tabindex="0" [class.cur]="c.className === baselineClass()"
                          [attr.aria-label]="'codex.picker.pickRow' | translate: { name: c.name }"
                          (click)="pick(c)" (keydown.enter)="pick(c)" (keydown.space)="pick(c); $event.preventDefault()">
                        <td class="c-name">
                          @if (c.size != null) { <span class="size-tag">S{{ c.size }}</span> }
                          <span class="pick-ident">
                            <span class="pick-name">
                              {{ c.name }}
                              @if (c.equipped) {
                                <span class="tag eq">✓ {{ 'codex.swap.equipped' | translate }}</span>
                              }
                            </span>
                            <span class="pick-meta">{{ metaLine(c) }}</span>
                          </span>
                        </td>
                        @for (col of displayColumns(); track col.key) {
                          <td class="c-num" [class.gapc]="cellState(c, col.key) === 'notApplicable'"
                              [attr.title]="cellState(c, col.key) === 'notApplicable' ? ('codex.picker.dashCellTitle' | translate) : null">
                            @if (barKeys.has(col.key)) {
                              @if (barOf(col.key, c); as bar) {
                                @if (bar.percent !== null) {
                                  <span class="bar" [style.width.%]="bar.percent" aria-hidden="true"></span>
                                }
                                @if (bar.optimum) { <span class="opt" [attr.title]="'codex.picker.optimum' | translate" aria-hidden="true"></span> }
                              }
                            }
                            @if (col.key === DELTA_KEY) {
                              <span class="cell d" [class.up]="deltaTone(c) === 'up'" [class.down]="deltaTone(c) === 'down'">{{ cellText(c, col) }}</span>
                            } @else {
                              <span class="cell">{{ cellText(c, col) }}</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div class="pick-cues">
                <span><span aria-hidden="true">↔</span> {{ 'codex.picker.scrollCue.horizontal' | translate: { columns: overflowColumnLabels() } }}</span>
                <span><span aria-hidden="true">↕</span> {{ 'codex.picker.scrollCue.vertical' | translate }}</span>
              </div>

              @if (scopeChip() || typeFilterChip() || chips().length > 0) {
                <ul class="fc-list">
                  @if (scopeChip(); as sc) {
                    <li class="fc">
                      {{ sc.label }}
                      <button type="button" (click)="scope.set('allSize')"
                              [attr.aria-label]="'codex.picker.chipRemove' | translate: { label: sc.label }">✕</button>
                    </li>
                  }
                  @if (typeFilterChip(); as tf) {
                    <li class="fc">
                      {{ tf.label }}
                      <button type="button" (click)="typeFilter.set(TYPE_ALL)"
                              [attr.aria-label]="'codex.picker.chipRemove' | translate: { label: tf.label }">✕</button>
                    </li>
                  }
                  @for (chip of chips(); track chip.key) {
                    <li class="fc">
                      {{ chip.columnLabelKey | translate }}: {{ chip.textKey | translate: chip.params }}
                      <button type="button" (click)="onClearFilter(chip.key)"
                              [attr.aria-label]="'codex.picker.chipRemove' | translate: { label: (chip.columnLabelKey | translate) }">✕</button>
                    </li>
                  }
                </ul>
              }
              @if (candidates().length > 0) {
                <p class="pick-sorthint">{{ 'codex.swap.sortHint' | translate }}</p>
              }

              <p class="pick-note">{{ 'codex.picker.dashNote' | translate }}</p>
              @if (baselineOutOfSet()) {
                <p class="pick-note baseline-note">{{ 'codex.picker.baselineOutOfSet' | translate }}</p>
              }
            }
          }

          <footer class="pick-foot">
            @if (missingColumnsText(); as missing) {
              <p class="pick-missing">{{ 'codex.picker.footerMissing' | translate: { fields: missing } }}</p>
            }
          </footer>
        </article>
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    .pick-veil { position: fixed; inset: 0; z-index: 150;
      background: color-mix(in srgb, var(--sc-bg-0) 60%, transparent);
      -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px);
      display: grid; place-items: center; padding: 52px 72px; overflow-y: auto; }
    .pick-hint { position: absolute; top: 16px; left: 0; right: 0; text-align: center;
      font-size: max(0.75rem, var(--sc-fs-floor)); color: var(--sc-fg-2); pointer-events: none; margin: 0; }
    .pick-hint.inferred { position: static; pointer-events: auto; text-align: left; margin: 0 18px;
      border-left: 2px solid color-mix(in srgb, var(--sc-warn) 55%, transparent); padding-left: 8px; }

    .pick-win { position: relative; width: 100%; max-width: 1060px; max-height: 100%;
      display: flex; flex-direction: column; background: var(--sc-bg-1);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      border-radius: var(--radius-md, 4px); box-shadow: 0 24px 70px rgb(0 0 0 / .7);
      overflow: hidden; padding: 16px 18px 14px; gap: 10px; }

    .pick-head { display: flex; align-items: flex-start; gap: 10px;
      background: linear-gradient(180deg, var(--sc-bg-2), var(--sc-bg-1));
      margin: -16px -18px 0; padding: 12px 16px; }
    .pick-titles { flex: 1 1 auto; min-width: 0; }
    .pick-titles h2 { margin: 0; font-size: 1.02rem; }
    .pick-installed { margin: 3px 0 0; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-1); overflow-wrap: anywhere; }
    .pick-applies { margin: 2px 0 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .pick-clear { flex: 0 0 auto; padding: 5px 10px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px dashed var(--sc-border); color: var(--sc-fg-1); font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer; }
    .pick-clear:hover { border-color: var(--sc-danger); color: var(--sc-danger); }
    .pick-close { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 50%; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); cursor: pointer; font-size: 0.9rem; }
    .pick-close:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
    .pick-msg { margin: 6px 0; font-size: 0.8rem; color: var(--sc-fg-2); }
    .pick-msg.err { color: var(--sc-danger); }

    .pick-scope { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 16px; }
    .pick-search { flex: 1 1 200px; min-width: 160px; }
    .pick-search input { width: 100%; padding: 7px 10px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-0); font: inherit; font-size: 0.8rem; }
    .pick-seg { display: flex; flex-direction: column; gap: 3px; }
    .pick-seg-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--sc-fg-2); }
    .pick-preview-hint { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); max-width: 220px; }
    .pick-count { margin: 0 0 6px; font-size: max(0.74rem, var(--sc-fs-floor)); color: var(--sc-fg-1); align-self: flex-end; }

    .pick-cols { position: relative; align-self: flex-end; }
    .pick-cols-sum { cursor: pointer; padding: 6px 10px; border-radius: 6px; background: var(--sc-bg-0);
      border: 1px solid var(--sc-border); color: var(--sc-fg-1); font-size: max(0.76rem, var(--sc-fs-floor)); list-style: none; }
    .pick-cols-sum::-webkit-details-marker { display: none; }
    .pick-cols-pop { position: absolute; top: calc(100% + 4px); right: 0; z-index: 6; width: 220px; max-height: 320px;
      overflow-y: auto; background: var(--sc-bg-2); border: 1px solid var(--sc-border); border-radius: var(--radius-md, 4px);
      box-shadow: 0 10px 28px rgb(0 0 0 / .6); padding: 8px; display: flex; flex-direction: column; gap: 3px; }
    .pc-row { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; }
    .pc-row.off { color: var(--sc-fg-2); cursor: not-allowed; }
    /* LOW-6: the unavailable columns render as a disabled fieldset group, not
       individually-disabled checkboxes scattered through the live list. */
    .pc-unavail-group { border: none; margin: 4px 0 0; padding: 4px 0 0; display: flex; flex-direction: column; gap: 3px;
      border-top: 1px dashed var(--sc-border); }
    .pc-unavail { margin: 0 0 2px; padding: 0; font-size: 11px; color: var(--sc-fg-2); font-style: italic; }
    .pc-reset { margin-top: 6px; padding: 4px 8px; border-radius: 4px; background: transparent;
      border: 1px solid var(--sc-border); color: var(--sc-fg-2); font: inherit; font-size: 11px; cursor: pointer; align-self: flex-start; }

    /* MEDIUM-5: the column-menu popover used to be an absolutely-positioned
       child of the th cell, so this scroll box had to drop its own clipping
       (overflow: visible) while a menu was open — which also dropped it as a
       scroll CONTAINER, forgetting scrollLeft/scrollTop (a table scrolled
       sideways snapped back to the Bauteil column the moment a menu was
       opened) and letting the sticky header re-resolve against the next
       scrolling ancestor. sc-column-menu now portals its panel through CDK's
       Overlay (see column-menu.component.ts), so .pick-scroll never has to
       relax its overflow at all — it stays a normal, always-scrollable
       container regardless of any open menu. */
    .pick-scroll { overflow: auto; border: 1px solid var(--sc-border); border-radius: var(--radius-md, 4px); flex: 1 1 auto; }
    .wt { min-inline-size: 1080px; width: 100%; border-collapse: collapse; font-size: max(12px, var(--sc-fs-floor));
      font-variant-numeric: tabular-nums; }
    .wt thead th { position: sticky; top: 0; z-index: 2; background: var(--sc-bg-2);
      border-bottom: 1px solid var(--sc-border); padding: 4px 8px; text-align: right;
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--sc-fg-2); }
    .wt th.c-name { text-align: left; position: sticky; left: 0; z-index: 4; }
    .wt td.c-name { position: sticky; left: 0; z-index: 3; background: var(--sc-bg-1); }

    .pick-row { border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 55%, transparent); cursor: pointer; }
    .pick-row:hover { background: color-mix(in srgb, var(--sc-accent) 7%, transparent); }
    .pick-row:hover td.c-name { background: color-mix(in srgb, var(--sc-accent) 7%, var(--sc-bg-1)); }
    .pick-row.cur { background: color-mix(in srgb, var(--sc-warn) 8%, transparent); }
    .pick-row.cur td.c-name { background: color-mix(in srgb, var(--sc-warn) 14%, var(--sc-bg-0)); }

    td.c-name { padding: 6px 8px; }
    .pick-ident { display: flex; flex-direction: column; gap: 1px; min-width: 0; margin-left: 4px; }
    .pick-name { font-size: 0.8rem; color: var(--sc-fg-0); overflow-wrap: anywhere; display: inline-flex; align-items: center; gap: 6px; }
    .pick-meta { font-size: max(0.64rem, var(--sc-fs-floor)); color: var(--sc-fg-2); overflow-wrap: anywhere; }
    .size-tag { font-size: max(0.62rem, var(--sc-fs-floor)); font-weight: 600; padding: 1px 6px; border-radius: 4px;
      color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    .tag.eq { font-size: max(0.54rem, var(--sc-fs-floor)); text-transform: uppercase; padding: 0 5px; border-radius: 3px;
      color: var(--sc-accent); border: 1px solid color-mix(in srgb, var(--sc-accent) 55%, transparent);
      background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }

    td.c-num { position: relative; padding: 6px 8px; text-align: right; color: var(--sc-fg-1); white-space: nowrap; }
    td.c-num.gapc { color: var(--sc-fg-2); }
    .bar { position: absolute; inset: 2px auto 2px 0; border-radius: 0 3px 3px 0; background: color-mix(in srgb, var(--sc-accent) 20%, transparent); }
    .opt { position: absolute; inset-block: 2px; inline-size: 1px; background: var(--sc-warn); }
    .cell { position: relative; }
    .cell.d.up { color: var(--sc-success); }
    .cell.d.down { color: var(--sc-danger); }

    .pick-note { margin: 2px 0 0; font-size: 11px; color: var(--sc-fg-2); }
    .pick-note.baseline-note { color: var(--sc-warn); }
    .pick-sorthint { margin: 4px 0 0; font-size: max(11px, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }
    .fc-list { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .fc { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 62%, var(--sc-bg-0));
      background: color-mix(in srgb, var(--sc-accent) 10%, transparent); color: var(--sc-accent); font-size: 11px; }
    .fc button { background: transparent; border: none; color: inherit; cursor: pointer; font: inherit; padding: 0; }

    .pick-cues { display: flex; justify-content: space-between; font-size: 11px; color: var(--sc-fg-2); margin-top: 2px; }

    .pick-foot { padding-top: 6px; }
    .pick-missing { margin: 0; font-size: 11px; color: var(--sc-fg-2); font-style: italic; }

    @media (max-width: 640px) {
      .pick-veil { padding: 0; }
      .pick-win { max-width: none; border-radius: 0; }
      .pick-scope { flex-direction: column; align-items: stretch; }
      .pick-count, .pick-cols { align-self: flex-start; }
    }
  `],
})
export class CodexSwapPickerComponent {
  private readonly svc = inject(CodexService);
  private readonly i18n = inject(TranslateService);

  /**
   * Signal-tracked UI language, so the strings this component resolves outside
   * a `| translate` pipe still re-render on a language switch (#50).
   */
  private readonly lang = signal(this.i18n.currentLang);

  /** The hardpoint to explore; `null` renders nothing (closed). */
  readonly target = input<SwapTarget | null>(null);
  readonly closed = output<void>();
  /** A row was picked, or "Slot leeren" — the host applies it. */
  readonly picked = output<SwapPick>();

  readonly NAME_KEY = NAME_SORT_KEY;
  readonly DELTA_KEY = 'codex.picker.col.deltaSustained';
  readonly catalogue = SWAP_VALUE_CATALOGUE;
  readonly TYPE_ALL = TYPE_ALL;

  readonly loading = signal(false);
  readonly error = signal(false);
  readonly candidates = signal<SwapCandidate[]>([]);
  readonly query = signal('');
  readonly scope = signal<SwapScope>('sameClass');
  readonly baseline = signal<SwapBaseline>('fitted');
  readonly chooser = signal<SwapColumnChooser>(this.loadColumns());
  readonly columnMenu = signal<ColumnMenuState>(EMPTY_COLUMN_MENU_STATE);
  /**
   * Part-type filter (E-main-gap #40): the attach types this hardpoint
   * actually queried for, and the one the user narrowed to. Independent of
   * `scope` — a missile rack has no weapon family to switch between, but may
   * still accept several distinct component types.
   */
  readonly portTypes = signal<string[]>([]);
  readonly typeFilter = signal<string>(TYPE_ALL);

  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');
  private returnFocus: HTMLElement | null = null;
  private loadToken = 0;

  /** Value keys that get a magnitude bar (MASTER §9: Alpha, DPS only). */
  readonly barKeys = new Set(['codex.equipped.alphaDamage', 'codex.equipped.dps']);

  /** ≤640px: the column set collapses to name + Δ + DPS + Alpha (UI spec phone state). */
  private static readonly PHONE_COLUMNS: readonly string[] = [
    'codex.picker.col.deltaSustained',
    'codex.equipped.dps',
    'codex.equipped.alphaDamage',
  ];

  private readonly isPhone = signal(
    typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(max-width: 640px)').matches : false,
  );

  constructor() {
    this.i18n.onLangChange.pipe(takeUntilDestroyed()).subscribe((e) => this.lang.set(e.lang));

    if (typeof globalThis.matchMedia === 'function') {
      const mq = globalThis.matchMedia('(max-width: 640px)');
      fromEvent<MediaQueryListEvent>(mq, 'change')
        .pipe(takeUntilDestroyed())
        .subscribe((e) => this.isPhone.set(e.matches));
    }

    effect(() => {
      const t = this.target();
      this.loadToken += 1;
      this.candidates.set([]);
      this.query.set('');
      this.scope.set('sameClass');
      this.baseline.set('fitted');
      this.typeFilter.set(TYPE_ALL);
      this.portTypes.set([]);
      this.columnMenu.set(EMPTY_COLUMN_MENU_STATE);
      this.error.set(false);
      if (t) {
        this.returnFocus = (globalThis.document?.activeElement as HTMLElement | null) ?? null;
        void this.load(t, this.loadToken);
      } else {
        this.restoreFocus();
      }
    });

    effect(() => {
      if (this.candidates().length > 0 || this.loading()) {
        queueMicrotask(() => this.search()?.nativeElement.focus());
      }
    });
  }

  // ── data ───────────────────────────────────────────────────────────────────

  private async load(t: SwapTarget, token: number): Promise<void> {
    this.loading.set(true);
    try {
      const installedName = t.className;
      const seedNames = [installedName, t.factoryClassName].filter((n): n is string => !!n);
      const seedPayloads = seedNames.length > 0 ? await this.svc.getEntityPayloads(seedNames) : null;
      const installed = installedName ? seedPayloads?.get(installedName) : undefined;
      const attachType = (installed?.payload as { attachType?: string | null } | undefined)?.attachType;
      const size =
        t.size ?? ((installed?.payload as { size?: number | null } | undefined)?.size ?? null);
      const types = attachType ? [attachType] : (t.attachTypes ?? []).filter(Boolean);
      if (token === this.loadToken) this.portTypes.set(types);
      if (types.length === 0) {
        if (token === this.loadToken) this.candidates.set([]);
        return;
      }

      const items = await this.svc.getCompatibleItems({ types, minSize: size, maxSize: size });
      const names = items.map((i) => i.classNameSlug);
      for (const extra of seedNames) if (!names.includes(extra)) names.push(extra);

      const payloads = await this.hydrate(names, (n) => this.svc.getEntityPayloads(n));
      const ammo = await this.hydrate(ammoClassNamesFor(names), (n) => this.svc.getAmmoPayloads(n));

      const rows = items.map((it) =>
        this.toCandidate(it, payloads, ammo, it.classNameSlug === installedName),
      );
      for (const extra of seedNames) {
        if (items.some((i) => i.classNameSlug === extra)) continue;
        const hit = payloads.get(extra);
        if (!hit) continue;
        rows.unshift(
          this.toCandidate(
            {
              kind: hit.kind,
              classNameSlug: extra,
              nameLocalized: extra === installedName ? t.name : null,
              manufacturerCode: null,
              size: t.size,
              subType: (hit.payload as { subType?: string | null } | undefined)?.subType ?? null,
              grade: null,
            },
            payloads,
            ammo,
            extra === installedName,
          ),
        );
      }

      if (token !== this.loadToken) return;
      this.candidates.set(rows);
    } catch {
      if (token === this.loadToken) this.error.set(true);
    } finally {
      if (token === this.loadToken) this.loading.set(false);
    }
  }

  private toCandidate(
    it: CompatibleItem,
    payloads: Map<string, { kind: CodexKind; payload: unknown }>,
    ammo: Map<string, unknown>,
    equipped: boolean,
  ): SwapCandidate {
    const hit = payloads.get(it.classNameSlug);
    return buildSwapCandidate({
      className: it.classNameSlug,
      kind: hit?.kind ?? it.kind,
      nameLocalized: it.nameLocalized,
      manufacturerCode: it.manufacturerCode,
      size: it.size,
      grade: it.grade,
      subType: it.subType,
      payload: hit?.payload ?? null,
      ammoPayload: ammo.get(ammoClassNameFor(it.classNameSlug) ?? ''),
      equipped,
    });
  }

  private async hydrate<T>(
    names: string[],
    fetch: (chunk: string[]) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (let i = 0; i < names.length; i += HYDRATE_CHUNK) {
      const part = await fetch(names.slice(i, i + HYDRATE_CHUNK));
      for (const [k, v] of part) out.set(k, v);
    }
    return out;
  }

  // ── column chooser persistence ───────────────────────────────────────────

  private loadColumns(): SwapColumnChooser {
    try {
      if (typeof localStorage === 'undefined') return DEFAULT_SWAP_COLUMN_CHOOSER;
      const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
      if (!raw) return DEFAULT_SWAP_COLUMN_CHOOSER;
      const parsed = JSON.parse(raw) as { visible?: unknown };
      if (!Array.isArray(parsed.visible)) return DEFAULT_SWAP_COLUMN_CHOOSER;
      const known = new Set(SWAP_VALUE_CATALOGUE.map((v) => v.key));
      const visible = parsed.visible.filter((v): v is string => typeof v === 'string' && known.has(v));
      return visible.includes(NAME_SORT_KEY) ? { visible } : { visible: [NAME_SORT_KEY, ...visible] };
    } catch {
      return DEFAULT_SWAP_COLUMN_CHOOSER;
    }
  }

  private saveColumns(state: SwapColumnChooser): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // best-effort — a blocked/full localStorage never breaks the picker
    }
  }

  // ── derived view state ─────────────────────────────────────────────────────

  private readonly fitted = computed(() =>
    this.candidates().find((c) => c.className === this.target()?.className),
  );

  readonly scopeOptions = computed<ScSegmentOption[]>(() => {
    this.lang();
    return swapScopeOptions(this.candidates(), this.fitted())
      .filter((o) => o.available)
      .map((o) => ({
        value: o.scope,
        label: this.i18n.instant(o.labelKey, this.resolveScopeParams(o.scope, o.params)) as string,
      }));
  });

  /** Translates the raw damage-channel id `sameFamily` carries into a word. */
  private resolveScopeParams(scope: SwapScope, params: Record<string, string | number>): Record<string, string | number> {
    if (scope !== 'sameFamily') return params;
    const family = params['family'];
    if (typeof family !== 'string' || !family) return params;
    const labelKey = DAMAGE_FAMILY_LABEL_KEY[family];
    return { ...params, family: labelKey ? (this.i18n.instant(labelKey) as string) : family };
  }

  readonly baselineOptions = computed<ScSegmentOption[]>(() => {
    const opts: ScSegmentOption[] = [{ value: 'fitted', labelKey: 'codex.picker.baseline.equipped' }];
    // `Ab Werk` is omitted rather than shown disabled — sc-segmented has no
    // disabled-option affordance, and offering a baseline nothing resolves to
    // would be a dead choice (B-C14).
    if (this.target()?.factoryClassName) opts.push({ value: 'factory', labelKey: 'codex.picker.baseline.factory' });
    return opts;
  });

  readonly baselineClass = computed<string | null>(() =>
    baselineClassName(this.baseline(), {
      fittedClassName: this.target()?.className ?? null,
      factoryClassName: this.target()?.factoryClassName ?? null,
    }),
  );

  /** Scope chip label under the table (Concept #g3) — mirrors the active segment. */
  readonly scopeChip = computed<{ label: string } | null>(() => {
    if (this.scope() === 'allSize') return null;
    const opt = this.scopeOptions().find((o) => o.value === this.scope());
    return opt ? { label: opt.label ?? '' } : null;
  });

  readonly scoped = computed<SwapCandidate[]>(() =>
    applySwapScope(this.candidates(), this.fitted(), this.scope()),
  );

  /** True only when the current scope actually holds more than one distinct
   * item ARCHETYPE (Laser Repeater / Cannon / …) — main's part-type filter
   * split on `c.archetype`, not on the coarser `attachType` a port declares
   * (E-main-gap #40). Ordinary fitted weapon ports commonly carry several
   * archetypes and get the control; a port that only ever accepts one never
   * shows it. */
  readonly showTypeFilter = computed<boolean>(() => {
    const archetypes = new Set(this.scoped().map((c) => c.archetype).filter((a): a is string => !!a));
    return archetypes.size > 1;
  });

  /** "All" plus one option per archetype actually present in the current
   * scope, each carrying a live count (main's facet pills, restored as a
   * segmented control to match this table's other scope-bar controls). */
  readonly typeFilterOptions = computed<ScSegmentOption[]>(() => {
    if (!this.showTypeFilter()) return [];
    this.lang();
    const counts = new Map<string, number>();
    for (const c of this.scoped()) {
      if (!c.archetype) continue;
      counts.set(c.archetype, (counts.get(c.archetype) ?? 0) + 1);
    }
    const opts: ScSegmentOption[] = [
      { value: TYPE_ALL, label: this.i18n.instant('codex.swap.filterAll') as string },
    ];
    for (const type of [...counts.keys()].sort()) {
      opts.push({ value: type, label: `${type} (${counts.get(type)})` });
    }
    return opts;
  });

  /** Removable chip for the active type filter, mirroring `scopeChip`. */
  readonly typeFilterChip = computed<{ label: string } | null>(() => {
    const tf = this.typeFilter();
    if (tf === TYPE_ALL) return null;
    const opt = this.typeFilterOptions().find((o) => o.value === tf);
    return { label: opt?.label ?? tf };
  });

  readonly typeScoped = computed<SwapCandidate[]>(() => {
    const tf = this.typeFilter();
    if (tf === TYPE_ALL) return this.scoped();
    return this.scoped().filter((c) => c.archetype === tf);
  });

  /** LOW-1 (main parity, `pruneSwapFilters`): a type filter that no longer
   * occurs after a scope change (e.g. `sameClass` → `sameFamily` dropped the
   * archetype the user narrowed to) resets to "all" instead of leaving the
   * table silently empty with a stale segmented value. */
  private readonly pruneTypeFilter = effect(() => {
    const tf = this.typeFilter();
    if (tf === TYPE_ALL) return;
    const opts = this.typeFilterOptions();
    if (!opts.some((o) => o.value === tf)) this.typeFilter.set(TYPE_ALL);
  });

  readonly searched = computed<SwapCandidate[]>(() => {
    const q = this.query().trim().toLowerCase();
    const scoped = this.typeScoped();
    if (!q) return scoped;
    const terms = q.split(/\s+/);
    return scoped.filter((c) => {
      const hay = [c.name, c.manufacturerCode, ...c.damageChannels].filter(Boolean).join(' ').toLowerCase();
      return terms.every((term) => hay.includes(term));
    });
  });

  /** Column keys the extract has no source for at all — omitted + named in the footer. */
  private readonly unavailableKeys = computed<Set<string>>(
    () => new Set(swapMissingSourceColumns(this.candidates(), SWAP_VALUE_CATALOGUE.map((v) => v.key))),
  );

  readonly unavailable = this.unavailableKeys;

  readonly missingColumnsText = computed<string | null>(() => {
    const missing = swapMissingSourceColumns(this.candidates(), this.wantedColumns());
    if (missing.length === 0) return null;
    this.lang();
    return missing.map((k) => this.i18n.instant(k) as string).join(', ');
  });

  private columnDefFor(key: string): ColumnDef<SwapCandidate> {
    const def = swapValueDef(key);
    const direct = DIRECT_ACCESSORS[key];
    return {
      key,
      labelKey: key === NAME_SORT_KEY ? 'codex.picker.col.name' : key,
      kind: def?.categorical ? 'categorical' : 'numeric',
      accessor: direct ?? ((c) => c.stats[key]?.value ?? null),
      lowerIsBetter: def?.lowerIsBetter,
    };
  }

  /** True while the chooser still holds the untouched, persisted default 17-column set
   * (the weapon `#g3` set is the only shape the chooser is ever seeded or reset to). */
  private readonly chooserIsDefault = computed<boolean>(() => {
    const visible = this.chooser().visible;
    return (
      visible.length === DEFAULT_SWAP_COLUMNS.length && visible.every((k, i) => k === DEFAULT_SWAP_COLUMNS[i])
    );
  });

  /**
   * ≤640px the table carries three value columns at most. For a weapon port
   * those are the UI spec's own Δ + DPS + Alpha; no other port kind has any of
   * them, so it takes the first three of its own kind-aware default rather
   * than a table of dashes.
   */
  private phoneColumnsFor(candidates: readonly SwapCandidate[]): readonly string[] {
    if (isWeaponCandidateSet(candidates)) return CodexSwapPickerComponent.PHONE_COLUMNS;
    return defaultSwapColumnsFor(candidates).slice(0, CodexSwapPickerComponent.PHONE_COLUMNS.length);
  }

  /**
   * The column keys this port wants, before availability filtering — the ONE
   * source the table, the chooser popover, the footer and `toggleColumn` all
   * read. While the chooser is untouched that is the port-kind-aware default
   * (D24); once the user has picked columns themselves their selection wins
   * verbatim. Letting these diverge is what made the popover show the weapon
   * set while the table rendered shield columns.
   */
  readonly wantedColumns = computed<readonly string[]>(() => {
    if (!this.chooserIsDefault()) return this.chooser().visible;
    const candidates = this.candidates();
    return this.isPhone()
      ? [NAME_SORT_KEY, ...this.phoneColumnsFor(candidates)]
      : defaultSwapColumnsFor(candidates);
  });

  /** Visible columns — {@link wantedColumns} minus the ones with no data source at all. */
  readonly displayColumns = computed<(SwapValueDef & { def: ColumnDef<SwapCandidate> })[]>(() => {
    const candidates = this.candidates();
    const wanted = this.wantedColumns();
    const missing = new Set(swapMissingSourceColumns(candidates, wanted));
    return wanted
      .filter((k) => k !== NAME_SORT_KEY && !missing.has(k))
      .map((k) => ({ ...(swapValueDef(k) as SwapValueDef), def: this.columnDefFor(k) }));
  });

  private readonly allMenuColumns = computed<ColumnDef<SwapCandidate>[]>(() => [
    this.columnDefFor(NAME_SORT_KEY),
    ...this.displayColumns().map((c) => c.def),
  ]);

  readonly rows = computed<SwapCandidate[]>(() =>
    applyColumnMenu(this.searched(), this.allMenuColumns(), this.columnMenu()),
  );

  // The baseline is a property of the PORT, not of the current filter — a
  // factory Cannon fitted under "Nur Repeater" must still price every row
  // against it (B-C14), so the map is built over every candidate, not `rows()`.
  readonly deltaColumn = computed(() =>
    swapDeltaColumn(this.candidates(), 'codex.equipped.dps', this.baselineClass()),
  );

  /** True when the active Δ baseline is filtered out of the visible rows. */
  readonly baselineOutOfSet = computed<boolean>(() => {
    const base = this.baselineClass();
    if (base === null) return false;
    return !this.rows().some((c) => c.className === base);
  });

  readonly chips = computed<ColumnFilterChip[]>(() =>
    activeFilterChips(this.allMenuColumns(), this.columnMenu()),
  );

  private barsCache = new Map<string, Map<string, { percent: number | null; optimum: boolean }>>();
  barOf(key: string, c: SwapCandidate): { percent: number | null; optimum: boolean } | undefined {
    let m = this.barsCache.get(key);
    if (!m || this.barsCacheRows !== this.rows()) {
      m = swapValueBars(this.rows(), this.candidates(), key);
      this.barsCache.set(key, m);
      this.barsCacheRows = this.rows();
    }
    return m.get(c.className);
  }
  private barsCacheRows: SwapCandidate[] | null = null;

  /** Columns beyond the ones a 1080px window shows fully at once (concept: 8 incl. name). */
  private static readonly VISIBLE_WITHOUT_SCROLL = 7;

  /** Off-screen column labels, joined for the horizontal scroll cue (B-C17). */
  readonly overflowColumnLabels = computed<string>(() => {
    this.lang();
    return this.displayColumns()
      .slice(CodexSwapPickerComponent.VISIBLE_WITHOUT_SCROLL)
      .map((c) => this.i18n.instant(c.key) as string)
      .join(', ');
  });

  // ── column head interaction ────────────────────────────────────────────────

  sortDirOf(key: string): SortDir | null {
    const s = this.columnMenu().sort;
    return s?.key === key ? s.dir : null;
  }

  rangeOf(key: string): { min: number | null; max: number | null } | null {
    const f = this.columnMenu().filters[key];
    return f && f.kind === 'numeric' ? { min: f.min, max: f.max } : null;
  }

  facetsOf(key: string): ColumnFacet[] {
    if (key === NAME_SORT_KEY) return [];
    const col = this.allMenuColumns().find((c) => c.key === key);
    if (!col || col.kind !== 'categorical') return [];
    return columnFacets(this.searched(), col, this.columnMenu(), this.allMenuColumns());
  }

  hasFilter(key: string): boolean {
    return !!this.columnMenu().filters[key];
  }

  /** LOW-4 (ui-spec-13-a11y): `aria-sort` stays on the PRIMARY column only —
   * ARIA expects at most one sorted column per grid. The tie-breaker is still
   * surfaced (via `sortRankTitle`'s "Sort 2" and the column menu's secondary
   * entry), just not through a second `aria-sort`. */
  ariaSort(key: string): 'ascending' | 'descending' | 'none' {
    const s = this.columnMenu().sort;
    if (s?.key === key) return s.dir === 'asc' ? 'ascending' : 'descending';
    return 'none';
  }

  /** Localized "Sort 1"/"Sort 2" for the primary/secondary sort column,
   * surfaced as the `<th title>` (E-main-gap #41; MEDIUM-4: was a bare,
   * untranslated digit). */
  sortRankTitle(key: string): string | null {
    const s = this.columnMenu();
    if (s.sort?.key === key) return this.i18n.instant('codex.picker.menu.sortRank', { n: 1 }) as string;
    if (s.secondarySort?.key === key) return this.i18n.instant('codex.picker.menu.sortRank', { n: 2 }) as string;
    return null;
  }

  isSecondarySort(key: string): boolean {
    return this.columnMenu().secondarySort?.key === key;
  }

  /** Plain click sorts (or flips); Ctrl/⌘-click (or the menu's "als zweite
   * Sortierung" entry) appends the column as a tie-breaker instead. */
  onHeadClick(key: string, ctrl = false): void {
    const col = this.allMenuColumns().find((c) => c.key === key);
    if (col) this.columnMenu.update((s) => toggleColumnSort(s, col, ctrl));
  }

  onSecondarySortToggle(key: string): void {
    // MEDIUM-2: an active secondary sort must be switchable back off — without
    // this short-circuit `toggleColumnSort(..., true)` only ever flips asc/desc
    // once the column already IS the secondary, so the "als zweite Sortierung"
    // control could never return to "off".
    if (this.isSecondarySort(key)) {
      this.columnMenu.update(clearSecondaryColumnSort);
      return;
    }
    const col = this.allMenuColumns().find((c) => c.key === key);
    if (col) this.columnMenu.update((s) => toggleColumnSort(s, col, true));
  }

  /** MEDIUM-3: the "als zweite Sortierung" entry only does what it says when a
   * DIFFERENT column already holds the primary sort — with no primary sort, or
   * on the primary column itself, `toggleColumnSort(..., true)` silently
   * reinterprets the click as a primary-sort change. Gate the entry so it is
   * only offered where it is truthful. */
  secondarySortEligible(key: string): boolean {
    const sort = this.columnMenu().sort;
    return !!sort && sort.key !== key;
  }

  onSortPick(key: string, dir: SortDir): void {
    this.columnMenu.update((s) => setColumnSort(s, key, dir));
  }

  onRangeChange(key: string, range: { min: number | null; max: number | null }): void {
    this.columnMenu.update((s) => setNumericFilter(s, key, range.min, range.max));
  }

  onFacetToggle(key: string, value: string): void {
    this.columnMenu.update((s) => toggleFacetValue(s, key, value));
  }

  onClearFilter(key: string): void {
    this.columnMenu.update((s) => clearColumnFilter(s, key));
  }

  clearAllFilters(): void {
    this.columnMenu.update(clearAllColumnFilters);
  }

  toggleColumn(key: string): void {
    // An untouched chooser still holds the persisted weapon set while the table
    // already renders THIS port's default, so toggle against what is on screen —
    // otherwise the first click would wipe the columns the port-kind seed added.
    const seed = this.chooserIsDefault() ? [...this.wantedColumns()] : null;
    this.chooser.update((s) => {
      const next = toggleSwapColumn(seed ? { ...s, visible: seed } : s, key);
      this.saveColumns(next);
      return next;
    });
  }

  resetColumns(): void {
    const next = resetSwapColumns();
    this.chooser.set(next);
    this.saveColumns(next);
  }

  /** LOW-3: the label text alone — the unit is a separate `<small>`, never concatenated in. */
  colLabel(v: SwapValueDef): string {
    this.lang();
    return this.i18n.instant(v.key) as string;
  }

  colUnit(v: SwapValueDef): string | null {
    this.lang();
    const unitKey = unitKeyFor(v.key, v);
    return unitKey ? (this.i18n.instant(unitKey) as string) : null;
  }

  // ── cells ──────────────────────────────────────────────────────────────────

  cellState(c: SwapCandidate, key: string): 'value' | 'notApplicable' | 'noSource' {
    return swapCellState(c, key);
  }

  cellText(c: SwapCandidate, v: SwapValueDef): string {
    if (v.key === 'codex.picker.col.deltaSustained') return this.deltaText(c);
    const state = swapCellState(c, v.key);
    if (state === 'value') return swapCell(c, { key: v.key, format: v.format, derived: false });
    return this.i18n.instant('codex.picker.dashCell') as string;
  }

  private deltaText(c: SwapCandidate): string {
    if (c.className === this.baselineClass()) return this.i18n.instant('codex.picker.noDelta') as string;
    const v = this.deltaColumn().get(c.className);
    if (v === null || v === undefined) return this.i18n.instant('codex.picker.dashCell') as string;
    const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
    return `${sign}${formatEquippedStat({ labelKey: '', value: Math.abs(v), format: 'dec' })}`;
  }

  /** Green for a real gain, red for a real loss, plain for `±0`/unknown (B-C16). */
  deltaTone(c: SwapCandidate): 'up' | 'down' | 'none' {
    if (c.className === this.baselineClass()) return 'none';
    const v = this.deltaColumn().get(c.className);
    if (v === null || v === undefined || v === 0) return 'none';
    return v > 0 ? 'up' : 'down';
  }

  /** "KLA · Laser Repeater · Grade A" — catalog data, so untranslated. */
  metaLine(c: SwapCandidate): string {
    return [c.manufacturerCode, c.typeLabel, c.grade].filter(Boolean).join(' · ');
  }

  setQuery(ev: Event): void {
    this.query.set((ev.target as HTMLInputElement).value);
  }

  /** Row click picks the component directly (MASTER §9). */
  pick(c: SwapCandidate): void {
    const t = this.target();
    if (!t) return;
    this.picked.emit({ className: c.className, target: t });
  }

  clearSlot(): void {
    const t = this.target();
    if (!t) return;
    this.picked.emit({ className: null, target: t });
  }

  // ── dialog behaviour ───────────────────────────────────────────────────────

  onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      this.closed.emit();
      return;
    }
    if (ev.key !== 'Tab') return;
    const focusable = this.focusable();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = globalThis.document?.activeElement as HTMLElement | null;
    if (ev.shiftKey && active === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  private focusable(): HTMLElement[] {
    const root = this.dialog()?.nativeElement;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('button, input, a[href], [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
  }

  private restoreFocus(): void {
    const el = this.returnFocus;
    this.returnFocus = null;
    if (el?.isConnected) el.focus();
  }
}
