import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';

import { AccessRequestService } from './access-request.service';
import { AnalyticsService } from '../core/analytics.service';
import { AuthService } from './auth.service';
import { LoginComponent } from './login.component';
import { SupabaseClientProvider } from '../core/supabase.client';

/**
 * The signed-out landing page (feedback 56f328ea): an uninvited visitor has to
 * see what this is and be able to ASK for an invite instead of hitting a wall.
 * Two things are worth pinning down — that the apply panel is reachable and
 * files a request, and that a duplicate application is reported to the visitor
 * as success (confirming "someone already applied with this address" would
 * make the form an oracle over who has applied).
 */
describe('LoginComponent — landing + apply', () => {
  let submit: jasmine.Spy;

  function setup() {
    submit = jasmine.createSpy('submit').and.resolveTo({ kind: 'ok' });
    TestBed.configureTestingModule({
      imports: [LoginComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: AccessRequestService, useValue: { submit } },
        { provide: AuthService, useValue: { ready: () => false, realUser: () => null, signInWithPassword: () => Promise.resolve({ error: null }), signInWithGoogle: () => Promise.resolve({ error: null }) } },
        { provide: AnalyticsService, useValue: { capture: () => {} } },
        { provide: SupabaseClientProvider, useValue: { client: {} } },
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('leads with the brand — logo, name and the join line', () => {
    const el: HTMLElement = setup().nativeElement;
    expect(el.querySelector('img.brand-logo')).toBeTruthy();
    expect(el.querySelector('h1')?.textContent).toContain('auth.landing.appName');
    expect(el.querySelector('.join')?.textContent).toContain('auth.landing.join');
  });

  it('files an application from the apply panel', async () => {
    const fixture = setup();
    const comp = fixture.componentInstance;

    comp.showApply();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('textarea')).toBeTruthy();

    comp.applyForm.setValue({ email: 'pilot@example.com', handle: 'CitizenKane', message: 'hi' });
    await comp.onApply();
    fixture.detectChanges();

    expect(submit).toHaveBeenCalledWith({
      email: 'pilot@example.com',
      handle: 'CitizenKane',
      message: 'hi',
    });
    expect(comp.applyDone()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.notice.sent')).toBeTruthy();
  });

  it('treats a duplicate application as success, not as an error', async () => {
    const fixture = setup();
    const comp = fixture.componentInstance;
    submit.and.resolveTo({ kind: 'duplicate' });

    comp.showApply();
    comp.applyForm.patchValue({ email: 'pilot@example.com' });
    await comp.onApply();

    expect(comp.applyDone()).toBeTrue();
    expect(comp.applyError()).toBeNull();
  });

  it('surfaces a real failure instead of pretending it was sent', async () => {
    const fixture = setup();
    const comp = fixture.componentInstance;
    submit.and.resolveTo({ kind: 'error', message: 'network down' });

    comp.showApply();
    comp.applyForm.patchValue({ email: 'pilot@example.com' });
    await comp.onApply();

    expect(comp.applyDone()).toBeFalse();
    expect(comp.applyError()).toBe('network down');
  });

  it('carries a half-typed sign-in email over into the apply form', () => {
    const comp = setup().componentInstance;
    comp.form.patchValue({ email: 'pilot@example.com' });
    comp.showApply();
    expect(comp.applyForm.getRawValue().email).toBe('pilot@example.com');
  });
});
