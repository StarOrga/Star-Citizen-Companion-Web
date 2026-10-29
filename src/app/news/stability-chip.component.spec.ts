import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { PatchStabilityVotesService } from './patch-stability-votes.service';
import type { CommunityCorrection, StabilityVerdict } from './patch-stability';
import { StabilityChipComponent, StabilityChipData, chipFromVerdict } from './stability-chip.component';

const EN = {
  stability: {
    word: { stabil: 'Stable', wackelig: 'Shaky', instabil: 'Unstable' },
    noData: 'Not enough data',
    tip: {
      noData: 'No rating yet', better: '{{d}} points stronger than {{prev}} ({{p}} %)', worse: '{{d}} points weaker than {{prev}} ({{p}} %)',
      same: 'about the same as {{prev}} ({{p}} %)', community: 'of which {{c}} from the community verdict', early: 'still provisional', open: 'click opens the calculation',
    },
  },
};

const data = (extra: Partial<StabilityChipData> = {}): StabilityChipData => ({
  line: '4.3', percent: 59, early: false, finished: false, previous: 73, previousLabel: '4.2', ...extra,
});

describe('StabilityChipComponent', () => {
  const votesLine = signal<string | null>(null);
  let correction: CommunityCorrection | null = null;
  const ensured: string[] = [];

  beforeEach(() => {
    votesLine.set(null);
    correction = null;
    ensured.length = 0;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideTranslateService({}),
        { provide: PatchStabilityVotesService, useValue: { line: votesLine, correctionFor: () => correction, ensure: (l: string) => ensured.push(l) } },
      ],
    });
    const t = TestBed.inject(TranslateService);
    t.setTranslation('en', EN);
    t.use('en');
  });

  function render(d: StabilityChipData | null, inputs: Record<string, unknown> = {}) {
    const f = TestBed.createComponent(StabilityChipComponent);
    f.componentRef.setInput('data', d);
    for (const [k, v] of Object.entries(inputs)) f.componentRef.setInput(k, v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('shows indicator, word and percent, and links to the long form of the line', () => {
    const el = render(data());
    const chip = el.querySelector('a.chip')!;
    expect(chip.textContent!.trim()).toBe('▼Shaky59 %');
    expect(chip.getAttribute('data-word')).toBe('wackelig');
    expect(chip.getAttribute('href')).toBe('/verse/patches/4.3#stabilitaet');
  });

  it('picks ▲ / ▼ / ≈ against the previous value with a threshold of 3 points', () => {
    const glyph = (d: StabilityChipData) => render(d).querySelector('.ind')?.textContent;
    expect(glyph(data({ percent: 82, previous: 73 }))).toBe('▲');
    expect(glyph(data({ percent: 59, previous: 73 }))).toBe('▼');
    expect(glyph(data({ percent: 66, previous: 64 }))).toBe('≈');
    expect(glyph(data({ previous: null }))).toBeUndefined();
  });

  it('words follow the one scale: stabil from 75, wackelig from 45, instabil below', () => {
    const word = (p: number) => render(data({ percent: p })).querySelector('.chip')!.getAttribute('data-word');
    expect([word(75), word(74), word(45), word(44)]).toEqual(['stabil', 'wackelig', 'wackelig', 'instabil']);
  });

  it('provisional: dashed and without indicator; finished: plain without indicator', () => {
    const early = render(data({ early: true })).querySelector('.chip')!;
    expect(early.classList.contains('early')).toBeTrue();
    expect(early.querySelector('.ind')).toBeNull();
    const done = render(data({ finished: true })).querySelector('.chip')!;
    expect(done.classList.contains('finished')).toBeTrue();
    expect(done.classList.contains('early')).toBeFalse();
    expect(done.querySelector('.ind')).toBeNull();
    expect(done.textContent).toContain('59 %');
  });

  it('too little data: grey, no percent, no indicator', () => {
    const chip = render(data({ percent: null })).querySelector('.chip')!;
    expect(chip.classList.contains('nodata')).toBeTrue();
    expect(chip.textContent!.trim()).toBe('Not enough data');
    expect(chip.querySelector('.ind, .pct')).toBeNull();
  });

  it('tooltip text names the word, the comparison and the way to the calculation', () => {
    const label = render(data()).querySelector('.chip')!.getAttribute('aria-label');
    expect(label).toBe('Shaky · 59 % — 14 points weaker than 4.2 (73 %) · click opens the calculation');
    expect(render(data({ early: true, previous: 60 })).querySelector('.chip')!.getAttribute('aria-label')).toContain('about the same as 4.2 (60 %)');
    expect(render(data({ early: true })).querySelector('.chip')!.getAttribute('aria-label')).toContain('still provisional');
  });

  it('a live chip adds the community correction to the number and names it in the tooltip', () => {
    votesLine.set('4.3');
    correction = { state: 'applied', correction: -5, nEff: 80, shares: { stabil: 0.2, wackelig: 0.5, instabil: 0.3 }, halfWidth: 6, votes: 87 };
    const el = render(data({ percent: 64 }), { live: true });
    expect(el.querySelector('.pct')!.textContent).toBe('59 %');
    expect(el.querySelector('.chip')!.getAttribute('aria-label')).toContain('of which −5 from the community verdict');
    expect(ensured).toEqual(['4.3']);
    // a chip that is not the LIVE one never takes the correction
    expect(render(data({ percent: 64 })).querySelector('.pct')!.textContent).toBe('64 %');
  });

  it('linked=false renders a span, so the chip can sit inside an anchor', () => {
    const el = render(data(), { linked: false });
    expect(el.querySelector('a')).toBeNull();
    expect(el.querySelector('span.chip')!.getAttribute('aria-label')).not.toContain('click opens');
  });

  it('chipFromVerdict maps a verdict and nulls an insufficient one', () => {
    const v = { line: '4.3', stability: 59, early: true, insufficient: false } as unknown as StabilityVerdict;
    expect(chipFromVerdict(v, { previous: 73, previousLabel: '4.2' })).toEqual(data({ early: true }));
    expect(chipFromVerdict({ ...v, insufficient: true }, {})?.percent).toBeNull();
    expect(chipFromVerdict(null)).toBeNull();
    expect(render(null).querySelector('.chip')).toBeNull();
  });
});
