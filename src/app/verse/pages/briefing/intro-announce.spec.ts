import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HERO_INTRO_HOLD_MAX_MS, ShellChromeService } from '../../../shell/fusion-bar/shell-chrome.service';
import { DocumentEntry, INTRO_FLAG, claimIntro, peekIntro, resetIntroDocument } from './briefing.model';

/**
 * The cinematic entrance belongs to a direct call of the bare domain, once per tab (concept
 * "Kamera-Welt", E1). The shell announces it at boot: it has to know the answer `claimIntro`
 * will give, without taking it.
 */
describe('Verse entrance announcement', () => {
  const store = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  const bare: () => DocumentEntry = () => ({ bare: true, revisit: false });
  const deep: () => DocumentEntry = () => ({ bare: false, revisit: false });
  const reload: () => DocumentEntry = () => ({ bare: true, revisit: true });
  beforeEach(() => resetIntroDocument());

  it('peeks the same answer the claim then gives, without claiming', () => {
    const s = store();
    expect(peekIntro(s, bare)).toBe('full');
    expect(peekIntro(s, bare), 'peeking claims nothing').toBe('full');
    expect(claimIntro(s, bare)).toBe('full');
    expect(peekIntro(s, bare)).toBe('short');
    expect(claimIntro(s, bare)).toBe('short');
    expect(s.getItem(INTRO_FLAG)).toBe('1');
  });

  it('only the bare domain plays it: a call with a path (or a reload) builds the short way and claims nothing', () => {
    const s = store();
    expect(claimIntro(s, deep)).toBe('short');
    expect(peekIntro(s, deep)).toBe('short');
    expect(claimIntro(s, reload)).toBe('short');
    expect(s.getItem(INTRO_FLAG), 'nothing claimed').toBeNull();
    expect(claimIntro(s, bare), 'the bare call is still the first').toBe('full');
  });

  it('once per tab: a second bare call in the same tab is short', () => {
    const s = store();
    expect(claimIntro(s, bare)).toBe('full');
    expect(claimIntro(s, bare)).toBe('short');
  });

  it('survives blocked storage: the document remembers it', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(claimIntro(null, bare)).toBe('full');
    expect(peekIntro(null, bare)).toBe('short');
    expect(claimIntro(broken, bare), 'same document').toBe('short');
    resetIntroDocument();
    expect(claimIntro(broken, bare), 'fresh document').toBe('full');
  });
});

describe('Entrance hold in the shell chrome', () => {
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
