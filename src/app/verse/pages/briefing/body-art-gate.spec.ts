import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingTransmitComponent, TX_ART_MS } from './briefing-transmit.component';

// QA D12: the planets' CSS art (SVG feTurbulence) is never painted while the living planet can still come.
describe('body art gate (D12)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [BriefingTransmitComponent], providers: [provideRouter([]), provideTranslateService()] });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the CSS art off until the fallback wait has passed', () => {
    const fixture = TestBed.createComponent(BriefingTransmitComponent);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const pl = host.querySelector<HTMLElement>('a.pl')!;
    expect(host.classList.contains('art')).toBe(false);
    expect(getComputedStyle(pl).backgroundImage).toBe('none');
    vi.advanceTimersByTime(TX_ART_MS);
    fixture.detectChanges();
    expect(host.classList.contains('art')).toBe(true);
    expect(getComputedStyle(pl).backgroundImage).toContain('crusader.svg');
  });
});
