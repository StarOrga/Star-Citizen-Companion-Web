import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { HqEinsatzService } from '../hq/data/hq-einsatz.service';
import { SocialEinsatzComponent } from './social-einsatz.component';
import { EinsatzCrew } from './social.types';

type Handler = (args?: Record<string, unknown>) => unknown;

const crew = (over: Partial<EinsatzCrew> = {}): EinsatzCrew => ({
  slots: [
    { id: 's1', ord: 0, label: 'Pilot', taken: true, mine: false, taker: { user_id: 'f1', display_name: 'Ana', username: 'ana_test' } },
    { id: 's2', ord: 1, label: 'Gunner', taken: false, mine: false, taker: null },
  ],
  counts: { yes: 1, maybe: 0, no: 1 },
  my_answer: null,
  my_slot: null,
  rsvps: [
    { user_id: 'f1', display_name: 'Ana', username: 'ana_test', answer: 'yes', slot_id: 's1', answered_at: '2026-11-07T10:00:00Z' },
    { user_id: 'f2', display_name: null, username: 'bo_test', answer: 'no', slot_id: null, answered_at: '2026-11-07T11:00:00Z' },
  ],
  ...over,
});

function setup(handlers: Record<string, Handler>, items: { id: string; title: string; status: string }[]) {
  const rpc = jasmine.createSpy('rpc').and.callFake(async (fn: string, args?: Record<string, unknown>) => {
    const h = handlers[fn];
    return { data: h ? h(args) : null, error: null };
  });
  const client = { rpc };
  TestBed.configureTestingModule({
    providers: [
      provideTranslateService({}),
      { provide: SupabaseClientProvider, useValue: { client, realClient: client } },
      { provide: HqEinsatzService, useValue: { items: signal(items) } },
    ],
  });
  return rpc;
}

async function mount() {
  const fixture = TestBed.createComponent(SocialEinsatzComponent);
  for (let i = 0; i < 3; i++) {
    fixture.detectChanges();
    await fixture.whenStable();
  }
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

const compare = () => ({
  me: {},
  friends: [{ user_id: 'f1', display_name: 'Ana', username: 'ana_test', stats: null }],
});

describe('SocialEinsatzComponent', () => {
  it('invites the picked friend into the picked Einsatz through share_einsatz and shows the crew', async () => {
    const rpc = setup(
      {
        list_friend_compare: compare,
        list_einsaetze_shared_with_me: () => [],
        share_einsatz: () => 'created',
        get_einsatz_crew: () => crew(),
      },
      [{ id: 'e1', title: 'Mining run', status: 'planned' }],
    );
    const { fixture, el } = await mount();
    const invite = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('social.einsatz.invite'));
    invite?.click();
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(rpc).toHaveBeenCalledWith('share_einsatz', { p_einsatz: 'e1', p_friend: 'f1', p_group: null });
    expect(el.textContent).toContain('social.einsatz.invited');
    // S2: who accepted, who declined, which slots are open
    const rows = Array.from(el.querySelectorAll('.rsvps li')).map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Anasocial.rsvp.yes', 'bo_testsocial.rsvp.no']);
    const slots = Array.from(el.querySelectorAll('.crew .slots li')).map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(slots).toEqual(['PilotAna', 'Gunnersocial.einsatz.open']);
  });

  it('an invitee sees who answered what by name, with the same list the owner sees', async () => {
    const shared = {
      einsatz_id: 'e9', title: 'Raid', activity: null, status: 'planned', planned_at: null, start_location: null,
      updated_at: '', owner_id: 'o', owner_name: 'Owner', owner_handle: null, shared_at: '', steps: [],
      crew: crew(),
    };
    setup({ list_friend_compare: compare, list_einsaetze_shared_with_me: () => [shared] }, []);
    const { el } = await mount();
    const rows = Array.from(el.querySelectorAll('.shared-row .rsvps li')).map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Anasocial.rsvp.yes', 'bo_testsocial.rsvp.no']);
    expect(el.querySelector('.shared-row .slots')?.textContent).toContain('Ana');
  });

  it('a friend sees counts and open slots of a shared Einsatz and can answer', async () => {
    const shared = {
      einsatz_id: 'e9', title: 'Raid', activity: null, status: 'planned', planned_at: null, start_location: null,
      updated_at: '', owner_id: 'o', owner_name: 'Owner', owner_handle: null, shared_at: '', steps: [],
      crew: crew({ rsvps: null }),
    };
    const rpc = setup(
      {
        list_friend_compare: compare,
        list_einsaetze_shared_with_me: () => [shared],
        respond_einsatz: () => crew({ rsvps: null, my_answer: 'yes' }),
      },
      [],
    );
    const { fixture, el } = await mount();
    expect(el.textContent).toContain('Raid');
    expect(el.textContent).toContain('social.einsatz.open');
    const yes = Array.from(el.querySelectorAll<HTMLButtonElement>('.answers button'))[0];
    yes.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(rpc).toHaveBeenCalledWith('respond_einsatz', { p_einsatz: 'e9', p_answer: 'yes', p_slot: null });
  });

  it('says what to do first when there is no Einsatz yet', async () => {
    setup({ list_friend_compare: compare, list_einsaetze_shared_with_me: () => [] }, []);
    const { el } = await mount();
    expect(el.textContent).toContain('social.einsatz.noneOwn');
    expect(el.textContent).toContain('social.einsatz.noneShared');
  });

  const team = { id: 'g1', name: 'Crew', role: 'owner', member_count: 3, joined_at: '', invite_code: null, invite_expires_at: null };

  it('invites a real group through the same invite button when there are no friends', async () => {
    const rpc = setup(
      {
        list_friend_compare: () => ({ me: {}, friends: [] }),
        list_my_groups: () => [team],
        list_einsaetze_shared_with_me: () => [],
        share_einsatz_with_group: () => 'created',
        get_einsatz_crew: () => crew(),
      },
      [{ id: 'e1', title: 'Mining run', status: 'planned' }],
    );
    const { fixture, el } = await mount();
    expect(el.textContent).not.toContain('social.einsatz.noFriends');
    expect(el.textContent).not.toContain('social.einsatz.pickAudience');
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('social.einsatz.invite'))?.click();
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(rpc).toHaveBeenCalledWith('share_einsatz_with_group', { p_einsatz: 'e1', p_group: 'g1' });
    expect(rpc).not.toHaveBeenCalledWith('share_einsatz', jasmine.anything());
  });

  it('offers the audience switch when both friends and groups exist, defaulting to a friend', async () => {
    const rpc = setup(
      {
        list_friend_compare: compare,
        list_my_groups: () => [team],
        list_einsaetze_shared_with_me: () => [],
        share_einsatz: () => 'created',
        get_einsatz_crew: () => crew(),
      },
      [{ id: 'e1', title: 'Mining run', status: 'planned' }],
    );
    const { fixture, el } = await mount();
    expect(el.querySelector('[aria-label="social.einsatz.pickAudience"], sc-select')).not.toBeNull();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('social.einsatz.invite'))?.click();
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    expect(rpc).toHaveBeenCalledWith('share_einsatz', { p_einsatz: 'e1', p_friend: 'f1', p_group: null });
  });
});
