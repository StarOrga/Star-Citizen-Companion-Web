import { encodeStockRef, ingredientTokenOfCrate, materialOf, parseStockRef, stockSuggestions, stockTarget } from './hq-stock-ref';

describe('hq-stock-ref', () => {
  const owned = [{ id: 'sh1', shipClassName: 'AEGS_Idris_P' }];

  it('round-trips kind and class name, and reads a bare class name', () => {
    expect(parseStockRef(encodeStockRef('item', 'ITEM_Iron'))).toEqual({ kind: 'item', className: 'ITEM_Iron' });
    expect(parseStockRef('ITEM_Iron')).toEqual({ kind: null, className: 'ITEM_Iron' });
    expect(parseStockRef(null)).toBeNull();
  });

  it('leads a ship to the reader\'s own copy, else the Codex page', () => {
    expect(stockTarget('Idris', 'ship:AEGS_Idris_P', owned)?.commands).toEqual(['/hq/hangar', 'sh1']);
    expect(stockTarget('Idris', 'ship:AEGS_Idris_P', [])?.commands).toEqual(['/codex', 'ship', 'AEGS_Idris_P']);
  });

  it('leads an item to its Codex page, a bare class name to the index search, nothing to plain text', () => {
    expect(stockTarget('Iron', 'item:Iron', owned)?.commands).toEqual(['/codex', 'item', 'Iron']);
    expect(stockTarget('Iron', 'Iron', owned)).toEqual({ commands: ['/codex/index'], queryParams: { q: 'Iron' } });
    expect(stockTarget('Iron', null, owned)).toBeNull();
  });
});

describe('stock material suggestions', () => {
  const hit = (classNameSlug: string, nameLocalized: string | null, attachType = 'Cargo'): any => ({
    kind: 'item', classNameSlug, nameLocalized, manufacturerCode: null, manufacturerName: null, attachType, size: null, grade: null, scope: 'equipment',
  });
  const hits = [
    hit('Ironclad_Livery_Idris', 'Ironclad Livery', 'Paints'),
    hit('Door_Ironclad', 'Ironclad Door', 'Door'),
    hit('Carryable_TBO_FL_8SCU_Commodity_Metal_Iron', 'Eisen'),
    hit('Carryable_TBO_FL_32SCU_Commodity_Metal_Iron', 'Iron'),
    hit('Carryable_TBO_FL_1SCU_Commodity_Metal_Ore_Iron', null),
    hit('Carryable_TBO_FL_2SCU_Commodity_Metal_Ore_Iron', 'Iron (Ore)'),
    hit('Carryable_TBO_FL_1SCU_Commodity_Metal_Ore_Copper', 'Copper (Ore)'),
    hit('Carryable_TBO_FL_4SCU_Commodity_Metal_Ore_Gold', null),
    hit('ITEM_Ironclad_Helm', 'Ironclad Helmet'),
  ];

  it('reads the material off a crate class name', () => {
    expect(materialOf('Carryable_TBO_FL_32SCU_Commodity_Metal_Iron')).toEqual({ token: 'Iron', ore: false, key: 'Iron' });
    expect(materialOf('Carryable_TBO_FL_1SCU_Commodity_Metal_Ore_Iron')?.key).toBe('Iron_Ore');
    expect(materialOf('Carryable_2H_FL_EighthSCU_Commodity_Mineral_Quantanium')?.token).toBe('Quantanium');
    expect(materialOf('ITEM_Ironclad_Helm')).toBeNull();
    expect(ingredientTokenOfCrate('Carryable_TBO_FL_32SCU_Commodity_Metal_Iron')).toBe('Iron');
    expect(ingredientTokenOfCrate('Carryable_TBO_FL_1SCU_Commodity_Metal_Ore_Iron')).toBeNull();
  });

  it('collapses crates per material, ranks exact names first and drops paints, doors and unnamed materials', () => {
    const out = stockSuggestions(hits, 'iron', 'en');
    expect(out.map((o) => o.title)).toEqual(['Iron', 'Iron (Ore)', 'Ironclad Helmet']);
    expect(out[0].key).toBe('item:Carryable_TBO_FL_32SCU_Commodity_Metal_Iron');
  });

  it('finds the same material under its German name', () => {
    const out = stockSuggestions(hits, 'Eisen', 'en');
    expect(out[0].key).toBe('item:Carryable_TBO_FL_32SCU_Commodity_Metal_Iron');
    expect(out.filter((o) => o.key.includes('Metal_Iron')).length).toBe(1);
  });
});
