import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopReadAuthComponent } from './desktop-read-auth.component';
import { AuthService } from '../auth/auth.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { DesktopConnectionService } from './desktop-connection.service';
import { SupabaseClientProvider } from '../core/supabase.client';

describe('DesktopReadAuthComponent', () => {
  let submit: jasmine.Spy;
  let touch: jasmine.Spy;
  let authed: boolean;

  function setup(params: Record<string, string>) {
    submit = spyOn(HTMLFormElement.prototype, 'submit');
    touch = jasmine.createSpy('touch').and.resolveTo(undefined);
    const invoke = jasmine.createSpy('invoke').and.resolveTo({
      data: { access_token: 'app-access', refresh_token: 'app-refresh', expires_at: 1234 },
      error: null,
    });
    const getSession = jasmine.createSpy('getSession').and.resolveTo({
      data: { session: { access_token: 'browser-access', refresh_token: 'browser-refresh', expires_at: 99 } },
      error: null,
    });
    TestBed.configureTestingModule({
      imports: [DesktopReadAuthComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
        {
          provide: AuthService,
          useValue: {
            init: () => undefined,
            ready: () => true,
            isAuthenticated: () => authed,
            user: signal({ email: 'pilot@example.com' }),
          },
        },
        { provide: ImpersonationService, useValue: { activeOrPending: () => false, exit: () => undefined } },
        { provide: DesktopConnectionService, useValue: { touch } },
        {
          provide: SupabaseClientProvider,
          useValue: { client: { auth: { getSession } }, realClient: { functions: { invoke } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(DesktopReadAuthComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  beforeEach(() => {
    authed = true;
    sessionStorage.removeItem('sc.oauth-redirect-qs');
  });
  afterEach(() => document.querySelectorAll('body > form').forEach((f) => f.remove()));

  it('without cb/state: errorMissingParams, nothing posted', async () => {
    const { fixture, cmp } = setup({});
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(cmp.status()).toBe('error');
    expect(cmp.errorMsg()).toBe('desktopConnect.errorMissingParams');
    expect(fixture.nativeElement.querySelector('.err').textContent).toContain('desktopConnect.errorMissingParams');
    expect(submit).not.toHaveBeenCalled();
  });

  for (const cb of [
    'https://evil.example/scc/callback',
    'http://localhost:4000/scc/callback',
    'http://127.0.0.1/scc/callback',
  ]) {
    it(`a non-loopback callback is an error: ${cb}`, async () => {
      const { cmp } = setup({ cb, state: 's' });
      await cmp.ngOnInit();
      expect(cmp.status()).toBe('error');
      expect(cmp.errorMsg()).toBe('desktopConnect.errorBadCallback');
      expect(submit).not.toHaveBeenCalled();
    });
  }

  it('signed out: asks for login and keeps the request as redirect', async () => {
    authed = false;
    const { cmp } = setup({ cb: 'http://127.0.0.1:5000/x', state: 's' });
    await cmp.ngOnInit();
    expect(cmp.status()).toBe('login_required');
    expect(cmp.returnUrl).toContain('/desktop/connect?cb=');
    expect(submit).not.toHaveBeenCalled();
  });

  it('always posts to /scc/callback, whatever path cb carried', async () => {
    const { cmp } = setup({ cb: 'http://127.0.0.1:5000/steal/elsewhere?x=1', state: 's' });
    await cmp.ngOnInit();
    expect(submit).toHaveBeenCalledTimes(1);
    const form = submit.calls.mostRecent().object as HTMLFormElement;
    expect(form.action).toBe('http://127.0.0.1:5000/scc/callback');
  });

  it('posts the token in the body, never in the URL', async () => {
    const { cmp } = setup({ cb: 'http://127.0.0.1:5000/scc/callback', state: 'st' });
    await cmp.ngOnInit();
    expect(cmp.status()).toBe('redirecting');
    expect(touch).toHaveBeenCalledOnceWith('starscape');
    const form = submit.calls.mostRecent().object as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.action).not.toContain('?');
    expect(form.action).not.toContain('app-access');
    const field = (n: string) => (form.querySelector(`input[name="${n}"]`) as HTMLInputElement | null)?.value;
    expect(field('state')).toBe('st');
    expect(field('token')).toBe('app-access');
    expect(field('refresh_token')).toBe('app-refresh');
    expect(field('email')).toBe('pilot@example.com');
  });
});
