import { TestBed } from '@angular/core/testing';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { reloadOnBuildRefresh } from './build-refresh.util';

describe('reloadOnBuildRefresh', () => {
  function arm(start = 0) {
    const buildRefresh = signal(start);
    const reload = jasmine.createSpy('reload');
    runInInjectionContext(TestBed.inject(Injector), () => reloadOnBuildRefresh({ buildRefresh }, reload));
    return { buildRefresh, reload };
  }

  it('leaves the initial load alone — the value at call time never reloads', () => {
    const { reload } = arm(3);
    TestBed.tick();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once per moved build', () => {
    const { buildRefresh, reload } = arm();
    buildRefresh.set(1);
    TestBed.tick();
    expect(reload).toHaveBeenCalledTimes(1);
    buildRefresh.set(2);
    TestBed.tick();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('runs reload untracked, so a signal the reload reads does not re-trigger it', () => {
    const { buildRefresh, reload } = arm();
    const other = signal(0);
    reload.and.callFake(() => other());
    buildRefresh.set(1);
    TestBed.tick();
    other.set(1);
    TestBed.tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
