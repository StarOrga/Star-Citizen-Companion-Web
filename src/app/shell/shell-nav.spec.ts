import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { SameRouteRefreshService } from '../core/same-route-refresh.service';
import { VerseStatusChipComponent } from '../news/verse-status-chip.component';
import { FeedbackFabComponent } from './feedback-fab.component';
import { FooterComponent } from './footer.component';
import { QuickSearchComponent } from './quick-search.component';
import { ShellComponent } from './shell.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';

// The header's neighbours pull in Supabase-backed services of their own; the
// nav contract under test doesn't involve them.
@Component({ selector: 'sc-quick-search', standalone: true, template: '' })
class QuickSearchStub {}
@Component({ selector: 'sc-verse-status-chip', standalone: true, template: '' })
class VerseStatusChipStub {}
@Component({ selector: 'sc-feedback-fab', standalone: true, template: '' })
class FeedbackFabStub {}
@Component({ selector: 'sc-user-feedback-fab', standalone: true, template: '' })
class UserFeedbackFabStub {}
@Component({ selector: 'sc-footer', standalone: true, template: '' })
class FooterStub {}

/**
 * Dispatch a click without letting the karma page follow the anchor: for a
 * modified click RouterLink deliberately does NOT preventDefault (that is the
 * whole point — the browser opens a new tab), which inside the test runner
 * would navigate the harness away.
 */
function click(el: HTMLElement, init: MouseEventInit = {}): void {
  const swallow = (ev: Event) => ev.preventDefault();
  el.addEventListener('click', swallow);
  el.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
  el.removeEventListener('click', swallow);
}

/**
 * The header's two "home" affordances (feedback 7532e639): the brand logo has to
 * be a real link to the home route, and re-clicking either it or the active
 * "Verse News" entry has to ask the page to reload — but only on a plain left
 * click, so Ctrl/⌘/middle click keep opening a new tab.
 */
describe('ShellComponent navigation', () => {
  let request: jasmine.Spy;

  function setup() {
    request = jasmine.createSpy('request').and.returnValue(true);
    TestBed.configureTestingModule({
      imports: [ShellComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: SameRouteRefreshService, useValue: { request } },
        { provide: AuthService, useValue: { ready: () => false, realUser: () => null, user: signal(null), signOut: () => Promise.resolve() } },
        { provide: RoleService, useValue: { isAdmin: signal(false) } },
        { provide: ProfileService, useValue: { username: signal(null) } },
      ],
    });
    TestBed.overrideComponent(ShellComponent, {
      remove: {
        imports: [
          QuickSearchComponent,
          VerseStatusChipComponent,
          FeedbackFabComponent,
          UserFeedbackFabComponent,
          FooterComponent,
        ],
      },
      add: {
        imports: [QuickSearchStub, VerseStatusChipStub, FeedbackFabStub, UserFeedbackFabStub, FooterStub],
      },
    });
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the brand logo inside a real anchor pointing at the home route', () => {
    const fixture = setup();
    const brand = fixture.nativeElement.querySelector('a.brand') as HTMLAnchorElement | null;

    expect(brand).withContext('brand must be an <a>, not a div/button').toBeTruthy();
    expect(brand!.getAttribute('href')).toBe('/news');
    expect(brand!.querySelector('img.logo')).toBeTruthy();
    expect(brand!.getAttribute('aria-label')).toBeTruthy();
  });

  it('asks the current page to reload when the logo is left-clicked', () => {
    const fixture = setup();
    const brand = fixture.nativeElement.querySelector('a.brand') as HTMLAnchorElement;

    click(brand);

    expect(request).toHaveBeenCalledWith('/news');
  });

  it('asks the current page to reload when the Verse News entry is re-clicked', () => {
    const fixture = setup();
    const newsLink = fixture.nativeElement.querySelector('nav.nav a[href="/news"]') as HTMLAnchorElement;

    click(newsLink);

    expect(request).toHaveBeenCalledWith('/news');
  });

  it('leaves modified and middle clicks to the browser', () => {
    const fixture = setup();
    const brand = fixture.nativeElement.querySelector('a.brand') as HTMLAnchorElement;

    click(brand, { ctrlKey: true });
    click(brand, { metaKey: true });
    click(brand, { shiftKey: true });
    click(brand, { button: 1 });

    expect(request).not.toHaveBeenCalled();
  });

  /**
   * Regression guard (2026-08-16): a Hangar entry was briefly added as a
   * fourth top-level link, then reverted — Hangar is a subview of Codex,
   * reached via the "Im Hangar" zone entrance on the Codex landing, not its
   * own nav slot. Pin the count so a future add-back has to be deliberate.
   */
  it('renders exactly three top-level nav entries: News, Codex, Starscape', () => {
    const fixture = setup();
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('nav.nav > a'),
    ) as HTMLAnchorElement[];

    expect(links.length).toBe(3);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/news', '/codex', '/starscape']);
  });

  it('never renders a top-level Hangar nav entry', () => {
    const fixture = setup();
    const hangarLink = fixture.nativeElement.querySelector('nav.nav a[href="/hangar"]');
    expect(hangarLink).toBeNull();
  });

  /**
   * Pages hang their own pinned bars off `--sc-topbar-h` (the settings section
   * rail does). It has to be the height the header actually PARKS at — so a
   * real number while the header is sticky, and 0px while it scrolls away with
   * the page, which is what it does below 1080px (admin feedback af058ca4
   * round 4). Whichever side of that line the karma window is on, the property
   * must exist and must agree with the header's computed position.
   */
  it('publishes the height the header parks at as --sc-topbar-h', () => {
    const fixture = setup();
    const bar = fixture.nativeElement.querySelector('.topbar') as HTMLElement;
    const published = document.documentElement.style.getPropertyValue('--sc-topbar-h');

    expect(published).toMatch(/^\d+px$/);
    const sticky = getComputedStyle(bar).position === 'sticky';
    if (sticky) {
      expect(parseFloat(published)).toBeCloseTo(bar.getBoundingClientRect().height, 0);
    } else {
      // Nothing is parked, so nothing may be reserved for it.
      expect(published).toBe('0px');
    }
  });

  it('takes --sc-topbar-h back down when the shell goes away', () => {
    const fixture = setup();
    expect(document.documentElement.style.getPropertyValue('--sc-topbar-h')).toMatch(/px$/);

    fixture.destroy();

    expect(document.documentElement.style.getPropertyValue('--sc-topbar-h')).toBe('');
  });
});
