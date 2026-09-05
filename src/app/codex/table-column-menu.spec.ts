import {
  activeFilterChips,
  applyColumnMenu,
  clearAllColumnFilters,
  clearColumnFilter,
  columnFacets,
  EMPTY_COLUMN_MENU_STATE,
  filterRows,
  setColumnSort,
  setNumericFilter,
  sortRows,
  toggleColumnSort,
  toggleFacetValue,
  type ColumnDef,
} from './table-column-menu';

interface Row {
  name: string;
  dps: number | null;
  mass: number;
  maker: string;
}

const rows: Row[] = [
  { name: 'Badger', dps: 360, mass: 128, maker: 'KLWE' },
  { name: 'Panther', dps: 279, mass: 120, maker: 'KLWE' },
  { name: 'Attrition', dps: 331, mass: 134, maker: 'BEHR' },
  { name: 'Prototype', dps: null, mass: 100, maker: 'AMRS' },
];

const columns: ColumnDef<Row>[] = [
  { key: 'name', labelKey: 'col.name', kind: 'categorical', accessor: (r) => r.name },
  { key: 'dps', labelKey: 'col.dps', kind: 'numeric', accessor: (r) => r.dps },
  { key: 'mass', labelKey: 'col.mass', kind: 'numeric', lowerIsBetter: true, accessor: (r) => r.mass },
  { key: 'maker', labelKey: 'col.maker', kind: 'categorical', accessor: (r) => r.maker },
];

const col = (key: string) => columns.find((c) => c.key === key)!;

describe('sorting', () => {
  it('opens a numeric column best-first and flips on the second click', () => {
    const first = toggleColumnSort(EMPTY_COLUMN_MENU_STATE, col('dps'));
    expect(first.sort).toEqual({ key: 'dps', dir: 'desc' });
    expect(toggleColumnSort(first, col('dps')).sort!.dir).toBe('asc');
  });

  it('opens a lower-is-better column ascending', () => {
    expect(toggleColumnSort(EMPTY_COLUMN_MENU_STATE, col('mass')).sort!.dir).toBe('asc');
  });

  it('sinks rows without a value to the bottom in BOTH directions', () => {
    const desc = sortRows(rows, columns, setColumnSort(EMPTY_COLUMN_MENU_STATE, 'dps', 'desc'));
    const asc = sortRows(rows, columns, setColumnSort(EMPTY_COLUMN_MENU_STATE, 'dps', 'asc'));
    expect(desc[desc.length - 1].name).toBe('Prototype');
    expect(asc[asc.length - 1].name).toBe('Prototype');
    expect(desc[0].name).toBe('Badger');
    expect(asc[0].name).toBe('Panther');
  });

  it('sorts text alphabetically', () => {
    const out = sortRows(rows, columns, setColumnSort(EMPTY_COLUMN_MENU_STATE, 'name', 'asc'));
    expect(out.map((r) => r.name)).toEqual(['Attrition', 'Badger', 'Panther', 'Prototype']);
  });
});

describe('numeric range filter', () => {
  it('keeps only rows inside von–bis', () => {
    const state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', 300, 350);
    expect(filterRows(rows, columns, state).map((r) => r.name)).toEqual(['Attrition']);
  });

  it('accepts an open bound', () => {
    const state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', 300, null);
    expect(filterRows(rows, columns, state).map((r) => r.name)).toEqual(['Badger', 'Attrition']);
  });

  it('drops rows with no value — a gap cannot satisfy a range', () => {
    const state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', null, 10000);
    expect(filterRows(rows, columns, state).some((r) => r.name === 'Prototype')).toBeFalse();
  });

  it('clears itself when both bounds go away', () => {
    const state = setNumericFilter(setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', 1, 2), 'dps', null, null);
    expect(state.filters['dps']).toBeUndefined();
  });
});

describe('categorical facets', () => {
  it('counts the options and marks the selected ones', () => {
    const state = toggleFacetValue(EMPTY_COLUMN_MENU_STATE, 'maker', 'KLWE');
    const facets = columnFacets(rows, col('maker'), state, columns);
    expect(facets[0]).toEqual({ value: 'KLWE', count: 2, selected: true });
    expect(facets.map((f) => f.value)).toEqual(['KLWE', 'AMRS', 'BEHR']);
  });

  it('ORs inside a column and ANDs across columns', () => {
    let state = toggleFacetValue(EMPTY_COLUMN_MENU_STATE, 'maker', 'KLWE');
    state = toggleFacetValue(state, 'maker', 'BEHR');
    expect(filterRows(rows, columns, state).length).toBe(3);
    state = setNumericFilter(state, 'mass', null, 125);
    expect(filterRows(rows, columns, state).map((r) => r.name)).toEqual(['Panther']);
  });

  it('unchecking the last option clears the filter', () => {
    const on = toggleFacetValue(EMPTY_COLUMN_MENU_STATE, 'maker', 'KLWE');
    expect(toggleFacetValue(on, 'maker', 'KLWE').filters['maker']).toBeUndefined();
  });

  it('counts facets against the OTHER columns’ filters', () => {
    const state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'mass', null, 125);
    expect(columnFacets(rows, col('maker'), state, columns)).toEqual([
      { value: 'AMRS', count: 1, selected: false },
      { value: 'KLWE', count: 1, selected: false },
    ]);
  });
});

describe('chips and clearing', () => {
  it('renders one removable chip per active filter', () => {
    let state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', 300, 350);
    state = toggleFacetValue(state, 'maker', 'KLWE');
    const chips = activeFilterChips(columns, state);
    expect(chips.map((c) => c.key)).toEqual(['dps', 'maker']);
    expect(chips[0].textKey).toBe('codex.table.chip.range');
    expect(chips[0].params).toEqual({ min: 300, max: 350 });
    expect(chips[1].textKey).toBe('codex.table.chip.values');
  });

  it('uses the one-sided chip text for an open bound', () => {
    const state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', 300, null);
    expect(activeFilterChips(columns, state)[0].textKey).toBe('codex.table.chip.min');
  });

  it('clears one column or all of them without touching the sort', () => {
    let state = setNumericFilter(EMPTY_COLUMN_MENU_STATE, 'dps', 1, 2);
    state = toggleFacetValue(state, 'maker', 'KLWE');
    state = setColumnSort(state, 'dps', 'desc');
    expect(Object.keys(clearColumnFilter(state, 'dps').filters)).toEqual(['maker']);
    const cleared = clearAllColumnFilters(state);
    expect(cleared.filters).toEqual({});
    expect(cleared.sort).toEqual({ key: 'dps', dir: 'desc' });
  });
});

describe('applyColumnMenu', () => {
  it('filters, then sorts', () => {
    let state = toggleFacetValue(EMPTY_COLUMN_MENU_STATE, 'maker', 'KLWE');
    state = setColumnSort(state, 'dps', 'asc');
    expect(applyColumnMenu(rows, columns, state).map((r) => r.name)).toEqual(['Panther', 'Badger']);
  });

  it('is a no-op on an empty state, and never mutates the input', () => {
    const out = applyColumnMenu(rows, columns, EMPTY_COLUMN_MENU_STATE);
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows as unknown as Row[]);
  });
});
