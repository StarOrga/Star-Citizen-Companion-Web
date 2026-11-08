import type { Mock } from 'vitest';
import { fakeAsync, tick } from '@angular/core/testing';
import { SPARKLE_COUNT, StarSparkle } from './star-sparkle';

describe('StarSparkle', () => {
  interface FakeAnim { pause: Mock; play: Mock; cancel: Mock; onfinish: (() => void) | null; oncancel: (() => void) | null }
  let host: HTMLElement, anims: FakeAnim[];
  const sparks = () => Array.from(host.querySelectorAll<HTMLElement>('.spark'));
  const LONGEST_GAP = 3000;

  beforeEach(() => {
    host = document.createElement('div');
    anims = [];
    vi.spyOn(Element.prototype, 'animate').mockImplementation(() => {
      const a: FakeAnim = { pause: vi.fn(), play: vi.fn(), cancel: vi.fn(), onfinish: null, oncancel: null };
      anims.push(a);
      return a as unknown as Animation;
    });
  });

  it('twinkles three stars at a time by default', fakeAsync(() => {
    const s = new StarSparkle(host);
    tick(LONGEST_GAP);
    expect(sparks().length).toBe(SPARKLE_COUNT);
    expect(SPARKLE_COUNT).toBe(3);
    s.stop();
  }));

  it('a finished star makes room for one at a new random spot, never a second one on top', fakeAsync(() => {
    const s = new StarSparkle(host, 1);
    tick(LONGEST_GAP);
    const first = sparks()[0].style.left + sparks()[0].style.top;
    tick(LONGEST_GAP);
    expect(sparks().length, 'still running: nothing new').toBe(1);
    anims[0].onfinish?.();
    expect(sparks().length, 'it goes away').toBe(0);
    tick(LONGEST_GAP);
    expect(sparks().length).toBe(1);
    expect(sparks()[0].style.left + sparks()[0].style.top).not.toBe(first);
    s.stop();
  }));

  it('stays inside the part of the sky the viewport shows', fakeAsync(() => {
    for (const r of [0, 0.999]) {
      const s = new StarSparkle(document.body.appendChild(host), 1, () => r);
      tick(LONGEST_GAP);
      const left = parseFloat(sparks()[0].style.left), top = parseFloat(sparks()[0].style.top);
      expect(left).toBeGreaterThanOrEqual(6);
      expect(left).toBeLessThanOrEqual(82);
      expect(top).toBeGreaterThanOrEqual(7);
      expect(top).toBeLessThanOrEqual(93);
      s.stop();
    }
    host.remove();
  }));

  it('pause holds the running stars and starts none; resume carries on', fakeAsync(() => {
    const s = new StarSparkle(host, 2);
    tick(LONGEST_GAP);
    s.pause();
    expect(anims.every((a) => vi.mocked(a.pause).mock.calls.length === 1)).toBe(true);
    anims[0].onfinish?.();
    tick(LONGEST_GAP);
    expect(sparks().length, 'nothing new while paused').toBe(1);
    s.resume();
    expect(anims[1].play).toHaveBeenCalled();
    tick(LONGEST_GAP);
    expect(sparks().length, 'back up to two').toBe(2);
    s.stop();
  }));

  it('stop removes everything and leaves no timer behind', fakeAsync(() => {
    const s = new StarSparkle(host);
    tick(100);
    s.stop();
    tick(LONGEST_GAP);
    expect(sparks().length).toBe(0);
  }));
});
