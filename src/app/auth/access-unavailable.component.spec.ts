import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AccessUnavailableComponent } from './access-unavailable.component';
import { AuthService } from './auth.service';
import { RoleService } from './role.service';

/**
 * AUD-054/073: the landing page of approvedGuard's fail-closed path. "Retry"
 * resumes the original navigation — through the same redirect check as the
 * login page, so a crafted ?redirect= cannot leave the origin.
 */
describe('AccessUnavailableComponent', () => {
  let refresh: jasmine.Spy;
  let signOut: jasmine.Spy;
  // Default: the read has settled and the identity is still unknown — the
  // fail-closed case this page was built for.
  let loaded = signal(true);
  let identityUnknown = signal(true);
  let approved = signal(false);

  function create(redirect: string | null, state: { loaded?: boolean; identityUnknown?: boolean; approved?: boolean } = {}) {
    loaded = signal(state.loaded ?? true);
    identityUnknown = signal(state.identityUnknown ?? true);
    approved = signal(state.approved ?? false);
    refresh = jasmine.createSpy('refresh').and.resolveTo(undefined);
    signOut = jasmine.createSpy('signOut').and.resolveTo(undefined);
    TestBed.configureTestingModule({
      imports: [AccessUnavailableComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        {
          provide: RoleService,
          useValue: {
            refresh,
            loaded: loaded.asReadonly(),
            identityUnknown: identityUnknown.asReadonly(),
            approved: approved.asReadonly(),
          },
        },
        { provide: AuthService, useValue: { signOut } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(redirect === null ? {} : { redirect }) } },
        },
      ],
    });
    const navigate = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(AccessUnavailableComponent);
    fixture.detectChanges();
    const buttons = () => Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    return { fixture, navigate, buttons };
  }

  it('re-reads the profile, then resumes the requested route', async () => {
    const { fixture, navigate } = create('/codex');
    await fixture.componentInstance.retry();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledOnceWith('/codex');
  });

  it('falls back to /news for a foreign or missing redirect', async () => {
    const evil = create('//evil.example');
    await evil.fixture.componentInstance.retry();
    expect(evil.navigate).toHaveBeenCalledOnceWith('/news');

    TestBed.resetTestingModule();
    const none = create(null);
    await none.fixture.componentInstance.retry();
    expect(none.navigate).toHaveBeenCalledOnceWith('/news');
  });

  it('disables both buttons while a retry is running', async () => {
    let finish: () => void = () => undefined;
    const { fixture, buttons } = create('/codex');
    refresh.and.returnValue(new Promise<void>((r) => (finish = r)));

    expect(buttons().every((b) => !b.disabled)).toBeTrue();
    buttons()[0].click();
    fixture.detectChanges();
    expect(buttons().length).toBe(2);
    expect(buttons().every((b) => b.disabled)).toBeTrue();
    expect(buttons()[0].textContent).toContain('auth.unavailable.retrying');

    finish();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(buttons().every((b) => !b.disabled)).toBeTrue();
  });

  describe('auto-resume after a late profile read', () => {
    it('shows a quiet checking state while the read is still pending', () => {
      const { fixture, buttons } = create('/codex', { loaded: false, identityUnknown: false });
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.checking')?.textContent).toContain('auth.unavailable.checking');
      expect(el.textContent).not.toContain('auth.unavailable.title');
      expect(buttons().length).toBe(0);
    });

    it('resumes the requested route with replaceUrl once the read lands approved', async () => {
      const { fixture, navigate } = create('/codex/ship/CNOU_Nomad?view=classic', { loaded: false, identityUnknown: false });
      expect(navigate).not.toHaveBeenCalled();

      loaded.set(true);
      approved.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledOnceWith('/codex/ship/CNOU_Nomad?view=classic', { replaceUrl: true });

      // A later signal change must not navigate a second time.
      approved.set(false);
      fixture.detectChanges();
      approved.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(navigate).toHaveBeenCalledTimes(1);
    });

    it('keeps the error copy and Retry when the identity is still unknown after loading', async () => {
      const { fixture, navigate, buttons } = create('/codex', { loaded: true, identityUnknown: true, approved: false });
      await fixture.whenStable();
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.textContent).toContain('auth.unavailable.title');
      expect(el.querySelector('.checking')).toBeNull();
      expect(buttons()[0].textContent).toContain('auth.unavailable.retry');
      expect(navigate).not.toHaveBeenCalled();
    });

    it('does not auto-resume while a manual retry is running', async () => {
      let finish: () => void = () => undefined;
      const { fixture, navigate } = create('/codex');
      refresh.and.returnValue(new Promise<void>((r) => (finish = r)));
      const run = fixture.componentInstance.retry();

      approved.set(true);
      identityUnknown.set(false);
      fixture.detectChanges();
      expect(navigate).not.toHaveBeenCalled();

      finish();
      await run;
      fixture.detectChanges();
      await fixture.whenStable();
      // Exactly one navigation: the retry's own.
      expect(navigate).toHaveBeenCalledOnceWith('/codex');
    });
  });

  it('signs out from the manual way out', async () => {
    const { buttons, fixture } = create(null);
    buttons()[1].click();
    await fixture.whenStable();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
