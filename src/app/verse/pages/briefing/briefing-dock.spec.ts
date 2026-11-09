import { NgZone } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { wireHqPageScroll } from '../../../hq/hq-page-scroll';
import { dockEase, dockProgress, dockState, glideTarget, labelMove, planetMove, snapStepTarget, wireSnap } from './briefing-dock';

describe('snapStepTarget (a wheel step that mandatory snapping would bounce)', () => {
  // Codex: stage at 16, the tall overview from 900 (2400 px), the footer end at 3300; viewport 900.
  const ps = [16, 900, 3300];
  it('steps from the stage down to the lower part instead of snapping back', () => {
    expect(snapStepTarget(16, 1, ps, 900)).toBe(900);
    expect(snapStepTarget(116, 1, ps, 900)).toBe(900);
  });
  it('scrolls natively inside an area taller than the viewport', () => {
    expect(snapStepTarget(900, 1, ps, 900)).toBeNull();
    expect(snapStepTarget(1500, -1, ps, 900)).toBeNull();
  });
  it('steps from the lower part start back up to the stage', () => {
    expect(snapStepTarget(900, -1, ps, 900)).toBe(16);
    expect(snapStepTarget(500, -1, ps, 900)).toBe(16);
  });
  it('leaves the ends to the browser', () => {
    expect(snapStepTarget(16, -1, ps, 900)).toBeNull();
    expect(snapStepTarget(3300, 1, ps, 900)).toBeNull();
    expect(snapStepTarget(16, 1, [16], 900)).toBeNull();
  });
  it('steps through viewport-high sections one by one (HQ)', () => {
    const hq = [0, 900, 1800];
    expect(snapStepTarget(0, 1, hq, 900)).toBe(900);
    expect(snapStepTarget(900, 1, hq, 900)).toBe(1800);
    expect(snapStepTarget(1800, -1, hq, 900)).toBe(900);
  });
});

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

  it('glides to the end in the direction of the gesture, never half way', () => {
    expect(glideTarget(0, 800, 1)).toBe(800);
    expect(glideTarget(300, 800, -1)).toBe(0);
    expect(glideTarget(800, 800, 1)).toBeNull();
    expect(glideTarget(0, 800, -1)).toBeNull();
    expect(glideTarget(0, 0, 1)).toBeNull();
  });

  it('makes the stage and the lower part native scroll-snap areas and releases them again', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const release = wireSnap(() => [a, b]);
    const wide = matchMedia('(min-width: 901px)').matches;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (wide && !reduce) {
      expect(document.documentElement.style.scrollSnapType).toContain('y');
      expect(a.style.scrollSnapAlign).toContain('start');
      expect(b.style.scrollSnapAlign).toContain('start');
    } else {
      expect(document.documentElement.style.scrollSnapType).toBe('');
    }
    release();
    expect(document.documentElement.style.scrollSnapType).toBe('');
    expect(a.style.scrollSnapAlign).toBe('');
  });

  it('does not snap a page with fewer than two areas', () => {
    const release = wireSnap(() => [document.createElement('div'), null]);
    expect(document.documentElement.style.scrollSnapType).toBe('');
    release();
  });

  it('snaps every HQ page and the footer end, with the late re-checks outside the zone', () => {
    const zone = TestBed.inject(NgZone);
    const pages = [document.createElement('section'), document.createElement('section'), document.createElement('section')];
    const footer = document.createElement('sc-footer');
    document.body.append(footer);
    const release = zone.run(() => wireHqPageScroll(() => pages, zone));
    expect(zone.hasPendingMacrotasks, 'no timer keeps the app busy').toBe(false);
    if (matchMedia('(min-width: 1024px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      expect(pages.every((p) => p.style.scrollSnapAlign.includes('start'))).toBe(true);
      expect(footer.style.scrollSnapAlign).toContain('end');
      expect(document.documentElement.style.scrollSnapType).toContain('mandatory');
    }
    release();
    expect(document.documentElement.style.scrollSnapType).toBe('');
    expect(footer.style.scrollSnapAlign).toBe('');
    footer.remove();
  });
});
