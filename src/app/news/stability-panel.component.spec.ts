import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityPanelComponent } from './stability-panel.component';
import { StabilityVerdict } from './patch-stability';

const base: StabilityVerdict = {
  line: '4.10', liveAt: '2026-08-26T00:00:00Z', daysLive: 10, level: 3, score: 0.437,
  components: { community: 0.49, service: 0, cig: 0.31 }, early: true, insufficient: false, historical: false,
  days: [
    { date: '2026-09-04', velocity: 30, score: 0.4, level: 3, components: { community: 0.4, service: 0, cig: 0.3 }, hotfixes: [] },
    { date: '2026-09-05', velocity: 39, score: 0.437, level: 3, components: { community: 0.49, service: 0, cig: 0.31 },
      hotfixes: [{ date: '2026-09-05', build: '12572603', text: 'Client Hotfix' }] },
  ],
  tickets: [{ id: 'STARC-218134', votes: 13, excerpt: 'Battaglia Story Mission 2 does not show up' }],
  kbOpen: 55, hotfixes: [],
};

describe('StabilityPanelComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityPanelComponent, TranslateModule.forRoot()] }));

  function render(v: StabilityVerdict) {
    const f = TestBed.createComponent(StabilityPanelComponent);
    f.componentRef.setInput('verdict', v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders headline, three component bars, a column per day with hotfix marks, and ticket anchors', () => {
    const el = render(base);
    expect(el.querySelector('.headline')!.getAttribute('data-level')).toBe('3');
    expect(el.querySelectorAll('.comp').length).toBe(3);
    expect(el.querySelectorAll('.col').length).toBe(2);
    expect(el.querySelectorAll('.col.hotfix').length).toBe(1);
    expect(el.querySelectorAll('.col.early').length).toBe(2);
    const a = el.querySelector('a.ticket') as HTMLAnchorElement;
    expect(a.href).toContain('issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-218134');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('historical verdict: headline + end-state note, no timeline', () => {
    const el = render({ ...base, historical: true, early: false, days: [], tickets: [], kbOpen: null });
    expect(el.querySelector('.headline')).not.toBeNull();
    expect(el.querySelector('.chart')).toBeNull();
    expect(el.querySelector('.state.historical')).not.toBeNull();
  });

  it('insufficient verdict: only the "not enough data" state', () => {
    const el = render({ ...base, insufficient: true, level: null, score: null });
    expect(el.querySelector('.headline')).toBeNull();
    expect(el.querySelector('.state.insufficient')).not.toBeNull();
  });
});
