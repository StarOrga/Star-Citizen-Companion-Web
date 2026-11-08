import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { FriendsService } from '../../social/friends.service';
import { emptyGraph } from '../../social/friends.types';
import { SocialService } from '../../social/social.service';
import { SharedEinsatz } from '../../social/social.types';
import { HqFriendShareComponent, audienceOf } from './hq-friend-share.component';
import { HqSharedEinsaetzeComponent } from './hq-shared-einsaetze.component';

const edge = (id: string, name: string, handle: string | null) => ({
  kind: 'incoming' as const,
  request_id: `r-${id}`,
  user_id: id,
  display_name: name,
  username: handle,
  since: '2026-11-01T00:00:00Z',
});

function friendsMock(graph = emptyGraph()) {
  const g = signal(graph);
  return {
    graph: g,
    loading: signal(false),
    busy: signal(false),
    error: signal<string | null>(null),
    incomingCount: () => g().incoming.length,
    friendCount: () => g().friends.length,
    load: vi.fn().mockName('load').mockResolvedValue(undefined),
    respond: vi.fn().mockName('respond').mockResolvedValue(true),
  };
}

function socialMock(extra: Record<string, unknown> = {}) {
  return {
    sharedEinsaetze: signal<SharedEinsatz[]>([]),
    groups: signal<unknown[]>([]),
    busy: signal(false),
    error: signal<string | null>(null),
    loadSharedEinsaetze: vi.fn().mockName('loadSharedEinsaetze').mockResolvedValue(undefined),
    loadGroups: vi.fn().mockName('loadGroups').mockResolvedValue(undefined),
    ...extra,
  };
}

function setup(friends: ReturnType<typeof friendsMock>, social: ReturnType<typeof socialMock>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTranslateService(),
      { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      { provide: FriendsService, useValue: friends },
      { provide: SocialService, useValue: social },
    ],
  });
}

describe('audienceOf', () => {
  it('splits friend and group values and rejects anything else', () => {
    expect(audienceOf('f:abc')).toEqual({ friendId: 'abc' });
    expect(audienceOf('g:xyz')).toEqual({ groupId: 'xyz' });
    expect(audienceOf(null)).toBeNull();
    expect(audienceOf('abc')).toBeNull();
  });
});

describe('HqFriendShareComponent', () => {
  it('does not exist for an account without friends', () => {
    setup(friendsMock(), socialMock());
    const f = TestBed.createComponent(HqFriendShareComponent);
    f.componentRef.setInput('kind', 'einsatz');
    f.componentRef.setInput('subjectId', 'e1');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('button')).toBeNull();
  });

  it('offers the share to an account with friends', () => {
    const friends = friendsMock({ ...emptyGraph(), friends: [{ ...edge('u2', 'Ada', 'ada'), kind: 'friend' as const }] });
    setup(friends, socialMock());
    const f = TestBed.createComponent(HqFriendShareComponent);
    f.componentRef.setInput('kind', 'ship_config');
    f.componentRef.setInput('subjectId', 'c1');
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('button')).not.toBeNull();
  });
});

describe('HqSharedEinsaetzeComponent', () => {
  const shared = (): SharedEinsatz => ({
    einsatz_id: 'e9',
    title: 'Bergbau Runde',
    activity: null,
    status: 'planned',
    planned_at: null,
    start_location: null,
    updated_at: '2026-11-04T00:00:00Z',
    owner_id: 'u2',
    owner_name: 'Ada',
    owner_handle: 'ada',
    shared_at: '2026-11-04T00:00:00Z',
    steps: [],
    crew: { slots: [], counts: { yes: 1, maybe: 0, no: 0 }, my_answer: null, my_slot: null, rsvps: null },
  });

  it('renders nothing when nothing is shared', () => {
    setup(friendsMock(), socialMock());
    const f = TestBed.createComponent(HqSharedEinsaetzeComponent);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('section')).toBeNull();
  });

  it('shows who shared it as an anchor, offers no editing and answers through respond()', () => {
    const respond = vi.fn().mockName('respond').mockResolvedValue(null);
    const social = socialMock({ respond });
    social.sharedEinsaetze.set([shared()]);
    setup(friendsMock(), social);
    const f = TestBed.createComponent(HqSharedEinsaetzeComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('.by a')?.getAttribute('href')).toBe('/social/ada');
    expect(el.querySelector('input, .rm')).toBeNull();
    (el.querySelector('.rsvp button') as HTMLButtonElement).click();
    expect(respond).toHaveBeenCalledWith('e9', 'yes', null);
  });
});
