import { encodeStockRef, parseStockRef, stockTarget } from './hq-stock-ref';

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
