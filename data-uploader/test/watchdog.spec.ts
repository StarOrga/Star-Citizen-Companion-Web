import { describe, it, expect } from 'vitest';
import { createWatchdog } from '../src/lib/watchdog.js';

/**
 * Deterministic fake clock — a manually-driven scheduler injected into the
 * watchdog so tests advance "time" explicitly instead of relying on real
 * timers. Each armed timer gets a monotonic id; `advance(ms)` fires every timer
 * whose deadline has passed.
 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const setTimer = (fn: () => void, ms: number): number => {
    const id = ++seq;
    timers.set(id, { at: now + ms, fn });
    return id;
  };
  const clearTimer = (id: number): void => {
    timers.delete(id);
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, t] of [...timers.entries()]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
  };
  return { setTimer, clearTimer, advance, pending: () => timers.size };
}

describe('createWatchdog', () => {
  it('fires onTimeout once after the idle window with no pet', () => {
    const clock = fakeClock();
    let fired = 0;
    let reportedIdle = -1;
    const wd = createWatchdog({
      timeoutMs: 1000,
      onTimeout: (idle) => {
        fired++;
        reportedIdle = idle;
      },
      setTimer: clock.setTimer as never,
      clearTimer: clock.clearTimer as never,
    });
    wd.start();
    clock.advance(999);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
    expect(reportedIdle).toBe(1000);
    expect(wd.timedOut()).toBe(true);
    // No second fire even if time keeps passing.
    clock.advance(5000);
    expect(fired).toBe(1);
  });

  it('pet() resets the countdown so a lively job never times out', () => {
    const clock = fakeClock();
    let fired = 0;
    const wd = createWatchdog({
      timeoutMs: 1000,
      onTimeout: () => fired++,
      setTimer: clock.setTimer as never,
      clearTimer: clock.clearTimer as never,
    });
    wd.start();
    for (let i = 0; i < 10; i++) {
      clock.advance(900); // always pet before the 1000ms deadline
      wd.pet();
    }
    expect(fired).toBe(0);
    // Now go quiet — it should trip.
    clock.advance(1000);
    expect(fired).toBe(1);
  });

  it('stop() prevents any timeout and clears the pending timer', () => {
    const clock = fakeClock();
    let fired = 0;
    const wd = createWatchdog({
      timeoutMs: 1000,
      onTimeout: () => fired++,
      setTimer: clock.setTimer as never,
      clearTimer: clock.clearTimer as never,
    });
    wd.start();
    wd.stop();
    expect(clock.pending()).toBe(0);
    clock.advance(10_000);
    expect(fired).toBe(0);
    // pet()/start() after stop are inert.
    wd.pet();
    wd.start();
    clock.advance(10_000);
    expect(fired).toBe(0);
  });

  it('a throwing onTimeout does not propagate', () => {
    const clock = fakeClock();
    const wd = createWatchdog({
      timeoutMs: 500,
      onTimeout: () => {
        throw new Error('reporting blew up');
      },
      setTimer: clock.setTimer as never,
      clearTimer: clock.clearTimer as never,
    });
    wd.start();
    expect(() => clock.advance(500)).not.toThrow();
    expect(wd.timedOut()).toBe(true);
  });
});
