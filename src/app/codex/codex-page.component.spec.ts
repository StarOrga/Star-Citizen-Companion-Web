import { routes } from '../app.routes';
import { CODEX_MORE_URL, CODEX_TOP_URL, codexPartUrl } from './codex-page.component';
import { lowerStart, partState, partTarget } from '../shared/page-glide';

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

  it('the address bar names the part, filters ride along', () => {
    expect(codexPartUrl('more', '?kind=ship&mfr=AEGS')).toBe(`${CODEX_MORE_URL}?kind=ship&mfr=AEGS`);
    expect(codexPartUrl('top', '?kind=ship')).toBe(`${CODEX_TOP_URL}?kind=ship`);
    expect(codexPartUrl('top', '')).toBe('/codex');
  });

  it('/codex and /codex/index (the old overview URL) are one page: the old links land on the lower part', () => {
    const find = (path: string): { data?: Record<string, unknown> } | undefined => {
      const walk = (rs: readonly { path?: string; data?: Record<string, unknown>; children?: unknown[] }[]): typeof rs[number] | undefined => {
        for (const r of rs) {
          if (r.path === path) return r;
          const hit = r.children ? walk(r.children as typeof rs) : undefined;
          if (hit) return hit;
        }
        return undefined;
      };
      return walk(routes as never);
    };
    const top = find('codex');
    const more = find('codex/index');
    expect(top?.data?.['codexPart']).toBe('top');
    expect(more?.data?.['codexPart']).toBe('more');
    expect(top?.data?.['layout']).toBe('cinematic');
    expect(more?.data?.['layout']).toBe('cinematic');
  });
});
