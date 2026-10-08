import {
  LEADER_HULL_MAX,
  LEADER_LABEL_H,
  LEADER_SLOT_GAP,
  LeaderFrame,
  LeaderLayout,
  LeaderPinInput,
  LeaderRect,
  layoutLeaderLabels,
} from './codex-holo-leader';
import { HoloAnchorFixture, JAVELIN_ANCHORS, NOMAD_ANCHORS, leaderPins } from '../testing/holo-anchors.fixture';

/** The Holotable's projection surface (`.silhouette-frame`) as measured on the
 * Nomad's Holodeck with both rails open (Chrome, 2026-10-08): 1440px and
 * 1180px viewports, and a 390px phone. */
const FRAME_1440: LeaderFrame = { width: 582, height: 480 };
const FRAME_1180: LeaderFrame = { width: 552, height: 480 };
const FRAME_PHONE: LeaderFrame = { width: 366, height: 360 };

/** The frame plus the outline extent the table reads off the silhouette bbox. */
const withHull = (f: LeaderFrame, fx: HoloAnchorFixture): LeaderFrame => {
  const b = fx.silhouette.bbox;
  return { ...f, hullSpan: { x0: b.x / 10, x1: (b.x + b.w) / 10 } };
};

const overlaps = (a: LeaderRect, b: LeaderRect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function expectCleanLayout(lay: LeaderLayout, frame: LeaderFrame, n: number): void {
  expect(lay.labels.length).toBe(n);
  for (let i = 0; i < lay.labels.length; i++) {
    const r = lay.labels[i].rect;
    for (let j = i + 1; j < lay.labels.length; j++) {
      expect(overlaps(r, lay.labels[j].rect))
        .withContext(`${lay.labels[i].portName} × ${lay.labels[j].portName}`)
        .toBeFalse();
    }
    expect(overlaps(r, lay.body)).withContext(`${lay.labels[i].portName} × hull outline`).toBeFalse();
    for (const l of lay.labels) {
      const inside = l.dot.x >= r.x && l.dot.x <= r.x + r.w && l.dot.y >= r.y && l.dot.y <= r.y + r.h;
      expect(inside).withContext(`dot ${l.portName} under label ${lay.labels[i].portName}`).toBeFalse();
    }
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(frame.width);
    expect(r.y + r.h).toBeLessThanOrEqual(frame.height);
  }
  // Within a column the labels keep their dots' top-to-bottom order, so two
  // leaders' horizontal runs never cross.
  for (const side of ['left', 'right'] as const) {
    const col = lay.labels.filter((l) => l.side === side).sort((a, b) => a.rect.y - b.rect.y);
    for (let i = 1; i < col.length; i++) expect(col[i].dot.y).toBeGreaterThanOrEqual(col[i - 1].dot.y);
  }
}

describe('layoutLeaderLabels', () => {
  it('uses the real fixtures: 96 Nomad anchors for 17 pins, every Javelin pin counted', () => {
    expect(NOMAD_ANCHORS.silhouette.anchors.length).toBe(96);
    expect(NOMAD_ANCHORS.pins.length).toBe(17);
    expect(JAVELIN_ANCHORS.pins.length).toBe(47);
  });

  for (const [name, frame] of [['1440', FRAME_1440], ['1180', FRAME_1180]] as const) {
    it(`labels all 17 Nomad pins without a single overlap at ${name}px`, () => {
      const lay = layoutLeaderLabels(leaderPins(NOMAD_ANCHORS), withHull(frame, NOMAD_ANCHORS));
      expect(lay).not.toBeNull();
      expectCleanLayout(lay!, frame, 17);
    });
  }

  it('puts each Nomad dot on its anchor and joins it to its label', () => {
    const pins = leaderPins(NOMAD_ANCHORS);
    const lay = layoutLeaderLabels(pins, withHull(FRAME_1440, NOMAD_ANCHORS))!;
    for (const l of lay.labels) {
      const p = pins.find((q) => q.portName === l.portName)!;
      expect(l.dot.x).toBeCloseTo(lay.hull.x + (p.x / 100) * lay.hull.w, 0);
      expect(l.dot.y).toBeCloseTo(lay.hull.y + (p.y / 100) * lay.hull.h, 0);
      expect(l.path.startsWith(`M${l.dot.x} ${l.dot.y}`)).toBeTrue();
      const edge = l.side === 'left' ? l.rect.x + l.rect.w : l.rect.x;
      expect(l.path.endsWith(`L${edge} ${l.rect.y + l.rect.h / 2}`)).toBeTrue();
    }
  });

  it('keeps left-half dots in the left column and right-half dots in the right one', () => {
    const lay = layoutLeaderLabels(leaderPins(NOMAD_ANCHORS), withHull(FRAME_1440, NOMAD_ANCHORS))!;
    const byName = new Map(lay.labels.map((l) => [l.portName, l.side]));
    expect(byName.get('hardpoint_weapon_top_left')).toBe('left');
    expect(byName.get('hardpoint_weapon_top_right')).toBe('right');
    expect(byName.get('hardpoint_cooler_left')).toBe('left');
    expect(byName.get('hardpoint_cooler_right')).toBe('right');
  });

  it('degrades the Javelin (47 pins) to the key at every width — more pins than column slots', () => {
    const pins = leaderPins(JAVELIN_ANCHORS);
    expect(layoutLeaderLabels(pins, withHull(FRAME_1440, JAVELIN_ANCHORS))).toBeNull();
    expect(layoutLeaderLabels(pins, withHull(FRAME_1180, JAVELIN_ANCHORS))).toBeNull();
    // Even the largest table: 2 columns × floor((560 + 4) / 26) = 42 slots.
    const max = 2 * Math.floor((LEADER_HULL_MAX + LEADER_SLOT_GAP) / (LEADER_LABEL_H + LEADER_SLOT_GAP));
    expect(max).toBe(42);
    expect(max).toBeLessThan(47);
    expect(layoutLeaderLabels(pins, { width: 2400, height: 1400 })).toBeNull();
  });

  it('keeps the key on a phone: a 390px frame cannot hold the hull and two columns', () => {
    expect(layoutLeaderLabels(leaderPins(NOMAD_ANCHORS), withHull(FRAME_PHONE, NOMAD_ANCHORS))).toBeNull();
  });

  it('holds fewer labels per column on a touch pointer (48px tap targets)', () => {
    const fine = layoutLeaderLabels(leaderPins(NOMAD_ANCHORS), withHull(FRAME_1440, NOMAD_ANCHORS))!;
    const coarse = layoutLeaderLabels(leaderPins(NOMAD_ANCHORS).slice(0, 8), { ...withHull(FRAME_1440, NOMAD_ANCHORS), coarse: true })!;
    expect(coarse.slotsPerColumn).toBeLessThan(fine.slotsPerColumn);
    expectCleanLayout(coarse, FRAME_1440, 8);
    expect(coarse.labels.every((l) => l.rect.h === 48)).toBeTrue();
  });

  it('returns null for no pins and for an unmeasured frame', () => {
    expect(layoutLeaderLabels([], FRAME_1440)).toBeNull();
    expect(layoutLeaderLabels(leaderPins(NOMAD_ANCHORS), { width: 0, height: 0 })).toBeNull();
  });

  it('hands centre-line and surplus dots to the other column instead of overflowing one', () => {
    // 20 dots all on the left half: one column holds fewer, the rest cross over.
    const pins: LeaderPinInput[] = Array.from({ length: 20 }, (_, i) => ({ portName: `p${i}`, index: i + 1, x: 10 + i, y: 5 + i * 4.5 }));
    const lay = layoutLeaderLabels(pins, withHull(FRAME_1440, NOMAD_ANCHORS))!;
    expect(lay).not.toBeNull();
    expectCleanLayout(lay, FRAME_1440, 20);
    expect(lay.labels.filter((l) => l.side === 'left').length).toBe(lay.slotsPerColumn);
  });
});
