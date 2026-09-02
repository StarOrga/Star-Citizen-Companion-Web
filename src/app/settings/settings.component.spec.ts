import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
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

  function configure(user: User | null = makeUser()) {
    TestBed.configureTestingModule({
      imports: [SettingsComponent, TranslateModule.forRoot()],
      providers: [
        // The rail builds its hrefs from the CURRENT url, so the tests need a
        // router and a location — mocked, so nothing touches real history.
        provideRouter([{ path: 'settings', component: SettingsComponent }]),
        provideLocationMocks(),
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
  }

  function setup(user: User | null = makeUser(), width = '360px') {
    configure(user);
    const fixture = TestBed.createComponent(SettingsComponent);
    (fixture.nativeElement as HTMLElement).style.width = width;
    (fixture.nativeElement as HTMLElement).style.display = 'block';
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Same page, but reached through the router at its real url — the only way
   * to see the href the browser would actually resolve.
   */
  async function setupRouted(width = '1100px') {
    configure();
    const harness = await RouterTestingHarness.create('/settings');
    const el = harness.routeNativeElement!;
    el.style.width = width;
    el.style.display = 'block';
    harness.detectChanges();
    return { harness, el };
  }

  /**
   * Dispatches a click the way the browser would, but never lets the anchor's
   * default navigation actually run away with the Karma frame. Returns whether
   * the component itself cancelled the event.
   */
  function clickLink(link: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
    let preventedByComponent = false;
    // Registered after the component's own listener, so it observes the flag
    // the component left behind before blocking the navigation for good.
    const guard = (e: Event) => {
      preventedByComponent = e.defaultPrevented;
      e.preventDefault();
    };
    link.addEventListener('click', guard);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
    link.removeEventListener('click', guard);
    return preventedByComponent;
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

  it('lists every section in the table of contents as a real fragment anchor', () => {
    const fixture = setup(makeUser(), '1100px');
    const el: HTMLElement = fixture.nativeElement;
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.toc .toc-link'));
    const groups = fixture.componentInstance.groups;
    expect(links.length).toBe(groups.length);
    links.forEach((link, i) => {
      // Real anchors: middle click / Ctrl+click must stay a browser feature.
      expect(link.tagName).toBe('A');
      const href = link.getAttribute('href')!;
      expect(href.endsWith(`#${groups[i].anchor}`)).toBeTrue();
      // A BARE "#anchor" is the bug from feedback af058ca4 round 3: it resolves
      // against <base href="/">, i.e. against the start page, not against
      // /settings. The href must always carry a path.
      expect(href.startsWith('#')).toBeFalse();
      // …and the target has to exist, or the rail is a set of dead links.
      expect(el.querySelector(`#${groups[i].anchor}`)).toBeTruthy();
    });
  });

  it('points the rail at the settings url, not at the app root', async () => {
    const { harness, el } = await setupRouted();
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.toc .toc-link'));
    const groups = (harness.routeDebugElement!.componentInstance as SettingsComponent).groups;
    expect(links.length).toBe(groups.length);
    links.forEach((link, i) => {
      expect(link.getAttribute('href')).toBe(`/settings#${groups[i].anchor}`);
    });
  });

  it('glides to the section on a plain left click and stays on /settings', async () => {
    const { harness, el } = await setupRouted();
    const component = harness.routeDebugElement!.componentInstance as SettingsComponent;
    const link = el.querySelectorAll<HTMLAnchorElement>('.toc .toc-link')[3];
    const target = el.querySelector<HTMLElement>('#settings-danger')!;
    const scrollIntoView = spyOn(target, 'scrollIntoView');

    expect(clickLink(link)).toBeTrue(); // the component owns this click…
    // …and moves the page itself instead of letting the browser jump.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const behaviour = scrollIntoView.calls.mostRecent().args[0] as ScrollIntoViewOptions;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    expect(behaviour.behavior).toBe(reduced ? 'auto' : 'smooth');
    expect(behaviour.block).toBe('start');

    // Highlight follows immediately, and the url keeps the section without a
    // route change — still on the settings page, never on the start page.
    harness.detectChanges();
    expect(component.activeGroup()).toBe('danger');
    const path = TestBed.inject(Location).path(true);
    expect(path.startsWith('/settings')).toBeTrue();
    expect(path).toContain('#settings-danger');
  });

  it('leaves a Ctrl/Cmd click to the browser so it can open a new tab', async () => {
    const { el } = await setupRouted();
    const link = el.querySelectorAll<HTMLAnchorElement>('.toc .toc-link')[2];
    const target = el.querySelector<HTMLElement>('#settings-privacy')!;
    const scrollIntoView = spyOn(target, 'scrollIntoView');

    expect(clickLink(link, { ctrlKey: true })).toBeFalse();
    expect(clickLink(link, { metaKey: true })).toBeFalse();
    expect(clickLink(link, { shiftKey: true })).toBeFalse();
    expect(clickLink(link, { button: 1 })).toBeFalse();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('groups the cards thematically instead of one flat grid', () => {
    const fixture = setup(makeUser(), '1100px');
    const el: HTMLElement = fixture.nativeElement;
    const sections = Array.from(el.querySelectorAll<HTMLElement>('.sections > .group'));
    expect(sections.map((s) => s.id)).toEqual([
      'settings-account',
      'settings-preferences',
      'settings-privacy',
      'settings-danger',
    ]);
    // Every group is headed and holds at least one card.
    for (const section of sections) {
      expect(section.querySelector('.group-title')).toBeTruthy();
      expect(section.querySelectorAll('.sc-card').length).toBeGreaterThan(0);
    }
    // The irreversible action is the last thing on the page.
    expect(sections[sections.length - 1].querySelector('.danger-zone')).toBeTruthy();
    // Account identity, the username editor and the password form belong to
    // the same group — all three are "who this account is".
    expect(sections[0].querySelector('.account')).toBeTruthy();
    expect(sections[0].querySelector('sc-password-form')).toBeTruthy();
    expect(sections[0].querySelectorAll('.sc-card').length).toBe(3);
    expect(sections[1].querySelector('.locale-grid')).toBeTruthy();
  });

  it('marks exactly one section as the active one in the rail', () => {
    const fixture = setup(makeUser(), '1100px');
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.toc-link.active').length).toBe(1);

    fixture.componentInstance.activeGroup.set('privacy');
    fixture.detectChanges();
    const active = el.querySelector<HTMLAnchorElement>('.toc-link.active')!;
    expect(active.getAttribute('href')!.endsWith('#settings-privacy')).toBeTrue();
    expect(active.getAttribute('aria-current')).toBe('true');
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
