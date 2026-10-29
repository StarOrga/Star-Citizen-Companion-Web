import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { STARSCAPE_FILTERS, StarscapeService, VISIBLE_VARIANT_ROLES } from './starscape.service';

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
  let rpcCalls: { fn: string; args: Record<string, unknown> }[];
  let rpcResult: unknown;

  function make(
    resolve: (call: RecordedQuery) => unknown = () => ({ data: [ROW], error: null, count: 1 }),
  ): StarscapeService {
    queries = [];
    rpcCalls = [];
    rpcResult = { data: [{ ...ROW, votes: 3, voted: false, total_count: 30 }], error: null };
    const client = {
      from: () => builder(resolve, queries),
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { abortSignal: () => Promise.resolve(rpcResult) };
      },
    };
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

  it('offers exactly four stable views, All first', () => {
    expect(STARSCAPE_FILTERS.map((f) => f.id)).toEqual(['all', 'newest', 'top', 'mine']);
    expect(make().filter()).toBe('all');
  });

  it('no longer probes series: the table is read only for the page itself', async () => {
    const svc = make();
    await svc.load(true);
    expect(queries.some((q) => q.select === 'series')).toBeFalse();
    expect(queries.some((q) => q.filters.some((f) => f.op === 'eq' && f.column === 'series'))).toBeFalse();
  });

  it('serves Community Top / Newest / My votes through the paging RPC', async () => {
    const svc = make();
    await svc.setFilter('top');
    expect(rpcCalls).toEqual([
      { fn: 'starscape_gallery_page', args: { p_filter: 'top', p_limit: 24, p_offset: 0 } },
    ]);
    expect(svc.wallpapers().length).toBe(1);
    expect(svc.total()).toBe(30);
    expect(svc.hasMore()).toBeTrue();
    // Next page continues at the loaded count and appends.
    await svc.load();
    expect(rpcCalls[1].args['p_offset']).toBe(1);
    expect(svc.wallpapers().length).toBe(2);
  });

  it('reloads from the top and drops the old tiles when the view changes', async () => {
    const svc = make();
    await svc.load(true);
    expect(svc.wallpapers().length).toBe(1);
    rpcResult = { data: [], error: null };
    await svc.setFilter('mine');
    expect(svc.filter()).toBe('mine');
    expect(svc.wallpapers().length).toBe(0);
    expect(svc.hasMore()).toBeFalse();
    await svc.setFilter('all');
    expect(svc.wallpapers().length).toBe(1);
  });

  it('turns a failed RPC into an error state, not an empty gallery', async () => {
    const svc = make();
    rpcResult = { data: null, error: { code: 'PGRST202', message: 'function not found' } };
    await svc.setFilter('top');
    expect(svc.error()).not.toBeNull();
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
