import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AccessRequestService } from './access-request.service';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from './auth.service';
import { ImpersonationService } from './impersonation.service';
import { LoginComponent } from './login.component';
import { SupabaseClientProvider } from '../core/supabase.client';
import { ViewAs } from './impersonation-policy';

/**
 * Defect B regression: while previewing as the signed-out visitor,
 * `auth.isAuthenticated()` is shadowed to `false` (see auth.service.ts), so
 * `authGuard` bounces every route back to `/login?redirect=…` even after a
 * REAL, successful sign-in — the credential paths must refuse instead of
 * silently looping. The banner/menu "Exit" control already reaches this
 * page (mounted app-level), so the fix here is only: (1) don't attempt the
 * sign-in, (2) explain why, (3) offer `leavePreview()` as a shortcut.
 */
describe('LoginComponent — signed-out preview lock', () => {
  let signInWithPassword: jasmine.Spy;
  let signInWithGoogle: jasmine.Spy;
  let exit: jasmine.Spy;
  let viewAs: ViewAs | null;

  function setup() {
    signInWithPassword = jasmine.createSpy('signInWithPassword').and.resolveTo({ error: null });
    signInWithGoogle = jasmine.createSpy('signInWithGoogle').and.resolveTo({ error: null });
    exit = jasmine.createSpy('exit');
    TestBed.configureTestingModule({
      imports: [LoginComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: AccessRequestService, useValue: { submit: () => Promise.resolve({ kind: 'ok' }) } },
        { provide: AuthService, useValue: { signInWithPassword, signInWithGoogle } },
        { provide: AnalyticsService, useValue: { capture: () => {} } },
        { provide: SupabaseClientProvider, useValue: { client: {} } },
        { provide: ImpersonationService, useValue: { viewAs: () => viewAs, exit } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the page normally when no sign-in is attempted (fidelity preserved)', () => {
    viewAs = 'anon';
    const fixture = setup();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('h1')).toBeTruthy();
    expect(el.querySelector('form')).toBeTruthy();
    expect(el.querySelector('input[type="email"]')).toBeTruthy();
    expect(el.querySelector('.notice.preview-locked')).toBeTruthy();
  });

  it('refuses onSubmit(), never calls signInWithPassword, and surfaces the notice', async () => {
    viewAs = 'anon';
    const fixture = setup();
    const comp = fixture.componentInstance;
    comp.form.setValue({ email: 'pilot@example.com', password: 'hunter22' });

    await comp.onSubmit();
    fixture.detectChanges();

    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(comp.errorMsg()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.notice.preview-locked')).toBeTruthy();
  });

  it('refuses signInWithGoogle() while previewing as anon', async () => {
    viewAs = 'anon';
    const fixture = setup();
    const comp = fixture.componentInstance;

    await comp.signInWithGoogle();

    expect(signInWithGoogle).not.toHaveBeenCalled();
    expect(comp.errorMsg()).toBeTruthy();
  });

  it('leavePreview() calls ImpersonationService.exit()', () => {
    viewAs = 'anon';
    const fixture = setup();
    fixture.componentInstance.leavePreview();
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('does not block sign-in for non-anon previews (viewer/collaborator never shadow auth)', async () => {
    viewAs = 'viewer';
    const fixture = setup();
    const comp = fixture.componentInstance;
    comp.form.setValue({ email: 'pilot@example.com', password: 'hunter22' });

    await comp.onSubmit();

    expect(signInWithPassword).toHaveBeenCalledWith('pilot@example.com', 'hunter22');
  });

  it('does not block sign-in with no active preview', async () => {
    viewAs = null;
    const fixture = setup();
    const comp = fixture.componentInstance;
    comp.form.setValue({ email: 'pilot@example.com', password: 'hunter22' });

    await comp.onSubmit();

    expect(signInWithPassword).toHaveBeenCalledWith('pilot@example.com', 'hunter22');
  });
});
