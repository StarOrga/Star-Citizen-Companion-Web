// Reusable column-head sort/filter model (MASTER §9, B-C15).
// -----------------------------------------------------------------------------
// FRAMEWORK-FREE. The concept's author asked for one pattern that every table in
// the app can adopt ("Dasselbe Muster soll überall gelten, wo die App eine
// Tabelle hat."), so this module knows nothing about the swap picker: it takes a
// row array, a column catalogue with accessors, and an immutable state object.
//
// Menu contents, in the concept's fixed order:
//   Sortieren  ▲ aufsteigend / ▼ absteigend
//   then either  Bereich  von–bis   (numeric columns)
//   or           a checkbox list with per-option counts (categorical columns)
// Active filters accumulate as removable chips UNDER the table.

export type ColumnKind = 'numeric' | 'categorical';
export type SortDir = 'asc' | 'desc';

export interface ColumnDef<TRow> {
  /** stable id — also the i18n label key's suffix and the state map's key. */
  key: string;
  labelKey: string;
  kind: ColumnKind;
  /** Reads the raw comparable value off a row; `null` = this row has no value. */
  accessor: (row: TRow) => number | string | null;
  /** Numeric columns only: a smaller number is the better outcome. */
  lowerIsBetter?: boolean;
}

export interface NumericColumnFilter {
  kind: 'numeric';
  min: number | null;
  max: number | null;
}

export interface CategoricalColumnFilter {
  kind: 'categorical';
  /** selected facet values; an EMPTY array means "no restriction", not "none". */
  selected: readonly string[];
}

export type ColumnFilter = NumericColumnFilter | CategoricalColumnFilter;

export interface ColumnMenuState {
  sort: { key: string; dir: SortDir } | null;
  /**
   * Tie-breaker applied when the primary sort ties (E-main-gap #41: main's
   * Ctrl-click secondary sort, restored via the column menu's "als zweite
   * Sortierung" entry). `undefined` on states built before this field existed
   * — every reader treats it the same as `null`.
   */
  secondarySort?: { key: string; dir: SortDir } | null;
  filters: Readonly<Record<string, ColumnFilter>>;
}

export const EMPTY_COLUMN_MENU_STATE: ColumnMenuState = { sort: null, secondarySort: null, filters: {} };

function withFilters(
  state: ColumnMenuState,
  key: string,
  filter: ColumnFilter | null,
): ColumnMenuState {
  const filters = { ...state.filters };
  if (filter === null) delete filters[key];
  else filters[key] = filter;
  return { sort: state.sort, secondarySort: state.secondarySort ?? null, filters };
}

/** Explicit choice from the menu's two sort rows. */
export function setColumnSort(state: ColumnMenuState, key: string, dir: SortDir): ColumnMenuState {
  // A column cannot be both the primary and the secondary sort at once.
  const secondarySort = state.secondarySort?.key === key ? null : (state.secondarySort ?? null);
  return { sort: { key, dir }, secondarySort, filters: state.filters };
}

/**
 * A click on the column HEAD (not the menu): sorts by that column, flipping the
 * direction when it already is the active one. First direction is the column's
 * natural one — numbers best-first (desc, or asc when lower is better), text A→Z.
 *
 * `asSecondary` (Ctrl/⌘-click, or the menu's "als zweite Sortierung" entry)
 * appends the column as a tie-breaker instead of replacing the primary sort —
 * a no-op when there is no primary sort yet or the column already IS the
 * primary one.
 */
export function toggleColumnSort<TRow>(
  state: ColumnMenuState,
  column: ColumnDef<TRow>,
  asSecondary = false,
): ColumnMenuState {
  const natural: SortDir =
    column.kind === 'numeric' ? (column.lowerIsBetter ? 'asc' : 'desc') : 'asc';
  if (asSecondary && state.sort && state.sort.key !== column.key) {
    if (state.secondarySort?.key === column.key) {
      return setSecondaryColumnSort(state, column.key, state.secondarySort.dir === 'asc' ? 'desc' : 'asc');
    }
    return setSecondaryColumnSort(state, column.key, natural);
  }
  if (state.sort?.key === column.key) {
    return setColumnSort(state, column.key, state.sort.dir === 'asc' ? 'desc' : 'asc');
  }
  return setColumnSort(state, column.key, natural);
}

/** Explicit choice of the secondary (tie-breaker) sort — additive, leaves the primary sort untouched. */
export function setSecondaryColumnSort(state: ColumnMenuState, key: string, dir: SortDir): ColumnMenuState {
  if (state.sort?.key === key) return state;
  return { sort: state.sort, secondarySort: { key, dir }, filters: state.filters };
}

export function clearSecondaryColumnSort(state: ColumnMenuState): ColumnMenuState {
  return { sort: state.sort, secondarySort: null, filters: state.filters };
}

export function clearColumnSort(state: ColumnMenuState): ColumnMenuState {
  return { sort: null, secondarySort: null, filters: state.filters };
}

/** `Bereich von–bis`. Both bounds optional; both null clears the filter. */
export function setNumericFilter(
  state: ColumnMenuState,
  key: string,
  min: number | null,
  max: number | null,
): ColumnMenuState {
  if (min === null && max === null) return withFilters(state, key, null);
  return withFilters(state, key, { kind: 'numeric', min, max });
}

/** One checkbox in a categorical menu. Unchecking the last one clears the filter. */
export function toggleFacetValue(
  state: ColumnMenuState,
  key: string,
  value: string,
): ColumnMenuState {
  const current = state.filters[key];
  const selected = current && current.kind === 'categorical' ? [...current.selected] : [];
  const i = selected.indexOf(value);
  if (i >= 0) selected.splice(i, 1);
  else selected.push(value);
  return selected.length === 0
    ? withFilters(state, key, null)
    : withFilters(state, key, { kind: 'categorical', selected });
}

export function clearColumnFilter(state: ColumnMenuState, key: string): ColumnMenuState {
  return withFilters(state, key, null);
}

export function clearAllColumnFilters(state: ColumnMenuState): ColumnMenuState {
  return { sort: state.sort, secondarySort: state.secondarySort ?? null, filters: {} };
}

export interface ColumnFacet {
  value: string;
  count: number;
  selected: boolean;
}

/**
 * The checkbox list for a categorical column, with counts over the rows the
 * OTHER columns' filters already left standing (so the counts describe what a
 * click would actually do). Sorted by count desc, then value.
 */
export function columnFacets<TRow>(
  rows: readonly TRow[],
  column: ColumnDef<TRow>,
  state: ColumnMenuState = EMPTY_COLUMN_MENU_STATE,
  columns: readonly ColumnDef<TRow>[] = [],
): ColumnFacet[] {
  const others = columns.filter((c) => c.key !== column.key);
  const base = others.length > 0 ? filterRows(rows, others, state) : rows;
  const counts = new Map<string, number>();
  for (const row of base) {
    const v = column.accessor(row);
    if (v === null || v === '') continue;
    const s = String(v);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const current = state.filters[column.key];
  const selected = new Set(current && current.kind === 'categorical' ? current.selected : []);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count, selected: selected.has(value) }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function passes<TRow>(row: TRow, column: ColumnDef<TRow>, filter: ColumnFilter): boolean {
  const v = column.accessor(row);
  if (filter.kind === 'numeric') {
    // A row without a value is NOT silently kept: a range filter is a statement
    // about numbers, and a gap cannot satisfy it.
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    if (filter.min !== null && v < filter.min) return false;
    if (filter.max !== null && v > filter.max) return false;
    return true;
  }
  if (filter.selected.length === 0) return true;
  return v !== null && filter.selected.includes(String(v));
}

/** Apply every active filter (AND across columns, OR inside one column). */
export function filterRows<TRow>(
  rows: readonly TRow[],
  columns: readonly ColumnDef<TRow>[],
  state: ColumnMenuState,
): TRow[] {
  const active = columns
    .map((c) => [c, state.filters[c.key]] as const)
    .filter((pair): pair is readonly [ColumnDef<TRow>, ColumnFilter] => !!pair[1]);
  if (active.length === 0) return [...rows];
  return rows.filter((row) => active.every(([c, f]) => passes(row, c, f)));
}

/** One column's comparison of two rows, in the given direction. */
function compareBy<TRow>(a: TRow, b: TRow, column: ColumnDef<TRow>, dir: 1 | -1): number {
  const va = column.accessor(a);
  const vb = column.accessor(b);
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
  return String(va).localeCompare(String(vb)) * dir;
}

/** Sort by the active column, then by the secondary (tie-breaker) column when
 * the primary sort ties. Rows without a value always sink to the bottom, in
 * BOTH directions — a gap is not "the smallest value". */
export function sortRows<TRow>(
  rows: readonly TRow[],
  columns: readonly ColumnDef<TRow>[],
  state: ColumnMenuState,
): TRow[] {
  const out = [...rows];
  const sort = state.sort;
  if (!sort) return out;
  const column = columns.find((c) => c.key === sort.key);
  if (!column) return out;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const secondary = state.secondarySort;
  const secondaryColumn = secondary ? columns.find((c) => c.key === secondary.key) : undefined;
  const secondaryDir = secondary?.dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => {
    const primary = compareBy(a, b, column, dir);
    if (primary !== 0 || !secondaryColumn) return primary;
    return compareBy(a, b, secondaryColumn, secondaryDir);
  });
}

/** Filter, then sort — the order the table renders in. */
export function applyColumnMenu<TRow>(
  rows: readonly TRow[],
  columns: readonly ColumnDef<TRow>[],
  state: ColumnMenuState,
): TRow[] {
  return sortRows(filterRows(rows, columns, state), columns, state);
}

export interface ColumnFilterChip {
  /** the column this chip belongs to — dismissing it clears that column. */
  key: string;
  columnLabelKey: string;
  /** `codex.table.chip.range` | `codex.table.chip.values` */
  textKey: string;
  /** interpolation params for `textKey` (`{min}`/`{max}` or `{values}`). */
  params: Record<string, string | number>;
}

/** The removable pills under the table (B-C15). */
export function activeFilterChips<TRow>(
  columns: readonly ColumnDef<TRow>[],
  state: ColumnMenuState,
): ColumnFilterChip[] {
  const chips: ColumnFilterChip[] = [];
  for (const column of columns) {
    const f = state.filters[column.key];
    if (!f) continue;
    if (f.kind === 'numeric') {
      chips.push({
        key: column.key,
        columnLabelKey: column.labelKey,
        textKey:
          f.min !== null && f.max !== null
            ? 'codex.table.chip.range'
            : f.min !== null
              ? 'codex.table.chip.min'
              : 'codex.table.chip.max',
        params: { min: f.min ?? '', max: f.max ?? '' },
      });
    } else if (f.selected.length > 0) {
      chips.push({
        key: column.key,
        columnLabelKey: column.labelKey,
        textKey: 'codex.table.chip.values',
        params: { values: f.selected.join(', '), count: f.selected.length },
      });
    }
  }
  return chips;
}
