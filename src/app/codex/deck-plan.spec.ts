import type { ShipDeck } from './codex.types';
import { buildDeckPlans, humanizeRoomKey } from './deck-plan';

// Shapes trimmed from the LIVE Carrack extract (#797): metres, +X starboard, +Y nose.
const DECKS: ShipDeck[] = [
  {
    key: 'Carrack_Deck_2',
    name: null,
    order: 1,
    rooms: [
      {
        key: 'MedicalBay_Room_RN',
        name: { en: 'Medical', de: null },
        pos: [0, 0, 0],
        floorZ: -3,
        height: 4,
        shapes: [[[-5, -5], [5, -5], [5, 5], [-5, 5]]],
      },
      { key: 'Lift_Front_Room_RN', name: null, pos: [3, 14, -9], floorZ: null, height: null, shapes: [] },
    ],
  },
  {
    key: 'Carrack_Deck_1',
    name: { en: 'Deck 01', de: null },
    order: 0,
    rooms: [
      {
        key: 'Turret_Room_RN',
        name: null,
        pos: [-18, -25, 0],
        floorZ: null,
        height: 3,
        shapes: [],
        tris: [[[-20, -26], [-16, -26], [-16, -24]], [[-20, -26], [-16, -24], [-20, -24]]],
      },
    ],
  },
  { key: 'Carrack_Deck_3', name: null, order: 2 },
];

describe('buildDeckPlans', () => {
  it('keeps only decks with rooms, bottom-up', () => {
    const set = buildDeckPlans(DECKS, 'en')!;
    expect(set.decks.map((d) => d.key)).toEqual(['Carrack_Deck_1', 'Carrack_Deck_2']);
    expect(set.decks.map((d) => d.label)).toEqual(['Deck 01', 'Deck 2']);
  });

  it('shares one frame across decks, padded, nose up', () => {
    const set = buildDeckPlans(DECKS, 'en')!;
    // x: -20..5 → 25 + 3 pad; y: -26..14 → 40 + 3 pad.
    expect(set.viewBox).toBe('0 0 28 43');
    const med = set.decks[1].rooms.find((r) => r.key === 'MedicalBay_Room_RN')!;
    // Model (-5, 5) is the top-left corner: x = -5 + 20 + 1.5, y = 14 - 5 + 1.5.
    expect(med.paths).toEqual(['M16.5 20.5L26.5 20.5L26.5 10.5L16.5 10.5Z']);
    expect(med.anchor).toEqual({ x: 21.5, y: 15.5 });
    expect(med.area).toBe(100);
    expect(med.box).toEqual({ w: 10, h: 10 });
  });

  it('merges trimesh triangles into one unstroked path', () => {
    const turret = buildDeckPlans(DECKS, 'en')!.decks[0].rooms[0];
    expect(turret.paths).toEqual([]);
    expect(turret.mesh.match(/M/g)?.length).toBe(2);
    expect(turret.area).toBe(8);
    // Label sits on the whole floor, not on one triangle.
    expect(turret.anchor).toEqual({ x: 3.5, y: 40.5 });
    expect(turret.box).toEqual({ w: 4, h: 2 });
  });

  it('draws larger rooms first so small ones stay on top', () => {
    const rooms = buildDeckPlans(DECKS, 'en')!.decks[1].rooms;
    expect(rooms.map((r) => r.key)).toEqual(['MedicalBay_Room_RN', 'Lift_Front_Room_RN']);
  });

  it('a room without footprint becomes a pin at its pivot', () => {
    const lift = buildDeckPlans(DECKS, 'en')!.decks[1].rooms.find((r) => r.key === 'Lift_Front_Room_RN')!;
    expect(lift.paths).toEqual([]);
    expect(lift.mesh).toBe('');
    expect(lift.anchor).toEqual({ x: 24.5, y: 1.5 });
    expect(lift.label).toBe('Lift Front');
  });

  it('labels fall back from the reader language to English to the key', () => {
    const set = buildDeckPlans(DECKS, 'de')!;
    expect(set.decks[1].rooms.find((r) => r.key === 'MedicalBay_Room_RN')!.label).toBe('Medical');
    expect(set.decks[0].rooms[0].label).toBe('Turret');
  });

  it("draws the uploader's fallback deck like any deck, under its own name", () => {
    const decks: ShipDeck[] = [
      { key: 'Vulture_Deck_1', name: null, order: 0 },
      { key: 'unassigned', name: { en: 'All rooms', de: 'Alle Räume' }, order: 1, fallback: true,
        rooms: [{ key: 'Room_Hab', name: null, pos: [0, 0, 0], floorZ: 0, height: 3, shapes: [[[0, 0], [4, 0], [4, 4]]] }] },
    ];
    const set = buildDeckPlans(decks, 'de')!;
    expect(set.decks.map((d) => [d.key, d.label])).toEqual([['unassigned', 'Alle Räume']]);
  });

  it('drops malformed rooms and returns null without any room', () => {
    const bad = [{ key: 'X_Deck', name: null, order: 0, rooms: [
      { key: '', pos: [0, 0], shapes: [] },
      { key: 'R', pos: [NaN, 0], shapes: [] },
      { key: 'S', pos: [0, 0], shapes: [[[0, 0], [1, 'a'], [1, 1]]] },
    ] }] as unknown as ShipDeck[];
    const set = buildDeckPlans(bad, 'en')!;
    expect(set.decks[0].rooms.map((r) => r.key)).toEqual(['S']);
    expect(set.decks[0].rooms[0].paths).toEqual([]);
    expect(buildDeckPlans([{ key: 'A', name: null, order: 0 }], 'en')).toBeNull();
    expect(buildDeckPlans(null, 'en')).toBeNull();
    expect(buildDeckPlans('nope' as unknown as ShipDeck[], 'en')).toBeNull();
  });
});

describe('humanizeRoomKey', () => {
  it('spaces out container entity names', () => {
    expect(humanizeRoomKey('MedicalBay_Office_Room_RN')).toBe('Medical Bay Office');
    expect(humanizeRoomKey('CargoPods_FrontContainter_Room_RN')).toBe('Cargo Pods Front Containter');
    expect(humanizeRoomKey('Corridors_Middle_Left_Room1_Room_RN')).toBe('Corridors Middle Left 1');
    expect(humanizeRoomKey('Captains_Quarters_Room_Room_RN')).toBe('Captains Quarters');
    expect(humanizeRoomKey('Corridor_Room_RN~2')).toBe('Corridor');
    expect(humanizeRoomKey('Room_RN')).toBe('Room_RN');
  });
});
