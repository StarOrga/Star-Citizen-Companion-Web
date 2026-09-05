import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityChipComponent } from './stability-chip.component';
import { StabilityVerdict, stabilityPercent, toneOf } from './patch-stability';

function verdict(extra: Partial<StabilityVerdict>): StabilityVerdict {
  return {
    line: '4.10', liveAt: '2026-08-26T00:00:00Z', daysLive: 10, level: 3, score: 0.44,
    stability: stabilityPercent(0.44), tone: toneOf(3),
    components: { community: 0.49, service: 0, cig: 0.31 }, early: true, insufficient: false, historical: false,
    days: [], tickets: [], kbOpen: 55, hotfixes: [], ...extra,
  };
}

describe('StabilityChipComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityChipComponent, TranslateModule.forRoot()] }));

  function render(v: StabilityVerdict | null) {
    const f = TestBed.createComponent(StabilityChipComponent);
    f.componentRef.setInput('verdict', v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders the traffic light, the surviving percentage and the early marker', () => {
    const el = render(verdict({}));
    const chip = el.querySelector('.chip')!;
    // level 3 is the middle of the scale → amber, and 0.44 penalty leaves 56 %.
    expect(chip.getAttribute('data-tone')).toBe('amber');
    expect(chip.querySelector('.pct')!.textContent!.trim()).toBe('56%');
    expect(chip.classList.contains('early')).toBeTrue();
  });

  it('a calm patch is green, a broken one red', () => {
    expect(render(verdict({ level: 1, tone: toneOf(1), score: 0.1, stability: stabilityPercent(0.1) }))
      .querySelector('.chip')!.getAttribute('data-tone')).toBe('green');
    expect(render(verdict({ level: 5, tone: toneOf(5), score: 0.8, stability: stabilityPercent(0.8) }))
      .querySelector('.chip')!.getAttribute('data-tone')).toBe('red');
  });

  it('renders nothing when insufficient or null', () => {
    expect(render(verdict({ insufficient: true, level: null, stability: null, tone: null })).querySelector('.chip')).toBeNull();
    expect(render(null).querySelector('.chip')).toBeNull();
  });
});
