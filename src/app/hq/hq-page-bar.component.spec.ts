import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { BetaService } from '../core/beta.service';
import { HqPageBarComponent } from './hq-page-bar.component';
import { HqPageNavService } from './hq-page-nav.service';

describe('HqPageBarComponent', () => {
  function setup(shell: boolean) {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        { provide: BetaService, useValue: { state: signal({ verse: true, codex: true, shell }), isEnabled: () => () => shell } },
        {
          provide: HqPageNavService,
          useValue: { pages: ['start', 'plan'], href: (p: string) => '/hq#' + p, go: () => undefined, active: () => 'start' },
        },
      ],
    });
    const f = TestBed.createComponent(HqPageBarComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  // Karma renders at 749px, wider than the 720px phone query that moves the bar, so the
  // stacking itself (bottom offset above the docked fusion bar) cannot be measured here; it was
  // measured in a 390px phone viewport (bar bottom 764, fusion bar top 772). What the spec pins
  // is the switch that selects that rule.
  it('stacks above the docked fusion bar only with the beta shell (class switch)', () => {
    expect(setup(true).classList).toContain('above-bar');
    TestBed.resetTestingModule();
    expect(setup(false).classList).not.toContain('above-bar');
  });

  it('names every tab for assistive tech (icon-only on narrow legacy phones)', () => {
    const tabs = Array.from(setup(false).querySelectorAll('a.tab')) as HTMLAnchorElement[];
    expect(tabs.length).toBe(2);
    expect(tabs.every((a) => !!a.getAttribute('aria-label'))).toBe(true);
  });
});
