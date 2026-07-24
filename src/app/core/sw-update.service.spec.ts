import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { SwUpdateService } from './sw-update.service';

/**
 * Guards the fresh-open-vs-active reload behaviour (feedback 4f9fcff8): a build
 * that is ready right after opening loads silently, while one that lands later —
 * the user is already on the page — only offers the deliberate reload prompt.
 */
describe('SwUpdateService', () => {
  let versionUpdates: Subject<VersionReadyEvent>;
  let swUpdate: {
    isEnabled: boolean;
    versionUpdates: Subject<VersionReadyEvent>;
    checkForUpdate: jasmine.Spy;
    activateUpdate: jasmine.Spy;
  };
  let reload: jasmine.Spy;
  let sessionStore: Map<string, string>;
  let service: SwUpdateService;

  const versionReady = (): VersionReadyEvent =>
    ({
      type: 'VERSION_READY',
      currentVersion: { hash: 'old' },
      latestVersion: { hash: 'new' },
    }) as VersionReadyEvent;

  /** Flush the microtask queue so the fire-and-forget applyUpdate() settles. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(() => {
    versionUpdates = new Subject<VersionReadyEvent>();
    swUpdate = {
      isEnabled: true,
      versionUpdates,
      checkForUpdate: jasmine.createSpy('checkForUpdate').and.resolveTo(true),
      activateUpdate: jasmine.createSpy('activateUpdate').and.resolveTo(true),
    };
    reload = jasmine.createSpy('reload');
    sessionStore = new Map<string, string>();
    const fakeWindow = {
      sessionStorage: {
        getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
        setItem: (k: string, v: string) => void sessionStore.set(k, v),
        removeItem: (k: string) => void sessionStore.delete(k),
      },
    };
    const fakeDoc = { location: { reload }, defaultView: fakeWindow };

    TestBed.configureTestingModule({
      providers: [
        SwUpdateService,
        { provide: SwUpdate, useValue: swUpdate },
        { provide: DOCUMENT, useValue: fakeDoc },
      ],
    });
    service = TestBed.inject(SwUpdateService);
  });

  it('silently activates and reloads when a build is ready right after opening', async () => {
    service.init();
    versionUpdates.next(versionReady());
    await flush();

    expect(swUpdate.activateUpdate).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    // No prompt on a fresh open — the user just gets the newest site.
    expect(service.updateReady()).toBeFalse();
    expect(sessionStore.get('sc.sw.autoReloaded')).toBe('1');
  });

  it('prompts (no silent reload) when a build lands while the user is on the page', async () => {
    service.init();
    // Simulate the update arriving well after startup — the user is settled.
    (service as unknown as { startedAt: number }).startedAt = Date.now() - 20_000;
    versionUpdates.next(versionReady());
    await flush();

    expect(reload).not.toHaveBeenCalled();
    expect(swUpdate.activateUpdate).not.toHaveBeenCalled();
    expect(service.updateReady()).toBeTrue();
  });

  it('auto-reloads at most once per session, then falls back to the prompt', async () => {
    service.init();
    versionUpdates.next(versionReady());
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);

    // A second ready build within the grace window must not loop the page.
    (service as unknown as { startedAt: number }).startedAt = Date.now();
    versionUpdates.next(versionReady());
    await flush();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(service.updateReady()).toBeTrue();
  });

  it('does nothing when the service worker is disabled', () => {
    swUpdate.isEnabled = false;
    service.init();
    versionUpdates.next(versionReady());

    expect(swUpdate.checkForUpdate).not.toHaveBeenCalled();
    expect(service.updateReady()).toBeFalse();
  });
});
