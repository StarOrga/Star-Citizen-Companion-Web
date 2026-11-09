import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SCC_APP_URI, SCC_LAUNCH_GRACE_MS, SCC_LAUNCH_WAIT_MS, SccAppLauncherService } from './scc-app-launcher.service';

describe('SccAppLauncherService', () => {
  const KEY = 'sc.sccApp.launchedBefore';
  let svc: SccAppLauncherService;
  let open: Mock;
  let removeFrame: Mock;

  beforeEach(() => {
    localStorage.removeItem(KEY);
    vi.useFakeTimers();
    svc = TestBed.inject(SccAppLauncherService);
    removeFrame = vi.fn().mockName('removeFrame');
    open = vi.spyOn(svc, 'openUri').mockReturnValue(removeFrame);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.removeItem(KEY);
  });

  it('reads a silent wait as "not there" and remembers nothing', async () => {
    const result = svc.launch();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(SCC_APP_URI);
    vi.advanceTimersByTime(SCC_LAUNCH_WAIT_MS);
    expect(await result).toBe(false);
    expect(svc.launchedBefore()).toBe(false);
    expect(removeFrame).toHaveBeenCalledTimes(1);
  });

  it('reads a focus change as "answered" and remembers it for this browser', async () => {
    const result = svc.launch();
    window.dispatchEvent(new Event('blur'));
    expect(await result).toBe(true);
    expect(svc.launchedBefore()).toBe(true);
    expect(removeFrame).toHaveBeenCalledTimes(1);
  });

  it('stops listening once settled', async () => {
    const first = svc.launch();
    vi.advanceTimersByTime(SCC_LAUNCH_WAIT_MS);
    await first;
    window.dispatchEvent(new Event('blur'));
    expect(svc.launchedBefore()).toBe(false);
  });

  it('shares one attempt between two quick calls', async () => {
    const a = svc.launch();
    const b = svc.launch();
    expect(open).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SCC_LAUNCH_WAIT_MS);
    expect(await a).toBe(false);
    expect(await b).toBe(false);
  });

  it('a longer wait still takes a late focus change as the answer', async () => {
    const result = svc.launch(SCC_LAUNCH_GRACE_MS);
    vi.advanceTimersByTime(SCC_LAUNCH_WAIT_MS + 3000);
    window.dispatchEvent(new Event('blur'));
    expect(await result).toBe(true);
    expect(svc.launchedBefore()).toBe(true);
  });
});
