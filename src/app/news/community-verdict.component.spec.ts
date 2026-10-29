import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { LocaleService } from '../core/locale/locale.service';
import { CommunityVerdictComponent } from './community-verdict.component';
import { communityCorrection, type VoteAggregate } from './patch-stability';
import { CastResult, PatchStabilityVotesService } from './patch-stability-votes.service';

const AGG: VoteAggregate = {
  wStabil: 22, wWackelig: 43, wInstabil: 21, sumW: 86, sumW2: 86, votes: 87, ownVerdict: null, ownNextChangeAt: null,
};
const FEW: VoteAggregate = { ...AGG, wStabil: 3, wWackelig: 6, wInstabil: 3, sumW: 12, sumW2: 12, votes: 12 };

const EN = {
  errors: { retry: 'Retry', generic: 'Something went wrong' },
  stability: {
    word: { stabil: 'Stable', wackelig: 'Shaky', instabil: 'Unstable' },
    vote: {
      title: 'Community verdict', loading: 'Loading', tooFew: 'Not enough votes ({{n}} of {{min}})', tooFewSub: 'collecting',
      applied: 'Applied {{c}} ({{n}} votes, range {{hw}})', split: 'Split', splitSub: 'differs', confirmed: 'Confirmed', confirmedSub: 'in range',
      sum: '{{n}} votes, {{c}}', yours: 'your verdict', blindTitle: 'Your verdict first', ask: 'How stable is {{line}}?', mine: 'Your verdict:',
      changeFrom: 'changeable from {{time}}', hint: { stabil: 'a', wackelig: 'b', instabil: 'c' }, cannotJudge: 'Cannot judge', showNumber: 'Show number',
      tooSoon: 'Wait {{h}} h', rules: 'rules', signedOut: 'Sign in to vote.', signIn: 'Sign in',
    },
  },
};

describe('CommunityVerdictComponent', () => {
  const agg = signal<VoteAggregate | null>(AGG);
  const error = signal<string | null>(null);
  const blind = signal(false);
  const user = signal<{ id: string } | null>({ id: 'u1' });
  const saving = signal(false);
  let castResult: CastResult = 'ok';
  const calls = { cast: [] as string[], load: 0, reveal: 0 };

  const votes = {
    line: signal('4.3'),
    aggregate: agg.asReadonly(),
    error: error.asReadonly(),
    saving: saving.asReadonly(),
    blind,
    own: () => ({ verdict: agg()?.ownVerdict ?? null, nextChangeAt: agg()?.ownNextChangeAt ?? null }),
    correctionFor: (s: number) => (agg() ? communityCorrection(s, agg() as VoteAggregate) : null),
    ensure: () => undefined,
    load: async () => { calls.load++; },
    reveal: () => { calls.reveal++; blind.set(false); },
    castVote: async (_line: string, w: string) => { calls.cast.push(w); return castResult; },
  };

  beforeEach(() => {
    agg.set(AGG);
    error.set(null);
    blind.set(false);
    user.set({ id: 'u1' });
    castResult = 'ok';
    calls.cast = [];
    calls.load = 0;
    calls.reveal = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: PatchStabilityVotesService, useValue: votes },
        { provide: AuthService, useValue: { user } },
        { provide: LocaleService, useValue: { intlLocale: () => 'en' } },
      ],
    });
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', EN);
    t.use('en');
  });

  function render(stability = 64) {
    const fixture = TestBed.createComponent(CommunityVerdictComponent);
    fixture.componentRef.setInput('line', '4.3');
    fixture.componentRef.setInput('stability', stability);
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, fixture };
  }

  const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLButtonElement>('.vb'));

  it('blind: only the vote entry shows, with the escape hatches, and the distribution stays hidden', () => {
    blind.set(true);
    const { el } = render();
    expect(el.querySelector('.bar')).toBeNull();
    expect(el.textContent).toContain('Your verdict first');
    expect(buttons(el).map((b) => b.querySelector('b')!.textContent)).toEqual(['Stable', 'Shaky', 'Unstable']);
    const links = Array.from(el.querySelectorAll<HTMLButtonElement>('.lnk'));
    expect(links.map((b) => b.textContent!.trim())).toEqual(['Cannot judge', 'Show number']);
    links[1].click();
    expect(calls.reveal).toBe(1);
  });

  it('casts a vote through the service when a button is pressed', async () => {
    blind.set(true);
    const { el, fixture } = render();
    buttons(el)[1].click();
    await fixture.whenStable();
    expect(calls.cast).toEqual(['wackelig']);
    expect(calls.reveal).toBe(1);
  });

  it('after the vote: own verdict, change lock time, own entry marked, correction visible', () => {
    agg.set({ ...AGG, ownVerdict: 'wackelig', ownNextChangeAt: new Date(Date.now() + 5 * 3_600_000).toISOString() });
    const { el } = render(80);
    expect(el.querySelector('.mine')!.textContent).toContain('Shaky');
    expect(el.querySelector('.mine')!.textContent).toContain('changeable from');
    expect(el.querySelector('.bar')).not.toBeNull();
    expect(el.querySelector('.legend li.own')!.textContent).toContain('your verdict');
    expect(buttons(el).map((b) => b.disabled)).toEqual([true, true, true]);
    expect(buttons(el)[1].getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.line')!.textContent).toContain('Applied');
  });

  it('after the lock the verdict can be changed', () => {
    agg.set({ ...AGG, ownVerdict: 'wackelig', ownNextChangeAt: new Date(Date.now() - 1000).toISOString() });
    const { el } = render(64);
    expect(buttons(el).map((b) => b.disabled)).toEqual([false, true, false]);
  });

  it('a DB refusal (too soon) shows the wait notice', async () => {
    castResult = 'too-soon';
    const { el, fixture } = render();
    buttons(el)[0].click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.notice')!.textContent).toContain('Wait 12 h');
  });

  it('too few votes: no distribution, no correction', () => {
    agg.set(FEW);
    const { el } = render();
    expect(el.querySelector('.bar')).toBeNull();
    expect(el.textContent).toContain('Not enough votes (12 of 25)');
  });

  it('signed out: the result shows normally with a sign-in hint instead of vote buttons', () => {
    user.set(null);
    const { el } = render();
    expect(buttons(el).length).toBe(0);
    expect(el.querySelector('.signin a')!.getAttribute('href')).toContain('/login');
    expect(el.querySelector('.bar')).not.toBeNull();
  });

  it('a failed load is an error state with retry, never an empty one', () => {
    agg.set(null);
    error.set('errors.generic');
    const { el } = render();
    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    el.querySelector<HTMLButtonElement>('.state button')!.click();
    expect(calls.load).toBe(1);
  });
});
