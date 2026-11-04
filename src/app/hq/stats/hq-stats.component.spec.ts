import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqStatsComponent } from './hq-stats.component';

describe('HqStatsComponent', () => {
  function mount(rpc: jasmine.Spy) {
    TestBed.configureTestingModule({
      imports: [HqStatsComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
      ],
    });
    const fixture = TestBed.createComponent(HqStatsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('shows marked, inert preview tiles under an app overlay for empty data - no wall of zeros, no error', async () => {
    const fixture = mount(jasmine.createSpy('rpc').and.resolveTo({ data: {}, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const ghost = el.querySelector('.tiles.ghost') as HTMLElement;
    expect(ghost).toBeTruthy();
    expect(ghost.hasAttribute('inert')).toBeTrue();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelectorAll('.tile').length).toBe(6);
    expect(ghost.querySelectorAll('.stamp').length).toBe(6);
    expect(el.querySelectorAll('button.tile').length).toBe(0);
    expect(el.querySelector('.overlay sc-hq-app-launch')).toBeTruthy();
    expect(el.querySelector('.overlay a[href="/apps"]')).toBeNull();
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
    expect(el.querySelector('.overlay')).toBeNull();
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
