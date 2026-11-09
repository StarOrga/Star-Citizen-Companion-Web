import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { fakeEngine, setupFusionSearch } from './fusion-search.testing';

/** B3.2 / B3.4: a recent term fills the field and stays on the page (note #5). */
describe('FusionSearchComponent recent term click', () => {
  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  /** Click, swallowing the browser default on `window` so a leaked click cannot open a real tab/reload the test page. Returns whether it was left to the browser. */
  function click(target: HTMLElement, init: MouseEventInit = {}): boolean {
    let leftToBrowser = false;
    const swallow = (ev: Event) => {
      leftToBrowser = !ev.defaultPrevented;
      ev.preventDefault();
    };
    window.addEventListener('click', swallow);
    target.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
    window.removeEventListener('click', swallow);
    return leftToBrowser;
  }

  function setup() {
    const engine = fakeEngine();
    engine.recent.set(['idris', 'reclaimer']);
    const s = setupFusionSearch(engine);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    s.field.click();
    s.fixture.detectChanges();
    const term = s.el.querySelector('a.term') as HTMLAnchorElement;
    return { ...s, engine, nav, term };
  }

  it('a plain left click searches for the term and does not navigate (root cause: RouterLink ignores preventDefault)', () => {
    const { term, nav, engine, fixture, cmp } = setup();
    const left = click(term);
    fixture.detectChanges();
    expect(left, 'the anchor default is cancelled').toBe(false);
    expect(nav).not.toHaveBeenCalled();
    expect(engine.input()).toBe('idris');
    expect(cmp.open()).toBe(true);
  });

  it('keeps a real href so "open in new tab" works (B3.4)', () => {
    const { term } = setup();
    expect(term.getAttribute('href')).toBe('/x'); // the fake engine's href() for the term's target
  });

  for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }] as MouseEventInit[]) {
    it(`a modified click ${JSON.stringify(mod)} is left to the browser and does not fill the field (B3.4)`, () => {
      const { term, engine, fixture, nav } = setup();
      const left = click(term, mod);
      fixture.detectChanges();
      expect(left, 'left to the browser: opens a new tab').toBe(true);
      expect(nav).not.toHaveBeenCalled();
      expect(engine.input()).toBe('');
    });
  }
});
