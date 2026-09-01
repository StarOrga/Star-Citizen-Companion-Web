import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import type { User } from '@supabase/supabase-js';
import { AuthService } from '../auth/auth.service';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { AnalyticsService } from '../core/analytics.service';
import { ComposerPrefsService } from '../core/composer-prefs.service';
import { ConsentService } from '../core/consent.service';
import { LocaleService } from '../core/locale/locale.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { SettingsComponent } from './settings.component';

/**
 * Layout + account-card contract of the settings page (feedback af058ca4).
 *
 * The geometry assertions are MEASURED in the real browser, not asserted
 * against the stylesheet: the reported bug was two dropdowns overlapping, and
 * only a layout read can prove that they no longer can. The host element is
 * sized explicitly so the phone case is covered as well as the desktop one —
 * the locale grid is container-driven (`auto-fit` + `minmax`), so its wrap
 * behaviour follows the host box, not the Karma window.
 */
describe('SettingsComponent layout', () => {
  function makeUser(overrides: Partial<User> = {}): User {
    return {
      id: '11111111-2222-3333-4444-555555555555',
      email: 'pilot@example.com',
      created_at: '2025-01-15T10:00:00.000Z',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: {},
      aud: 'authenticated',
      identities: [
        { provider: 'google' },
        { provider: 'email' },
      ],
      ...overrides,
    } as unknown as User;
  }

  function setup(user: User | null = makeUser(), width = '360px') {
    TestBed.configureTestingModule({
      imports: [SettingsComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: AuthService,
          useValue: { user: signal(user), signOut: async () => undefined },
        },
        { provide: RoleService, useValue: { role: signal('admin') } },
        {
          provide: ProfileService,
          useValue: {
            username: signal('nomad'),
            loaded: signal(true),
            refresh: async () => undefined,
            setUsername: async () => ({ error: null }),
          },
        },
        {
          provide: ConsentService,
          useValue: {
            preferencesAllowed: signal(true),
            statisticsAllowed: signal(false),
            setPreferences: () => undefined,
            setStatistics: () => undefined,
          },
        },
        {
          provide: ComposerPrefsService,
          useValue: { sendOnEnter: signal(true), setSendOnEnter: () => undefined },
        },
        {
          provide: LocaleService,
          useValue: {
            language: signal('de'),
            languageSetting: signal('auto'),
            languageIsAuto: signal(true),
            region: signal('DE'),
            regionSetting: signal('auto'),
            regionIsAuto: signal(true),
            setLanguage: () => undefined,
            setRegion: () => undefined,
          },
        },
        { provide: AnalyticsService, useValue: { capture: () => undefined } },
        {
          provide: SupabaseClientProvider,
          useValue: {
            client: {
              rpc: () => Promise.resolve({ error: null }),
              functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
            },
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(SettingsComponent);
    (fixture.nativeElement as HTMLElement).style.width = width;
    (fixture.nativeElement as HTMLElement).style.display = 'block';
    fixture.detectChanges();
    return fixture;
  }

  function overlaps(a: DOMRect, b: DOMRect): boolean {
    // 1px tolerance: sub-pixel layout must not count as a collision.
    return !(
      a.right <= b.left + 1 ||
      b.right <= a.left + 1 ||
      a.bottom <= b.top + 1 ||
      b.bottom <= a.top + 1
    );
  }

  it('never lets the language and region selects overlap on a phone width', () => {
    const fixture = setup(makeUser(), '360px');
    const selects: HTMLSelectElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.locale-field .sc-select'),
    );
    expect(selects.length).toBe(2);
    expect(
      overlaps(selects[0].getBoundingClientRect(), selects[1].getBoundingClientRect()),
    ).toBeFalse();
  });

  it('never lets the language and region selects overlap on a desktop width', () => {
    const fixture = setup(makeUser(), '1100px');
    const selects: HTMLSelectElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.locale-field .sc-select'),
    );
    expect(
      overlaps(selects[0].getBoundingClientRect(), selects[1].getBoundingClientRect()),
    ).toBeFalse();
  });

  it('keeps both selects inside their card at a phone width', () => {
    const fixture = setup(makeUser(), '360px');
    const grid = fixture.nativeElement.querySelector('.locale-grid') as HTMLElement;
    const gridRect = grid.getBoundingClientRect();
    for (const select of Array.from(
      grid.querySelectorAll<HTMLSelectElement>('.sc-select'),
    )) {
      const rect = select.getBoundingClientRect();
      expect(rect.right).toBeLessThanOrEqual(gridRect.right + 1);
      expect(rect.left).toBeGreaterThanOrEqual(gridRect.left - 1);
    }
  });

  it('does not cap the page below the shell width any more', () => {
    const fixture = setup(makeUser(), '1100px');
    const page = fixture.nativeElement.querySelector('.page') as HTMLElement;
    expect(getComputedStyle(page).maxWidth).toBe('none');
  });

  it('demotes the user id out of the account rows but keeps it copyable', () => {
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;
    const rowText = Array.from(el.querySelectorAll('.account .row')).map(
      (r) => r.textContent ?? '',
    );
    expect(rowText.some((t) => t.includes('11111111-2222'))).toBeFalse();

    const idLine = el.querySelector('.id-line');
    expect(idLine).toBeTruthy();
    expect(idLine!.querySelector('code')!.textContent).toContain('11111111-2222');
    expect(idLine!.querySelector('button.id-copy')).toBeTruthy();
  });

  it('renders every linked identity, not just the session provider', () => {
    const fixture = setup();
    const pills = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.provider-pill'),
    ).map((p) => p.textContent!.trim());
    expect(pills.length).toBe(2);
    expect(pills.join(' ').toLowerCase()).toContain('google');
  });

  it('falls back to app_metadata.providers when identities are absent', () => {
    const fixture = setup(
      makeUser({
        identities: undefined,
        app_metadata: { provider: 'google', providers: ['google', 'email'] },
      }),
    );
    expect(
      fixture.nativeElement.querySelectorAll('.provider-pill').length,
    ).toBe(2);
  });

  it('shows the membership age as a single coarse unit with an exact tooltip', () => {
    const fixture = setup();
    const component = fixture.componentInstance;
    const label = component.memberSinceLabel();
    expect(label).not.toBeNull();
    // One unit only — never a "1 year 2 months 3 days" breakdown.
    expect(label!.key).toMatch(/^profile\.memberSince\.(days|months|years)\.(one|other)$/);

    const row = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.account .row .value',
      ),
    ).find((v) => v.hasAttribute('title'));
    expect(row).toBeTruthy();
    expect(row!.getAttribute('title')).toBeTruthy();
  });
});
