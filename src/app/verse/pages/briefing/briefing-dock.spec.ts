import { dockEase, dockProgress, dockState, labelMove, planetMove } from './briefing-dock';

describe('briefing-dock', () => {
  it('maps the scroll range to 0…1 and the states', () => {
    expect(dockProgress(0, 800)).toBe(0);
    expect(dockProgress(400, 800)).toBe(0.5);
    expect(dockProgress(900, 800)).toBe(1);
    expect(dockProgress(50, 0)).toBe(0);
    expect(dockEase(0.5)).toBe(0.5);
    expect(dockState(0)).toBe('top');
    expect(dockState(0.4)).toBe('fly');
    expect(dockState(1)).toBe('docked');
  });

  it('lands the planet and its label exactly on the head', () => {
    const pl = { x: 100, y: 500, w: 80, h: 80 };
    const mini = { x: 140, y: 950, w: 24, h: 24 };
    const m = planetMove(pl, mini, 1);
    expect(m.tx).toBe(40);
    expect(m.ty).toBe(450);
    expect(m.k).toBeCloseTo(0.3, 6);

    const lab = { x: 110, y: 588, w: 60, h: 17 };
    const word = { x: 176, y: 953, w: 47, h: 18 };
    const l = labelMove(pl, lab, word, m, 1);
    // Screen top left of the label = planet TL + planet move + k · (label offset + own move).
    const x = pl.x + m.tx + m.k * (lab.x - pl.x + l.tx);
    const y = pl.y + m.ty + m.k * (lab.y - pl.y + l.ty);
    expect(x).toBeCloseTo(word.x, 6);
    expect(y).toBeCloseTo(word.y, 6);
    expect(m.k * l.k).toBeCloseTo(18 / 17, 6);
  });

  it('stays put at the top', () => {
    const pl = { x: 1, y: 2, w: 3, h: 3 };
    expect(planetMove(pl, { x: 9, y: 9, w: 1, h: 1 }, 0)).toEqual({ tx: 0, ty: 0, k: 1 });
  });
});
