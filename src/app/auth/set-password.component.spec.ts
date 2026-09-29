import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from './auth.service';
import { SetPasswordComponent } from './set-password.component';

// AUD-054/073: the invite / recovery landing page.
describe('SetPasswordComponent', () => {
  let fixture: ComponentFixture<SetPasswordComponent>;
  let sendPasswordReset: jasmine.Spy;
  const user = signal<{ email: string } | null>(null);

  function create(query: Record<string, string> = {}) {
    user.set(null);
    sendPasswordReset = jasmine.createSpy('sendPasswordReset').and.resolveTo({ data: {}, error: null });
    TestBed.configureTestingModule({
      imports: [SetPasswordComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: AuthService,
          useValue: { ready: signal(true), realUser: user, sendPasswordReset, updatePassword: jasmine.createSpy() },
        },
        { provide: ActivatedRoute, useValue: { queryParamMap: new BehaviorSubject(convertToParamMap(query)) } },
      ],
    });
    fixture = TestBed.createComponent(SetPasswordComponent);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const btn = () => el().querySelector('form.resend button[type="submit"]') as HTMLButtonElement;

  function typeEmail(value: string) {
    const input = el().querySelector('form.resend input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function resend() {
    el().querySelector('form.resend')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('titles an invite differently from a recovery', () => {
    create({ via: 'invite' });
    expect(el().querySelector('h1')?.textContent).toContain('auth.setPassword.inviteTitle');
    TestBed.resetTestingModule();
    create({ via: 'recovery' });
    expect(el().querySelector('h1')?.textContent).toContain('auth.setPassword.title');
    expect(el().querySelector('h1')?.textContent).not.toContain('inviteTitle');
  });

  it('shows the password form for a signed-in visitor', () => {
    create();
    user.set({ email: 'pilot@example.com' });
    fixture.detectChanges();
    expect(el().querySelector('sc-password-form')).not.toBeNull();
    expect(el().querySelector('form.resend')).toBeNull();
  });

  it('keeps "send link" disabled for an invalid address', () => {
    create();
    typeEmail('not-an-address');
    expect(btn().disabled).toBeTrue();
    typeEmail('pilot@example.com');
    expect(btn().disabled).toBeFalse();
  });

  it('shows the rate limit, and only the rate limit, as an error', async () => {
    create();
    typeEmail('pilot@example.com');
    sendPasswordReset.and.resolveTo({ data: null, error: { status: 429, message: 'rate limited' } });
    await resend();
    expect(sendPasswordReset).toHaveBeenCalledOnceWith('pilot@example.com');
    expect(el().querySelector('.flash.error[role="alert"]')).not.toBeNull();
    expect(el().textContent).not.toContain('auth.setPassword.resent');
  });

  it('answers any other returned error like a success, so the form reveals no membership', async () => {
    create();
    typeEmail('stranger@example.com');
    sendPasswordReset.and.resolveTo({ data: null, error: { status: 400, message: 'user not found' } });
    await resend();
    expect(el().querySelector('[role="alert"]')).toBeNull();
    expect(el().querySelector('.flash.success')?.textContent).toContain('auth.setPassword.resent');
  });

  it('shows the success state after a clean send', async () => {
    create();
    typeEmail('pilot@example.com');
    await resend();
    expect(el().querySelector('.flash.success')?.textContent).toContain('auth.setPassword.resent');
  });

  it('shows an error when the send throws', async () => {
    create();
    typeEmail('pilot@example.com');
    sendPasswordReset.and.rejectWith(new TypeError('Failed to fetch'));
    await resend();
    expect(el().querySelector('.flash.error[role="alert"]')).not.toBeNull();
    expect(el().textContent).not.toContain('auth.setPassword.resent');
  });
});
