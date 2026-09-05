import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';

import { RouteLoadRecoveryService, isRouteChunkError } from './route-load-recovery.service';

/**
 * Regression guard for admin feedback cdb16d63 ("teilweise funktionieren menü
 * punkte oben in de header nicht mehr, wie telemetrie oder auch … freunde").
 *
 * Every route is `loadComponent: () => import(...)`. When a chunk from a
 * superseded build is requested the SPA rewrite answers index.html, the module
 * fails its MIME check, the router emits NavigationError — and before this
 * service NOTHING listened, so the menu entry was a silent no-op that stayed
 * dead for the rest of the document's life. These tests pin that such a
 * failure now becomes a real navigation again, exactly once per URL, and that
 * no other kind of navigation failure can trigger a page load.
 */
describe('RouteLoadRecoveryService', () => {
  let events: Subject<unknown>;
  let assign: jasmine.Spy;
  let reload: jasmine.Spy;
  let sessionStore: Map<string, string>;
  let fakeSession: {
    getItem: (k: string) => string | null;
    setItem: (k: string, v: string) => void;
    removeItem: (k: string) => void;
  };

  /** Let the awaited adoption step settle so location is touched. */
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  const chunkError = (): Error =>
    new Error(
      'Failed to fetch dynamically imported module: https://sc-companion.vercel.app/chunk-7QK3XZ2A.js',
    );

  function setup(swUpdate?: unknown): RouteLoadRecoveryService {
    events = new Subject<unknown>();
    assign = jasmine.createSpy('assign');
    reload = jasmine.createSpy('reload');
    sessionStore = new Map<string, string>();
    fakeSession = {
      getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
      setItem: (k: string, v: string) => void sessionStore.set(k, v),
      removeItem: (k: string) => void sessionStore.delete(k),
    };
    const fakeWindow = { sessionStorage: fakeSession };

    TestBed.configureTestingModule({
      providers: [
        RouteLoadRecoveryService,
        { provide: Router, useValue: { events } },
        {
          provide: DOCUMENT,
          useValue: { location: { assign, reload }, defaultView: fakeWindow },
        },
        ...(swUpdate ? [{ provide: SwUpdate, useValue: swUpdate }] : []),
      ],
    });
    const service = TestBed.inject(RouteLoadRecoveryService);
    service.init();
    return service;
  }

  describe('isRouteChunkError', () => {
    it('recognises every engine phrasing of a failed lazy route chunk', () => {
      expect(isRouteChunkError(chunkError())).toBeTrue();
      expect(
        isRouteChunkError(new Error('error loading dynamically imported module: /chunk-A.js')),
      ).toBeTrue();
      expect(isRouteChunkError(new Error('Importing a module script failed.'))).toBeTrue();
      expect(
        isRouteChunkError(
          new Error(
            'Failed to load module script: Expected a JavaScript module script but the server ' +
              'responded with a MIME type of "text/html".',
          ),
        ),
      ).toBeTrue();
      expect(isRouteChunkError(new Error('Loading chunk 42 failed.'))).toBeTrue();

      const named = new Error('boom');
      named.name = 'ChunkLoadError';
      expect(isRouteChunkError(named)).toBeTrue();
    });

    it('does not claim any other navigation failure', () => {
      // Reloading on these would turn a broken guard or a bad redirect into a
      // reload loop, which is strictly worse than the dead click.
      expect(isRouteChunkError(new Error("Cannot match any routes. URL Segment: 'nope'"))).toBeFalse();
      expect(isRouteChunkError(new TypeError('roles.role is not a function'))).toBeFalse();
      expect(isRouteChunkError(null)).toBeFalse();
      expect(isRouteChunkError(undefined)).toBeFalse();
    });
  });

  it('reloads the page onto the attempted URL when a route chunk will not load', async () => {
    const service = setup();

    events.next(new NavigationError(1, '/admin/telemetry', chunkError()));
    expect(service.recovering()).withContext('indicator stays up until the reload').toBeTrue();
    await flush();

    expect(assign).toHaveBeenCalledOnceWith('/admin/telemetry');
    expect(service.loadFailed()).withContext('recovery is running, not given up').toBeFalse();
  });

  it('leaves every other navigation failure alone', async () => {
    const service = setup();

    events.next(new NavigationError(1, '/friends', new Error('Cannot match any routes')));
    await flush();

    expect(assign).not.toHaveBeenCalled();
    expect(service.recovering()).toBeFalse();
    expect(service.loadFailed()).toBeFalse();
  });

  it('adopts a newer service-worker version before reloading', async () => {
    const swUpdate = {
      isEnabled: true,
      checkForUpdate: jasmine.createSpy('checkForUpdate').and.resolveTo(true),
      activateUpdate: jasmine.createSpy('activateUpdate').and.resolveTo(true),
    };
    setup(swUpdate);

    events.next(new NavigationError(1, '/friends', chunkError()));
    await flush();

    expect(swUpdate.checkForUpdate).toHaveBeenCalled();
    expect(swUpdate.activateUpdate)
      .withContext('otherwise the reload is served the very cache that just failed')
      .toHaveBeenCalled();
    expect(assign).toHaveBeenCalledOnceWith('/friends');
  });

  it('gives up loudly instead of looping when the same URL fails again', async () => {
    const service = setup();

    events.next(new NavigationError(1, '/friends', chunkError()));
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);

    // Same session, same URL, still broken — the reload did not help.
    events.next(new NavigationError(2, '/friends', chunkError()));
    await flush();

    expect(assign).withContext('no second reload — that would be a loop').toHaveBeenCalledTimes(1);
    expect(service.loadFailed()).toBeTrue();
  });

  it('rearms the one-shot once the URL navigates successfully', async () => {
    const service = setup();

    events.next(new NavigationError(1, '/friends', chunkError()));
    await flush();
    events.next(new NavigationEnd(2, '/friends', '/friends'));

    expect(service.loadFailed()).toBeFalse();

    events.next(new NavigationError(3, '/friends', chunkError()));
    await flush();

    expect(assign).withContext('a later, unrelated failure may recover too').toHaveBeenCalledTimes(2);
  });

  it('keeps working when sessionStorage is unavailable', async () => {
    const service = setup();
    fakeSession.getItem = () => {
      throw new Error('private mode');
    };
    fakeSession.setItem = () => {
      throw new Error('private mode');
    };

    events.next(new NavigationError(1, '/friends', chunkError()));
    await flush();

    expect(assign).toHaveBeenCalledOnceWith('/friends');
    expect(service.loadFailed()).toBeFalse();
  });
});
