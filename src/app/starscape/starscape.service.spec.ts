import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { StarscapeService, VISIBLE_VARIANT_ROLES } from './starscape.service';

/** Everything one PostgREST call did, so a test can assert on the query itself. */
interface RecordedQuery {
  select: string;
  filters: { op: string; column: string; value: unknown }[];
  orders: { column: string; ascending: boolean }[];
  range: [number, number] | null;
}

/**
 * A chainable, awaitable stand-in for a PostgREST query builder that also
 * records what was asked for.
 */
function builder(
  resolve: (call: RecordedQuery) => unknown,
  log: RecordedQuery[],
): Record<string, unknown> {
  const call: RecordedQuery = { select: '', filters: [], orders: [], range: null };
  log.push(call);
  const result = () => Promise.resolve(resolve(call));
  const obj: Record<string, unknown> = {};
  obj['select'] = (columns: string) => {
    call.select = columns;
    return obj;
  };
  obj['in'] = (column: string, value: unknown) => {
    call.filters.push({ op: 'in', column, value });
    return obj;
  };
  obj['eq'] = (column: string, value: unknown) => {
    call.filters.push({ op: 'eq', column, value });
    return obj;
  };
  obj['not'] = (column: string, op: string, value: unknown) => {
    call.filters.push({ op: `not.${op}`, column, value });
    return obj;
  };
  obj['order'] = (column: string, opts?: { ascending?: boolean }) => {
    call.orders.push({ column, ascending: opts?.ascending !== false });
    return obj;
  };
  obj['range'] = (from: number, to: number) => {
    call.range = [from, to];
    return obj;
  };
  obj['limit'] = () => obj;
  obj['maybeSingle'] = () => result();
  obj['abortSignal'] = () => result();
  obj['then'] = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
    result().then(ok, fail);
  return obj;
}

const ROW = {
  image_id: 'abc123',
  source_url: 'https://media.robertsspaceindustries.com/abc123/source.jpg',
  preview_url: 'https://media.robertsspaceindustries.com/abc123/cover.jpg',
  title: 'Frontier Tensions',
  series: 'Release Info',
  article_url: 'https://robertsspaceindustries.com/comm-link/1',
  published_at: '2026-07-01T00:00:00Z',
};

describe('StarscapeService', () => {
  let queries: RecordedQuery[];

  /**
   * `resolve` sees the recorded query, so a test can answer differently per
   * call — which is how the deploy-order retry is exercised without guessing
   * the order the service happens to fire its requests in.
   */
  function make(
    resolve: (call: RecordedQuery) => unknown = () => ({ data: [ROW], error: null, count: 1 }),
  ): StarscapeService {
    queries = [];
    const client = { from: () => builder(resolve, queries) };
    TestBed.configureTestingModule({
      providers: [{ provide: SupabaseClientProvider, useValue: { client } }],
    });
    return TestBed.inject(StarscapeService);
  }

  it('lists only the visible variant roles, so one artwork is one tile', async () => {
    // RSI republishes one render as a 21:9, a 16:9 and a HUD-framed banner under
    // separate CDN ids. fetch-verse-news groups them; the grid must ask for the
    // representative only, or the duplicates are back.
    const svc = make();
    await svc.load(true);
    const page = queries.find((q) => q.range !== null);
    expect(page).toBeTruthy();
    expect(page!.filters).toContain({
      op: 'in',
      column: 'variant_role',
      value: VISIBLE_VARIANT_ROLES,
    });
  });

  it('orders the page deterministically, not by published_at alone', async () => {
    // One comm-link contributes several rows sharing a published_at to the
    // second. Without a tiebreaker, `range()` paging can serve the same row on
    // two pages and skip another — a duplicate tile with no duplicate row.
    const svc = make();
    await svc.load(true);
    const page = queries.find((q) => q.range !== null);
    expect(page!.orders.map((o) => o.column)).toEqual(['published_at', 'image_id']);
    expect(page!.orders.every((o) => !o.ascending)).toBeTrue();
  });

  it('keeps the series probe on the same visibility rule as the grid', async () => {
    const svc = make();
    await svc.load(true);
    const probe = queries.find((q) => q.select === 'series');
    expect(probe).toBeTruthy();
    expect(probe!.filters.some((f) => f.column === 'variant_role')).toBeTrue();
  });

  it('resolves a shared image id regardless of its variant role', async () => {
    // A `?image=<id>` link shared before its row became a hidden crop variant
    // must still open the picture someone sent.
    const svc = make(() => ({ data: ROW, error: null }));
    const found = await svc.loadOne('abc123');
    expect(found?.imageId).toBe('abc123');
    const lookup = queries.find((q) => q.filters.some((f) => f.column === 'image_id'));
    expect(lookup!.filters.some((f) => f.column === 'variant_role')).toBeFalse();
  });

  it('still lists the gallery when the variant columns are not deployed yet', async () => {
    // The bundle goes live the moment Vercel finishes; the migration is applied
    // out of band. In that gap PostgREST answers 42703 — the gallery must fall
    // back to the unfiltered list, not show an error page.
    const svc = make((call) =>
      call.filters.some((f) => f.column === 'variant_role')
        ? { data: null, error: { code: '42703', message: 'column variant_role does not exist' } }
        : { data: [ROW], error: null, count: 1 },
    );
    await svc.load(true);
    expect(svc.error()).toBeNull();
    expect(svc.wallpapers().length).toBe(1);
    const pages = queries.filter((q) => q.range !== null);
    expect(pages.length).toBe(2); // filtered attempt, then the retry
    expect(pages[1].filters.some((f) => f.column === 'variant_role')).toBeFalse();
  });
});
