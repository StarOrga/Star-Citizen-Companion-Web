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

  it('enter() with a valid target writes storage and reloads', () => {
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc);
    svc.setActualRole('admin', true);

    svc.enter('viewer');

    expect(svc.viewAs()).toBe('viewer');
    expect(svc.active()).toBe(true);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBe(JSON.stringify('viewer'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('sign-out (setActualRole(null, true)) clears the overlay', () => {
    const svc = TestBed.inject(ImpersonationService);
    spyOnReload(svc);
    svc.setActualRole('admin', true);
    svc.enter('viewer');
    expect(svc.active()).toBe(true);

    svc.setActualRole(null, true);

    expect(svc.active()).toBe(false);
    expect(svc.viewAs()).toBeNull();
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
  });

  it('exit() clears storage and reloads', () => {
    const svc = TestBed.inject(ImpersonationService);
    const reload = spyOnReload(svc);
    svc.setActualRole('admin', true);
    svc.enter('collaborator');

    svc.exit();

    expect(svc.active()).toBe(false);
    expect(sessionStorage.getItem(VIEW_AS_STORAGE_KEY)).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
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
});
