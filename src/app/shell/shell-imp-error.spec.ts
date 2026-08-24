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
 * Defect A regression: `ImpersonationService.enterFailed()` must be visibly
 * surfaced somewhere the user actually sees — this pins ShellComponent as
 * that "somewhere" and its dismiss control.
 */
describe('ShellComponent — preview write-failed notice', () => {
  let clearEnterFailed: jasmine.Spy;
  let enterFailed: ReturnType<typeof signal<boolean>>;

  function setup() {
    enterFailed = signal(false);
    clearEnterFailed = jasmine.createSpy('clearEnterFailed').and.callFake(() => enterFailed.set(false));
    TestBed.configureTestingModule({
      imports: [ShellComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        { provide: AuthService, useValue: { user: signal(null), signOut: () => Promise.resolve() } },
        { provide: RoleService, useValue: { isAdmin: signal(false) } },
        { provide: ProfileService, useValue: { username: signal(null) } },
        {
          provide: ImpersonationService,
          useValue: {
            active: signal(false),
            targets: signal([]),
            enterFailed,
            clearEnterFailed,
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

  it('renders nothing when enterFailed() is false', () => {
    const fixture = setup();
    expect(fixture.nativeElement.querySelector('.imp-enter-error')).toBeNull();
  });

  it('renders the notice when enterFailed() is true, and dismiss clears it', () => {
    const fixture = setup();
    enterFailed.set(true);
    fixture.detectChanges();

    const notice = fixture.nativeElement.querySelector('.imp-enter-error');
    expect(notice).toBeTruthy();

    const dismiss = notice.querySelector('.imp-enter-error__dismiss') as HTMLButtonElement;
    dismiss.click();

    expect(clearEnterFailed).toHaveBeenCalledTimes(1);
  });
});
