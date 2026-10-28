import { Component, signal, ChangeDetectionStrategy, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';

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

@Component({ selector: 'sc-quick-search', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class QuickSearchStub {}
@Component({ selector: 'sc-verse-status-chip', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class VerseStatusChipStub {}
@Component({ selector: 'sc-feedback-fab', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class FeedbackFabStub {}
@Component({ selector: 'sc-user-feedback-fab', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class UserFeedbackFabStub {}
@Component({ selector: 'sc-footer', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class FooterStub { readonly overlay = input(false); }
@Component({ selector: 'sc-account-notice', standalone: true, changeDetection: ChangeDetectionStrategy.Eager, template: '' })
class AccountNoticeStub {}

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

/**
 * Wave A parity (audit N1/N2): main page ↔ subpage must not unmount the cinematic
 * header in one frame — it stays mounted and compresses into the bar (and back).
 * The shell no longer renders a stage slot of its own: pages own it under their hero (G1).
 */
describe('ShellComponent beta header across main ↔ subpage', () => {
  afterEach(() => localStorage.removeItem('sc.beta'));

  async function setup() {
    localStorage.setItem('sc.beta', JSON.stringify({ shell: true, verse: true, codex: true }));
    TestBed.configureTestingModule({
      imports: [ShellComponent],
      providers: [
        provideTranslateService(),
        provideRouter([{ path: '**', component: Blank }]),
        provideNoopAnimations(),
        { provide: SameRouteRefreshService, useValue: { request: () => true } },
        {
          provide: AuthService,
          useValue: {
            ready: () => false,
            isAuthenticated: () => false,
            session: signal(null),
            realUser: () => null,
            user: signal(null),
            signOut: () => Promise.resolve(),
          },
        },
        { provide: RoleService, useValue: { isAdmin: signal(false), isCollaborator: signal(false) } },
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
          useValue: { loadFailed: signal(false), recovering: signal(false), reload: () => undefined, dismiss: () => undefined },
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
    const router = TestBed.inject(Router);
    const go = async (url: string) => {
      await fixture.ngZone!.run(() => router.navigateByUrl(url));
      // No whenStable: the beta shell keeps timers (scene, toasts) running for good.
      for (let i = 0; i < 3; i++) {
        fixture.detectChanges();
        await new Promise((r) => setTimeout(r));
      }
    };
    await go('/verse');
    return { fixture, go };
  }

  it('keeps the same header element mounted and compresses it on a subpage', async () => {
    const { fixture, go } = await setup();
    const el = fixture.nativeElement as HTMLElement;
    const header = el.querySelector('sc-main-header') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.classList).not.toContain('compressed');

    await go('/verse/news');
    expect(el.querySelector('sc-main-header')).withContext('header stays mounted').toBe(header);
    expect(header.classList).toContain('compressed');
    expect(header.hasAttribute('inert')).toBeTrue();

    await go('/verse');
    expect(el.querySelector('sc-main-header')).toBe(header);
    expect(header.classList).not.toContain('compressed');
    fixture.destroy();
  });

  it('renders no shell-level stage slot above <main>', async () => {
    const { fixture } = await setup();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector(':scope > .stage-slot, :scope > [data-stage-slot]')).toBeNull();
    expect(el.querySelector('.cine-spacer')).not.toBeNull();
    fixture.destroy();
  });
});
