import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { StabilityBadgeComponent } from './stability-badge.component';
import { StabilityVerdict, stabilityPercent, toneOf } from './patch-stability';

function verdict(extra: Partial<StabilityVerdict> = {}): StabilityVerdict {
  return {
    line: '4.10', liveAt: '2026-08-26T00:00:00Z', daysLive: 20, level: 2, score: 0.2,
    stability: stabilityPercent(0.2), tone: toneOf(2),
    components: { community: 0.2, service: 0, cig: 0.1 }, early: false, insufficient: false, historical: false,
    days: [], tickets: [], kbOpen: 5, hotfixes: [], ...extra,
  };
}

describe('StabilityBadgeComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityBadgeComponent], providers: [provideTranslateService({})] }));

  function render(v: StabilityVerdict | null, size?: 'sm' | 'md' | 'lg') {
    const f = TestBed.createComponent(StabilityBadgeComponent);
    f.componentRef.setInput('verdict', v);
    if (size) f.componentRef.setInput('size', size);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders the ring with the surviving percentage, tone and size', () => {
    const el = render(verdict(), 'lg');
    const badge = el.querySelector<HTMLElement>('.badge')!;
    expect(badge.getAttribute('role')).toBe('img');
    expect(badge.getAttribute('data-tone')).toBe(toneOf(2));
    expect(badge.getAttribute('data-size')).toBe('lg');
    expect(badge.querySelector('.val')!.textContent).toContain(String(stabilityPercent(0.2)));
    expect(badge.style.getPropertyValue('--fill')).toBe(`${stabilityPercent(0.2)}%`);
    expect(badge.classList.contains('early')).toBeFalse();
    expect(badge.getAttribute('aria-label')).toBeTruthy();
  });

  it('marks an early verdict and adds the early caveat to its label', () => {
    const badge = render(verdict({ early: true, daysLive: 3 })).querySelector('.badge')!;
    expect(badge.classList.contains('early')).toBeTrue();
    expect(badge.getAttribute('aria-label')).toContain('news.patch.stability.early');
  });

  it('renders nothing for null, insufficient or level-less verdicts', () => {
    expect(render(null).querySelector('.badge')).toBeNull();
    expect(render(verdict({ insufficient: true, level: null, stability: null, tone: null })).querySelector('.badge')).toBeNull();
    expect(render(verdict({ level: null })).querySelector('.badge')).toBeNull();
  });
});
