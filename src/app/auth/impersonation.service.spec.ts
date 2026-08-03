import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ImpersonationService, VIEW_AS_STORAGE_KEY } from './impersonation.service';

/**
 * `reload()` is `protected` so production code cannot call it, but the
 * unit tests must stub it — the whole point of the seam is that these
 * specs never actually reload the page. Casting to `any` to reach the
 * protected member is the intended test-only escape hatch.
 */
function spyOnReload(svc: ImpersonationService): jasmine.Spy {
  return spyOn(svc as unknown as { reload: () => void }, 'reload');
}

describe('ImpersonationService', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [ImpersonationService] });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  it('is inactive with no stored value and no real role loaded yet', () => {
    const svc = TestBed.inject(ImpersonationService);
    expect(svc.active()).toBe(false);
    expect(svc.viewAs()).toBeNull();
  });

  it('a stored admin value with a real collaborator role is inactive and wiped', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('admin'));
    const svc = TestBed.inject(ImpersonationService);
    svc.setActualRole('collaborator', true);

    expect(svc.active()).toBe(false);
    expect(svc.viewAs()).toBeNull();
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('a viewer with stored viewer is inactive and wiped (viewer has no targets)', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer'));
    const svc = TestBed.inject(ImpersonationService);
    svc.setActualRole('viewer', true);

    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('a viewer with stored anon is inactive and wiped once loaded', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('anon'));
    const svc = TestBed.inject(ImpersonationService);
    svc.setActualRole('viewer', true);

    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('enter() ignores a target outside targets() — no storage write, no reload', () => {
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc);
    svc.setActualRole('collaborator', true);

    svc.enter('admin');

    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('enter() with a valid target writes storage and reloads, without mutating viewAs() first (F3)', () => {
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc).and.callFake(() => {
      // At the moment reload() fires, the exposed signal must NOT have been
      // flipped yet — mutating it before the (real) reload would fire every
      // effect keyed off `auth.user()`/`viewAs()` in a document that is
      // about to be torn down (regression for the FeedbackDraftService
      // data-loss bug, F3).
      expect(svc.viewAs()).toBeNull();
    });
    svc.setActualRole('admin', true);

    svc.enter('viewer');

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBe(JSON.stringify('viewer'));
    // Because `reload()` is stubbed (this is a unit test, not a real
    // navigation), the signal legitimately stays unchanged afterward too —
    // in production the reload always follows and re-reads storage.
    expect(svc.viewAs()).toBeNull();
  });

  it('sign-out (setActualRole(null, true)) clears the overlay', () => {
    // Enter no longer flips `_stored` itself (F3) — a real preview always
    // starts from a fresh construction reading storage after the reload, so
    // that's what this test simulates too.
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer'));
    const svc = TestBed.inject(ImpersonationService);
    svc.setActualRole('admin', true);
    expect(svc.active()).toBe(true);

    svc.setActualRole(null, true);

    expect(svc.active()).toBe(false);
    expect(svc.viewAs()).toBeNull();
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('exit() clears storage and reloads', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('collaborator'));
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc);
    svc.setActualRole('admin', true);
    expect(svc.active()).toBe(true);

    svc.exit();

    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('exit() does NOT reload and degrades to an in-memory exit when removeItem silently no-ops (F4)', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('collaborator'));
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc);
    svc.setActualRole('admin', true);
    expect(svc.active()).toBe(true);

    spyOn(sessionStorage, 'removeItem').and.callFake(() => {
      /* silently do nothing — simulates a blocked/no-op clear */
    });

    svc.exit();

    // Reloading here would just restore the same preview from storage and
    // trap the user permanently — so it must NOT be called...
    expect(reload).not.toHaveBeenCalled();
    // ...but the user must still be freed from the overlay in this document.
    expect(svc.active()).toBe(false);
    expect(svc.viewAs()).toBeNull();
  });

  it('pre-load anon is active before the real role finishes loading', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('anon'));
    const svc = TestBed.inject(ImpersonationService);

    expect(svc.active()).toBe(true);
    expect(svc.viewAs()).toBe('anon');
  });

  it('pre-load collaborator is not active before the real role finishes loading', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('collaborator'));
    const svc = TestBed.inject(ImpersonationService);

    expect(svc.active()).toBe(false);
    expect(svc.viewAs()).toBeNull();
  });

  it('rejects a garbage stored value at construction time', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, 'not-json-and-not-a-role');
    const svc = TestBed.inject(ImpersonationService);

    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('targets() mirrors impersonationTargets() for the current real role', () => {
    const svc = TestBed.inject(ImpersonationService);
    svc.setActualRole('admin', true);
    expect(svc.targets()).toEqual(['collaborator', 'viewer', 'anon']);

    svc.setActualRole('viewer', true);
    expect(svc.targets()).toEqual([]);
  });

  it('never throws while constructing with a garbage sc.viewAs value (F1 boot-crash regression)', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, 'ADMIN');

    expect(() => TestBed.inject(ImpersonationService)).not.toThrow();
    const svc = TestBed.inject(ImpersonationService);
    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('never throws when a garbage value parses as JSON to a non-ViewAs shape', () => {
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify({ role: 'admin' }));

    expect(() => TestBed.inject(ImpersonationService)).not.toThrow();
    const svc = TestBed.inject(ImpersonationService);
    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('constructs safely and fails closed when sessionStorage access throws (F2 regression)', () => {
    // Simulates a SecurityError from accessing `.sessionStorage` itself
    // (private mode / disabled storage / framed contexts) — reproduced by
    // overriding `defaultView` with a stand-in whose `sessionStorage`
    // getter throws.
    const throwingWindow = {
      get sessionStorage(): Storage {
        throw new DOMException('storage disabled', 'SecurityError');
      },
      location: { reload: () => {} },
    } as unknown as Window & typeof globalThis;
    const stubDocument = { defaultView: throwingWindow } as unknown as Document;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [ImpersonationService, { provide: DOCUMENT, useValue: stubDocument }],
    });

    let svc!: ImpersonationService;
    expect(() => (svc = TestBed.inject(ImpersonationService))).not.toThrow();
    expect(svc.active()).toBe(false);
    svc.setActualRole('admin', true);
    // Fail closed: storage cannot round-trip a preview, so no target may be
    // offered even though the real role would otherwise allow some.
    expect(svc.targets()).toEqual([]);
  });

  it('enter() and exit() always go through the reload seam (never navigate directly)', () => {
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc);
    svc.setActualRole('admin', true);

    svc.enter('viewer');
    expect(reload).toHaveBeenCalledTimes(1);

    // Simulate the post-reload state (enter() itself never mutates _stored —
    // F3) so exit() has something real to clear.
    TestBed.resetTestingModule();
    sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify('viewer'));
    TestBed.configureTestingModule({ providers: [ImpersonationService] });
    const svc2 = TestBed.inject(ImpersonationService);
    const reload2 = spyOnReload(svc2);
    svc2.setActualRole('admin', true);

    svc2.exit();
    expect(reload2).toHaveBeenCalledTimes(1);
  });
});
