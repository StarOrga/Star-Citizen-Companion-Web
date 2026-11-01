import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqStatsComponent } from './hq-stats.component';

describe('HqStatsComponent', () => {
  function mount(rpc: jasmine.Spy) {
    TestBed.configureTestingModule({
      imports: [HqStatsComponent],
      providers: [
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStatsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders six zero tiles for empty data without an error', async () => {
    const fixture = mount(jasmine.createSpy('rpc').and.resolveTo({ data: {}, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.tile').length).toBe(6);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('#hq-stats-title')).toBeTruthy();
  });

  it('renders figures for full data and opens a detail dialog', async () => {
    const fixture = mount(
      jasmine.createSpy('rpc').and.resolveTo({
        data: {
          bucket: 'day',
          auec: { earned: 1000, spent: 400, net: 600, series: [] },
          missions: { total: 5, series: [] },
          deaths_claims: { deaths: 2, claims: 1, series: [] },
        },
        error: null,
      }),
    );
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('600');
    (el.querySelector('.tile') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('shows an error state with retry when the load fails', async () => {
    const fixture = mount(jasmine.createSpy('rpc').and.resolveTo({ data: null, error: new Error('boom') }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="alert"]')).toBeTruthy();
    expect(el.querySelector('.tile')).toBeNull();
  });
});
