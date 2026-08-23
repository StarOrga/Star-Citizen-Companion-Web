import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
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
 * Defect A regression: ShellComponent used to carry an `@if (!auth.user())`
 * branch in the header actions with its own standalone "exit preview" button
 * (`.exit-preview-btn`), commented as "the only way back" while signed out.
 * It was provably dead — every shell child route is gated by `authGuard`
 * (canActivateChild in app.routes.ts), which bounces to /login before the
 * shell mounts, for a real signed-out visitor AND for an admin previewing
 * 'anon' (auth.isAuthenticated()/auth.user() are shadowed to false/null in
 * both cases — auth.service.ts). The ONLY reachable way back is
 * `ImpersonationBannerComponent`, mounted app-level.
 *
 * These specs pin that the header never renders a second, standalone exit
 * control — even in the (production-impossible) edge case of `auth.user()`
 * being null while the shell is mounted — guarding against the dead branch
 * silently coming back.
 */
describe('ShellComponent — no standalone header exit-preview control (Defect A)', () => {
  function setup(opts: { user: unknown; active: boolean }) {
    TestBed.configureTestingModule({
      imports: [ShellComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        { provide: AuthService, useValue: { user: signal(opts.user), signOut: () => Promise.resolve() } },
        { provide: RoleService, useValue: { isAdmin: signal(false) } },
        { provide: ProfileService, useValue: { username: signal(null) } },
        {
          provide: ImpersonationService,
          useValue: {
            active: signal(opts.active),
            targets: signal([]),
            enterFailed: signal(false),
            clearEnterFailed: () => {},
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
    return fixture;
  }

  it('never renders .exit-preview-btn or .signin-btn while a preview is active and a real session exists', () => {
    const fixture = setup({ user: { id: 'u1' }, active: true });

    expect(fixture.nativeElement.querySelector('.exit-preview-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.signin-btn')).toBeNull();
    // The one real affordance (account menu) is always present instead.
    expect(fixture.nativeElement.querySelector('.avatar-btn')).toBeTruthy();
  });

  it('never renders .exit-preview-btn or .signin-btn even if auth.user() were null (production-impossible edge case)', () => {
    const fixture = setup({ user: null, active: true });

    expect(fixture.nativeElement.querySelector('.exit-preview-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.signin-btn')).toBeNull();
    expect(fixture.nativeElement.querySelector('.avatar-btn')).toBeTruthy();
  });
});
