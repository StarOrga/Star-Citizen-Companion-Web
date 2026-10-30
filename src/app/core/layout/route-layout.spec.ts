import { Route, Routes } from '@angular/router';
import { routes } from '../../app.routes';
import { layoutOfData } from './page-layout';

interface Leaf {
  readonly url: string;
  readonly layout: string | null;
}

/** Every page route (no redirect, no children) with the url it is mounted at, lazy children included. */
async function leaves(list: Routes, prefix = ''): Promise<Leaf[]> {
  const out: Leaf[] = [];
  for (const r of list) {
    const url = [prefix, r.path].filter(Boolean).join('/');
    if (r.redirectTo !== undefined) continue;
    let kids: Routes | undefined = r.children;
    if (!kids && r.loadChildren) {
      const loaded = await (r.loadChildren as () => Promise<Routes>)();
      kids = Array.isArray(loaded) ? loaded : undefined;
    }
    if (kids) {
      // A parent that declares a layout covers children without their own.
      const inherited = layoutOfData(r.data);
      for (const leaf of await leaves(kids, url)) {
        out.push({ url: leaf.url, layout: leaf.layout ?? inherited });
      }
    } else if (r.path !== '**') {
      out.push({ url: '/' + url, layout: layoutOfData((r as Route).data) });
    }
  }
  return out;
}

describe('route layout coverage (data.layout)', () => {
  let all: Leaf[];

  beforeAll(async () => {
    all = await leaves(routes);
  });

  it('finds the page routes', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('declares a layout on every page route', () => {
    expect(all.filter((l) => !l.layout).map((l) => l.url)).toEqual([]);
  });

  it('follows the confirmed page-type mapping for the landmarks', () => {
    const byUrl = new Map(all.map((l) => [l.url, l.layout]));
    expect(byUrl.get('/login')).toBe('cinematic');
    expect(byUrl.get('/verse')).toBe('cinematic');
    expect(byUrl.get('/verse/explorer')).toBe('cinematic');
    expect(byUrl.get('/codex')).toBe('cinematic');
    expect(byUrl.get('/codex/index')).toBe('tool');
    expect(byUrl.get('/codex/:kind/:className')).toBe('content');
    expect(byUrl.get('/hq/hangar')).toBe('tool');
    expect(byUrl.get('/hq/hangar/:id')).toBe('content');
    expect(byUrl.get('/settings')).toBe('content');
    expect(byUrl.get('/legal/privacy')).toBe('plain');
    expect(byUrl.get('/admin/telemetry')).toBe('content');
  });
});
