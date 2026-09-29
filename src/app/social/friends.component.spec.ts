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
    expect(el.textContent).not.toContain('friends.incoming.empty');
    expect(el.textContent).not.toContain('friends.list.empty');
  });

  it('shows the empty texts for an empty graph', async () => {
    const { el } = await mount([]);
    expect(el.textContent).toContain('friends.incoming.empty');
    expect(el.textContent).toContain('friends.list.empty');
    expect(el.textContent).toContain('friends.outgoing.empty');
    expect(el.textContent).toContain('friends.blocked.empty');
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

  it('the handle field validates before enabling the search button', async () => {
    const { fixture, el } = await mount([]);
    const input = el.querySelector('input.text-input') as HTMLInputElement;
    const submit = el.querySelector('form button[type=submit]') as HTMLButtonElement;
    expect(submit.disabled).toBeTrue();
    input.value = 'ab';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(submit.disabled).toBeTrue();
    input.value = 'pilot_ok';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(submit.disabled).toBeFalse();
  });
});
