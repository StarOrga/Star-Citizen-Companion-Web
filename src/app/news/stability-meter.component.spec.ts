import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { StabilityMeterComponent } from './stability-meter.component';

describe('StabilityMeterComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityMeterComponent], providers: [provideTranslateService({})] }));

  function render(percent: number | null, level: 1 | 2 | 3 | 4 | 5 | null = null, label: string | null = null): HTMLElement {
    const f = TestBed.createComponent(StabilityMeterComponent);
    f.componentRef.setInput('percent', percent);
    f.componentRef.setInput('level', level);
    f.componentRef.setInput('label', label);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('fills bars in steps of 20 points and shows the number', () => {
    const el = render(72, 2);
    expect(el.querySelectorAll('.bars i.f').length).toBe(4);
    expect(el.querySelector('.pct')!.textContent).toContain('72');
    expect(el.querySelector('.m')!.classList.contains('weak')).toBeFalse();
  });

  it('goes warning amber below 70 percent and for amber levels', () => {
    expect(render(61, 1).querySelector('.m')!.classList.contains('weak')).toBeTrue();
    expect(render(90, 4).querySelector('.m')!.classList.contains('weak')).toBeTrue();
  });

  it('renders the empty scale without data', () => {
    const el = render(null);
    expect(el.querySelectorAll('.bars i.f').length).toBe(0);
    expect(el.querySelector('.m')!.classList.contains('none')).toBeTrue();
    expect(el.querySelector('.cap')).toBeNull();
  });

  it('an explicit empty label hides the caption', () => {
    expect(render(80, 1, '').querySelector('.cap')).toBeNull();
  });
});
