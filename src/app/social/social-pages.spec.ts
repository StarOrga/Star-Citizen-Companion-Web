import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { SocialCompareComponent } from './social-compare.component';
import { SocialFriendComponent } from './social-friend.component';
import { SocialGroupsComponent } from './social-groups.component';
import { SocialInviteBoxComponent } from './social-invite-box.component';
import { SocialInviteLandingComponent } from './social-invite-landing.component';
import { SocialVisibilityDialogComponent } from './social-visibility-dialog.component';
import { SOCIAL_NOTICE_KEY, SocialComponent } from './social.component';
import { SocialStats } from './social.types';

type Handler = (args?: Record<string, unknown>) => unknown;

const stats = (over: Partial<SocialStats> = {}): SocialStats => ({
  ships: 3, sets: 1, einsaetze_planned: 0, einsaetze_done: 2, missions_30d: 4, kartograph_rank: 1, active_days_30: 5, desktop_connected: false,
  ...over,
});

function setup(handlers: Record<string, Handler>, extra: unknown[] = []) {
  const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string, args?: Record<string, unknown>) => {
    const h = handlers[fn];
    if (!h) return { data: fn === 'list_my_friend_edges' ? [] : null, error: null };
    try {
      return { data: h(args), error: null };
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } };
    }
  });
  const client = { rpc };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: SupabaseClientProvider, useValue: { client, realClient: client } },
      ...(extra as never[]),
    ],
  });
  return rpc;
}

async function mount<T>(type: new () => T) {
  const fixture = TestBed.createComponent(type);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

const TOKEN = 'a'.repeat(64);

describe('SocialComponent notice', () => {
  beforeEach(() => localStorage.removeItem(SOCIAL_NOTICE_KEY));
  afterEach(() => localStorage.removeItem(SOCIAL_NOTICE_KEY));

  const allOn = { general: { hangar: true, flagship: true, presence: true, stats: true }, overrides: [] };

  it('shows the one-time notice for untouched defaults and remembers the dismissal', async () => {
    setup({ get_my_social_visibility: () => allOn });
    const { fixture, el } = await mount(SocialComponent);
    expect(el.querySelector('.notice')).not.toBeNull();
    el.querySelectorAll<HTMLButtonElement>('.notice button')[1].click();
    await settle(fixture);
    expect(el.querySelector('.notice')).toBeNull();
    expect(localStorage.getItem(SOCIAL_NOTICE_KEY)).toBe('1');
  });

  it('shows no notice once a switch was changed', async () => {
    setup({ get_my_social_visibility: () => ({ ...allOn, general: { ...allOn.general, hangar: false } }) });
    const { el } = await mount(SocialComponent);
    expect(el.querySelector('.notice')).toBeNull();
  });

  it('opens the visibility popup from the notice button', async () => {
    setup({ get_my_social_visibility: () => allOn });
    const { fixture, el } = await mount(SocialComponent);
    el.querySelectorAll<HTMLButtonElement>('.notice button')[0].click();
    await settle(fixture);
    expect(el.querySelector('sc-social-visibility-dialog [role=dialog]')).not.toBeNull();
  });
});

describe('SocialInviteBoxComponent', () => {
  it('shows the invite link and renews it as revoke then create', async () => {
    const rpc = setup({
      my_friend_invite: () => [{ token: TOKEN, expires_at: '2026-11-12T00:00:00Z' }],
    });
    const { fixture, el } = await mount(SocialInviteBoxComponent);
    expect((el.querySelector('.link-row input') as HTMLInputElement).value).toContain('/invite/' + TOKEN);
    Array.from(el.querySelectorAll<HTMLButtonElement>('.actions button'))[0].click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('revoke_friend_invite');
    expect(rpc).toHaveBeenCalledWith('create_friend_invite');
  });

  it('keeps the exact-username lookup and validates before enabling it', async () => {
    setup({});
    const { fixture, el } = await mount(SocialInviteBoxComponent);
    const input = el.querySelector('form input') as HTMLInputElement;
    const submit = el.querySelector('form button[type=submit]') as HTMLButtonElement;
    expect(submit.disabled).toBeTrue();
    input.value = 'pilot_ok';
    input.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(submit.disabled).toBeFalse();
  });
});

describe('SocialGroupsComponent', () => {
  const friend = (id: string) => ({ user_id: id, display_name: null, username: 'pilot_' + id });

  it('lists groups and toggles a friend into several of them', async () => {
    const rpc = setup({
      list_my_friend_groups: () => [
        { id: 'g1', kind: 'org', name: 'Orgy', created_at: '', members: [] },
        { id: 'g2', kind: 'einsatzgruppe', name: 'Raid', created_at: '', members: [friend('a')] },
      ],
      list_my_friend_edges: () => [
        { kind: 'friend', request_id: null, user_id: 'a', display_name: null, username: 'pilot_a', since: '2026-09-01T10:00:00Z' },
      ],
    });
    const { fixture, el } = await mount(SocialGroupsComponent);
    // friends are only loaded by the page; load them here
    await TestBed.inject((await import('./friends.service')).FriendsService).load();
    await settle(fixture);
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('.chip'));
    expect(chips.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    chips[0].click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('set_friend_group_member', { p_group: 'g1', p_member: 'a', p_in: true });
  });

  it('says in words that groups are private and what joining grants', async () => {
    setup({ list_my_friend_groups: () => [] });
    const { el } = await mount(SocialGroupsComponent);
    expect(el.textContent).toContain('social.groups.privateNote');
    expect(el.textContent).toContain('social.groups.shareNote');
    expect(el.textContent).toContain('social.groups.empty');
  });

  it('a failed load renders the error state with retry, never the empty state', async () => {
    setup({ list_my_friend_groups: () => { throw new Error('boom'); } });
    const { el } = await mount(SocialGroupsComponent);
    expect(el.querySelector('.load-error')).not.toBeNull();
    expect(el.textContent).not.toContain('social.groups.empty');
  });
});

describe('SocialCompareComponent', () => {
  it('shows me versus a friend and marks the weaker value as a warning, not an error', async () => {
    setup({
      list_friend_compare: () => ({
        me: stats({ ships: 1 }),
        friends: [{ user_id: 'a', display_name: null, username: 'pilot_a', stats: stats({ ships: 9 }) }],
      }),
    });
    const { el } = await mount(SocialCompareComponent);
    const first = el.querySelector('tbody tr') as HTMLElement;
    const cells = first.querySelectorAll('td');
    expect(cells[0].textContent?.trim()).toBe('1');
    expect(cells[0].classList).toContain('behind');
    expect(cells[1].classList).toContain('ahead');
    expect(el.textContent).toContain('social.comparePanel.webNote');
  });

  it('says a hiding friend hides, instead of showing zeros', async () => {
    setup({
      list_friend_compare: () => ({ me: stats(), friends: [{ user_id: 'a', display_name: null, username: 'pilot_a', stats: null }] }),
    });
    const { el } = await mount(SocialCompareComponent);
    expect(el.textContent).toContain('social.comparePanel.friendHides');
    expect(el.querySelectorAll('.hidden-val').length).toBeGreaterThan(0);
  });
});

describe('SocialVisibilityDialogComponent', () => {
  const vis = {
    general: { hangar: true, flagship: true, presence: true, stats: true },
    overrides: [{ user_id: 'a', display_name: null, username: 'pilot_a', hangar: false, flagship: null, presence: null, stats: null }],
  };

  it('saves a general switch at once with all four facets', async () => {
    const rpc = setup({ get_my_social_visibility: () => vis });
    const { fixture, el } = await mount(SocialVisibilityDialogComponent);
    el.querySelectorAll<HTMLButtonElement>('button.switch')[2].click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('set_my_social_visibility', {
      p_hangar: true, p_flagship: true, p_presence: false, p_stats: true,
    });
  });
});

describe('SocialFriendComponent', () => {
  const overview = {
    friend: { user_id: 'a', display_name: null, username: 'pilot_a', since: '2026-09-01T10:00:00Z', flagship_ship_class: 'ANVL_Carrack', online: true },
    from_friend: { loadouts: [{ share_id: 's', loadout_id: 'l', name: 'Mining set', role: 'mining', shared_at: '' }], einsaetze: [], ship_configs: [] },
    from_me: { loadouts: [], einsaetze: [], ship_configs: [] },
    my_groups: [],
    hangar: [{ ship_class_name: 'ANVL_Carrack', custom_name: null, status: 'wishlist', pinned_rank: 1 }],
    compare: { me: stats(), friend: stats({ ships: 7 }) },
  };

  const route = (who: string) => ({ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ who }) }, paramMap: of(convertToParamMap({ who })) } });

  it('renders what is shared both ways, the hangar with its status and the comparison', async () => {
    const rpc = setup({ friend_overview: () => overview }, [route('pilot_a')]);
    const { el } = await mount(SocialFriendComponent);
    expect(rpc).toHaveBeenCalledWith('friend_overview', { p_friend: 'pilot_a' });
    expect(el.textContent).toContain('Mining set');
    expect(el.textContent).toContain('social.friendPage.wishlist');
    expect(el.querySelector('#social-compare')).not.toBeNull();
  });

  it('a hidden hangar is said to be hidden, not empty', async () => {
    setup({ friend_overview: () => ({ ...overview, hangar: null }) }, [route('pilot_a')]);
    const { el } = await mount(SocialFriendComponent);
    expect(el.textContent).toContain('social.friendPage.hangarHidden');
    expect(el.textContent).not.toContain('social.friendPage.hangarEmpty');
  });

  it('a report from the friend page carries the chosen category, not a fixed one', async () => {
    const rpc = setup({ friend_overview: () => overview, report_user: () => 'created' }, [route('pilot_a')]);
    const { fixture, el } = await mount(SocialFriendComponent);
    const page = fixture.componentInstance;
    page.reportOpen.set(true);
    page.setCategory('harassment');
    page.reportReason.set('  insults  ');
    fixture.detectChanges();
    expect(el.querySelector('.report-card')).not.toBeNull();
    await page.submitReport();
    expect(rpc).toHaveBeenCalledWith('report_user', jasmine.objectContaining({ category: 'harassment', reason: 'insults' }));
    expect(page.reportOpen()).toBeFalse();
  });

  it('null from the server is the not-found state', async () => {
    setup({ friend_overview: () => null }, [route('nobody')]);
    const { el } = await mount(SocialFriendComponent);
    expect(el.textContent).toContain('social.friendPage.missing');
  });

  it('a failed call is an error state with retry', async () => {
    setup({ friend_overview: () => { throw new Error('boom'); } }, [route('pilot_a')]);
    const { el } = await mount(SocialFriendComponent);
    expect(el.querySelector('.load-error button')).not.toBeNull();
  });
});

describe('SocialInviteLandingComponent', () => {
  const route = (token: string) => ({ provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ token }) } } });
  const auth = (signedIn: boolean) => ({ provide: AuthService, useValue: { isAuthenticated: () => signedIn, whenReady: async () => undefined } });

  it('a signed-out visitor gets a sign-in step that returns to the invite', async () => {
    setup({ peek_friend_invite: () => [{ display_handle: 'pilot_a' }] }, [route(TOKEN), auth(false)]);
    const { el } = await mount(SocialInviteLandingComponent);
    const a = el.querySelector<HTMLAnchorElement>('a[href^="/login"]');
    expect(a?.getAttribute('href')).toContain('redirect=%2Finvite%2F' + TOKEN);
  });

  it('a signed-in visitor redeems with one press and gets the friend page link when already friends', async () => {
    const rpc = setup({
      peek_friend_invite: () => [{ display_handle: 'pilot_a' }],
      redeem_friend_invite: () => ({ verdict: 'accepted', user_id: 'a', display_name: null, username: 'pilot_a' }),
    }, [route(TOKEN), auth(true)]);
    const { fixture, el } = await mount(SocialInviteLandingComponent);
    el.querySelector<HTMLButtonElement>('button.sc-btn-primary')?.click();
    await settle(fixture);
    expect(rpc).toHaveBeenCalledWith('redeem_friend_invite', { p_token: TOKEN });
    expect(el.querySelector('a[href="/social/pilot_a"]')).not.toBeNull();
  });

  it('a dead link, and a malformed token, render the same dead state', async () => {
    setup({ peek_friend_invite: () => [] }, [route(TOKEN), auth(false)]);
    const { el } = await mount(SocialInviteLandingComponent);
    expect(el.textContent).toContain('social.inviteLanding.dead');
    TestBed.resetTestingModule();
    setup({}, [route('zz'), auth(false)]);
    const again = await mount(SocialInviteLandingComponent);
    expect(again.el.textContent).toContain('social.inviteLanding.dead');
  });
});
