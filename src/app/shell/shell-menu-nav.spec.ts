import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { RouteLoadRecoveryService } from '../core/route-load-recovery.service';
import { SameRouteRefreshService } from '../core/same-route-refresh.service';
import { VerseStatusChipComponent } from '../news/verse-status-chip.component';
import { AccountNoticeComponent } from '../social/account-notice.component';
import { FeedbackFabComponent } from './feedback-fab.component';
import { FooterComponent } from './footer.component';
import { QuickSearchComponent } from './quick-search.component';
import { ShellComponent } from './shell.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';

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
@Component({ selector: 'sc-account-notice', standalone: true, template: '' })
class AccountNoticeStub {}

/** Click without letting the karma page follow the anchor — see shell-nav.spec.ts. */
function click(el: HTMLElement, init: MouseEventInit = {}): void {
  const swallow = (ev: Event) => ev.preventDefault();
  el.addEventListener('click', swallow);
  el.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
  el.removeEventListener('click', swallow);
}

/**
 * Admin feedback cdb16d63: "teilweise funktionieren menü punkte oben in de
 * header nicht mehr, wie telemetrie oder auch hinter dem profilicon wie
 * freunde … mach das robust".
 *
 * Two contracts are pinned here. First: every entry that NAVIGATES is a real
 * anchor with a real href, so it survives whatever the click handler does (and
 * so middle/Ctrl click keeps opening a tab) — a `(click)`-only control is the
 * shape that dies silently. Second: when a route's lazy chunk cannot be loaded
 * at all, the shell stops being silent about it (see
 * RouteLoadRecoveryService).
 */
describe('ShellComponent menu navigation', () => {
  let isAdmin: ReturnType<typeof signal<boolean>>;
  let loadFailed: ReturnType<typeof signal<boolean>>;
  let recovering: ReturnType<typeof signal<boolean>>;
  let recoveryReload: jasmine.Spy;
  let recoveryDismiss: jasmine.Spy;

  function setup(admin = false) {
    isAdmin = signal(admin);
    loadFailed = signal(false);
    recovering = signal(false);
    recoveryReload = jasmine.createSpy('reload');
    recoveryDismiss = jasmine.createSpy('dismiss');

    TestBed.configureTestingModule({
      imports: [ShellComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        {
          provide: AuthService,
          useValue: {
            ready: () => false,
            realUser: () => null,
            user: signal(null),
            signOut: () => Promise.resolve(),
          },
        },
        { provide: RoleService, useValue: { isAdmin } },
        { provide: ProfileService, useValue: { username: signal('Jerry') } },
        {
          provide: ImpersonationService,
          useValue: {
            targets: signal([]),
            active: signal(false),
            enterFailed: signal(false),
            viewAs: signal(null),
            enter: () => undefined,
            exit: () => undefined,
            clearEnterFailed: () => undefined,
          },
        },
        {
          provide: RouteLoadRecoveryService,
          useValue: { loadFailed, recovering, reload: recoveryReload, dismiss: recoveryDismiss },
        },
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
          AccountNoticeComponent,
        ],
      },
      add: {
        imports: [
          QuickSearchStub,
          VerseStatusChipStub,
          FeedbackFabStub,
          UserFeedbackFabStub,
          FooterStub,
          AccountNoticeStub,
        ],
      },
    });
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    return fixture;
  }

  function openMenu(fixture: ReturnType<typeof setup>) {
    const avatar = fixture.nativeElement.querySelector('.avatar-btn') as HTMLButtonElement;
    avatar.click();
    fixture.detectChanges();
  }

  it('renders every account-menu destination as a real anchor with an href', () => {
    const fixture = setup(true);
    openMenu(fixture);

    const hrefs = Array.from(
      fixture.nativeElement.querySelectorAll('.dropdown a.dropdown-item'),
    ).map((a) => (a as HTMLAnchorElement).getAttribute('href'));

    expect(hrefs).toContain('/settings');
    expect(hrefs).toContain('/friends');
    expect(hrefs).toContain('/admin/api-tokens');
  });

  it('renders the Telemetrie header entry as a real anchor for an admin', () => {
    const fixture = setup(true);

    const link = fixture.nativeElement.querySelector(
      'nav.nav a[href="/admin/telemetry"]',
    ) as HTMLAnchorElement | null;

    expect(link).withContext('Telemetrie must be an <a>, not a click handler').toBeTruthy();
    expect(link!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('folds the account menu away on a plain left click', () => {
    const fixture = setup();
    openMenu(fixture);
    expect(fixture.componentInstance.menuOpen()).toBeTrue();

    click(fixture.nativeElement.querySelector('a.dropdown-item[href="/friends"]'));

    expect(fixture.componentInstance.menuOpen()).toBeFalse();
  });

  it('leaves the account menu open for modified and middle clicks', () => {
    const fixture = setup();

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
      openMenu(fixture);
      click(fixture.nativeElement.querySelector('a.dropdown-item[href="/friends"]'), init);

      expect(fixture.componentInstance.menuOpen())
        .withContext(`a ${JSON.stringify(init)} click opens a tab and stays here`)
        .toBeTrue();
      fixture.componentInstance.closeMenu();
      fixture.detectChanges();
    }
  });

  it('says so when a route could not be loaded, instead of a silent dead click', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelector('.route-load-error')).toBeNull();

    loadFailed.set(true);
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector('.route-load-error') as HTMLElement;
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('alert');

    (notice.querySelector('.route-load-error__action') as HTMLButtonElement).click();
    expect(recoveryReload).toHaveBeenCalled();

    (notice.querySelector('.route-load-error__dismiss') as HTMLButtonElement).click();
    expect(recoveryDismiss).toHaveBeenCalled();
  });

  it('keeps the navigation indicator up while a failed route is being recovered', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelector('.nav-scan')).toBeNull();

    recovering.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.nav-scan'))
      .withContext('the seconds before the recovery reload must not look like nothing happened')
      .toBeTruthy();
  });
});
