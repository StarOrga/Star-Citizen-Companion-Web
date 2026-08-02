import {
  UpcomingShip,
  diffUpcoming,
  matchesUpcomingQuery,
  normalizeShipName,
  snapshotOf,
  thumbnailCandidates,
} from './upcoming-ships.service';

function ship(partial: Partial<UpcomingShip> & { id: string; name: string }): UpcomingShip {
  return {
    manufacturer: null,
    manufacturerCode: null,
    productionStatus: null,
    type: null,
    focus: null,
    rsiUrl: null,
    thumbnail: null,
    flightReadyButMissing: false,
    ...partial,
  };
}

const IDRIS = ship({
  id: 'idris-p',
  name: 'Idris-P',
  manufacturer: 'Aegis Dynamics',
  manufacturerCode: 'AEGS',
  type: 'combat',
  focus: 'Frigate',
  productionStatus: 'in-concept',
});
const ZEUS = ship({
  id: 'zeus-cl',
  name: 'Zeus Mk II CL',
  manufacturer: 'Roberts Space Industries',
  manufacturerCode: 'RSI',
  type: 'transport',
  focus: 'Cargo Hauling',
  productionStatus: 'flight-ready',
  flightReadyButMissing: true,
});

describe('upcoming ships — search', () => {
  it('matches everything for an empty or whitespace query', () => {
    expect(matchesUpcomingQuery(IDRIS, '')).toBeTrue();
    expect(matchesUpcomingQuery(IDRIS, '   ')).toBeTrue();
  });

  it('matches on name, manufacturer, code, type and focus, case-insensitively', () => {
    expect(matchesUpcomingQuery(IDRIS, 'idris')).toBeTrue();
    expect(matchesUpcomingQuery(IDRIS, 'AEGIS')).toBeTrue();
    expect(matchesUpcomingQuery(IDRIS, 'aegs')).toBeTrue();
    expect(matchesUpcomingQuery(IDRIS, 'combat')).toBeTrue();
    expect(matchesUpcomingQuery(IDRIS, 'frigate')).toBeTrue();
  });

  it('ANDs multiple tokens instead of widening the result', () => {
    expect(matchesUpcomingQuery(ZEUS, 'zeus cargo')).toBeTrue();
    expect(matchesUpcomingQuery(ZEUS, 'zeus frigate')).toBeFalse();
  });

  it('does not match unrelated terms', () => {
    expect(matchesUpcomingQuery(IDRIS, 'drake')).toBeFalse();
  });
});

describe('upcoming ships — diff', () => {
  it('reports nothing when there is no baseline yet (first-ever visit)', () => {
    const d = diffUpcoming([IDRIS, ZEUS], null, new Set());
    expect(d.added).toEqual([]);
    expect(d.favoriteUpdates).toEqual([]);
  });

  it('reports ships missing from the baseline as added', () => {
    const d = diffUpcoming([IDRIS, ZEUS], snapshotOf([IDRIS]), new Set());
    expect(d.added.map((s) => s.id)).toEqual(['zeus-cl']);
    expect(d.favoriteUpdates).toEqual([]);
  });

  it('reports a favorited ship whose production status moved', () => {
    const baseline = snapshotOf([IDRIS]);
    const promoted = { ...IDRIS, productionStatus: 'flight-ready' };
    const d = diffUpcoming([promoted], baseline, new Set(['idris-p']));
    expect(d.added).toEqual([]);
    expect(d.favoriteUpdates.map((s) => s.id)).toEqual(['idris-p']);
  });

  it('ignores status moves on ships the user did not favorite', () => {
    const baseline = snapshotOf([IDRIS]);
    const promoted = { ...IDRIS, productionStatus: 'flight-ready' };
    expect(diffUpcoming([promoted], baseline, new Set()).favoriteUpdates).toEqual([]);
  });

  it('reports an added ship once, even when it is already favorited', () => {
    const d = diffUpcoming([IDRIS, ZEUS], snapshotOf([IDRIS]), new Set(['zeus-cl']));
    expect(d.added.map((s) => s.id)).toEqual(['zeus-cl']);
    expect(d.favoriteUpdates).toEqual([]);
  });

  it('stays quiet when nothing changed', () => {
    const d = diffUpcoming([IDRIS, ZEUS], snapshotOf([IDRIS, ZEUS]), new Set(['idris-p']));
    expect(d.added).toEqual([]);
    expect(d.favoriteUpdates).toEqual([]);
  });

  it('treats a missing production status as a stable empty string', () => {
    const bare = ship({ id: 'x', name: 'X' });
    expect(snapshotOf([bare])).toEqual({ x: '' });
    expect(diffUpcoming([bare], snapshotOf([bare]), new Set(['x'])).favoriteUpdates).toEqual([]);
  });
});

describe('upcoming ships — artwork candidates', () => {
  it('prefers the full candidate list over the single legacy url', () => {
    const s = ship({
      id: 'ursa',
      name: 'Ursa',
      thumbnail: 'https://media.robertsspaceindustries.com/x/store_small.jpg',
      thumbnails: [
        'https://media.robertsspaceindustries.com/x/store_small.jpg',
        'https://media.robertsspaceindustries.com/x/store_large.jpg',
      ],
    });
    expect(thumbnailCandidates(s)).toEqual([
      'https://media.robertsspaceindustries.com/x/store_small.jpg',
      'https://media.robertsspaceindustries.com/x/store_large.jpg',
    ]);
  });

  it('falls back to the single url for payloads that predate the list', () => {
    const s = ship({ id: 'ursa', name: 'Ursa', thumbnail: 'https://media.rsi/x.jpg' });
    expect(thumbnailCandidates(s)).toEqual(['https://media.rsi/x.jpg']);
  });

  it('yields nothing when the ship has no artwork at all', () => {
    expect(thumbnailCandidates(ship({ id: 'x', name: 'X' }))).toEqual([]);
    expect(thumbnailCandidates(ship({ id: 'x', name: 'X', thumbnails: [] }))).toEqual([]);
  });
});

describe('upcoming ships — game-name normalization', () => {
  // Must stay byte-for-byte compatible with the edge function's normalizeName,
  // or `gameShipArt` lookups silently miss and ship cards lose their artwork.
  it('lowercases and drops everything non-alphanumeric', () => {
    expect(normalizeShipName('Aegis Idris-M')).toBe('aegisidrism');
    expect(normalizeShipName('MISC Hull C')).toBe('mischullc');
    expect(normalizeShipName('Origin 890 Jump')).toBe('origin890jump');
  });

  it('strips diacritics so accented CIG names still match', () => {
    expect(normalizeShipName("Aopoa San'tok.yāi")).toBe('aopoasantokyai');
  });

  it('is stable for names that are already normalized', () => {
    expect(normalizeShipName('rsiursa')).toBe('rsiursa');
  });
});
