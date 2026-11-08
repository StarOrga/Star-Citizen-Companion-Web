import { merkTypeOf, recentRowsOfType, typeOfKind, wishRowOfType } from './merkliste.model';
import type { StoredRow } from '../fusion-bar/search-recent-rows';

describe('merkliste model', () => {
  it('cuts the page type from the URL', () => {
    expect(merkTypeOf('/codex/index?kind=weapon')).toBe('weapon');
    expect(merkTypeOf('/codex/ship/drak_cutter')).toBe('ship');
    expect(merkTypeOf('/codex/upcoming')).toBe('ship');
    expect(merkTypeOf('/codex/blueprint/x#a')).toBe('blueprint');
    expect(merkTypeOf('/hq/hangar/abc')).toBe('ship');
    expect(merkTypeOf('/hq')).toBeNull();
    expect(merkTypeOf('/hq#planen')).toBeNull();
    expect(merkTypeOf('/verse')).toBeNull();
    expect(merkTypeOf('/verse/news/abc')).toBe('news');
    expect(merkTypeOf('/verse/gallery')).toBeNull();
    expect(merkTypeOf('/admin')).toBeNull();
  });

  it('announced ships belong to the ship type', () => {
    expect(typeOfKind('upcoming')).toBe('ship');
    expect(typeOfKind('manufacturer')).toBeNull();
  });

  const hit = (kind: string, slug: string, id: string) =>
    ({ type: 'hit', id, target: { link: ['/codex', kind, slug], queryParams: null }, hit: { kind, classNameSlug: slug, nameLocalized: slug.toUpperCase(), manufacturerCode: 'DRAK' }, outside: false, owned: null, fit: null, signal: { recent: true, owned: false, popular: false } }) as unknown as StoredRow;

  it('keeps recent rows of the page type only; untyped keeps all rows of a known type', () => {
    const rows = [hit('ship', 'a', '1'), hit('weapon', 'b', '2'), hit('upcoming', 'c', '3')];
    expect(recentRowsOfType(rows, 'ship').map((r) => r.id)).toEqual(['1', '3']);
    expect(recentRowsOfType(rows, null).length).toBe(3);
  });

  it('cuts wishes by type and links announced ships to the upcoming grid with their name', () => {
    const up = wishRowOfType({ kind: 'upcoming', className: 'ironclad', name: 'Ironclad Assault', manufacturer: null }, 'ship')!;
    expect(up.target!.link).toEqual(['/codex', 'upcoming']);
    expect(up.target!.queryParams).toEqual({ q: 'Ironclad Assault' });
    expect(wishRowOfType({ kind: 'weapon', className: 'w', name: null, manufacturer: null }, 'ship')).toBeNull();
    expect(wishRowOfType({ kind: 'weapon', className: 'w', name: null, manufacturer: null }, null)?.type).toBe('weapon');
  });

  it('titles a wished entry with its stored name, else the resolved catalog name, never the raw class name', () => {
    const w = { kind: 'item', className: 'MISL_S01_IR_VNCL_Arrow', name: null, manufacturer: null };
    expect(wishRowOfType({ ...w, name: 'Arrow-I-Rakete' }, null, () => 'Other')!.title).toBe('Arrow-I-Rakete');
    expect(wishRowOfType(w, null, () => 'Arrow-I-Rakete')!.title).toBe('Arrow-I-Rakete');
    expect(wishRowOfType(w, null, () => null)!.title).not.toContain('MISL_S01');
  });
});
