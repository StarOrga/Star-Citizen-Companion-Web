import { TestBed } from '@angular/core/testing';
import { SupabaseClientProvider } from '../core/supabase.client';
import { SocialService } from './social.service';
import { canManageInvite, canRemoveMember, formatTeamCode, socialErrorKey } from './social.types';
import { TeamsService } from './teams.service';

interface Reply {
  data?: unknown;
  error?: { message: string } | null;
}

function setup(reply: (fn: string, args?: Record<string, unknown>) => Reply) {
  const rpc = vi.fn().mockName('rpc').mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    const r = reply(fn, args);
    return { data: r.data ?? null, error: r.error ?? null };
  });
  const client = { rpc };
  TestBed.configureTestingModule({
    providers: [{ provide: SupabaseClientProvider, useValue: { client, realClient: client } }],
  });
  return rpc;
}

describe('TeamsService', () => {
  it('creates a group through create_group and reloads the list', async () => {
    const rpc = setup((fn) => (fn === 'create_group' ? { data: { id: 'g1' } } : { data: [] }));
    const id = await TestBed.inject(TeamsService).create('  Crew  ');
    expect(id).toBe('g1');
    expect(rpc).toHaveBeenCalledWith('create_group', { p_name: 'Crew' });
    expect(rpc).toHaveBeenCalledWith('list_my_groups');
  });

  it('flags a wrong code as invalidCode without an error key', async () => {
    setup(() => ({ data: null }));
    const svc = TestBed.inject(TeamsService);
    expect(await svc.join('abcd')).toBe(false);
    expect(svc.invalidCode()).toBe(true);
    expect(svc.error()).toBeNull();
  });

  it('maps the last-owner refusal onto its error key', async () => {
    setup((fn) => (fn === 'leave_group' ? { error: { message: 'last_owner' } } : { data: [] }));
    const svc = TestBed.inject(TeamsService);
    expect(await svc.leave('g1')).toBe(false);
    expect(svc.error()).toBe('social.error.lastOwner');
  });

  it('keeps a load failure out of the empty state', async () => {
    setup(() => ({ error: { message: 'boom' } }));
    const svc = TestBed.inject(TeamsService);
    await svc.load();
    expect(svc.loadError()).toBeTruthy();
    expect(svc.loaded()).toBe(true);
  });

  it('shares an Einsatz with a group through the one invite path of SocialService', async () => {
    const rpc = setup(() => ({ data: 'created' }));
    expect(await TestBed.inject(SocialService).inviteToEinsatz('e1', { teamId: 'g1' })).toBe('created');
    expect(rpc).toHaveBeenCalledWith('share_einsatz_with_group', { p_einsatz: 'e1', p_group: 'g1' });
  });
});

describe('group helpers', () => {
  it('formats a code in blocks of four', () => {
    expect(formatTeamCode('0123456789ABCDEF')).toBe('0123-4567-89AB-CDEF');
  });

  it('mirrors the server role rules', () => {
    expect(canManageInvite('admin')).toBe(true);
    expect(canManageInvite('member')).toBe(false);
    expect(canRemoveMember('owner', 'admin')).toBe(true);
    expect(canRemoveMember('admin', 'admin')).toBe(false);
    expect(canRemoveMember('admin', 'member')).toBe(true);
    expect(canRemoveMember('member', 'member')).toBe(false);
  });

  it('keeps the existing invite rate-limit code ahead of the new one', () => {
    expect(socialErrorKey('invite_rate_limited')).toBe('social.error.inviteRateLimited');
    expect(socialErrorKey('rate_limited')).toBe('social.error.teamRateLimited');
  });
});
