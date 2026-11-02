import type { HangarRoleLoadout, HangarShip, HangarShipConfig } from '../../hangar/hangar.types';
import { searchContextOf } from '../../shell/fusion-bar/search-context';
import type { PolyHitKind, PolySearchHit } from '../codex-poly-search';
import { CodexSearchGroup } from './codex-search-model';
import { buildFitPorts, fitVerdict } from './search-compat';
import { composeSearchResult } from './search-compose';
import { searchOwn } from './search-own';
import { parseQuery, sizeChip } from './search-query-parse';
import { SEARCH_ROWS_SHOWN, SearchChip } from './search-result-model';
import { NO_SIGNALS, RankSignals, popularityMap, pushRecentOpened, readRecentOpened, recentRank } from './search-signals';
import { mapGalleryRows, searchPatches } from './search-sources';

function hit(kind: PolyHitKind, slug: string, name: string, extra: Partial<PolySearchHit> = {}): PolySearchHit {
  return {
    kind, classNameSlug: slug, nameLocalized: name, manufacturerCode: null, manufacturerName: null,
    size: null, grade: null, scope: 'equipment', ...extra,
  };
}

function group(kind: PolyHitKind, hits: PolySearchHit[], total = hits.length): CodexSearchGroup {
  return { kind, hits, total, count: total, countIsFloor: false, folded: 0, foldedIsFloor: false, more: null };
}

const base = { term: 'stalker', signedIn: true, flagshipClassName: null as string | null };

describe('composeSearchResult', () => {
  const ships = group('ship', [hit('ship', 'A1', 'Stalker I'), hit('ship', 'A2', 'Stalker II'), hit('ship', 'A3', 'Stalker III'), hit('ship', 'A4', 'Stalker IV'), hit('ship', 'A5', 'Stalker V')], 9);
  const weapons = group('weapon', [hit('weapon', 'W1', 'Stalker Cannon')]);

  it('shows every group with all loaded rows, three visible, expandable for the rest (A3)', () => {
    for (const url of ['/codex', '/hq', '/verse/news']) {
      const r = composeSearchResult({ ...base, groups: [ships, weapons], context: searchContextOf(url), chips: [] });
      const g = r.groups.find((x) => x.id === 'ship')!;
      expect(g.rows.length).toBe(5);
      expect(g.expandable).toBe(5 - SEARCH_ROWS_SHOWN);
      expect(g.total).toBe(9);
      expect(g.moreTarget?.link).toEqual(['/codex/index']);
    }
  });

  it('the context orders groups, it does not cap them (A3/C1)', () => {
    const w = composeSearchResult({ ...base, groups: [ships, weapons], context: searchContextOf('/codex/index?kind=weapon'), chips: [] });
    expect(w.groups.map((g) => g.id)).toEqual(['weapon', 'ship']);
    expect(w.groups[0].reason?.key).toBe('search.why.context');
  });

  it('chips filter; a fast-exact hit outside goes to the outside group with a reason (A10)', () => {
    const kindChip = searchContextOf('/codex/index?kind=weapon').chips;
    const r = composeSearchResult({ ...base, term: 'stalker ii', groups: [ships, weapons], context: searchContextOf('/codex/index?kind=weapon'), chips: kindChip });
    expect(r.groups.map((g) => g.id)).toEqual(['weapon']);
    expect(r.outside).not.toBeNull();
    expect(r.outside!.outside).toBeTrue();
    expect(r.outside!.rows.every((x) => x.type === 'hit' && x.outside)).toBeTrue();
    expect(r.outside!.reason?.key).toBe('search.why.outside');
    expect(r.outside!.reason?.params?.['chip']).toBe('search.chip.kind');
  });

  it('a weak match outside the chips is only counted', () => {
    const chips = searchContextOf('/codex/index?kind=weapon').chips;
    const r = composeSearchResult({ ...base, term: 'tal', groups: [ships, weapons], context: searchContextOf('/codex/index?kind=weapon'), chips });
    expect(r.outside).toBeNull();
    expect(r.filteredOut).toBeGreaterThan(0);
  });

  it('size chips filter by size and fill the menu counts', () => {
    const items = group('item', [hit('item', 'C2', 'Stalker Cooler', { size: 2 }), hit('item', 'C3', 'Stalker Cooler B', { size: 3 })]);
    const chip = sizeChip(3);
    const r = composeSearchResult({ ...base, groups: [items], context: searchContextOf('/codex'), chips: [chip], facets: { size: { '2': 4, '3': 7 }, grade: {} } });
    expect(r.groups[0].rows.length).toBe(1);
    expect(r.chips[0].options!.find((o) => o.value === '3')!.count).toBe(7);
    expect(r.chips[0].options!.find((o) => o.value === '9')!.count).toBe(0);
  });

  it('the own group stands first on HQ pages, second elsewhere, max 3 shown (A2)', () => {
    const own = { rows: [] as never[], total: 0 };
    const ownRows = searchOwn('stalker', {
      ships: [{ id: 'h1', shipClassName: 'A1', customName: 'Nachtfalke Stalker', status: 'owned' } as HangarShip],
      configs: [], sets: [], items: [],
    });
    expect(ownRows.total).toBe(1);
    void own;
    const hq = composeSearchResult({ ...base, groups: [ships], context: searchContextOf('/hq'), chips: [], own: ownRows });
    expect(hq.groups.map((g) => g.id)).toEqual(['own', 'ship']);
    expect(hq.groups[0].reason?.key).toBe('search.why.ownHq');
    const codex = composeSearchResult({ ...base, groups: [ships, weapons], context: searchContextOf('/codex'), chips: [], own: ownRows });
    expect(codex.groups.map((g) => g.id)).toEqual(['ship', 'own', 'weapon']);
  });

  it('signed out: no own rows can exist, the own group is absent', () => {
    const r = composeSearchResult({ ...base, signedIn: false, groups: [ships], context: searchContextOf('/hq'), chips: [], own: null });
    expect(r.groups.some((g) => g.id === 'own')).toBeFalse();
  });

  it('ownership, recent opens and popularity only break ties among equal name scores (C9)', () => {
    const g = group('ship', [hit('ship', 'X1', 'Gladius Alpha'), hit('ship', 'X2', 'Gladius Beta'), hit('ship', 'X3', 'Gladius')]);
    const signals: RankSignals = { recentRank: (_k, c) => (c === 'X2' ? 0 : -1), owns: (c) => c === 'X1', popularity: () => 0 };
    const r = composeSearchResult({ ...base, term: 'gladius', groups: [g], context: searchContextOf('/codex'), chips: [], signals });
    const ids = r.groups[0].rows.map((x) => (x.type === 'hit' ? x.hit.classNameSlug : ''));
    expect(ids[0]).toBe('X3'); // the exact name wins over every signal
    expect(ids.slice(1)).toEqual(['X2', 'X1']); // recent before owned
  });

  it('popularity breaks the remaining tie', () => {
    const g = group('ship', [hit('ship', 'P1', 'Pioneer One'), hit('ship', 'P2', 'Pioneer Two')]);
    const signals: RankSignals = { ...NO_SIGNALS, popularity: (_k, c) => (c === 'P2' ? 40 : 0) };
    const r = composeSearchResult({ ...base, term: 'pioneer', groups: [g], context: searchContextOf('/codex'), chips: [], signals });
    expect((r.groups[0].rows[0] as { hit: PolySearchHit }).hit.classNameSlug).toBe('P2');
  });

  it('the Hangar chip keeps the owned ship out of the catalog group when the own group has it', () => {
    const own = searchOwn('stalker', { ships: [{ id: 'h1', shipClassName: 'A1', customName: null, status: 'owned' } as HangarShip], configs: [], sets: [], items: [] }, { nameOf: () => 'Stalker I' });
    const ctx = searchContextOf('/hq/hangar');
    const r = composeSearchResult({ ...base, groups: [ships], context: ctx, chips: ctx.chips, own, signals: { ...NO_SIGNALS, owns: (c) => c === 'A1' } });
    const shipGroup = r.groups.find((g) => g.id === 'ship');
    expect(shipGroup?.rows.some((x) => x.type === 'hit' && x.hit.classNameSlug === 'A1')).toBeFalsy();
  });

  it('HQ ownership chips order, they do not filter: own group first, catalog below with HQ CTAs (A2, A3, B7, C1)', () => {
    const own = searchOwn('laser', { ships: [], configs: [], sets: [], items: [{ name: 'Laser Repeater S3', class_name: 'KLWE_LaserRepeater_S3', location: 'Lager A', qty: 3 }] });
    const lasers = group('weapon', [hit('weapon', 'KLWE_LaserRepeater_S3', 'Laser Repeater S3', { attachType: 'WeaponGun', size: 3 }), hit('weapon', 'W9', 'Laser Beam S1')]);
    const ctx = searchContextOf('/hq', 'bestand');
    const r = composeSearchResult({ ...base, term: 'laser', groups: [lasers], context: ctx, chips: ctx.chips, own });
    expect(r.groups.map((g) => g.id)).toEqual(['own', 'weapon']);
    expect(r.outside).toBeNull();
    expect(r.groups[1].rows.length).toBe(2);
    const cta = r.groups[1].rows[0];
    expect(cta.type === 'hit' && cta.cta?.id).toBe('whereStored');
    expect(r.groups[0].reason?.key).toBe('search.why.ownHq');
  });

  it('a kind chip still filters and keeps the outside group', () => {
    const ctx = searchContextOf('/codex/index?kind=weapon');
    const r = composeSearchResult({ ...base, term: 'stalker ii', groups: [ships, weapons], context: ctx, chips: ctx.chips });
    expect(r.groups.map((g) => g.id)).toEqual(['weapon']);
    expect(r.outside).not.toBeNull();
  });

  it('every hit row carries its CTA and icons', () => {
    const r = composeSearchResult({ ...base, groups: [ships], context: searchContextOf('/codex'), chips: [], flagshipClassName: 'DRAK_Cutlass' });
    const row = r.groups[0].rows[0];
    expect(row.cta?.id).toBe('compareWith');
    expect(row.icons).toEqual({ wishlist: true, lager: true, nachschub: true });
  });

  it('the fit badge is carried when a chip names a ship (B5)', () => {
    const ports = [{ types: ['WeaponGun'], minSize: 3, maxSize: 3 }];
    const w = group('weapon', [hit('weapon', 'W3', 'Laser S3', { attachType: 'WeaponGun', size: 3 }), hit('weapon', 'W1', 'Laser S1', { attachType: 'WeaponGun', size: 1 })]);
    const ctx = searchContextOf('/codex/ship/AEGS_Gladius');
    const r = composeSearchResult({ ...base, term: 'laser', groups: [w], context: ctx, chips: ctx.chips, fit: (h) => fitVerdict(h, ports) });
    const verdicts = r.groups[0].rows.map((x) => (x.type === 'hit' ? x.fit?.verdict : null));
    expect(verdicts.sort()).toEqual(['fits', 'noFit']);
  });

  it('reports empty and carries didYouMean', () => {
    const r = composeSearchResult({ ...base, groups: [], context: searchContextOf('/codex'), chips: [], didYouMean: ['Gladius'] });
    expect(r.empty).toBeTrue();
    expect(r.didYouMean).toEqual(['Gladius']);
  });
});

describe('fitVerdict', () => {
  const ports = [{ types: ['WeaponGun'], minSize: 2, maxSize: 4 }];
  it('fits, wrong size, wrong type, unknown', () => {
    expect(fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 3 }, ports).verdict).toBe('fits');
    const size = fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 6 }, ports);
    expect(size).toEqual(jasmine.objectContaining({ verdict: 'noFit', reasonKey: 'search.fit.noSize' }));
    expect(fitVerdict({ kind: 'component', attachType: 'Shield', size: 2 }, ports).reasonKey).toBe('search.fit.noType');
    expect(fitVerdict({ kind: 'ship', attachType: null, size: null }, ports).verdict).toBe('unknown');
    expect(fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 3 }, null).verdict).toBe('unknown');
  });
});

describe('searchOwn (A2, C11, C12)', () => {
  const ships = [
    { id: 'h1', shipClassName: 'AEGS_Gladius', customName: 'Nachtfalke', status: 'owned' },
    { id: 'h2', shipClassName: 'AEGS_Gladius', customName: null, status: 'owned' },
    { id: 'h3', shipClassName: 'DRAK_Cutlass_Black', customName: null, status: 'wishlist' },
  ] as HangarShip[];
  const configs = [{ id: 'c1', hangarShipId: 'h1', name: 'Rennbuild', loadout: [], isActive: true }] as unknown as HangarShipConfig[];
  const sets = [{ id: 's1', name: 'Wüsten Set', items: [] }] as unknown as HangarRoleLoadout[];
  const items = [{ name: 'Gladius Livery', class_name: null, location: 'Port Olisar', qty: 2 }];
  const src = { ships, configs, sets, items };
  const nameOf = (c: string) => (c === 'AEGS_Gladius' ? 'Aegis Gladius' : null);

  it('finds a ship by its own name; the ship type leads, the own name follows (B2)', () => {
    const r = searchOwn('nachtfalke', src, { nameOf });
    expect(r.rows[0]).toEqual(jasmine.objectContaining({ ownKind: 'ship', title: 'Aegis Gladius', ownName: 'Nachtfalke' }));
    expect(r.rows[0].target.link).toEqual(['/hq/hangar', 'h1']);
  });

  it('two copies of one type are two rows with different names', () => {
    const r = searchOwn('gladius', src, { nameOf });
    expect(r.rows.filter((x) => x.ownKind === 'ship').length).toBe(2);
  });

  it('finds config names, set names and inventory items; wishlist ships are not "owned"', () => {
    expect(searchOwn('rennbuild', src, { nameOf }).rows[0].ownKind).toBe('config');
    expect(searchOwn('wusten', src, { nameOf }).rows[0].ownKind).toBe('set');
    expect(searchOwn('cutlass', src, { nameOf }).total).toBe(0);
    expect(searchOwn('olisar', src, { nameOf }).total).toBe(0); // location is not searched, only names
    const it = searchOwn('livery', src, { nameOf }).rows[0];
    expect(it).toEqual(jasmine.objectContaining({ ownKind: 'item', qty: 2, subtitle: 'Port Olisar' }));
  });

  it('caps the rows but keeps the total', () => {
    const r = searchOwn('gladius', src, { nameOf, limit: 1 });
    expect(r.rows.length).toBe(1);
    expect(r.total).toBe(3);
  });

  it('signed out (empty sources) finds nothing', () => {
    expect(searchOwn('gladius', { ships: [], configs: [], sets: [], items: [] }).total).toBe(0);
  });
});

describe('search sources', () => {
  it('finds patch lines by version or channel', () => {
    const lines = [
      { line: '4.9', latestAt: '2026-10-01', entries: [{ version: '4.9.1', stage: 'live', hotfix: false, facet: 'live' }] },
      { line: '4.8', latestAt: '2026-08-01', entries: [{ version: '4.8.0', stage: 'ptu', hotfix: false, facet: 'ptu' }] },
    ] as never;
    expect(searchPatches('4.9', lines).rows.map((r) => r.line)).toEqual(['4.9']);
    expect(searchPatches('ptu', lines).rows.map((r) => r.line)).toEqual(['4.8']);
    expect(searchPatches('gladius', lines).total).toBe(0);
    expect(searchPatches('4.9', lines).rows[0].target.link).toEqual(['/verse', 'patches', '4.9']);
  });

  it('maps gallery rows to /verse/gallery/:imageId targets and tolerates a missing RPC', () => {
    const r = mapGalleryRows([{ image_id: 'abc', title: 'Idris at dawn', series: 'Ships', published_at: null, preview_url: null }]);
    expect(r.rows[0].target.link).toEqual(['/verse', 'gallery', 'abc']);
    expect(mapGalleryRows(null).total).toBe(0);
  });
});

describe('search signals storage', () => {
  function memory(): Storage {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
  }
  it('keeps the 50 newest opens, deduped', () => {
    const st = memory();
    let list = readRecentOpened(st);
    for (let i = 0; i < 60; i++) list = pushRecentOpened(st, list, 'ship', `C${i}`);
    list = pushRecentOpened(st, list, 'ship', 'c59');
    expect(list.length).toBe(50);
    expect(list[0].className).toBe('c59');
    expect(readRecentOpened(st).length).toBe(50);
    expect(recentRank(list, 'ship', 'C58')).toBe(1);
  });
  it('reads server popularity as a lookup', () => {
    const m = popularityMap([{ entity_kind: 'ship', class_name: 'AEGS_Gladius', hits: 12 }]);
    expect(m.get('ship|aegs_gladius')).toBe(12);
  });
  it('a chip made from parsed text is a stable "parsed" chip', () => {
    const chip: SearchChip = parseQuery('s3').chips[0];
    expect(chip.id).toBe('parsed:size');
  });
});

describe('nested ports (B5)', () => {
  // Idris-like: a size-10 turret that seats a gimbal with an S3 gun seat.
  const top = [{ portName: 'hardpoint_turret_front', types: ['Turret'], minSize: 10, maxSize: 10 }];
  const loadout = [{ itemPortName: 'hardpoint_turret_front', entityClassName: 'TURRET_S10', entries: [{ itemPortName: 'gimbal_a', entityClassName: 'GIMBAL_S3' }] }];
  const items: Record<string, { portName: string; types: string[]; minSize: number; maxSize: number }[]> = {
    TURRET_S10: [{ portName: 'gimbal_a', types: ['Turret'], minSize: 3, maxSize: 3 }],
    GIMBAL_S3: [{ portName: 'gun', types: ['WeaponGun'], minSize: 3, maxSize: 3 }],
  };
  const ports = buildFitPorts(top, loadout, (c) => items[c]);

  it('walks turret → sub-port and fits a weapon at the deepest level', () => {
    expect(fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 3 }, ports).verdict).toBe('fits');
  });

  it('a wrong size at the deepest level is a real no-fit with the sub-port range', () => {
    const v = fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 6 }, ports);
    expect(v).toEqual(jasmine.objectContaining({ verdict: 'noFit', reasonKey: 'search.fit.noSize', reasonParams: { size: 6, min: 3, max: 3 } }));
  });

  it('a mount whose sub-ports are unknown is ?, never a false warning', () => {
    const blind = buildFitPorts(top, loadout, () => undefined);
    expect(blind[0].opaque).toBeTrue();
    expect(fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 3 }, blind).verdict).toBe('unknown');
    expect(fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 6 }, blind).verdict).toBe('unknown');
  });

  it('a plain ship without mounts still reports a type mismatch', () => {
    const plain = buildFitPorts([{ portName: 'sh', types: ['Shield'], minSize: 1, maxSize: 1 }], [], () => undefined);
    expect(fitVerdict({ kind: 'weapon', attachType: 'WeaponGun', size: 3 }, plain).reasonKey).toBe('search.fit.noType');
  });
});
