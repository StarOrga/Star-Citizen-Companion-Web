import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { fakeEngine, fxGroup, fxHit, setupFusionSearch } from './fusion-search.testing';

@Component({ selector: 'sc-scenario-page', template: '', standalone: true })
class PageStub {}

/**
 * B3.3 (note #5): every way out of the search either stays on the page (leaving,
 * clearing, picking a recent term) or is a deliberate open that lands on the fitting
 * subpage. Walked on Verse, Codex, HQ and Admin; the field's own code does not branch
 * on the page, only the context chips do, so the stay-put guarantees must hold on all.
 */
describe('FusionSearchComponent search scenarios (B3.3)', () => {
  const ships = fxGroup('ship', [fxHit('ship', 'AEGS_Reclaimer', 'Aegis Reclaimer'), fxHit('ship', 'AEGS_Redeemer', 'Aegis Redeemer')], 9);

  afterEach(() => (document.activeElement as HTMLElement | null)?.blur?.());

  async function setupOn(url: string, recent: string[] = ['idris']) {
    const engine = fakeEngine({ groups: [ships] });
    engine.recent.set(recent);
    const s = setupFusionSearch(engine);
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: '**', component: PageStub }]);
    await router.navigateByUrl(url);
    s.fixture.detectChanges();
    const nav = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    return { ...s, engine, router, nav, navigate, url };
  }

  /** Dispatch a click; the browser default is swallowed on window. Returns whether it was left to the browser. */
  function click(target: HTMLElement, init: MouseEventInit = {}): boolean {
    let left = false;
    const swallow = (ev: Event) => {
      left = !ev.defaultPrevented;
      ev.preventDefault();
    };
    window.addEventListener('click', swallow);
    target.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
    window.removeEventListener('click', swallow);
    return left;
  }

  for (const url of ['/verse', '/codex/index', '/hq/hangar', '/admin/feedback']) {
    describe(`on ${url}`, () => {
      it('recent term click: fills the field, stays on the page', async () => {
        const s = await setupOn(url);
        s.field.click();
        s.fixture.detectChanges();
        click(s.el.querySelector('a.term') as HTMLElement);
        s.fixture.detectChanges();
        expect(s.engine.input()).toBe('idris');
        expect(s.nav).not.toHaveBeenCalled();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.router.url).toBe(url);
      });

      it('Enter on the active recent term: searches it, stays on the page', async () => {
        const s = await setupOn(url);
        s.field.click();
        s.fixture.detectChanges();
        s.key('ArrowDown');
        s.key('Enter');
        expect(s.engine.input()).toBe('idris');
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.router.url).toBe(url);
      });

      it('Escape: closes, keeps the page', async () => {
        const s = await setupOn(url);
        s.field.click();
        s.fixture.detectChanges();
        s.key('Escape');
        expect(s.cmp.open()).toBeFalse();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.router.url).toBe(url);
      });

      it('click outside: closes, keeps the page', async () => {
        const s = await setupOn(url);
        s.field.click();
        s.fixture.detectChanges();
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(s.cmp.open()).toBeFalse();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.router.url).toBe(url);
      });

      it('clear (the X): empties the text, stays open and on the page', async () => {
        const s = await setupOn(url);
        s.type('aegis');
        click(s.el.querySelector('button.clear') as HTMLElement);
        s.fixture.detectChanges();
        expect(s.engine.input()).toBe('');
        expect(s.cmp.open()).toBeTrue();
        expect(s.navigate).not.toHaveBeenCalled();
        expect(s.router.url).toBe(url);
      });
    });
  }

  describe('deliberate opens', () => {
    it('result row: a real anchor to the detail page, closes the panel on a plain click', async () => {
      const s = await setupOn('/verse');
      s.type('aegis re');
      const a = s.el.querySelector('.group .row a.hit') as HTMLAnchorElement;
      expect(a.getAttribute('href')).toContain('/codex/ship/');
      click(a);
      s.fixture.detectChanges();
      expect(s.cmp.open()).toBeFalse();
    });

    it('"all in index": a real anchor to the Codex index with the term', async () => {
      const s = await setupOn('/hq/hangar');
      s.type('aegis re');
      const more = s.el.querySelector('a.more') as HTMLAnchorElement;
      expect(more.getAttribute('href')).toContain('/codex/index');
    });

    it('Enter on typed text without an option off the Codex: opens the index results page', async () => {
      const s = await setupOn('/verse');
      s.engine.groups.set([]);
      s.type('zzz');
      s.key('Enter');
      expect(s.navigate).toHaveBeenCalled();
      expect((s.navigate.calls.mostRecent().args[0] as string[])[0]).toBe('/codex/index');
    });

    it('new-tab click on a result row is left to the browser: no in-app navigation, panel stays', async () => {
      const s = await setupOn('/verse');
      s.type('aegis re');
      const left = click(s.el.querySelector('.group .row a.hit') as HTMLElement, { ctrlKey: true });
      expect(left).toBeTrue();
      expect(s.navigate).not.toHaveBeenCalled();
      expect(s.nav).not.toHaveBeenCalled();
      expect(s.cmp.open()).toBeTrue();
    });
  });
});
