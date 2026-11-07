import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import { SocialTeamsComponent } from './social-teams.component';
import { Team, TeamMember } from './social.types';

type Handler = (args?: Record<string, unknown>) => unknown;

const team = (over: Partial<Team> = {}): Team => ({
  id: 'g1', name: 'Crew', role: 'owner', member_count: 2, joined_at: '2026-11-07T00:00:00Z',
  invite_code: '0123456789ABCDEF', invite_expires_at: '2026-12-07T00:00:00Z', ...over,
});

const members: TeamMember[] = [
  { user_id: 'u1', display_name: 'Me', username: 'me_test', role: 'owner', joined_at: '', is_me: true },
  { user_id: 'u2', display_name: null, username: 'bo_test', role: 'member', joined_at: '', is_me: false },
];

function setup(handlers: Record<string, Handler>, confirm = true) {
  const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string, args?: Record<string, unknown>) => {
    const h = handlers[fn];
    return { data: h ? h(args) : null, error: null };
  });
  const client = { rpc };
  const confirmSpy = jasmine.createSpy('confirm').and.resolveTo(confirm);
  TestBed.configureTestingModule({
    providers: [
      provideTranslateService({}),
      { provide: SupabaseClientProvider, useValue: { client, realClient: client } },
      { provide: ScConfirmService, useValue: { confirm: confirmSpy } },
    ],
  });
  return { rpc, confirmSpy };
}

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
}

async function mount() {
  const fixture = TestBed.createComponent(SocialTeamsComponent);
  await settle(fixture);
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const button = (el: HTMLElement, key: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(key));

describe('SocialTeamsComponent', () => {
  it('shows the empty state, not an error, when the user is in no group', async () => {
    setup({ list_my_groups: () => [] });
    const { el } = await mount();
    expect(el.textContent).toContain('social.teams.empty');
  });

  it('shows a load error with retry instead of the empty state', async () => {
    const rpc = jasmine.createSpy('rpc').and.resolveTo({ data: null, error: { message: 'boom' } });
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({}),
        { provide: SupabaseClientProvider, useValue: { client: { rpc }, realClient: { rpc } } },
        { provide: ScConfirmService, useValue: { confirm: async () => true } },
      ],
    });
    const { el } = await mount();
    expect(el.querySelector('.load-error')).not.toBeNull();
    expect(el.textContent).not.toContain('social.teams.empty');
    expect(button(el, 'errors.retry')).toBeTruthy();
  });

  it('creates a group and joins by code through the RPCs', async () => {
    const { rpc } = setup({ list_my_groups: () => [], create_group: () => ({ id: 'g1' }), join_group: () => 'g1' });
    const { fixture, el } = await mount();
    const inputs = el.querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = 'Crew';
    inputs[0].dispatchEvent(new Event('input'));
    inputs[1].value = '0123-4567';
    inputs[1].dispatchEvent(new Event('input'));
    await settle(fixture);
    el.querySelectorAll('form')[0].dispatchEvent(new Event('submit'));
    el.querySelectorAll('form')[1].dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('create_group', { p_name: 'Crew' });
    expect(rpc).toHaveBeenCalledWith('join_group', { p_code: '0123-4567' });
  });

  it('tells the user a wrong code is invalid', async () => {
    setup({ list_my_groups: () => [], join_group: () => null });
    const { fixture, el } = await mount();
    const code = el.querySelectorAll<HTMLInputElement>('input')[1];
    code.value = 'nope';
    code.dispatchEvent(new Event('input'));
    await settle(fixture);
    el.querySelectorAll('form')[1].dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.textContent).toContain('social.teams.invalidCode');
  });

  it('shows the code to an owner but not to a plain member', async () => {
    setup({ list_my_groups: () => [team(), team({ id: 'g2', name: 'Other', role: 'member', invite_code: null, invite_expires_at: null })] });
    const { el } = await mount();
    const codes = Array.from(el.querySelectorAll('.code')).map((c) => c.textContent?.trim());
    expect(codes).toEqual(['0123-4567-89AB-CDEF']);
  });

  it('asks before leaving and does nothing when declined', async () => {
    const { rpc, confirmSpy } = setup({ list_my_groups: () => [team()], leave_group: () => null }, false);
    const { fixture, el } = await mount();
    button(el, 'social.teams.leave')?.click();
    await settle(fixture);
    expect(confirmSpy).toHaveBeenCalledWith(jasmine.objectContaining({ tone: 'danger' }));
    expect(rpc).not.toHaveBeenCalledWith('leave_group', jasmine.anything());
  });

  it('leaves after the confirm and shows the last-owner refusal', async () => {
    const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string) =>
      fn === 'leave_group' ? { data: null, error: { message: 'last_owner' } } : { data: fn === 'list_my_groups' ? [team()] : null, error: null });
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({}),
        { provide: SupabaseClientProvider, useValue: { client: { rpc }, realClient: { rpc } } },
        { provide: ScConfirmService, useValue: { confirm: async () => true } },
      ],
    });
    const { fixture, el } = await mount();
    button(el, 'social.teams.leave')?.click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('leave_group', { p_group: 'g1' });
    expect(el.textContent).toContain('social.error.lastOwner');
  });

  it('lists members and removes one after a confirm; never offers remove on oneself', async () => {
    const { rpc, confirmSpy } = setup({
      list_my_groups: () => [team()],
      list_group_members: () => members,
      remove_group_member: () => null,
    });
    const { fixture, el } = await mount();
    button(el, 'social.teams.showMembers')?.click();
    await settle(fixture);
    const rows = el.querySelectorAll('.members li');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).not.toContain('social.teams.removeMember');
    (rows[1].querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(confirmSpy).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith('remove_group_member', { p_group: 'g1', p_member: 'u2' });
  });

  it('only an owner sees delete group, and it asks first', async () => {
    const { rpc, confirmSpy } = setup({ list_my_groups: () => [team()], delete_group: () => null });
    const { fixture, el } = await mount();
    button(el, 'social.teams.delete')?.click();
    await settle(fixture);
    expect(confirmSpy).toHaveBeenCalledWith(jasmine.objectContaining({ tone: 'danger' }));
    expect(rpc).toHaveBeenCalledWith('delete_group', { p_group: 'g1' });
  });

  it('hides delete group and rotate from a plain member', async () => {
    setup({ list_my_groups: () => [team({ role: 'member', invite_code: null, invite_expires_at: null })] });
    const { el } = await mount();
    expect(button(el, 'social.teams.delete')).toBeUndefined();
    expect(button(el, 'social.teams.rotate')).toBeUndefined();
  });
});
