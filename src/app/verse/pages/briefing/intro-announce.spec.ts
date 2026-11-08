import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HERO_INTRO_HOLD_MAX_MS, ShellChromeService } from '../../../shell/fusion-bar/shell-chrome.service';
import { INTRO_FLAG, claimIntro, peekIntro, resetIntroDocument } from './briefing.model';

/**
 * The shell announces the hub's full entrance at boot (owner brief 2026-11-04):
 * it has to know the answer `claimIntro` will give, without taking it.
 */
describe('Verse entrance announcement', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  beforeEach(() => resetIntroDocument());

  const noon = (d: number) => () => new Date(2026, 10, d, 12, 0, 0);

  it('peeks the same answer the claim then gives, without claiming', () => {
    const s = store();
    expect(peekIntro(s, noon(5))).toBe('full');
    expect(peekIntro(s, noon(5)), 'peeking claims nothing').toBe('full');
    expect(claimIntro(s, noon(5))).toBe('full');
    expect(peekIntro(s, noon(5))).toBe('short');
    expect(claimIntro(s, noon(5))).toBe('short');
  });

  it('a reload or new tab on the same day is short, the next local day is full again', () => {
    const s = store();
    expect(claimIntro(s, noon(5))).toBe('full');
    resetIntroDocument();
    expect(peekIntro(s, noon(5)), 'reload / new tab').toBe('short');
    expect(claimIntro(s, noon(5))).toBe('short');
    expect(peekIntro(s, noon(6))).toBe('full');
    expect(claimIntro(s, noon(6))).toBe('full');
    expect(s.getItem(INTRO_FLAG)).toBe('2026-11-06');
  });

  it('counts the local calendar day: 23:59 and 00:01 are different days', () => {
    const s = store();
    expect(claimIntro(s, () => new Date(2026, 10, 5, 23, 59))).toBe('full');
    expect(claimIntro(s, () => new Date(2026, 10, 5, 23, 59))).toBe('short');
    expect(claimIntro(s, () => new Date(2026, 10, 6, 0, 1))).toBe('full');
  });

  it('without usable storage the day is remembered for this document only', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => undefined };
    expect(claimIntro(null, noon(5))).toBe('full');
    expect(peekIntro(null, noon(5))).toBe('short');
    expect(claimIntro(broken, noon(5)), 'same document, same day').toBe('short');
    resetIntroDocument();
    expect(claimIntro(broken, noon(5)), 'fresh document').toBe('full');
  });

  it('holds the chrome until the hub starts the entrance, and drops a hold nobody took over', fakeAsync(() => {
    const chrome = TestBed.inject(ShellChromeService);
    chrome.holdHeroIntro();
    expect(chrome.heroIntro()).toEqual({ k: 1, full: true, hold: true });
    chrome.startHeroIntro(1, true);
    tick(HERO_INTRO_HOLD_MAX_MS);
    expect(chrome.heroIntro(), 'a started entrance is not dropped').toEqual({ k: 1, full: true });

    chrome.endHeroIntro();
    chrome.holdHeroIntro();
    tick(HERO_INTRO_HOLD_MAX_MS);
    expect(chrome.heroIntro(), 'no hub took it over').toBeNull();
  }));
});
