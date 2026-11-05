import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { FriendsComponent } from './friends.component';
import { FriendEdgeRow } from './friends.types';

const edge = (kind: FriendEdgeRow['kind'], id: string): FriendEdgeRow => ({
  kind,
  request_id: kind === 'incoming' || kind === 'outgoing' ? 'req-' + id : null,
  user_id: id,
  display_name: null,
  username: 'pilot_' + id,
  since: '2026-09-01T10:00:00Z',
});

async function mount(edges: FriendEdgeRow[], errors: Record<string, string> = {}) {
  const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string) => {
    if (errors[fn]) return { data: null, error: { message: errors[fn] } };
    return { data: fn === 'list_my_friend_edges' ? edges : null, error: null };
  });
  const client = { rpc };
  TestBed.configureTestingModule({
    imports: [FriendsComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: SupabaseClientProvider, useValue: { client, realClient: client } },
    ],
  });
  const fixture = TestBed.createComponent(FriendsComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, rpc };
}

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
}

function buttonByKey(el: HTMLElement, scope: string, key: string): HTMLButtonElement {
  const btn = Array.from(el.querySelectorAll<HTMLButtonElement>(scope + ' button')).find((b) =>
    b.textContent?.includes(key),
  );
  if (!btn) throw new Error('button not found: ' + key);
  return btn;
}

describe('FriendsComponent (smoke)', () => {
  it('loads on init and lists friends, incoming and outgoing requests by handle', async () => {
    const { el, rpc } = await mount([
      edge('friend', 'a'),
      edge('incoming', 'b'),
      edge('outgoing', 'c'),
      edge('blocked', 'd'),
    ]);
    expect(rpc).toHaveBeenCalledWith('list_my_friend_edges');
    const names = Array.from(el.querySelectorAll('.edge-name')).map((n) => n.textContent?.trim());
    expect(names).toEqual(['pilot_b', 'pilot_a', 'pilot_c', 'pilot_d']);
    expect(el.textContent).not.toContain('friends.list.empty');
  });

  it('an empty graph keeps only the friends card, so the invite box stays close', async () => {
    const { el } = await mount([]);
    expect(el.querySelectorAll('.section').length).toBe(1);
    expect(el.textContent).toContain('friends.list.empty');
    expect(el.textContent).not.toContain('friends.incoming.title');
    expect(el.textContent).not.toContain('friends.outgoing.title');
    expect(el.textContent).not.toContain('friends.blocked.title');
  });

  it('accepting a request calls respond_friend_request(accept=true), reloads and flashes', async () => {
    const { fixture, el, rpc } = await mount([edge('incoming', 'b')]);
    buttonByKey(el, '.edge', 'friends.actions.accept').click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('respond_friend_request', { request_id: 'req-b', accept: true });
    expect(rpc.calls.mostRecent().args[0]).toBe('list_my_friend_edges');
    expect(el.querySelector('.flash.success')?.textContent).toContain('friends.flash.nowFriends');
  });

  it('declining calls respond_friend_request(accept=false)', async () => {
    const { fixture, el, rpc } = await mount([edge('incoming', 'b')]);
    buttonByKey(el, '.edge', 'friends.actions.decline').click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('respond_friend_request', { request_id: 'req-b', accept: false });
    expect(el.querySelector('.flash.success')?.textContent).toContain('friends.flash.declined');
  });

  it('a failing respond shows the error key in an alert and no success flash', async () => {
    const { fixture, el } = await mount([edge('incoming', 'b')], {
      respond_friend_request: 'request_expired',
    });
    buttonByKey(el, '.edge', 'friends.actions.accept').click();
    await settle(fixture);
    expect(el.querySelector('.flash.error')?.textContent).toContain('friends.error.requestExpired');
    expect(el.querySelector('.flash.success')).toBeNull();
  });

  it('every friend name is a real anchor to /social/<handle>', async () => {
    const { el } = await mount([edge('friend', 'a')]);
    const a = el.querySelector<HTMLAnchorElement>('.edge-name a.edge-link');
    expect(a?.getAttribute('href')).toBe('/social/pilot_a');
  });

  it('falls back to the user id in the path when the account has no handle', async () => {
    const { el } = await mount([{ ...edge('friend', 'a'), username: null }]);
    expect(el.querySelector('.edge-name a')?.getAttribute('href')).toBe('/social/a');
  });

  it('the empty friends state leads to the invite box', async () => {
    const { fixture, el } = await mount([]);
    let asked = 0;
    fixture.componentInstance.inviteRequested.subscribe(() => asked++);
    el.querySelector<HTMLButtonElement>('.empty-state button')?.click();
    expect(asked).toBe(1);
  });
});
