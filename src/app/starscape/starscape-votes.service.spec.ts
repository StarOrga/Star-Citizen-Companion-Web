import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { AuthService } from '../auth/auth.service';
import { StarscapeVotesService, TOP_LIMIT } from './starscape-votes.service';

/**
 * A chainable, awaitable stand-in for one PostgREST query builder. `eq`/`select`
 * return itself, and awaiting it (or `maybeSingle()`) yields the canned result.
 */
function query(result: unknown): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  obj['eq'] = () => obj;
  obj['select'] = () => obj;
  obj['maybeSingle'] = () => Promise.resolve(result);
  obj['then'] = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(ok, fail);
  return obj;
}

interface ClientStub {
  rpc: Mock;
  from: Mock;
  insertResult: unknown;
  deleteResult: unknown;
  profileResult: unknown;
  inserts: unknown[];
}

function clientStub(): ClientStub {
  const stub = {
    insertResult: { error: null },
    deleteResult: { error: null },
    profileResult: { data: null, error: null },
    inserts: [] as unknown[],
  } as ClientStub;
  stub.rpc = vi.fn().mockName('rpc').mockResolvedValue({ data: [], error: null });
  stub.from = vi.fn().mockName('from').mockImplementation((table: string) => {
    if (table === 'profiles') return query(stub.profileResult);
    return {
      insert: (row: unknown) => {
        stub.inserts.push(row);
        return query(stub.insertResult);
      },
      delete: () => query(stub.deleteResult),
    };
  });
  return stub;
}

describe('StarscapeVotesService', () => {
  let client: ClientStub;
  const user = { id: 'user-1' };

  function make(signedIn = true): StarscapeVotesService {
    client = clientStub();
    localStorage.removeItem('sc.starscape.topOnly');
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseClientProvider, useValue: { client } },
        {
          provide: AuthService,
          useValue: {
            user: () => (signedIn ? user : null),
            isAuthenticated: () => signedIn,
          },
        },
      ],
    });
    return TestBed.inject(StarscapeVotesService);
  }

  afterEach(() => {
    localStorage.removeItem('sc.starscape.topOnly');
    TestBed.resetTestingModule();
  });

  it('lights the thumbs-up before the server answers', async () => {
    const svc = make();
    const pending = svc.toggle('img-1');
    // Optimistic: the icon and the count flip on the tap, not a round trip later.
    expect(svc.hasVoted('img-1')).toBe(true);
    expect(svc.countFor('img-1')).toBe(1);
    await pending;
    expect(client.inserts).toEqual([{ image_id: 'img-1', user_id: 'user-1' }]);
    expect(svc.hasVoted('img-1')).toBe(true);
  });

  it('rolls the optimistic vote back when the write actually fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined as never);
    const svc = make();
    client.insertResult = { error: { message: 'denied', code: '42501' } };
    await svc.toggle('img-1');
    expect(svc.hasVoted('img-1')).toBe(false);
    expect(svc.countFor('img-1')).toBe(0);
    // The rollback is silent for the user, not for the console (AUD-255).
    expect(warn).toHaveBeenCalledWith('[starscape] vote write failed', expect.objectContaining({ imageId: 'img-1' }));
  });

  it('treats a duplicate vote as the success it is', async () => {
    const svc = make();
    // Two taps racing: the second insert hits the (image_id, user_id) primary
    // key. That is the state we already painted, so it must not roll back.
    client.insertResult = { error: { message: 'duplicate key', code: '23505' } };
    await svc.toggle('img-1');
    expect(svc.hasVoted('img-1')).toBe(true);
    expect(svc.countFor('img-1')).toBe(1);
  });

  it('revokes an existing vote and decrements the tally', async () => {
    const svc = make();
    await svc.toggle('img-1');
    await svc.toggle('img-1');
    expect(svc.hasVoted('img-1')).toBe(false);
    expect(svc.countFor('img-1')).toBe(0);
  });

  it('does nothing at all for a signed-out visitor', async () => {
    const svc = make(false);
    await svc.toggle('img-1');
    expect(svc.canVote()).toBe(false);
    expect(client.inserts).toEqual([]);
    expect(svc.hasVoted('img-1')).toBe(false);
  });

  it('reads counts through the aggregate RPC, never the votes table', async () => {
    const svc = make();
    client.rpc.mockResolvedValue({
      data: [{ image_id: 'img-1', votes: 4, voted: true }],
      error: null,
    });
    await svc.syncCounts(['img-1', 'img-2']);
    expect(client.rpc).toHaveBeenCalledWith('starscape_vote_state', {
      p_image_ids: ['img-1', 'img-2'],
    });
    expect(svc.countFor('img-1')).toBe(4);
    expect(svc.hasVoted('img-1')).toBe(true);
    // An image with no votes is simply absent from the result, not zero rows of
    // somebody else's data.
    expect(svc.countFor('img-2')).toBe(0);
    expect(svc.hasVoted('img-2')).toBe(false);
  });

  it('asks the server for the ranking instead of sorting a page client-side', async () => {
    const svc = make();
    client.rpc.mockResolvedValue({
      data: [
        {
          image_id: 'top-1',
          source_url: 'https://cdn/source.jpg',
          preview_url: 'https://cdn/cover.jpg',
          title: 'Top one',
          series: null,
          article_url: 'https://rsi/comm-link',
          published_at: '2026-08-01T00:00:00Z',
          votes: 9,
          voted: true,
        },
      ],
      error: null,
    });
    await svc.loadTop();
    expect(client.rpc).toHaveBeenCalledWith('starscape_top_wallpapers', { p_limit: TOP_LIMIT });
    expect(svc.topWallpapers().map((w) => w.imageId)).toEqual(['top-1']);
    // The ranking already carries its counts — no second round trip.
    expect(svc.countFor('top-1')).toBe(9);
    expect(svc.hasVoted('top-1')).toBe(true);
  });

  it('persists the toggle on the profile so the desktop app sees it too', async () => {
    const svc = make();
    await svc.setTopOnly(true);
    expect(svc.topOnly()).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('set_starscape_top_only', { enabled: true });
    // …and it fetched the ranking it just switched to.
    expect(client.rpc).toHaveBeenCalledWith('starscape_top_wallpapers', { p_limit: TOP_LIMIT });
  });

  it('still remembers the toggle for a signed-out visitor', async () => {
    const svc = make(false);
    await svc.setTopOnly(true);
    expect(localStorage.getItem('sc.starscape.topOnly')).toBe('1');
    // No profile write is even attempted without an account.
    expect(client.rpc).not.toHaveBeenCalledWith('set_starscape_top_only', { enabled: true });

    TestBed.resetTestingModule();
    const fresh = make(false);
    localStorage.setItem('sc.starscape.topOnly', '1');
    await fresh.loadPreference();
    expect(fresh.topOnly()).toBe(true);
  });

  it('lets the profile column win over the local copy once signed in', async () => {
    const svc = make();
    localStorage.setItem('sc.starscape.topOnly', '1');
    client.profileResult = { data: { starscape_top_only: false }, error: null };
    await svc.loadPreference();
    expect(svc.topOnly()).toBe(false);
  });
});
