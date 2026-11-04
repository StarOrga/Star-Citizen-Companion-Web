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

  it('peeks the same answer the claim then gives, without claiming', () => {
    const s = store();
    expect(peekIntro(s, () => false)).toBe('full');
    expect(peekIntro(s, () => false)).withContext('peeking claims nothing').toBe('full');
    expect(claimIntro(s, () => false)).toBe('full');
    expect(peekIntro(s, () => false)).toBe('short');
    expect(claimIntro(s, () => false)).toBe('short');
  });

  it('treats a reload as a first visit until the document claimed once', () => {
    const s = store();
    s.setItem(INTRO_FLAG, '1');
    expect(peekIntro(s, () => true)).toBe('full');
    expect(claimIntro(s, () => true)).toBe('full');
    expect(peekIntro(s, () => true)).withContext('the same document coming back').toBe('short');
  });

  it('holds the chrome until the hub starts the entrance, and drops a hold nobody took over', fakeAsync(() => {
    const chrome = TestBed.inject(ShellChromeService);
    chrome.holdHeroIntro();
    expect(chrome.heroIntro()).toEqual({ k: 1, full: true, hold: true });
    chrome.startHeroIntro(1, true);
    tick(HERO_INTRO_HOLD_MAX_MS);
    expect(chrome.heroIntro()).withContext('a started entrance is not dropped').toEqual({ k: 1, full: true });

    chrome.endHeroIntro();
    chrome.holdHeroIntro();
    tick(HERO_INTRO_HOLD_MAX_MS);
    expect(chrome.heroIntro()).withContext('no hub took it over').toBeNull();
  }));
});
