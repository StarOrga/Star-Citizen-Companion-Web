import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { ViewAs } from '../auth/impersonation-policy';
import { ProfileService } from '../auth/profile.service';
import { RoleService } from '../auth/role.service';
import { SameRouteRefreshService } from '../core/same-route-refresh.service';
import { VerseStatusChipComponent } from '../news/verse-status-chip.component';
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

/**
 * Colour semantics of the account menu (admin feedback f8ea96f5).
 *
 * "Ansehen als" is a role preview only an admin or a collaborator is ever
 * offered - impersonationTargets() returns an empty list for a viewer, so a
 * plain user never reaches this group at all. Per the project's colour rule
 * that makes it an elevated-access surface: the hot accent
 * (--sc-accent-hot), never --sc-danger, which stays reserved for errors and
 * destructive actions.
 *
 * These specs pin the marker CLASS rather than a computed colour: `.elevated`
 * is the single hook the stylesheet paints from, so an accidental "back to the
 * normal accent" edit fails here instead of shipping silently.
 */
describe('ShellComponent - elevated-access marking in the account menu', () => {
  function setup(opts: { targets: ViewAs[]; active: boolean; admin: boolean }) {
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
            user: signal({ id: 'u1', email: 'a@b.c' }),
            signOut: () => Promise.resolve(),
          },
        },
        { provide: RoleService, useValue: { isAdmin: signal(opts.admin) } },
        { provide: ProfileService, useValue: { username: signal(null) } },
        {
          provide: ImpersonationService,
          useValue: {
            active: signal(opts.active),
            targets: signal(opts.targets),
            enterFailed: signal(false),
            clearEnterFailed: () => {},
            enter: jasmine.createSpy('enter'),
            exit: jasmine.createSpy('exit'),
          },
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
        ],
      },
      add: {
        imports: [QuickSearchStub, VerseStatusChipStub, FeedbackFabStub, UserFeedbackFabStub, FooterStub],
      },
    });
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    // The dropdown only exists once the avatar opens it.
    (fixture.nativeElement.querySelector('.avatar-btn') as HTMLButtonElement).click();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function items(el: HTMLElement): HTMLElement[] {
    return Array.from(el.querySelectorAll<HTMLElement>('.dropdown-item'));
  }

  it('marks every "view as" target with the hot-accent class', () => {
    const el = setup({ targets: ['collaborator', 'viewer', 'anon'], active: false, admin: true });

    const targets = items(el).filter((b) => /nav\.viewAs\.(collaborator|viewer|anon)/.test(b.textContent ?? ''));

    expect(targets.length).toBe(3);
    for (const entry of targets) {
      expect(entry.classList).withContext(entry.textContent ?? '').toContain('elevated');
    }
  });

  it('marks the group header red AND states the restriction in words', () => {
    const el = setup({ targets: ['viewer', 'anon'], active: false, admin: false });

    const sep = el.querySelector('.dropdown-sep.elevated');

    expect(sep).withContext('the "Ansehen als" separator must carry .elevated').toBeTruthy();
    expect(sep!.textContent).toContain('nav.viewAs.title');
    // Colour never carries the meaning on its own.
    expect(sep!.querySelector('.sep-tag')?.textContent).toContain('nav.viewAs.restricted');
  });

  it('keeps the exit inside the red group - it is an elevated control too', () => {
    const el = setup({ targets: [], active: true, admin: true });

    const exit = items(el).find((b) => (b.textContent ?? '').includes('nav.viewAs.exit'));

    expect(exit).toBeTruthy();
    expect(exit!.classList).toContain('elevated');
    expect(el.querySelector('.dropdown-sep.elevated')).toBeTruthy();
  });

  it('marks the admin-only API-tokens entry red and labels it', () => {
    const el = setup({ targets: ['viewer'], active: false, admin: true });

    const tokens = el.querySelector<HTMLAnchorElement>('a.dropdown-item[href="/admin/api-tokens"]');

    expect(tokens).toBeTruthy();
    expect(tokens!.classList).toContain('elevated');
    expect(tokens!.querySelector('.di-tag')?.textContent).toContain('nav.adminOnly');
  });

  it('leaves the entries every signed-in user may use in the normal accent', () => {
    const el = setup({ targets: ['viewer', 'anon'], active: false, admin: true });

    for (const href of ['/settings', '/friends']) {
      const item = el.querySelector<HTMLAnchorElement>('a.dropdown-item[href="' + href + '"]');
      expect(item).withContext(href).toBeTruthy();
      expect(item!.classList).withContext(href).not.toContain('elevated');
    }
    const signOut = items(el).find((b) => (b.textContent ?? '').includes('nav.signOut'));
    expect(signOut).toBeTruthy();
    expect(signOut!.classList).not.toContain('elevated');
  });

  it('shows no elevated surface at all for a plain viewer', () => {
    const el = setup({ targets: [], active: false, admin: false });

    expect(el.querySelector('.dropdown-sep.elevated')).toBeNull();
    expect(el.querySelector('.dropdown-item.elevated')).toBeNull();
  });
});
