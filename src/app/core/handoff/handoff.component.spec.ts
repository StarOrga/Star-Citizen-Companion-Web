import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { HandoffComponent } from './handoff.component';
import { HandoffService } from './handoff.service';

const CODE = 'a'.repeat(43);

describe('HandoffComponent', () => {
  let handoff: jasmine.SpyObj<HandoffService>;
  let confirm: jasmine.Spy;
  let email: string | undefined;

  function create(fragment: string | null) {
    handoff = jasmine.createSpyObj<HandoffService>('HandoffService', ['peek', 'redeem', 'errorKey']);
    handoff.peek.and.resolveTo('j***@g***.com');
    handoff.redeem.and.resolveTo('/codex');
    handoff.errorKey.and.resolveTo('handoff.errors.invalidCode');
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [HandoffComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
        { provide: HandoffService, useValue: handoff },
        { provide: ScConfirmService, useValue: { confirm } },
        { provide: AuthService, useValue: { ready: () => Promise.resolve(), realUser: () => (email ? { email } : null) } },
      ],
    });
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    spyOn(history, 'replaceState');
    const fixture = TestBed.createComponent(HandoffComponent);
    return fixture;
  }

  beforeEach(() => {
    email = undefined;
  });

  it('never redeems on load: only peeks, and strips the fragment first', async () => {
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    expect(history.replaceState).toHaveBeenCalled();
    expect(handoff.peek).toHaveBeenCalledWith(CODE);
    expect(handoff.redeem).not.toHaveBeenCalled();
    expect(f.componentInstance.account()).toBe('j***@g***.com');
  });

  it('rejects a malformed code without any request', async () => {
    const f = create('c=short');
    await f.componentInstance.ngOnInit();
    expect(handoff.peek).not.toHaveBeenCalled();
    expect(f.componentInstance.errorKey()).toBe('handoff.errors.invalidCode');
  });

  it('redeems only after the tap and navigates', async () => {
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    await f.componentInstance.signIn();
    expect(handoff.redeem).toHaveBeenCalledWith(CODE);
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/codex', { replaceUrl: true });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks for confirmation when another account is signed in, and respects "no"', async () => {
    email = 'someone.else@example.com';
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    confirm.and.resolveTo(false);
    await f.componentInstance.signIn();
    expect(confirm).toHaveBeenCalled();
    expect(handoff.redeem).not.toHaveBeenCalled();
  });

  it('shows a translated error when redeem fails', async () => {
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    handoff.redeem.and.rejectWith(new Error('x'));
    await f.componentInstance.signIn();
    expect(f.componentInstance.errorKey()).toBe('handoff.errors.invalidCode');
  });
});
