import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Route } from '@angular/router';
import { Observable, Subject, of, throwError } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { IdlePreloadingStrategy, PRELOAD_ROUTE_DATA, PRELOAD_START_DELAY_MS, connectionAllowsPreload } from './idle-preloading.strategy';

describe('IdlePreloadingStrategy', () => {
  let authed: ReturnType<typeof signal<boolean>>;

  function setup(): IdlePreloadingStrategy {
    authed = signal(true);
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { isAuthenticated: authed } }] });
    // Idle callbacks run at once here; the start delay stays a real (faked) timer.
    vi.spyOn(window, 'requestIdleCallback').mockImplementation((cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 0;
    });
    return TestBed.inject(IdlePreloadingStrategy);
  }

  const marked = (path: string): Route => ({ path, data: { [PRELOAD_ROUTE_DATA]: true } });

  it('leaves unmarked routes alone', fakeAsync(() => {
    const strategy = setup();
    const load = vi.fn().mockName('load').mockReturnValue(of(null));
    strategy.preload({ path: 'admin' }, load).subscribe();
    tick(PRELOAD_START_DELAY_MS * 2);
    expect(load).not.toHaveBeenCalled();
  }));

  it('loads a marked route only after the start delay', fakeAsync(() => {
    const strategy = setup();
    const load = vi.fn().mockName('load').mockReturnValue(of(null));
    strategy.preload(marked('codex'), load).subscribe();
    tick(PRELOAD_START_DELAY_MS - 100);
    expect(load).not.toHaveBeenCalled();
    tick(200);
    flush();
    expect(load).toHaveBeenCalledTimes(1);
  }));

  it('loads one area at a time', fakeAsync(() => {
    const strategy = setup();
    const first = new Subject<unknown>();
    const loadA = vi.fn().mockName('a').mockReturnValue(first as Observable<unknown>);
    const loadB = vi.fn().mockName('b').mockReturnValue(of(null));
    strategy.preload(marked('verse'), loadA).subscribe();
    strategy.preload(marked('hq'), loadB).subscribe();
    tick(PRELOAD_START_DELAY_MS + 10);
    flush();
    expect(loadA).toHaveBeenCalled();
    expect(loadB).not.toHaveBeenCalled();
    first.complete();
    tick(10);
    flush();
    expect(loadB).toHaveBeenCalled();
  }));

  it('skips everything while signed out', fakeAsync(() => {
    const strategy = setup();
    authed.set(false);
    const load = vi.fn().mockName('load').mockReturnValue(of(null));
    let completed = false;
    strategy.preload(marked('codex'), load).subscribe({ complete: () => (completed = true) });
    tick(PRELOAD_START_DELAY_MS + 10);
    flush();
    expect(load).not.toHaveBeenCalled();
    expect(completed).toBe(true);
  }));

  it('swallows a failed preload and moves on', fakeAsync(() => {
    const strategy = setup();
    const failing = vi.fn().mockName('failing').mockReturnValue(throwError(() => new Error('chunk 404')));
    const next = vi.fn().mockName('next').mockReturnValue(of(null));
    let errored = false;
    strategy.preload(marked('codex'), failing).subscribe({ error: () => (errored = true) });
    strategy.preload(marked('hq'), next).subscribe();
    tick(PRELOAD_START_DELAY_MS + 10);
    flush();
    expect(errored).toBe(false);
    expect(next).toHaveBeenCalled();
  }));

  it('respects Save-Data and 2G', () => {
    expect(connectionAllowsPreload(undefined)).toBe(true);
    expect(connectionAllowsPreload({ effectiveType: '4g' })).toBe(true);
    expect(connectionAllowsPreload({ saveData: true, effectiveType: '4g' })).toBe(false);
    expect(connectionAllowsPreload({ effectiveType: '2g' })).toBe(false);
    expect(connectionAllowsPreload({ effectiveType: 'slow-2g' })).toBe(false);
  });
});
