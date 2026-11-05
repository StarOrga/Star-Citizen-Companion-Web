import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { SocialService } from './social.service';
import { EinsatzCrew, SharedEinsatz } from './social.types';

interface RpcResult { data?: unknown; error?: { message: string } | null }

function setup(results: Record<string, RpcResult> = {}) {
  const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string) => {
    const r = results[fn] ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  });
  const realRpc = jasmine.createSpy('realRpc').and.callFake(async (fn: string) => {
    const r = results[fn] ?? {};
    return { data: r.data ?? null, error: r.error ?? null };
  });
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseClientProvider, useValue: { client: { rpc }, realClient: { rpc: realRpc } } }],
  });
  return { rpc, realRpc, svc: TestBed.inject(SocialService) };
}

const crew = (over: Partial<EinsatzCrew> = {}): EinsatzCrew => ({
  slots: [],
  counts: { yes: 0, maybe: 0, no: 0 },
  my_answer: null,
  my_slot: null,
  rsvps: null,
  ...over,
});

describe('SocialService', () => {
  it('loadGroups fills the signal and splits it by kind', async () => {
    const { svc } = setup({
      list_my_friend_groups: {
        data: [
          { id: 'a', kind: 'org', name: 'Wings', created_at: 't', members: [] },
          { id: 'b', kind: 'einsatzgruppe', name: 'Bunker', created_at: 't', members: [] },
        ],
      },
    });
    await svc.loadGroups();
    expect(svc.groups().length).toBe(2);
    expect(svc.orgs().map((g) => g.id)).toEqual(['a']);
    expect(svc.einsatzgruppen().map((g) => g.id)).toEqual(['b']);
    expect(svc.loadError()).toBeNull();
  });

  it('a failed load sets loadError with a key and keeps the last value', async () => {
    const results: Record<string, RpcResult> = {
      list_online_friends: { data: [{ user_id: 'u1' }] },
    };
    const { svc } = setup(results);
    await svc.loadOnline();
    expect(svc.onlineIds().has('u1')).toBeTrue();

    results['list_online_friends'] = { error: { message: 'account_suspended' } };
    await svc.loadOnline();
    expect(svc.loadError()).toBe('social.error.accountSuspended');
    expect(svc.onlineIds().has('u1')).toBeTrue();
  });

  it('an unknown failure falls through to the shared translator, never raw text', async () => {
    const { svc } = setup({ list_friend_compare: { error: { message: 'canceling statement due to statement timeout' } } });
    await svc.loadCompare();
    expect(svc.loadError()).toBe('errors.timeout');
    expect(svc.compare()).toBeNull();
  });

  it('createInvite stores the live link, revokeInvite clears it', async () => {
    const { svc, rpc } = setup({ create_friend_invite: { data: { token: 't', expires_at: 'e' } } });
    expect((await svc.createInvite())?.token).toBe('t');
    expect(svc.invite()?.token).toBe('t');
    expect(await svc.revokeInvite()).toBeTrue();
    expect(rpc).toHaveBeenCalledWith('revoke_friend_invite');
    expect(svc.invite()).toBeNull();
  });

  it('peekInvite goes through the real client and resolves the row or null', async () => {
    const { svc, realRpc, rpc } = setup({ peek_friend_invite: { data: [{ display_handle: 'alpha' }] } });
    expect((await svc.peekInvite('tok'))?.display_handle).toBe('alpha');
    expect(realRpc).toHaveBeenCalledWith('peek_friend_invite', { p_token: 'tok' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('peekInvite separates a dead link from a failed call', async () => {
    const dead = setup({ peek_friend_invite: { data: [] } });
    expect(await dead.svc.peekInvite('tok')).toBeNull();
    expect(dead.svc.error()).toBeNull();
    TestBed.resetTestingModule();
    const failed = setup({ peek_friend_invite: { error: { message: 'canceling statement due to statement timeout' } } });
    expect(await failed.svc.peekInvite('tok')).toBeNull();
    expect(failed.svc.error()).toBe('errors.timeout');
  });

  it('redeemInvite returns the verdict and maps a dead link', async () => {
    const ok = setup({ redeem_friend_invite: { data: { verdict: 'pending', user_id: 'u1', display_name: null, username: 'a' } } });
    expect((await ok.svc.redeemInvite('tok'))?.verdict).toBe('pending');
    TestBed.resetTestingModule();
    const bad = setup({ redeem_friend_invite: { error: { message: 'invite_expired' } } });
    expect(await bad.svc.redeemInvite('tok')).toBeNull();
    expect(bad.svc.error()).toBe('social.error.inviteExpired');
  });

  it('createGroup trims the name and reloads', async () => {
    const { svc, rpc } = setup({ create_friend_group: { data: 'g1' } });
    expect(await svc.createGroup('org', '  Wings ')).toBe('g1');
    expect(rpc).toHaveBeenCalledWith('create_friend_group', { p_kind: 'org', p_name: 'Wings' });
    expect(rpc).toHaveBeenCalledWith('list_my_friend_groups');
  });

  it('setGroupMember passes the membership and does not reload on failure', async () => {
    const { svc, rpc } = setup({ set_friend_group_member: { error: { message: 'not_friends' } } });
    expect(await svc.setGroupMember('g', 'u', true)).toBeFalse();
    expect(rpc).toHaveBeenCalledWith('set_friend_group_member', { p_group: 'g', p_member: 'u', p_in: true });
    expect(rpc).not.toHaveBeenCalledWith('list_my_friend_groups');
    expect(svc.error()).toBe('social.error.notFriends');
    expect(svc.busy()).toBeFalse();
  });

  it('setFriendVisibility sends null facets through as inherit', async () => {
    const { svc, rpc } = setup();
    await svc.setFriendVisibility('u', { hangar: false, flagship: null, presence: null, stats: true });
    expect(rpc).toHaveBeenCalledWith('set_friend_visibility', {
      p_friend: 'u', p_hangar: false, p_flagship: null, p_presence: null, p_stats: true,
    });
    expect(rpc).toHaveBeenCalledWith('get_my_social_visibility');
  });

  it('shareEinsatz sends exactly one audience', async () => {
    const { svc, rpc } = setup({ share_einsatz: { data: 'created' } });
    expect(await svc.shareEinsatz('e', { friendId: 'u' })).toBe('created');
    expect(rpc).toHaveBeenCalledWith('share_einsatz', { p_einsatz: 'e', p_friend: 'u', p_group: null });
    await svc.shareEinsatz('e', { groupId: 'g' });
    expect(rpc).toHaveBeenCalledWith('share_einsatz', { p_einsatz: 'e', p_friend: null, p_group: 'g' });
  });

  it('shareLoadoutWithGroup keeps a zero apart from a failure', async () => {
    const { svc } = setup({ share_loadout_with_group: { data: 0 } });
    expect(await svc.shareLoadoutWithGroup('l', 'g')).toBe(0);
    expect(svc.error()).toBeNull();
  });

  it('adoptShipConfig returns what the Holotable link needs', async () => {
    const { svc } = setup({ adopt_friend_ship_config: { data: { configId: 'c', shipClassName: 'RSI_Aurora', existed: false } } });
    expect(await svc.adoptShipConfig('s')).toEqual({ configId: 'c', shipClassName: 'RSI_Aurora', existed: false });
  });

  it('respond updates the open Einsatz card and leaves the others', async () => {
    const answered = crew({ my_answer: 'yes', my_slot: 's1' });
    const { svc, rpc } = setup({ respond_einsatz: { data: answered } });
    svc.sharedEinsaetze.set([
      { einsatz_id: 'e1', crew: crew() } as SharedEinsatz,
      { einsatz_id: 'e2', crew: crew() } as SharedEinsatz,
    ]);
    await svc.respond('e1', 'yes', 's1');
    expect(rpc).toHaveBeenCalledWith('respond_einsatz', { p_einsatz: 'e1', p_answer: 'yes', p_slot: 's1' });
    expect(svc.sharedEinsaetze()[0].crew.my_slot).toBe('s1');
    expect(svc.sharedEinsaetze()[1].crew.my_slot).toBeNull();
  });

  it('respond surfaces a taken slot and changes nothing', async () => {
    const { svc } = setup({ respond_einsatz: { error: { message: 'slot_taken' } } });
    svc.sharedEinsaetze.set([{ einsatz_id: 'e1', crew: crew() } as SharedEinsatz]);
    expect(await svc.respond('e1', 'yes', 's1')).toBeNull();
    expect(svc.error()).toBe('social.error.slotTaken');
    expect(svc.sharedEinsaetze()[0].crew.my_answer).toBeNull();
  });

  describe('friendOverview', () => {
    it('is ok with data', async () => {
      const { svc, rpc } = setup({ friend_overview: { data: { friend: { user_id: 'u' } } } });
      const res = await svc.friendOverview('pilot');
      expect(res.kind).toBe('ok');
      expect(rpc).toHaveBeenCalledWith('friend_overview', { p_friend: 'pilot' });
    });

    it('is missing when the server answers null', async () => {
      const { svc } = setup({ friend_overview: { data: null } });
      expect((await svc.friendOverview('nobody')).kind).toBe('missing');
    });

    it('is an error with a key when the call fails', async () => {
      const { svc } = setup({ friend_overview: { error: { message: 'account_suspended' } } });
      expect(await svc.friendOverview('x')).toEqual({ kind: 'error', key: 'social.error.accountSuspended' });
    });
  });
});
