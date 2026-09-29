import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { ScConfirmService } from '../shared/dialog/sc-confirm.service';
import { FakeCall, FakeResult, chainArgs, fakeSupabase } from '../testing/fake-supabase';
import { AdminComponent } from './admin.component';

const ME = 'user-me';
const T0 = '2026-08-01T10:00:00Z';

function user(id: string, email: string, role: 'admin' | 'collaborator' | 'viewer', extra: object = {}) {
  return {
    id,
    email,
    display_name: email.split('@')[0],
    username: null,
    role,
    created_at: T0,
    last_sign_in_at: T0,
    ...extra,
  };
}

interface World {
  users: object[];
  requests: object[];
  allowed: object[];
  reports: object[];
  /** Per-target overrides, checked before the world data. */
  override: Record<string, (call: FakeCall) => FakeResult>;
}

describe('AdminComponent', () => {
  let world: World;
  let calls: FakeCall[];
  let confirm: jasmine.Spy;
  let signOut: jasmine.Spy;
  let refreshRole: jasmine.Spy;

  const emptyWorld = (): World => ({ users: [], requests: [], allowed: [], reports: [], override: {} });

  async function mount(): Promise<ComponentFixture<AdminComponent>> {
    const fake = fakeSupabase({
      answer: (call) => {
        const custom = world.override[call.target];
        if (custom) return custom(call);
        switch (call.target) {
          case 'list_users_for_admin':
            return { data: world.users };
          case 'pending_access_requests':
            return { data: world.requests };
          case 'list_allowed_emails':
            return { data: world.allowed };
          case 'list_reports_for_admin':
            return { data: world.reports };
          case 'invite-user':
            return { data: { status: 'invited' } };
          case 'delete-user':
            return { data: { ok: true } };
          default:
            return { data: null };
        }
      },
    });
    calls = fake.calls;
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    signOut = jasmine.createSpy('signOut').and.resolveTo(undefined);
    refreshRole = jasmine.createSpy('refresh').and.resolveTo(undefined);
    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        fake.provider,
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ScConfirmService, useValue: { confirm } },
        { provide: RoleService, useValue: { refresh: refreshRole } },
        { provide: AuthService, useValue: { user: () => ({ id: ME }), signOut } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AdminComponent);
    await settle(fixture);
    return fixture;
  }

  async function settle(fixture: ComponentFixture<AdminComponent>) {
    fixture.detectChanges();
    await fixture.whenStable();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    fixture.detectChanges();
  }

  const el = (f: ComponentFixture<AdminComponent>) => f.nativeElement as HTMLElement;
  const row = (f: ComponentFixture<AdminComponent>, email: string) =>
    Array.from(el(f).querySelectorAll('tbody tr')).find((tr) => tr.textContent!.includes(email)) as HTMLElement;
  const button = (scope: Element, key: string) =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent!.trim() === key) as HTMLButtonElement;
  const called = (target: string) => calls.filter((c) => c.target === target);

  beforeEach(() => {
    world = emptyWorld();
  });

  afterEach(() => TestBed.resetTestingModule());

  describe('empty lists', () => {
    it('loads all four feeds on init and shows the empty states', async () => {
      const f = await mount();
      for (const rpc of ['list_users_for_admin', 'list_allowed_emails', 'pending_access_requests', 'list_reports_for_admin']) {
        expect(called(rpc).length).toBe(1);
      }
      expect(el(f).textContent).toContain('admin.requests.empty');
      expect(el(f).querySelector('table')).toBeNull();
      expect(el(f).querySelector('.err')).toBeNull();
      expect(f.componentInstance.people()).toEqual([]);
    });
  });

  describe('role lock matrix', () => {
    it('locks demoting and deleting the last admin, with the last-admin tip', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      const mine = row(f, 'me@example.com');
      expect(button(mine, 'admin.actions.demoteViewer').disabled).toBeTrue();
      expect(button(mine, 'admin.actions.promoteCollab').disabled).toBeTrue();
      expect(button(mine, 'admin.actions.leaveSelf').disabled).toBeTrue();

      const admin = f.componentInstance;
      const me = admin.users().find((u) => u.id === ME)!;
      expect(admin.roleLockReason(me, 'viewer')).toBe('admin.lastAdminTip');
      expect(admin.deleteLockReason(me)).toBe('admin.lastAdminTip');
      expect(admin.deleteLocked(me)).toBeTrue();
      expect(mine.textContent).toContain('admin.lastAdmin');
    });

    it('lets other roles change freely while the last admin stays locked', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      const other = row(f, 'viewer@example.com');
      expect(button(other, 'admin.actions.promoteAdmin').disabled).toBeFalse();
      expect(button(other, 'admin.actions.promoteCollab').disabled).toBeFalse();
      expect(button(other, 'admin.actions.delete').disabled).toBeFalse();
    });

    it('unlocks the demotion once a second admin exists', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'second@example.com', 'admin')];
      const f = await mount();
      const mine = row(f, 'me@example.com');
      expect(button(mine, 'admin.actions.demoteViewer').disabled).toBeFalse();
      expect(button(mine, 'admin.actions.leaveSelf').disabled).toBeFalse();
      expect(mine.textContent).not.toContain('admin.lastAdmin');
    });

    it('locks every change on a protected account, even with several admins', async () => {
      world.users = [
        user(ME, 'me@example.com', 'admin'),
        user('u2', 'founder@example.com', 'admin', { protected: true }),
      ];
      const f = await mount();
      const founder = row(f, 'founder@example.com');
      expect(button(founder, 'admin.actions.demoteViewer').disabled).toBeTrue();
      expect(button(founder, 'admin.actions.delete').disabled).toBeTrue();
      const u = f.componentInstance.users().find((x) => x.id === 'u2')!;
      expect(f.componentInstance.roleLockReason(u, 'viewer')).toBe('admin.protectedTip');
      expect(f.componentInstance.deleteLockReason(u)).toBe('admin.protectedTip');
    });
  });

  describe('setRole', () => {
    it('sends the RPC for someone else without refreshing the own role', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      button(row(f, 'viewer@example.com'), 'admin.actions.promoteCollab').click();
      await settle(f);
      const rpc = called('set_user_role');
      expect(rpc.length).toBe(1);
      expect(rpc[0].args).toEqual({ target_id: 'u2', new_role: 'collaborator' });
      expect(refreshRole).not.toHaveBeenCalled();
      expect(called('list_users_for_admin').length).toBe(2);
    });

    it('refreshes the own role after changing it', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'second@example.com', 'admin')];
      const f = await mount();
      button(row(f, 'me@example.com'), 'admin.actions.demoteViewer').click();
      await settle(f);
      expect(called('set_user_role')[0].args).toEqual({ target_id: ME, new_role: 'viewer' });
      expect(refreshRole).toHaveBeenCalledTimes(1);
    });

    it('shows the mapped error and skips the reload when the RPC refuses', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      world.override['set_user_role'] = () => ({ error: { message: 'protected_admin: founder' } });
      button(row(f, 'viewer@example.com'), 'admin.actions.promoteAdmin').click();
      await settle(f);
      expect(el(f).querySelector('.err')?.textContent).toContain('admin.delete.err.protected_admin');
      expect(called('list_users_for_admin').length).toBe(1);
      expect(refreshRole).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('does not call the edge function when the confirm is declined', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      confirm.and.resolveTo(false);
      button(row(f, 'viewer@example.com'), 'admin.actions.delete').click();
      await settle(f);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(called('delete-user').length).toBe(0);
    });

    it('deletes another user with the confirm params and reloads the list', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      button(row(f, 'viewer@example.com'), 'admin.actions.delete').click();
      await settle(f);
      expect(confirm.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({
          messageKey: 'admin.delete.confirmOther',
          params: { email: 'viewer@example.com' },
          tone: 'danger',
        }),
      );
      expect(called('delete-user')[0].args).toEqual({ body: { userId: 'u2' } });
      expect(signOut).not.toHaveBeenCalled();
      expect(called('list_users_for_admin').length).toBe(2);
    });

    it('signs out after the account deleted itself', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'second@example.com', 'admin')];
      const f = await mount();
      world.override['delete-user'] = () => ({ data: { ok: true, deletedSelf: true } });
      button(row(f, 'me@example.com'), 'admin.actions.leaveSelf').click();
      await settle(f);
      expect(confirm.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({ messageKey: 'admin.delete.confirmSelf', confirmKey: 'admin.actions.leaveSelf' }),
      );
      expect(called('delete-user')[0].args).toEqual({ body: { userId: ME } });
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    it('shows the mapped error for a refusal from the edge function', async () => {
      world.users = [user(ME, 'me@example.com', 'admin'), user('u2', 'viewer@example.com', 'viewer')];
      const f = await mount();
      world.override['delete-user'] = () => ({ data: { error: 'user_not_found' } });
      button(row(f, 'viewer@example.com'), 'admin.actions.delete').click();
      await settle(f);
      expect(el(f).querySelector('.err')?.textContent).toContain('admin.delete.err.user_not_found');
      expect(signOut).not.toHaveBeenCalled();
      expect(called('list_users_for_admin').length).toBe(1);
    });
  });

  describe('list errors', () => {
    it('shows an error card with a key when the users RPC fails', async () => {
      world.override['list_users_for_admin'] = () => ({ error: { message: 'forbidden: admin role required' } });
      const f = await mount();
      expect(f.componentInstance.errorMsg()).toBe('errors.forbidden');
      expect(el(f).querySelector('.err')?.textContent).toContain('errors.forbidden');
      expect(el(f).querySelector('.err')?.textContent).toContain('admin.errorTitle');
    });

    it('shows the allowlist error without hiding the accounts', async () => {
      world.users = [user(ME, 'me@example.com', 'admin')];
      world.override['list_allowed_emails'] = () => ({ error: { message: 'boom', code: 'XX000' } });
      const f = await mount();
      expect(f.componentInstance.allowlistErrorMsg()).toBe('errors.server');
      expect(row(f, 'me@example.com')).toBeTruthy();
    });
  });

  describe('access requests', () => {
    const request = (extra: object = {}) => ({
      id: 'req-1',
      email: 'applicant@example.com',
      handle: 'pilot',
      message: 'Let me in',
      created_at: T0,
      allowlisted: false,
      joined: false,
      ...extra,
    });
    const requestRow = (f: ComponentFixture<AdminComponent>) => el(f).querySelector('.req') as HTMLElement;

    it('lists the pending request', async () => {
      world.requests = [request()];
      const f = await mount();
      expect(requestRow(f).textContent).toContain('applicant@example.com');
      expect(requestRow(f).textContent).toContain('Let me in');
    });

    it('accept invites with a mail, then decides, then reloads the queue', async () => {
      world.requests = [request()];
      const f = await mount();
      button(requestRow(f), 'admin.requests.accept').click();
      await settle(f);
      const order = calls.filter((c) => c.op === 'invoke' || c.target === 'decide_access_request').map((c) => c.target);
      expect(order).toEqual(['invite-user', 'decide_access_request']);
      expect(called('invite-user')[0].args).toEqual({
        body: { email: 'applicant@example.com', role: 'viewer', sendInvite: true },
      });
      expect(called('decide_access_request')[0].args).toEqual({ request_id: 'req-1', accept: true });
      expect(f.componentInstance.accessMsg()).toEqual(
        jasmine.objectContaining({ kind: 'success', key: 'admin.requests.accepted' }),
      );
      expect(called('pending_access_requests').length).toBe(2);
    });

    it('accept does not mail an applicant who already has an account', async () => {
      world.requests = [request({ joined: true })];
      const f = await mount();
      button(requestRow(f), 'admin.requests.accept').click();
      await settle(f);
      expect((called('invite-user')[0].args as { body: { sendInvite: boolean } }).body.sendInvite).toBeFalse();
      expect(f.componentInstance.accessMsg()?.key).toBe('admin.requests.acceptedNoMail');
    });

    it('accept does NOT decide the request when the invite fails', async () => {
      world.requests = [request()];
      const f = await mount();
      world.override['invite-user'] = () => ({ data: { error: 'invite_failed' } });
      button(requestRow(f), 'admin.requests.accept').click();
      await settle(f);
      expect(called('invite-user').length).toBe(1);
      expect(called('decide_access_request').length).toBe(0);
      expect(f.componentInstance.accessMsg()).toEqual({ kind: 'error', key: 'admin.register.err.invite_failed' });
      // The request stays in the queue, and the accept button is usable again.
      expect(requestRow(f)).toBeTruthy();
      expect(button(requestRow(f), 'admin.requests.accept').disabled).toBeFalse();
    });

    it('accept reports an error from the decide RPC and keeps the row', async () => {
      world.requests = [request()];
      const f = await mount();
      world.override['decide_access_request'] = () => ({ error: { message: 'forbidden: admin role required' } });
      button(requestRow(f), 'admin.requests.accept').click();
      await settle(f);
      expect(f.componentInstance.accessMsg()).toEqual({ kind: 'error', key: 'errors.forbidden' });
      expect(called('pending_access_requests').length).toBe(1);
    });

    it('decline asks first and does nothing when declined', async () => {
      world.requests = [request()];
      const f = await mount();
      confirm.and.resolveTo(false);
      button(requestRow(f), 'admin.requests.decline').click();
      await settle(f);
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(called('decide_access_request').length).toBe(0);
    });

    it('decline stamps the request rejected after a confirm', async () => {
      world.requests = [request()];
      const f = await mount();
      button(requestRow(f), 'admin.requests.decline').click();
      await settle(f);
      expect(called('decide_access_request')[0].args).toEqual({ request_id: 'req-1', accept: false });
      expect(called('invite-user').length).toBe(0);
      expect(f.componentInstance.accessMsg()?.key).toBe('admin.requests.declined');
    });
  });

  describe('open invitations', () => {
    const invite = {
      email: 'invited@example.com',
      role: 'collaborator',
      note: null,
      created_at: T0,
      consumed_at: null,
      joined: false,
    };

    it('withdraw asks first and does nothing when declined', async () => {
      world.allowed = [invite];
      const f = await mount();
      confirm.and.resolveTo(false);
      button(row(f, 'invited@example.com'), 'admin.people.withdraw').click();
      await settle(f);
      expect(called('remove_allowed_email').length).toBe(0);
    });

    it('withdraw removes the allowlist entry and reloads the allowlist', async () => {
      world.allowed = [invite];
      const f = await mount();
      button(row(f, 'invited@example.com'), 'admin.people.withdraw').click();
      await settle(f);
      expect(called('remove_allowed_email')[0].args).toEqual({ target_email: 'invited@example.com' });
      expect(called('list_allowed_emails').length).toBe(2);
    });
  });
});
