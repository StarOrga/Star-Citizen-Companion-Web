import { TestBed } from '@angular/core/testing';
import { BriefingAsteroidComponent, asteroidPath, inAsteroidZone } from './briefing-asteroid.component';

describe('briefing asteroid', () => {
  const stage = { top: 100, height: 600 } as DOMRect;

  it('hits only the sky patch left of the hero', () => {
    expect(inAsteroidZone(240, 100 + 600 * 0.25, 1300, stage)).toBeTrue();
    expect(inAsteroidZone(650, 100 + 600 * 0.25, 1300, stage)).toBeFalse();
    expect(inAsteroidZone(240, 100 + 600 * 0.6, 1300, stage)).toBeFalse();
  });

  it('starts and ends off screen and passes just above the rim at the centre', () => {
    const { d, mid } = asteroidPath(1300, 750, 520, 200);
    const [x0, y0, cx, cy, x2, y2] = d.match(/-?\d+/g)!.map(Number);
    expect(x0).toBeGreaterThan(1300);
    expect(x2).toBeLessThan(0);
    // The curve's midpoint (t = 0.5) sits above the rim by more than half the rock.
    const my = 0.25 * y0 + 0.5 * cy + 0.25 * y2;
    const mx = 0.25 * x0 + 0.5 * cx + 0.25 * x2;
    expect(mx).toBeCloseTo(650, -1);
    expect(520 - my).toBeGreaterThan(100);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('launches once per double tap and never under reduced motion', () => {
    const fixture = TestBed.createComponent(BriefingAsteroidComponent);
    const egg = fixture.componentInstance;
    egg.reducedMotion = () => true;
    egg.launch();
    expect(egg.path()).toBeNull();

    egg.reducedMotion = () => false;
    // The real stage sits in the shell's <main tabindex="-1">: that frame must not count as a control.
    const frame = document.createElement('main');
    frame.tabIndex = -1;
    const el = frame.appendChild(document.createElement('div'));
    spyOn(el, 'getBoundingClientRect').and.returnValue({ top: 0, height: window.innerHeight } as DOMRect);
    const tap = (t: number): void =>
      egg.tap({ button: 0, timeStamp: t, clientX: window.innerWidth * 0.18, clientY: window.innerHeight * 0.25, target: el } as unknown as PointerEvent, el);
    tap(1000);
    expect(egg.path()).toBeNull();
    tap(1200);
    expect(egg.path()).not.toBeNull();
  });
});
