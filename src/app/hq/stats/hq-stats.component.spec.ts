import { HqLiveService } from '../now/hq-live.service';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { HqStatsComponent } from './hq-stats.component';

const liveState = signal<Record<string, unknown> | null>(null);

describe('HqStatsComponent', () => {
  function mount(rpc: jasmine.Spy) {
    TestBed.configureTestingModule({
      imports: [HqStatsComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: SupabaseClientProvider, useValue: { client: { rpc } } },
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: HqLiveService, useValue: { state: liveState } },
      ],
    });
    const fixture = TestBed.createComponent(HqStatsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => liveState.set(null));

  it('offers no app start in the overlay once the SCC app reports game data', async () => {
    liveState.set({ location: 'Lorville' });
    const fixture = mount(jasmine.createSpy('rpc').and.resolveTo({ data: {}, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.overlay')).toBeTruthy();
    expect(el.querySelector('.overlay sc-hq-app-launch')).toBeNull();
  });

  describe('contract completion tile', () => {
    async function tile(data: Record<string, unknown>): Promise<HTMLElement> {
      const fixture = mount(jasmine.createSpy('rpc').and.resolveTo({ data, error: null }));
      await fixture.whenStable();
      fixture.detectChanges();
      const tiles: HTMLElement[] = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button.tile'));
      return tiles.find((t) => t.textContent?.includes('hq.stats.tile.contracts.name')) as HTMLElement;
    }

    it('shows the rate and stays neutral while completed contracts outweigh the rest', async () => {
      const t = await tile({ missions: { total: 3, series: [] }, contracts: { failed: 1, abandoned: 0, series: [] } });
      expect(t.querySelector('.t-value')?.textContent).toBe('75 %');
      expect(t.classList.contains('warn')).toBeFalse();
    });

    it('warns when failed and abandoned contracts exceed the completed ones', async () => {
      const t = await tile({ missions: { total: 1, series: [] }, contracts: { failed: 1, abandoned: 1, series: [] } });
      expect(t.querySelector('.t-value')?.textContent).toBe('33 %');
      expect(t.classList.contains('warn')).toBeTrue();
    });

    it('shows no rate without a finished contract', async () => {
      const t = await tile({ auec: { earned: 10, spent: 0, net: 10, series: [] } });
      expect(t.querySelector('.t-value')?.textContent).toBe('–');
      expect(t.classList.contains('zero')).toBeTrue();
    });
  });

  it('shows marked, inert preview tiles under an app overlay for empty data - no wall of zeros, no error', async () => {
    const fixture = mount(jasmine.createSpy('rpc').and.resolveTo({ data: {}, error: null }));
    await fixture.whenStable();
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const ghost = el.querySelector('.tiles.ghost') as HTMLElement;
    expect(ghost).toBeTruthy();
    expect(ghost.hasAttribute('inert')).toBeTrue();
    expect(ghost.getAttribute('aria-hidden')).toBe('true');
    expect(ghost.querySelectorAll('.tile').length).toBe(7);
    expect(ghost.querySelectorAll('.stamp').length).toBe(7);
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
