import type { MapPlace } from './map/hq-map.types';
import {
  ProposalLine,
  defaultSplit,
  normalizeSplit,
  proposalCounts,
  proposeEinsaetze,
  purposesOf,
  setBuyPart,
  toggleMethod,
} from './einsatz-proposal';

const AREA18: MapPlace = { id: 'stanton/arccorp/area18', system: 'Stanton', planet: 'ArcCorp', location: 'Area18' };
const LORVILLE: MapPlace = { id: 'stanton/hurston/lorville', system: 'Stanton', planet: 'Hurston', location: 'Lorville' };

const line = (key: string, name: string, kind: string, qty: number, forClassName: string | null = null, forName: string | null = null): ProposalLine => ({
  key,
  name,
  className: key,
  kind,
  qty,
  forClassName,
  forName,
});

const BP = line('gallant_bp', 'Gallant', 'blueprint', 2);
const ALU = line('aluminium', 'Aluminium', 'material', 16, 'gallant_bp', 'Gallant');
const COPPER = line('copper', 'Kupfer', 'material', 8, 'gallant_bp', 'Gallant');
const MEDPEN = line('medpen', 'Medpen', 'item', 12);
const RATTLER = line('rattler', 'Rattler II', 'item', 4);

const shops = (m: Record<string, MapPlace>) => (l: ProposalLine) => m[l.key] ?? null;

describe('proposeEinsaetze', () => {
  it('proposes nothing for an empty Nachschub', () => {
    expect(proposeEinsaetze([], { placeOf: () => null })).toEqual([]);
  });

  it('puts crafting last, after missions, buying and mining', () => {
    const d = proposeEinsaetze([MEDPEN, BP, ALU, COPPER], { placeOf: shops({ medpen: AREA18 }) });
    expect(d.map((x) => x.role)).toEqual(['mission', 'buy', 'mine', 'craft']);
    expect(d[d.length - 1].steps[0]).toEqual(jasmine.objectContaining({ kind: 'craft', label: 'Gallant', qty: 2 }));
  });

  it('buys material whose shop is known and mines the rest by default, refining what is mined', () => {
    const d = proposeEinsaetze([ALU, COPPER], { placeOf: shops({ aluminium: AREA18 }) });
    const buy = d.find((x) => x.role === 'buy')!;
    const mine = d.find((x) => x.role === 'mine')!;
    expect(buy.steps.map((s) => s.label)).toEqual(['Aluminium']);
    expect(mine.steps.map((s) => `${s.kind}:${s.label}`)).toEqual(['mine:Kupfer', 'refine:Kupfer']);
  });

  it('orders purchases along the route and keeps lines without a shop at the end with an open place', () => {
    const d = proposeEinsaetze([MEDPEN, RATTLER, ALU], {
      placeOf: shops({ medpen: LORVILLE, rattler: AREA18 }),
      split: new Map([['aluminium', { buy: 16, mine: 0 }]]),
    });
    const buy = d.find((x) => x.role === 'buy')!;
    expect(buy.steps.map((s) => s.location)).toEqual(['Lorville', 'Area18', null]);
    expect(buy.steps[2].label).toBe('Aluminium');
  });

  it('mentions the blueprint purpose of material but never groups by it', () => {
    const other = line('titan', 'Titan', 'material', 4, 'p4ar_bp', 'P4-AR');
    const d = proposeEinsaetze([ALU, other], { placeOf: shops({ aluminium: AREA18, titan: AREA18 }) });
    const buy = d.find((x) => x.role === 'buy')!;
    expect(buy.steps.length).toBe(2);
    expect(purposesOf(buy)).toEqual(['Gallant', 'P4-AR']);
  });

  it('honours a split: 10 bought, 6 mined', () => {
    const d = proposeEinsaetze([ALU], { placeOf: shops({ aluminium: AREA18 }), split: new Map([['aluminium', setBuyPart(ALU, 10)]]) });
    expect(d.find((x) => x.role === 'buy')!.steps[0].qty).toBe(10);
    expect(d.find((x) => x.role === 'mine')!.steps[0].qty).toBe(6);
  });

  it('counts Einsaetze and steps for the header', () => {
    const d = proposeEinsaetze([MEDPEN, BP, ALU], { placeOf: shops({ medpen: AREA18 }) });
    expect(proposalCounts(d)).toEqual({ einsaetze: 4, steps: 1 + 1 + 2 + 1 });
  });

  it('still crafts a blueprint that has no material on the Nachschub', () => {
    const d = proposeEinsaetze([BP], { placeOf: () => null });
    expect(d.map((x) => x.role)).toEqual(['mission', 'craft']);
  });
});

describe('split helpers', () => {
  it('defaults: material to buy with a shop, to mine without, others bought, blueprints not split', () => {
    expect(defaultSplit(ALU, true)).toEqual({ buy: 16, mine: 0 });
    expect(defaultSplit(ALU, false)).toEqual({ buy: 0, mine: 16 });
    expect(defaultSplit(MEDPEN, false)).toEqual({ buy: 12, mine: 0 });
    expect(defaultSplit(BP, true)).toEqual({ buy: 0, mine: 0 });
  });

  it('toggles between all-buy and all-mine', () => {
    expect(toggleMethod(ALU, { buy: 16, mine: 0 })).toEqual({ buy: 0, mine: 16 });
    expect(toggleMethod(ALU, { buy: 0, mine: 16 })).toEqual({ buy: 16, mine: 0 });
    expect(toggleMethod(ALU, { buy: 5, mine: 11 })).toEqual({ buy: 16, mine: 0 });
  });

  it('keeps a split valid', () => {
    expect(normalizeSplit(ALU, { buy: 99, mine: 0 })).toEqual({ buy: 16, mine: 0 });
    expect(normalizeSplit(ALU, { buy: -3, mine: 0 })).toEqual({ buy: 0, mine: 16 });
    expect(normalizeSplit(MEDPEN, { buy: 1, mine: 11 })).toEqual({ buy: 12, mine: 0 });
  });
});
