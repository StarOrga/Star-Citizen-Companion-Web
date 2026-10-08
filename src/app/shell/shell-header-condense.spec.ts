import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { SameRouteRefreshService } from '../core/same-route-refresh.service';
import { VerseStatusChipComponent } from '../news/verse-status-chip.component';
import { AccountNoticeComponent } from '../social/account-notice.component';
import { FeedbackFabComponent } from './feedback-fab.component';
import { FooterComponent } from './footer.component';
import { QuickSearchComponent } from './quick-search.component';
import { ShellComponent, isAdminNavRoute } from './shell.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';

@Component({ selector: 'sc-quick-search', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class QuickSearchStub {}
@Component({ selector: 'sc-verse-status-chip', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class VerseStatusChipStub {}
@Component({ selector: 'sc-feedback-fab', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class FeedbackFabStub {}
@Component({ selector: 'sc-user-feedback-fab', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class UserFeedbackFabStub {}
@Component({ selector: 'sc-footer', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class FooterStub {}
@Component({ selector: 'sc-account-notice', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class AccountNoticeStub {}

/** Click without letting the karma page follow the anchor — see shell-nav.spec.ts. */
function click(el: HTMLElement, init: MouseEventInit = {}): void {
  const swallow = (ev: Event) => ev.preventDefault();
  el.addEventListener('click', swallow);
  el.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, ...init }));
  el.removeEventListener('click', swallow);
}

/**
 * The header stays one row on a desktop window: between the phone layout and
 * ~1180px the two admin entries fold into a red "Admin" menu. These pin the
 * menu's contract — real anchors, red with the "admin only" words, the
 * menu-button keyboard model and focus return — and, where the Karma window
 * falls into that range, that the CSS really swaps the inline entries for it.
 */
describe('ShellComponent condensed header', () => {
  let fixture: ComponentFixture<ShellComponent>;
  let el: HTMLElement;

  function setup(admin: boolean) {
    TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        provideNoopAnimations(),
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        {
          provide: AuthService,
          useValue: { ready: () => false, realUser: () => null, user: signal(null), signOut: () => Promise.resolve() },
        },
        { provide: RoleService, useValue: { isAdmin: signal(admin) } },
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
      ],
    });
    TestBed.overrideComponent(ShellComponent, {
      remove: {
        imports: [QuickSearchComponent, VerseStatusChipComponent, FeedbackFabComponent, UserFeedbackFabComponent, FooterComponent, AccountNoticeComponent],
      },
      add: { imports: [QuickSearchStub, VerseStatusChipStub, FeedbackFabStub, UserFeedbackFabStub, FooterStub, AccountNoticeStub] },
    });
    fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    el = fixture.nativeElement;
  }

  const button = () => el.querySelector<HTMLButtonElement>('.admin-more-btn')!;
  const items = () => Array.from(el.querySelectorAll<HTMLAnchorElement>('.admin-dropdown .dropdown-item'));

  it('a plain viewer gets no admin menu at all', () => {
    setup(false);
    expect(el.querySelector('.admin-more')).toBeNull();
  });

  it('folds both admin entries into one menu of real anchors, red and labelled "admin only"', () => {
    setup(true);
    expect(button().getAttribute('aria-haspopup')).toBe('menu');
    expect(button().getAttribute('aria-expanded')).toBe('false');

    button().click();
    fixture.detectChanges();

    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(items().map((a) => a.getAttribute('href'))).toEqual(['/admin', '/admin/telemetry']);
    expect(items().every((a) => a.classList.contains('elevated') && a.getAttribute('role') === 'menuitem')).toBeTrue();
    expect(items().every((a) => a.querySelector('.di-tag')?.textContent?.trim() === 'nav.adminOnly')).toBeTrue();
    const hot = getComputedStyle(document.documentElement).getPropertyValue('--sc-accent-hot').trim();
    if (hot) {
      const probe = document.createElement('span');
      probe.style.color = hot;
      document.body.appendChild(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      expect(items().map((a) => getComputedStyle(a).color)).toEqual([expected, expected]);
      expect(getComputedStyle(button()).color).toBe(expected);
    }
  });

  it('ArrowDown opens it on the first entry, arrows rove, Escape closes and hands focus back', fakeAsync(() => {
    setup(true);
    button().focus();
    button().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(document.activeElement).toBe(items()[0]);

    const menu = el.querySelector<HTMLElement>('.admin-dropdown')!;
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items()[1]);

    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(el.querySelector('.admin-dropdown')).toBeNull();
    expect(document.activeElement).toBe(button());
  }));

  it('a plain click on an entry folds it away; a modified click opens a tab and leaves it open', () => {
    setup(true);
    button().click();
    fixture.detectChanges();
    click(items()[1], { ctrlKey: true });
    fixture.detectChanges();
    expect(fixture.componentInstance.adminMenuOpen()).toBeTrue();

    click(items()[1]);
    fixture.detectChanges();
    expect(fixture.componentInstance.adminMenuOpen()).toBeFalse();
  });

  it('opening one header menu closes the other', () => {
    setup(true);
    button().click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.avatar-btn')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.adminMenuOpen()).toBeFalse();
    expect(fixture.componentInstance.menuOpen()).toBeTrue();
  });

  it('between the phone layout and 1180px the inline admin entries give way to the menu', () => {
    setup(true);
    if (!matchMedia('(min-width: 721px) and (max-width: 1179px)').matches) {
      pending('the Karma window is outside the folded range');
      return;
    }
    const inline = Array.from(el.querySelectorAll<HTMLElement>('nav.nav > a.admin-inline'));
    expect(inline.length).toBe(2);
    expect(inline.every((a) => getComputedStyle(a).display === 'none')).toBeTrue();
    expect(getComputedStyle(el.querySelector('.admin-more')!).display).not.toBe('none');
    expect(getComputedStyle(el.querySelector('.topbar')!).flexWrap).toBe(
      matchMedia('(max-width: 819px)').matches ? 'wrap' : 'nowrap',
    );
  });

  it('marks the menu active on the admin routes it holds, not on the account menu\'s tokens page', () => {
    expect(isAdminNavRoute('/admin')).toBeTrue();
    expect(isAdminNavRoute('/admin/telemetry?range=7d')).toBeTrue();
    expect(isAdminNavRoute('/admin/api-tokens')).toBeFalse();
    expect(isAdminNavRoute('/codex')).toBeFalse();
  });
});
