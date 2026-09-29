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

  function create(redirect: string | null) {
    refresh = jasmine.createSpy('refresh').and.resolveTo(undefined);
    signOut = jasmine.createSpy('signOut').and.resolveTo(undefined);
    TestBed.configureTestingModule({
      imports: [AccessUnavailableComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: RoleService, useValue: { refresh } },
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

  it('signs out from the manual way out', async () => {
    const { buttons, fixture } = create(null);
    buttons()[1].click();
    await fixture.whenStable();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
