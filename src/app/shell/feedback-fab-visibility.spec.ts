import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { RoleService } from '../auth/role.service';
import { FeedbackFabPrefsService } from '../core/feedback-fab-prefs.service';
import { UserFeedbackPanelComponent } from '../feedback/user-feedback-panel.component';
import { UserFeedbackService } from '../feedback/user-feedback.service';
import { AdminFeedbackComponent } from '../admin/feedback/admin-feedback.component';
import { FeedbackFabComponent } from './feedback-fab.component';
import { UserFeedbackFabComponent } from './user-feedback-fab.component';

// Both panels are Supabase-backed and only render once the FAB is opened; this
// spec never opens one, but the stubs keep the imports out of the injector too.
@Component({ selector: 'sc-admin-feedback', standalone: true, template: '' })
class AdminFeedbackStub {}
@Component({ selector: 'sc-user-feedback-panel', standalone: true, template: '' })
class UserFeedbackPanelStub {}

const KEY = 'sc.feedback.fabHidden';

/**
 * The Settings opt-out has to reach BOTH launchers — an admin and a viewer see
 * different buttons in the same corner, and "hide the feedback button" has to
 * mean the same thing to both of them.
 */
describe('feedback launcher visibility', () => {
  afterEach(() => localStorage.removeItem(KEY));

  function adminFab() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FeedbackFabComponent, TranslateModule.forRoot()],
      providers: [{ provide: RoleService, useValue: { isAdmin: signal(true) } }],
    });
    TestBed.overrideComponent(FeedbackFabComponent, {
      remove: { imports: [AdminFeedbackComponent] },
      add: { imports: [AdminFeedbackStub] },
    });
    const fixture = TestBed.createComponent(FeedbackFabComponent);
    fixture.detectChanges();
    return fixture;
  }

  function userFab() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserFeedbackFabComponent, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: { user: signal({ id: 'u1' }) } },
        { provide: RoleService, useValue: { loaded: signal(true), isAdmin: signal(false) } },
        { provide: ImpersonationService, useValue: { activeOrPending: signal(false) } },
        {
          provide: UserFeedbackService,
          useValue: {
            unreadTopics: signal(0),
            loaded: signal(true),
            refresh: () => Promise.resolve(),
            markAllRead: () => Promise.resolve(),
          },
        },
      ],
    });
    TestBed.overrideComponent(UserFeedbackFabComponent, {
      remove: { imports: [UserFeedbackPanelComponent] },
      add: { imports: [UserFeedbackPanelStub] },
    });
    const fixture = TestBed.createComponent(UserFeedbackFabComponent);
    fixture.detectChanges();
    return fixture;
  }

  function hasFab(fixture: { nativeElement: HTMLElement }): boolean {
    return !!fixture.nativeElement.querySelector('button.fab');
  }

  it('renders the admin launcher by default and drops it once hidden', () => {
    localStorage.removeItem(KEY);
    expect(hasFab(adminFab())).withContext('default = shown').toBeTrue();

    localStorage.setItem(KEY, '1');
    const fixture = adminFab();
    expect(hasFab(fixture)).withContext('opted out').toBeFalse();

    // And back again, without a reload — the toggle lives on another page.
    TestBed.inject(FeedbackFabPrefsService).setShow(true);
    fixture.detectChanges();
    expect(hasFab(fixture)).toBeTrue();
  });

  it('renders the user launcher by default and drops it once hidden', () => {
    localStorage.removeItem(KEY);
    expect(hasFab(userFab())).withContext('default = shown').toBeTrue();

    localStorage.setItem(KEY, '1');
    const fixture = userFab();
    expect(hasFab(fixture)).withContext('opted out').toBeFalse();

    TestBed.inject(FeedbackFabPrefsService).setShow(true);
    fixture.detectChanges();
    expect(hasFab(fixture)).toBeTrue();
  });
});
