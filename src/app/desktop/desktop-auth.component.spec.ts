import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { DesktopAuthComponent } from './desktop-auth.component';
import { AuthService } from '../auth/auth.service';
import { RoleService } from '../auth/role.service';
import { ImpersonationService } from '../auth/impersonation.service';
import { DesktopConnectionService } from './desktop-connection.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import de from '../../../public/i18n/de.json';
import en from '../../../public/i18n/en.json';

/**
 * AUD-170: the token hand-off to the Data Uploader's loopback waits for an
 * explicit "Connect" click — nothing is minted or sent before it.
 */
describe('DesktopAuthComponent', () => {
  let invoke: jasmine.Spy;
  let touch: jasmine.Spy;
  let submit: jasmine.Spy;

  function setup() {
    invoke = jasmine.createSpy('invoke').and.resolveTo({
      data: { access_token: 'desk-access', refresh_token: 'desk-refresh', expires_at: 1234 },
      error: null,
    });
    touch = jasmine.createSpy('touch').and.resolveTo(undefined);
    submit = spyOn(HTMLFormElement.prototype, 'submit');
    const getSession = jasmine.createSpy('getSession').and.resolveTo({
      data: { session: { access_token: 'browser-access', refresh_token: 'browser-refresh', expires_at: 99 } },
      error: null,
    });

    TestBed.configureTestingModule({
      imports: [DesktopAuthComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({ cb: 'http://127.0.0.1:46821/cb', state: 's' }) },
          },
        },
        {
          provide: AuthService,
          useValue: {
            init: () => undefined,
            ready: () => true,
            isAuthenticated: () => true,
            user: signal({ email: 'pilot@example.com' }),
          },
        },
        { provide: RoleService, useValue: { waitReady: () => Promise.resolve(), isCollaborator: () => true } },
        { provide: ImpersonationService, useValue: { activeOrPending: () => false, exit: () => undefined } },
        { provide: DesktopConnectionService, useValue: { touch } },
        {
          provide: SupabaseClientProvider,
          useValue: { client: { auth: { getSession } }, realClient: { functions: { invoke } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(DesktopAuthComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  function postedForm(): HTMLFormElement {
    return submit.calls.mostRecent().object as HTMLFormElement;
  }

  afterEach(() => {
    document.querySelectorAll('body > form').forEach((f) => f.remove());
  });

  it('stops at the confirmation: nothing minted, touched or posted', async () => {
    const { fixture, cmp } = setup();
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(cmp.status()).toBe('confirm');
    expect(cmp.port()).toBe('46821');
    expect(invoke).not.toHaveBeenCalled();
    expect(touch).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    expect(buttons.map((b) => b.type)).toEqual(['button', 'button']);
  });

  it('hands off after Connect: one POST with state, token and refresh token', async () => {
    const { cmp } = setup();
    await cmp.ngOnInit();
    await cmp.confirm();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(touch).toHaveBeenCalledOnceWith('uploader');
    expect(submit).toHaveBeenCalledTimes(1);
    const form = postedForm();
    expect(form.action).toBe('http://127.0.0.1:46821/cb');
    const field = (n: string) => (form.querySelector(`input[name="${n}"]`) as HTMLInputElement | null)?.value;
    expect(field('state')).toBe('s');
    expect(field('token')).toBe('desk-access');
    expect(field('refresh_token')).toBe('desk-refresh');
    expect(cmp.status()).toBe('redirecting');
  });

  it('Cancel sends nothing', async () => {
    const { cmp } = setup();
    await cmp.ngOnInit();
    cmp.cancel();
    expect(cmp.status()).toBe('cancelled');
    await cmp.confirm();
    expect(invoke).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('a double click posts once', async () => {
    const { cmp } = setup();
    await cmp.ngOnInit();
    await Promise.all([cmp.confirm(), cmp.confirm()]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  describe('i18n keys', () => {
    const KEYS = ['confirmPrompt', 'confirmHint', 'confirm', 'cancel', 'cancelled', 'loginRequired'];
    for (const [lang, cat] of [['de', de], ['en', en]] as const) {
      for (const key of KEYS) {
        it(`${lang}: desktopAuth.${key} is a non-empty string`, () => {
          const value = (cat as { desktopAuth: Record<string, unknown> }).desktopAuth[key];
          expect(typeof value).toBe('string');
          expect((value as string).length).toBeGreaterThan(0);
        });
      }
    }
  });
});

/** D16 step 10: callback validation and "token in the body, never the URL". */
describe('DesktopAuthComponent — callback hardening', () => {
  let submit: jasmine.Spy;
  let invoke: jasmine.Spy;

  function setup(params: Record<string, string>) {
    invoke = jasmine.createSpy('invoke').and.resolveTo({ data: null, error: { message: 'no mint' } });
    submit = spyOn(HTMLFormElement.prototype, 'submit');
    const getSession = jasmine.createSpy('getSession').and.resolveTo({
      data: { session: { access_token: 'browser-access', refresh_token: 'browser-refresh', expires_at: 99 } },
      error: null,
    });
    TestBed.configureTestingModule({
      imports: [DesktopAuthComponent],
      providers: [
        provideTranslateService(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(params) } } },
        {
          provide: AuthService,
          useValue: {
            init: () => undefined,
            ready: () => true,
            isAuthenticated: () => true,
            user: signal({ email: 'pilot@example.com' }),
          },
        },
        { provide: RoleService, useValue: { waitReady: () => Promise.resolve(), isCollaborator: () => true } },
        { provide: ImpersonationService, useValue: { activeOrPending: () => false, exit: () => undefined } },
        { provide: DesktopConnectionService, useValue: { touch: () => Promise.resolve() } },
        {
          provide: SupabaseClientProvider,
          useValue: { client: { auth: { getSession } }, realClient: { functions: { invoke } } },
        },
      ],
    });
    const fixture = TestBed.createComponent(DesktopAuthComponent);
    return { fixture, cmp: fixture.componentInstance };
  }

  beforeEach(() => sessionStorage.removeItem('sc.oauth-redirect-qs'));
  afterEach(() => document.querySelectorAll('body > form').forEach((f) => f.remove()));

  it('a non-loopback cb ends in error and never submits a form', async () => {
    const { fixture, cmp } = setup({ cb: 'https://evil.example/cb', state: 's' });
    await cmp.ngOnInit();
    fixture.detectChanges();
    expect(cmp.status()).toBe('error');
    expect(cmp.errorMsg()).toBe('desktopAuth.errorBadCallback');
    await cmp.confirm();
    expect(submit).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it('missing cb/state ends in the missing-params error', async () => {
    const { cmp } = setup({});
    await cmp.ngOnInit();
    expect(cmp.status()).toBe('error');
    expect(cmp.errorMsg()).toBe('desktopAuth.errorMissingParams');
  });

  it('the token rides in the POST fields, not in the action URL', async () => {
    const { cmp } = setup({ cb: 'http://127.0.0.1:46821/cb', state: 'st' });
    await cmp.ngOnInit();
    await cmp.confirm();
    expect(submit).toHaveBeenCalledTimes(1);
    const form = submit.calls.mostRecent().object as HTMLFormElement;
    expect(form.method.toLowerCase()).toBe('post');
    expect(form.action).not.toContain('browser-access');
    expect(form.action).not.toContain('?');
    const field = (n: string) => (form.querySelector(`input[name="${n}"]`) as HTMLInputElement | null)?.value;
    // The mint failed, so the hand-off falls back to the browser session.
    expect(field('token')).toBe('browser-access');
    expect(field('email')).toBe('pilot@example.com');
    expect(form.querySelector('input[name="token"]')?.getAttribute('type')).toBe('hidden');
  });
});
