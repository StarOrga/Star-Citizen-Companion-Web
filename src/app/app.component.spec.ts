import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTranslateService } from '@ngx-translate/core';
import { User } from '@supabase/supabase-js';
import { AppComponent } from './app.component';
import { AuthService } from './auth/auth.service';
import { PresenceService } from './auth/presence.service';
import { RoleService } from './auth/role.service';
import { LocaleService } from './core/locale/locale.service';
import { SupabaseClientProvider } from './core/supabase.client';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideTranslateService({ fallbackLang: 'en' }),
        // SwUpdateService (injected by AppComponent) depends on SwUpdate, which
        // needs the ngsw comm channel. Disabled keeps it inert under test.
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
      ],
    }).compileComponents();
  });

  it('creates the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});

/**
 * AUD-198: the profile's language/region used to be applied once per
 * DOCUMENT, so signing out and in as another account in the same tab kept the
 * first account's locale. Now it is once per ACCOUNT, and signing out drops
 * the old profile values.
 */
describe('AppComponent — profile locale on account switch', () => {
  const user = signal<User | null>(null);
  const langs: Record<string, string> = { a: 'de', b: 'en' };

  /** Just enough of the query chain the component walks: from().select().eq().maybeSingle(). */
  const sbStub = {
    client: {
      from: () => ({
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: () =>
              Promise.resolve({ data: { preferred_lang: langs[id], preferred_region: null } }),
          }),
        }),
      }),
    },
  };

  beforeEach(async () => {
    user.set(null);
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(withXhr()),
        provideTranslateService({ fallbackLang: 'en' }),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
        // AppComponent.ngOnInit calls auth.init() and presence.init().
        { provide: AuthService, useValue: { user, init: () => undefined } as Partial<AuthService> },
        // Real PresenceService would reach realClient.rpc through the stub below.
        { provide: PresenceService, useValue: { init: () => undefined } as Partial<PresenceService> },
        // The impersonation banner reads the real role; keep it off the DB.
        { provide: RoleService, useValue: { realRole: signal(null) } as unknown as RoleService },
        { provide: SupabaseClientProvider, useValue: sbStub as unknown as SupabaseClientProvider },
      ],
    }).compileComponents();
  });

  it('hydrates the profile per account and clears it on sign-out', async () => {
    const locale = TestBed.inject(LocaleService);
    const hydrate = spyOn(locale, 'hydrateFromProfile');
    const clear = spyOn(locale, 'clearProfile');
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    // Boot with no user: nothing applied, nothing cleared.
    expect(hydrate).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    user.set({ id: 'a' } as User);
    TestBed.tick();
    await fixture.whenStable();
    expect(hydrate).toHaveBeenCalledTimes(1);
    expect(hydrate.calls.mostRecent().args[0]).toBe('de');

    user.set(null);
    TestBed.tick();
    await fixture.whenStable();
    expect(clear).toHaveBeenCalledTimes(1);

    user.set({ id: 'b' } as User);
    TestBed.tick();
    await fixture.whenStable();
    expect(hydrate).toHaveBeenCalledTimes(2);
    expect(hydrate.calls.mostRecent().args[0]).toBe('en');
  });
});
