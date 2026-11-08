import type { Mock, MockedObject } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../auth/auth.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { HandoffComponent } from './handoff.component';
import { HandoffService } from './handoff.service';

const CODE = 'a'.repeat(43);

describe('HandoffComponent', () => {
  let handoff: MockedObject<HandoffService>;
  let confirm: Mock;
  let email: string | undefined;
  let userId = 'other-user';

  function create(fragment: string | null) {
    handoff = {
      peek: vi.fn().mockName("HandoffService.peek"),
      redeem: vi.fn().mockName("HandoffService.redeem"),
      errorKey: vi.fn().mockName("HandoffService.errorKey")
    } as unknown as MockedObject<HandoffService>;
    handoff.peek.mockResolvedValue({ account: 'j***@g***.test', userId: 'owner-1', targetPath: '/codex/ship/x' });
    handoff.redeem.mockResolvedValue('/codex');
    handoff.errorKey.mockResolvedValue('handoff.errors.invalidCode');
    confirm = vi.fn().mockName('confirm').mockResolvedValue(true);
    TestBed.configureTestingModule({
      imports: [HandoffComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
        { provide: HandoffService, useValue: handoff },
        { provide: ScConfirmService, useValue: { confirm } },
        {
          provide: AuthService,
          useValue: {
            ready: () => Promise.resolve(),
realUser: () => (email ? { email, id: userId } : null),
          },
        },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(history, 'replaceState').mockReturnValue(undefined as never);
    const fixture = TestBed.createComponent(HandoffComponent);
    return fixture;
  }

  beforeEach(() => {
    email = undefined;
    userId = 'other-user';
  });

  it('warns although two different accounts mask identically (jane@gamma.test vs jx@gmx.test)', async () => {
    email = 'jx@gmx.test'; // masks to j***@g***.test, same as the code owner's display
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    await f.componentInstance.signIn();
    expect(confirm).toHaveBeenCalled();
    expect(handoff.redeem).toHaveBeenCalled(); // confirmed -> proceeds
  });

  it('same account already signed in: no redeem, just navigates to the target', async () => {
    email = 'jane@gamma.test';
    userId = 'owner-1';
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    await f.componentInstance.signIn();
    expect(handoff.redeem).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigateByUrl).toHaveBeenCalledWith('/codex/ship/x', { replaceUrl: true });
  });

  it('a double tap sends only one redeem', async () => {
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    await Promise.all([f.componentInstance.signIn(), f.componentInstance.signIn()]);
    expect(handoff.redeem).toHaveBeenCalledTimes(1);
  });

  it('cancelling the dialog frees the button again', async () => {
    email = 'jx@gmx.test';
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    confirm.mockResolvedValue(false);
    await f.componentInstance.signIn();
    expect(f.componentInstance.busy()).toBe(false);
  });

  it('never redeems on load: only peeks, and strips the fragment first', async () => {
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    expect(history.replaceState).toHaveBeenCalled();
    expect(handoff.peek).toHaveBeenCalledWith(CODE);
    expect(handoff.redeem).not.toHaveBeenCalled();
    expect(f.componentInstance.account()).toBe('j***@g***.test');
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
    confirm.mockResolvedValue(false);
    await f.componentInstance.signIn();
    expect(confirm).toHaveBeenCalled();
    expect(handoff.redeem).not.toHaveBeenCalled();
  });

  it('shows a translated error when redeem fails', async () => {
    const f = create(`c=${CODE}`);
    await f.componentInstance.ngOnInit();
    handoff.redeem.mockRejectedValue(new Error('x'));
    await f.componentInstance.signIn();
    expect(f.componentInstance.errorKey()).toBe('handoff.errors.invalidCode');
  });
});
