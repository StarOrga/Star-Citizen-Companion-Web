import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { LoadoutShareService } from './loadout-share.service';

type RpcResult = { data?: unknown; error?: { message: string } | null };

function setup(results: Record<string, RpcResult> = {}) {
  const make = (tag: string) =>
    jasmine.createSpy(tag).and.callFake(async (fn: string) => {
      const r = results[fn] ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    });
  const rpc = make('client.rpc');
  const realRpc = make('realClient.rpc');
  TestBed.configureTestingModule({
    providers: [
      {
        provide: SupabaseClientProvider,
        useValue: { client: { rpc }, realClient: { rpc: realRpc } },
      },
    ],
  });
  return { rpc, realRpc, svc: TestBed.inject(LoadoutShareService) };
}

describe('LoadoutShareService', () => {
  it('createLink returns the token from create_loadout_link', async () => {
    const { svc, rpc } = setup({ create_loadout_link: { data: 'abc123' } });
    expect(await svc.createLink('l1')).toBe('abc123');
    expect(rpc).toHaveBeenCalledWith('create_loadout_link', { target_loadout: 'l1' });
    expect(svc.error()).toBeNull();
  });

  it('createLink failure resolves null with an i18n key, not the raw text', async () => {
    const { svc } = setup({ create_loadout_link: { error: { message: 'loadout_not_found' } } });
    expect(await svc.createLink('l1')).toBeNull();
    expect(svc.error()).toBe('share.error.loadoutNotFound');
    expect(svc.busy()).toBeFalse();
  });

  it('shareWithFriend passes both ids and returns the verdict (default created)', async () => {
    const { svc, rpc } = setup({ share_loadout_with_friend: { data: 'duplicate' } });
    expect(await svc.shareWithFriend('l1', 'f1')).toBe('duplicate');
    expect(rpc).toHaveBeenCalledWith('share_loadout_with_friend', {
      target_loadout: 'l1',
      friend: 'f1',
    });
  });

  it('shareWithFriend defaults a null verdict to created', async () => {
    const { svc } = setup();
    expect(await svc.shareWithFriend('l1', 'f1')).toBe('created');
  });

  it('shareWithFriend to a non-friend maps to share.error.notFriends', async () => {
    const { svc } = setup({ share_loadout_with_friend: { error: { message: 'not_friends' } } });
    expect(await svc.shareWithFriend('l1', 'f1')).toBeNull();
    expect(svc.error()).toBe('share.error.notFriends');
  });

  it('revoke calls revoke_loadout_share and resolves true', async () => {
    const { svc, rpc } = setup();
    expect(await svc.revoke('s1')).toBeTrue();
    expect(rpc).toHaveBeenCalledWith('revoke_loadout_share', { share_id: 's1' });
  });

  it('revoke failure resolves false with the key', async () => {
    const { svc } = setup({ revoke_loadout_share: { error: { message: 'share_not_found' } } });
    expect(await svc.revoke('s1')).toBeFalse();
    expect(svc.error()).toBe('share.error.shareNotFound');
  });

  it('listShares and listSharedWithMe return rows, [] on null and on failure', async () => {
    const { svc, rpc } = setup({ list_loadout_shares: { data: [{ id: 's1' }] } });
    expect((await svc.listShares('l1')).length).toBe(1);
    expect(rpc).toHaveBeenCalledWith('list_loadout_shares', { target_loadout: 'l1' });
    expect(await svc.listSharedWithMe()).toEqual([]);
  });

  it('listShares failure resolves [] and sets the key', async () => {
    const { svc } = setup({ list_loadout_shares: { error: { message: 'boom' } } });
    expect(await svc.listShares('l1')).toEqual([]);
    expect(svc.error()).toBe('share.error.generic');
  });

  it('getShared uses realClient (not client) and returns the first row', async () => {
    const { svc, rpc, realRpc } = setup({ get_shared_loadout: { data: [{ name: 'Alpha' }] } });
    const view = await svc.getShared('tok');
    expect(view?.name).toBe('Alpha');
    expect(realRpc).toHaveBeenCalledWith('get_shared_loadout', { share_token: 'tok' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('getShared resolves null for an empty result and for a failure', async () => {
    const { svc } = setup({ get_shared_loadout: { data: [] } });
    expect(await svc.getShared('tok')).toBeNull();
    expect(svc.error()).toBeNull();

  });

  it('getShared failure resolves null and sets the key', async () => {
    const { svc } = setup({ get_shared_loadout: { error: { message: 'account_suspended' } } });
    expect(await svc.getShared('tok')).toBeNull();
    expect(svc.error()).toBe('share.error.suspended');
  });
});
