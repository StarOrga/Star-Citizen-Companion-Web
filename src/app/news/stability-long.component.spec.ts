import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { LocaleService } from '../core/locale/locale.service';
import { communityCorrection, componentDeductions, type StabilityVerdict, type VoteAggregate } from './patch-stability';
import { PatchStabilityVotesService } from './patch-stability-votes.service';
import { StabilityLongComponent } from './stability-long.component';

const VERDICT: StabilityVerdict = {
  line: '4.3', liveAt: '2026-10-20T00:00:00Z', daysLive: 9, level: 3, score: 0.36, stability: 64, tone: 'amber',
  components: { community: 0.6, service: 0.3, cig: 0.2 }, early: true, insufficient: false, historical: false,
  days: [{ date: '2026-10-28', velocity: 40, score: 0.36, level: 3, components: { community: 0.6, service: 0.3, cig: 0.2 }, hotfixes: [] }],
  tickets: [{ id: 'STARC-1', votes: 48, excerpt: 'Quantum breaks' }], kbOpen: 38, hotfixes: [], replies: 412, threads: 2, outageMin7d: 90,
};

const AGG: VoteAggregate = { wStabil: 22, wWackelig: 43, wInstabil: 21, sumW: 86, sumW2: 86, votes: 87, ownVerdict: null, ownNextChangeAt: null };

describe('componentDeductions', () => {
  it('splits 100 − S over the components so that the parts add up exactly', () => {
    const d = componentDeductions({ community: 0.6, service: 0.3, cig: 0.2 }, 64);
    expect((d.community ?? 0) + (d.service ?? 0) + (d.cig ?? 0)).toBe(36);
    expect(d.community!).toBeGreaterThan(d.service!);
    const two = componentDeductions({ community: 0.5, service: null, cig: 0.1 }, 70);
    expect(two.service).toBeNull();
    expect((two.community ?? 0) + (two.cig ?? 0)).toBe(30);
  });
});

describe('StabilityLongComponent', () => {
  const agg = signal<VoteAggregate | null>(AGG);
  const blind = signal(false);

  beforeEach(() => {
    agg.set(AGG);
    blind.set(false);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        {
          provide: PatchStabilityVotesService,
          useValue: {
            line: signal('4.3'), aggregate: agg.asReadonly(), error: signal(null).asReadonly(), saving: signal(false).asReadonly(), blind,
            own: () => ({ verdict: null, nextChangeAt: null }),
            correctionFor: (s: number) => (agg() ? communityCorrection(s, agg() as VoteAggregate) : null),
            ensure: () => undefined, load: async () => undefined, reveal: () => blind.set(false), castVote: async () => 'ok',
          },
        },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: LocaleService, useValue: { intlLocale: () => 'en' } },
      ],
    });
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', {});
    t.use('en');
  });

  function render(inputs: Record<string, unknown>): HTMLElement {
    const f = TestBed.createComponent(StabilityLongComponent);
    for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('shows the corrected number in the head and the deduction sum ending on it', () => {
    const el = render({ verdict: VERDICT, live: true, previous: { line: '4.2', percent: 73 } });
    const corr = communityCorrection(64, AGG).correction;
    expect(el.querySelector('.hp')!.textContent).toBe(`${64 + corr} %`);
    expect(el.querySelector('.sum .total b')!.textContent).toBe(String(64 + corr));
    expect(el.querySelectorAll('.sum .ded').length).toBe(4);
    expect(el.querySelector('.sum .comm b')!.textContent).toBe(corr === 0 ? '±0' : `${corr > 0 ? '+' : '−'}${Math.abs(corr)}`);
    expect(el.querySelector('.ghost')).not.toBeNull();
    expect(el.querySelectorAll('.tk-list .ticket').length).toBe(1);
    expect(el.querySelector('sc-community-verdict')).not.toBeNull();
  });

  it('a finished line shows the computed number only: no Community-Urteil row and no vote card', () => {
    const el = render({ verdict: VERDICT, live: false, previous: null });
    expect(el.querySelector('.hp')!.textContent).toBe('64 %');
    expect(el.querySelector('.sum .comm')).toBeNull();
    expect(el.querySelector('sc-community-verdict')).toBeNull();
    expect(el.querySelector('.ghost')).toBeNull();
  });

  it('blind: the number is blurred and inert, the vote card leads', () => {
    blind.set(true);
    const el = render({ verdict: VERDICT, live: true, previous: null });
    const calc = el.querySelector('.calc')!;
    expect(calc.classList.contains('blind')).toBeTrue();
    expect(calc.hasAttribute('inert')).toBeTrue();
    expect(el.querySelectorAll('sc-community-verdict').length).toBe(1);
    expect(el.firstElementChild!.tagName.toLowerCase()).toBe('sc-community-verdict');
  });

  it('without loaded votes the stability still renders from the computed number', () => {
    agg.set(null);
    const el = render({ verdict: VERDICT, live: true, previous: null });
    expect(el.querySelector('.hp')!.textContent).toBe('64 %');
    expect(el.querySelector('.sum .comm')).toBeNull();
  });
});
