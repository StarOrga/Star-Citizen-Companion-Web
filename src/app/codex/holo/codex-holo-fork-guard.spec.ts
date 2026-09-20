import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloForkGuard } from './codex-holo-fork-guard';
import { HangarService } from '../../hangar/hangar.service';
import { HangarShipConfig } from '../../hangar/hangar.types';

function config(followsOwner: boolean): Pick<HangarShipConfig, 'id' | 'followsOwner'> {
  return { id: 'cfg-1', followsOwner };
}

describe('CodexHoloForkGuard', () => {
  let guard: CodexHoloForkGuard;
  let forkFollowedLoadout: jasmine.Spy;
  let confirmSpy: jasmine.Spy;

  beforeEach(() => {
    forkFollowedLoadout = jasmine.createSpy('forkFollowedLoadout');
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({}),
        { provide: HangarService, useValue: { forkFollowedLoadout } },
      ],
    });
    guard = TestBed.inject(CodexHoloForkGuard);
    confirmSpy = spyOn(window, 'confirm');
  });

  it('resolves "own" without a prompt for a config that is not following anything', async () => {
    const result = await guard.ensureEditable(config(false));
    expect(result).toBe('own');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(forkFollowedLoadout).not.toHaveBeenCalled();
  });

  it('resolves "forked" after the hv-s4 question is confirmed and the fork write succeeds', async () => {
    confirmSpy.and.returnValue(true);
    forkFollowedLoadout.and.returnValue(Promise.resolve({ id: 'cfg-1' } as HangarShipConfig));
    const result = await guard.ensureEditable(config(true));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(forkFollowedLoadout).toHaveBeenCalledWith('cfg-1', {});
    expect(result).toBe('forked');
  });

  it('resolves "cancelled" when the hv-s4 question is declined', async () => {
    confirmSpy.and.returnValue(false);
    const result = await guard.ensureEditable(config(true));
    expect(result).toBe('cancelled');
    expect(forkFollowedLoadout).not.toHaveBeenCalled();
  });

  it('resolves "cancelled" when the fork write itself fails', async () => {
    confirmSpy.and.returnValue(true);
    forkFollowedLoadout.and.returnValue(Promise.resolve(null));
    const result = await guard.ensureEditable(config(true));
    expect(result).toBe('cancelled');
  });
});
