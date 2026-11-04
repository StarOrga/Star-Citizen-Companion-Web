import { TestBed } from '@angular/core/testing';
import { SCC_APP_URI, SCC_LAUNCH_WAIT_MS, SccAppLauncherService } from './scc-app-launcher.service';

describe('SccAppLauncherService', () => {
  const KEY = 'sc.sccApp.launchedBefore';
  let svc: SccAppLauncherService;
  let open: jasmine.Spy;
  let removeFrame: jasmine.Spy;

  beforeEach(() => {
    localStorage.removeItem(KEY);
    jasmine.clock().install();
    svc = TestBed.inject(SccAppLauncherService);
    removeFrame = jasmine.createSpy('removeFrame');
    open = spyOn(svc, 'openUri').and.returnValue(removeFrame);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
    localStorage.removeItem(KEY);
  });

  it('reads a silent wait as "not there" and remembers nothing', async () => {
    const result = svc.launch();
    expect(open).toHaveBeenCalledOnceWith(SCC_APP_URI);
    jasmine.clock().tick(SCC_LAUNCH_WAIT_MS);
    expect(await result).toBeFalse();
    expect(svc.launchedBefore()).toBeFalse();
    expect(removeFrame).toHaveBeenCalledTimes(1);
  });

  it('reads a focus change as "answered" and remembers it for this browser', async () => {
    const result = svc.launch();
    window.dispatchEvent(new Event('blur'));
    expect(await result).toBeTrue();
    expect(svc.launchedBefore()).toBeTrue();
    expect(removeFrame).toHaveBeenCalledTimes(1);
  });

  it('stops listening once settled', async () => {
    const first = svc.launch();
    jasmine.clock().tick(SCC_LAUNCH_WAIT_MS);
    await first;
    window.dispatchEvent(new Event('blur'));
    expect(svc.launchedBefore()).toBeFalse();
  });

  it('shares one attempt between two quick calls', async () => {
    const a = svc.launch();
    const b = svc.launch();
    expect(open).toHaveBeenCalledTimes(1);
    jasmine.clock().tick(SCC_LAUNCH_WAIT_MS);
    expect(await a).toBeFalse();
    expect(await b).toBeFalse();
  });
});
