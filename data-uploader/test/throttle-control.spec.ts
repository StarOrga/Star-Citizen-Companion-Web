import { describe, it, expect, vi } from 'vitest';
import {
  createThrottleControl,
  runtimeFor,
  isLiveProfileId,
  type LiveProfileId,
} from '../src/lib/throttle-control.js';
import { catalogHooks, skinHooks } from '../src/lib/upload-hooks.js';
import { UploadJobStore, createJob, type TextIO } from '../src/lib/upload-job.js';
import { createPauseControl, PausedError } from '../src/lib/pause-control.js';

/** Records the sleeps a control asks for instead of burning wall-clock time. */
function recordingSleeper(): { sleeps: number[]; sleep: (ms: number) => Promise<void> } {
  const sleeps: number[] = [];
  return {
    sleeps,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  };
}

function memStore(): UploadJobStore {
  let text: string | null = null;
  const io: TextIO = {
    read: () => text,
    write: (t) => {
      text = t;
    },
    remove: () => {
      text = null;
    },
  };
  const store = new UploadJobStore(io);
  store.save(createJob('job-1', '/out', { channel: 'LIVE', patchVersion: '4.0', buildNumber: '1' }, 0));
  return store;
}

describe('createThrottleControl', () => {
  it('starts on the given profile and exposes its runtime knobs', () => {
    const c = createThrottleControl('standard');
    expect(c.profile()).toBe('standard');
    expect(c.runtime()).toEqual(runtimeFor('standard'));
  });

  it('switches profiles and reports whether anything changed', () => {
    const c = createThrottleControl('standard');
    expect(c.set('minimal')).toBe(true);
    expect(c.profile()).toBe('minimal');
    // Re-selecting the active profile is a no-op, not a spurious change event.
    expect(c.set('minimal')).toBe(false);
  });

  it('ignores an unknown profile id instead of blanking the profile', () => {
    const c = createThrottleControl('minimal');
    expect(c.set('turbo' as LiveProfileId)).toBe(false);
    expect(c.set(undefined as unknown as LiveProfileId)).toBe(false);
    // A bad IPC payload must never silently un-throttle a throttled job.
    expect(c.profile()).toBe('minimal');
  });

  it('notifies listeners with the new profile and its runtime', () => {
    const c = createThrottleControl('standard');
    const seen: string[] = [];
    c.onChange((p, rt) => seen.push(`${p}:${rt.priority}`));
    c.set('minimal');
    c.set('maximum');
    // maximum rides at Normal — see process-throttle.spec on why raising the
    // class cannot reach the worker processes that do the work.
    expect(seen).toEqual(['minimal:idle', 'maximum:normal']);
  });

  it('survives a listener that throws — job control must not break', () => {
    const c = createThrottleControl('standard');
    const good = vi.fn();
    c.onChange(() => {
      throw new Error('bad listener');
    });
    c.onChange(good);
    expect(() => c.set('minimal')).not.toThrow();
    expect(good).toHaveBeenCalledOnce();
  });

  it('stops notifying after unsubscribe', () => {
    const c = createThrottleControl('standard');
    const cb = vi.fn();
    const off = c.onChange(cb);
    off();
    c.set('minimal');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('live re-read at work-unit boundaries', () => {
  it('paces the NEXT unit with the profile switched during the previous one', async () => {
    const { sleeps, sleep } = recordingSleeper();
    const c = createThrottleControl('maximum', sleep);

    // Unit 1 runs under 'maximum' — no pacing.
    await c.pace();
    expect(sleeps).toEqual([]);

    // The operator sits down to play WHILE unit 1 is in flight.
    c.set('minimal');

    // Unit 2 must observe it. This is the whole feature: the loop re-reads the
    // profile per unit instead of using the value captured at job start.
    await c.pace();
    expect(sleeps).toEqual([runtimeFor('minimal').pacingMs]);

    // …and back up again when they walk away.
    c.set('maximum');
    await c.pace();
    expect(sleeps).toEqual([runtimeFor('minimal').pacingMs]);
  });

  it('does not interrupt a unit that already started — pace only awaits between units', async () => {
    const { sleep } = recordingSleeper();
    const c = createThrottleControl('maximum', sleep);
    const order: string[] = [];

    const unit = async (n: number): Promise<void> => {
      order.push(`start-${n}`);
      // A switch landing mid-unit must not tear the unit apart: `pace` is only
      // ever awaited at the boundary, so the unit runs to completion either way.
      c.set(n === 1 ? 'minimal' : 'maximum');
      await Promise.resolve();
      order.push(`end-${n}`);
    };

    for (const n of [1, 2]) {
      await c.pace();
      await unit(n);
    }
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('never sleeps for the unthrottled profiles', async () => {
    const { sleeps, sleep } = recordingSleeper();
    const c = createThrottleControl('standard', sleep);
    await c.pace();
    c.set('auto');
    await c.pace();
    expect(sleeps).toEqual([]);
  });
});

describe('upload hooks bind the throttle live', () => {
  it('gives the catalog stage a pacer that re-reads the CURRENT profile', async () => {
    const { sleeps, sleep } = recordingSleeper();
    const throttle = createThrottleControl('maximum', sleep);
    // Hooks are built ONCE at stage start — exactly the place a start-time
    // snapshot would have been baked in.
    const hooks = catalogHooks(memStore(), createPauseControl(), throttle);

    await hooks.pace?.();
    throttle.set('minimal');
    await hooks.pace?.();

    expect(sleeps).toEqual([runtimeFor('minimal').pacingMs]);
  });

  it('gives the skin stage the same live pacer', async () => {
    const { sleeps, sleep } = recordingSleeper();
    const throttle = createThrottleControl('minimal', sleep);
    const hooks = skinHooks(memStore(), createPauseControl(), throttle);
    await hooks.pace?.();
    expect(sleeps).toEqual([runtimeFor('minimal').pacingMs]);
  });

  it('omits the pacer entirely when no throttle is bound', () => {
    const hooks = catalogHooks(memStore(), createPauseControl());
    expect(hooks.pace).toBeUndefined();
  });

  it('leaves pause/cancel in charge — a paused job never reaches the pacing sleep', async () => {
    const { sleeps, sleep } = recordingSleeper();
    const throttle = createThrottleControl('minimal', sleep);
    const pause = createPauseControl();
    const hooks = catalogHooks(memStore(), pause, throttle);
    pause.pause();

    // Mirrors the real loop order: checkpoint() first, then pace().
    await expect(
      (async () => {
        hooks.control?.checkpoint();
        await hooks.pace?.();
      })(),
    ).rejects.toThrow(PausedError);
    expect(sleeps).toEqual([]);
  });
});

describe('isLiveProfileId', () => {
  it('accepts the four selectable profiles and rejects anything else', () => {
    for (const id of ['minimal', 'standard', 'maximum', 'auto']) {
      expect(isLiveProfileId(id)).toBe(true);
    }
    for (const bad of ['custom', '', 'MINIMAL', null, undefined, 3, {}]) {
      expect(isLiveProfileId(bad)).toBe(false);
    }
  });
});
