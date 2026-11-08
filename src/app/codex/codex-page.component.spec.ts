import { routes } from '../app.routes';
import { Router, UrlTree } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { CODEX_MORE_ANCHOR, CODEX_TOP_URL, codexPartUrl } from './codex-page.component';
import { holdOnLower, lowerStart, partState, partTarget } from '../shared/page-glide';

describe('Codex page: "Mehr in Codex" (scroll handoff like "Mehr im Verse")', () => {
  it('partState: top at the stage, docked from the lower part on, fly in between', () => {
    expect(partState(0, 1000)).toBe('top');
    expect(partState(400, 1000)).toBe('fly');
    expect(partState(999, 1000)).toBe('docked');
    expect(partState(1800, 1000)).toBe('docked');
    expect(partState(500, 0)).toBe('top');
  });

  it('a gesture down on the stage glides to the lower part, then the page scrolls on its own', () => {
    expect(partTarget(0, 1000, 1)).toBe(1000);
    expect(partTarget(600, 1000, 1)).toBe(1000);
    expect(partTarget(1000, 1000, 1)).toBeNull();
    expect(partTarget(1500, 1000, 1)).toBeNull();
  });

  it('a gesture up glides back to the stage only from the start of the lower part', () => {
    expect(partTarget(1000, 1000, -1)).toBe(0);
    expect(partTarget(600, 1000, -1)).toBe(0);
    expect(partTarget(1400, 1000, -1)).toBeNull();
    expect(partTarget(0, 1000, -1)).toBeNull();
    expect(partTarget(10, 0, 1)).toBeNull();
  });

  it('lowerStart reads the lower part against the docked header margin', () => {
    const el = document.createElement('section');
    el.style.cssText = 'position:absolute;top:900px;left:0;width:10px;height:10px;scroll-margin-top:72px;';
    document.body.appendChild(el);
    expect(lowerStart(el, 0)).toBe(828);
    el.remove();
  });

  it('the address bar stays on /codex: the lower part is the anchor #more, filters ride along (#319)', () => {
    expect(codexPartUrl('more', '?kind=ship&mfr=AEGS')).toBe('/codex?kind=ship&mfr=AEGS#more');
    expect(codexPartUrl('more', '')).toBe('/codex#more');
    expect(codexPartUrl('top', '?kind=ship')).toBe(`${CODEX_TOP_URL}?kind=ship`);
    expect(codexPartUrl('top', '')).toBe('/codex');
    expect(codexPartUrl('more', '?kind=ship')).not.toContain('/codex/index');
  });

  it('the old /codex/index links redirect to /codex#more and keep their filters', () => {
    interface R { path?: string; data?: Record<string, unknown>; children?: unknown[]; redirectTo?: unknown }
    const walk = (rs: readonly R[], path: string): R | undefined => {
      for (const r of rs) {
        if (r.path === path) return r;
        const hit = r.children ? walk(r.children as R[], path) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    const top = walk(routes as never, 'codex');
    const more = walk(routes as never, 'codex/index');
    expect(top?.data?.['layout']).toBe('cinematic');
    expect(typeof more?.redirectTo).toBe('function');
    const tree = TestBed.runInInjectionContext(() =>
      (more!.redirectTo as (d: { queryParams: Record<string, string> }) => UrlTree)({ queryParams: { kind: 'weapon', q: 'p4' } }),
    );
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/codex?kind=weapon&q=p4#' + CODEX_MORE_ANCHOR);
  });

  describe('a deep link to the lower part (holdOnLower)', () => {
    let page: HTMLElement;
    let lower: HTMLElement;
    beforeEach(() => {
      page = document.createElement('div');
      page.style.cssText = 'position:relative;overflow-anchor:none;';
      page.innerHTML = '<div style="height:1200px"></div><section style="height:3000px"></section>';
      document.body.appendChild(page);
      lower = page.querySelector('section')!;
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    afterEach(() => {
      page.remove();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    const frames = (n = 3): Promise<void> =>
      new Promise((r) => {
        const step = (): void => (n-- <= 0 ? r() : void requestAnimationFrame(step));
        step();
      });
    const jumper = { jumpToLower: () => window.scrollTo({ top: lowerStart(lower), behavior: 'instant' }) };

    it('lands on the lower part, and a scroll up after it is not pulled back down', async () => {
      const done = jasmine.createSpy('done');
      const stop = holdOnLower(jumper, () => lowerStart(lower), done);
      expect(Math.abs(window.scrollY - lowerStart(lower))).toBeLessThanOrEqual(2);
      // The reader scrolls up (scrollbar: no wheel or key event).
      window.scrollTo({ top: 0, behavior: 'instant' });
      await frames();
      expect(done).toHaveBeenCalledTimes(1);
      // The page grows on afterwards (late data): the hold is over, nothing re-lands.
      page.insertAdjacentHTML('beforeend', '<div style="height:800px"></div>');
      (page.firstElementChild as HTMLElement).style.height = '1400px';
      await frames(4);
      expect(window.scrollY).toBe(0);
      stop();
      expect(done).toHaveBeenCalledTimes(1);
    });

    it('a wheel turn ends the hold before it can re-land', async () => {
      const done = jasmine.createSpy('done');
      const stop = holdOnLower(jumper, () => lowerStart(lower), done);
      window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      expect(done).toHaveBeenCalledTimes(1);
      window.scrollTo({ top: 0, behavior: 'instant' });
      (page.firstElementChild as HTMLElement).style.height = '1500px';
      await frames(4);
      expect(window.scrollY).toBe(0);
      stop();
    });

    it('re-lands while the page still grows and the reader has not moved', async () => {
      const stop = holdOnLower(jumper, () => lowerStart(lower), () => undefined);
      (page.firstElementChild as HTMLElement).style.height = '1600px';
      await frames(4);
      expect(Math.abs(window.scrollY - lowerStart(lower))).toBeLessThanOrEqual(2);
      stop();
    });
  });
});
