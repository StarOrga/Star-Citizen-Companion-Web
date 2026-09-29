import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { PasswordFormComponent } from './password-form.component';

// AUD-054/073: the one form that sets a password (invite, recovery, account page).
describe('PasswordFormComponent', () => {
  let updatePassword: jasmine.Spy;
  let fixture: ComponentFixture<PasswordFormComponent>;
  let saved: number;

  beforeEach(() => {
    updatePassword = jasmine.createSpy('updatePassword').and.resolveTo({ data: {}, error: null });
    TestBed.configureTestingModule({
      imports: [PasswordFormComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' }), { provide: AuthService, useValue: { updatePassword } }],
    });
    fixture = TestBed.createComponent(PasswordFormComponent);
    saved = 0;
    fixture.componentInstance.saved.subscribe(() => saved++);
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const submitBtn = () => el().querySelector('button[type="submit"]') as HTMLButtonElement;

  function type(password: string, confirm = password) {
    const [a, b] = Array.from(el().querySelectorAll('input')) as HTMLInputElement[];
    a.value = password;
    a.dispatchEvent(new Event('input'));
    b.value = confirm;
    b.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  async function submit() {
    el().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('keeps submit disabled for a short or mismatching password', () => {
    type('short');
    expect(submitBtn().disabled).toBeTrue();
    type('longenough1', 'longenough2');
    expect(submitBtn().disabled).toBeTrue();
    type('longenough1');
    expect(submitBtn().disabled).toBeFalse();
  });

  it('saves, clears the fields and fires saved exactly once', async () => {
    type('longenough1');
    await submit();
    expect(updatePassword).toHaveBeenCalledOnceWith('longenough1');
    expect(saved).toBe(1);
    expect(el().querySelector('.flash.success')?.textContent).toContain('auth.setPassword.saved');
    expect(el().querySelector('.flash.error')).toBeNull();
    expect(fixture.componentInstance.password()).toBe('');
  });

  it('shows an error key for a returned error and does not fire saved', async () => {
    type('longenough1');
    updatePassword.and.resolveTo({ data: null, error: { message: 'weak', status: 422 } });
    await submit();
    const alert = el().querySelector('.flash.error[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent!.trim()).toMatch(/^[a-z][\w-]*(\.[\w-]+)+$/i);
    expect(saved).toBe(0);
    expect(el().querySelector('.flash.success')).toBeNull();
  });

  it('shows an error when the call throws', async () => {
    type('longenough1');
    updatePassword.and.rejectWith(new TypeError('Failed to fetch'));
    await submit();
    expect(el().querySelector('.flash.error[role="alert"]')).not.toBeNull();
    expect(saved).toBe(0);
    expect(submitBtn().disabled).toBeFalse();
  });
});
