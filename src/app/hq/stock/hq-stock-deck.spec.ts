import type { BestandKind } from '../data/hq-codex-kind';
import type { QualityRow } from '../data/hq-quality';
import {
  ALT_MAX_HITS,
  INV_KINDS,
  NO_DECK_FILTER,
  alternativesFor,
  buildCrates,
  deckBays,
  filterCrates,
  kindCounts,
  linesOf,
  parseStockQuery,
  placeCounts,
  subCounts,
  tieredSearch,
} from './hq-stock-deck';
import { groupPlaces, placeInfo } from './hq-stock-places';

const IRON = 'Carryable_TBO_FL_32SCU_Commodity_Metal_Iron';
const IRON_ORE = 'Carryable_TBO_FL_32SCU_Commodity_Ore_Iron';
const rows: QualityRow[] = [
  { location: 'Area18', name: 'Eisen', class_name: `item:${IRON}`, qty: 15, unit: 'scu', stacks: [{ quality: 940, qty: 5 }, { quality: 620, qty: 10 }], reservations: [{ amount: 4, note: 'Kaelis', at: '2026-11-08T10:00:00Z', quality: 940 }] },
  { location: 'Lorville', name: 'Eisen', class_name: `item:${IRON}`, qty: 9, unit: 'scu', stacks: [{ quality: 410, qty: 9 }] },
  { location: 'Lorville', name: 'Eisenerz', class_name: IRON_ORE, qty: 3, unit: 'scu' },
  { location: 'Area18', name: 'Pembroke-Helm', class_name: 'cds_helmet_pembroke', qty: 1, unit: 'pcs' },
  { location: 'Lorville', name: 'Torso', class_name: 'orc_torso', qty: 1, unit: 'pcs' },
  { location: 'Area18', name: 'P4-AR', class_name: 'ksar_rifle_p4ar', qty: 2, unit: 'pcs' },
  { location: 'Blueprints', name: 'Gallant', class_name: 'gallant_bp', qty: 1, unit: 'pcs' },
];
const kinds = new Map<string, BestandKind>([
  ['cds_helmet_pembroke', { area: 'armor', sub: 'helmet', role: null }],
  ['orc_torso', { area: 'armor', sub: 'torso', role: null }],
  ['ksar_rifle_p4ar', { area: 'weapons', sub: 'primary', role: null }],
]);
const no = (): boolean => false;
const crates = buildCrates(rows, kinds, 'Blueprints');

describe('hq-stock-deck · Frachtdeck view helpers', () => {
  it('one container per place and item, quality aggregated, the Sammlung place left out (I3)', () => {
    const area = crates.find((c) => c.location === 'Area18' && c.name === 'Eisen')!;
    expect(area.qty).toBe(15);
    expect(area.avg).toBe(727);
    expect(area.min).toBe(620);
    expect(area.max).toBe(940);
    expect(area.reserved).toBe(4);
    expect(crates.some((c) => c.name === 'Gallant')).toBe(false);
  });

  it('derives the sub-kind from the Codex slot, and ore vs refined from the crate class (I9)', () => {
    const by = (n: string) => crates.find((c) => c.name === n)!;
    expect([by('Pembroke-Helm').kind, by('Pembroke-Helm').sub]).toEqual(['armor', 'helmet']);
    expect([by('P4-AR').kind, by('P4-AR').sub]).toEqual(['weapons', 'primary']);
    expect(by('Eisenerz').sub).toBe('ore');
    expect(by('Eisen').sub).toBe('refined');
  });

  it('counts every kind and every sub, 0 for the empty ones, never dropping an option (F4)', () => {
    const k = kindCounts(crates, NO_DECK_FILTER, no, 0);
    expect([...k.keys()]).toEqual([...INV_KINDS]);
    expect(k.get('other')).toBe(0);
    expect(k.get('sets')).toBe(0);
    const s = subCounts(crates, { ...NO_DECK_FILTER, kind: 'armor' }, no);
    expect([...s.keys()]).toEqual(['helmet', 'torso', 'arms', 'legs', 'undersuit', 'backpack']);
    expect(s.get('helmet')).toBe(1);
    expect(s.get('arms')).toBe(0);
  });

  it('kind counts honour the place, the place amounts honour the kind (brief f7 counts rule)', () => {
    const atLorville = kindCounts(crates, { ...NO_DECK_FILTER, place: 'Lorville' }, no, 0);
    expect(atLorville.get('materials')).toBe(2);
    expect(atLorville.get('weapons')).toBe(0);
    const places = placeCounts(crates, { ...NO_DECK_FILTER, kind: 'materials' }, no);
    expect(places.get('Area18')).toBe(1);
    expect(places.get('Lorville')).toBe(2);
  });

  it('bays weigh by what the filter shows, not by SCU (I1)', () => {
    const bays = deckBays(filterCrates(crates, NO_DECK_FILTER, no));
    expect(bays.map((b) => [b.location, b.weight])).toEqual([['Area18', 3], ['Lorville', 3]]);
  });

  it('reads a minimum quality out of the query', () => {
    expect(parseStockQuery('eisen q>700')).toEqual({ text: 'eisen', minQ: 700 });
    expect(parseStockQuery('Eisen Q ≥ 810')).toEqual({ text: 'eisen', minQ: 810 });
    expect(parseStockQuery('P4-AR')).toEqual({ text: 'p4-ar', minQ: null });
  });

  it('offers alternatives on no hit AND on up to three hits, never above (I15)', () => {
    const f = { ...NO_DECK_FILTER, place: 'Lorville', text: 'eisen', minQ: 700 };
    const hits = filterCrates(crates, f, no);
    expect(hits.length).toBe(0);
    const a = alternativesFor(crates, hits, f, no, [{ id: 'iron_bp', name: 'Eisen-Barren' }])!;
    expect(a.elsewhere.map((c) => c.location)).toEqual(['Area18']);
    expect(a.wish).toEqual({ text: 'eisen', minQ: 700 });
    expect(a.craft.map((c) => c.id)).toEqual(['iron_bp']);
    const few = filterCrates(crates, { ...NO_DECK_FILTER, text: 'eisen' }, no);
    expect(few.length).toBeLessThanOrEqual(ALT_MAX_HITS);
    expect(alternativesFor(crates, few, { ...NO_DECK_FILTER, text: 'eisen' }, no, [])).not.toBeNull();
    const many = Array.from({ length: ALT_MAX_HITS + 1 }, () => crates[0]);
    expect(alternativesFor(crates, many, { ...NO_DECK_FILTER, text: 'eisen' }, no, [])).toBeNull();
    expect(alternativesFor(crates, [], NO_DECK_FILTER, no, [])).toBeNull();
  });

  it('search tiers: the active area first, the rest of the Bestand after (I14)', () => {
    const entries = [
      { area: 'inventar' as const, key: 'a', name: 'Cutlass Paint', className: null },
      { area: 'hangar' as const, key: 'b', name: 'Cutlass Black', className: 'DRAK_Cutlass' },
      { area: 'sammlung' as const, key: 'c', name: 'Gallant', className: null },
    ];
    const t = tieredSearch(entries, ['inventar'], 'cutlass');
    expect(t.active.map((e) => e.key)).toEqual(['a']);
    expect(t.rest.map((e) => e.key)).toEqual(['b']);
    expect(tieredSearch(entries, ['inventar', 'hangar', 'sammlung'], 'cutlass').rest).toEqual([]);
  });

  it('hand-over lines: one gather line per item with a stop per place, largest free first (D4 input)', () => {
    const eisen = crates.filter((c) => c.name === 'Eisen');
    const [line] = linesOf(eisen, (l) => placeInfo(l).system);
    expect(line.stops!.map((s) => [s.location, s.amount])).toEqual([['Area18', 11], ['Lorville', 9]]);
    expect(line.amount).toBe(20);
    expect(line.className).toBe(IRON);
    expect(line.stops![0].system).toBe('Stanton');
  });

  it('groups every place by system and planet, deterministic, with amounts and search (I10)', () => {
    const g = groupPlaces(['Area18', 'Stanton1_Lorville', 'Some Outpost'], new Map([['Area18', 3]]));
    const stanton = g.find((x) => x.system === 'Stanton')!;
    const arc = stanton.bodies.find((b) => b.body === 'ArcCorp')!;
    expect(arc.places[0]).toEqual(expect.objectContaining({ id: 'Area18', amount: 3 }));
    expect(stanton.bodies.find((b) => b.body === 'Hurston')!.places.some((p) => p.id === 'Stanton1_Lorville')).toBe(true);
    expect(g.some((x) => x.system === 'Pyro')).toBe(true);
    expect(g[g.length - 1].system).toBeNull();
    const searched = groupPlaces([], new Map(), 'lorv');
    expect(searched.flatMap((x) => x.bodies.flatMap((b) => b.places.map((p) => p.name)))).toEqual(['Lorville']);
  });
});
