import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityChipComponent } from './stability-chip.component';
import { StabilityVerdict } from './patch-stability';

function verdict(extra: Partial<StabilityVerdict>): StabilityVerdict {
  return {
    line: '4.10', liveAt: '2026-08-26T00:00:00Z', daysLive: 10, level: 3, score: 0.44,
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

  it('renders the level with its data attribute and the early marker', () => {
    const el = render(verdict({}));
    const chip = el.querySelector('.chip')!;
    expect(chip.getAttribute('data-level')).toBe('3');
    expect(chip.classList.contains('early')).toBeTrue();
  });

  it('renders nothing when insufficient or null', () => {
    expect(render(verdict({ insufficient: true, level: null })).querySelector('.chip')).toBeNull();
    expect(render(null).querySelector('.chip')).toBeNull();
  });
});
