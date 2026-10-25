import { SHOWN_FOCUS_MS, ShownTrackerEnv, trackShown } from './shown-tracker';

/** A manual clock + a fake document/window that can lose focus. */
function fakeEnv() {
  let now = 0;
  let visible = true;
  let focused = true;
  let timer: { at: number; fn: () => void } | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const target = {
    addEventListener: (type: string, fn: () => void) => {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn);
    },
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
  };
  const env = {
    doc: {
      get visibilityState() {
        return visible ? 'visible' : 'hidden';
      },
      hasFocus: () => focused,
      ...target,
    },
    win: target,
    setTimeout: (fn: () => void, ms: number) => {
      timer = { at: now + ms, fn };
      return timer;
    },
    clearTimeout: () => {
      timer = null;
    },
    now: () => now,
  } as unknown as ShownTrackerEnv;
  const emit = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  return {
    env,
    advance(ms: number) {
      now += ms;
      if (timer && now >= timer.at) {
        const t = timer;
        timer = null;
        t.fn();
      }
    },
    blur() {
      focused = false;
      emit('blur');
    },
    focus() {
      focused = true;
      emit('focus');
    },
    hide() {
      visible = false;
      emit('visibilitychange');
    },
    show() {
      visible = true;
      emit('visibilitychange');
    },
    listenerCount: () => [...listeners.values()].reduce((a, s) => a + s.size, 0),
  };
}

describe('trackShown (5 s of page focus)', () => {
  it('commits once after 5 s of focus and detaches its listeners', () => {
    const f = fakeEnv();
    const commit = jasmine.createSpy('commit');
    trackShown(['a', 'b'], commit, f.env);
    f.advance(SHOWN_FOCUS_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    f.advance(1);
    expect(commit).toHaveBeenCalledOnceWith(['a', 'b']);
    expect(f.listenerCount()).toBe(0);
  });

  it('pauses while the tab is blurred or hidden and resumes with the remaining time', () => {
    const f = fakeEnv();
    const commit = jasmine.createSpy('commit');
    trackShown(['a'], commit, f.env);
    f.advance(3000);
    f.blur();
    f.advance(60_000); // timers are cleared while blurred
    expect(commit).not.toHaveBeenCalled();
    f.focus();
    f.advance(1999);
    expect(commit).not.toHaveBeenCalled();
    f.advance(1);
    expect(commit).toHaveBeenCalledTimes(1);

    const g = fakeEnv();
    const commit2 = jasmine.createSpy('commit2');
    g.hide();
    trackShown(['x'], commit2, g.env);
    g.advance(10_000);
    expect(commit2).not.toHaveBeenCalled();
    g.show();
    g.advance(SHOWN_FOCUS_MS);
    expect(commit2).toHaveBeenCalledTimes(1);
  });

  it('commits nothing when cancelled early, and nothing for an empty list', () => {
    const f = fakeEnv();
    const commit = jasmine.createSpy('commit');
    const cancel = trackShown(['a'], commit, f.env);
    f.advance(2000);
    cancel();
    f.advance(10_000);
    expect(commit).not.toHaveBeenCalled();
    expect(f.listenerCount()).toBe(0);
    trackShown([], commit, f.env)();
    expect(commit).not.toHaveBeenCalled();
  });
});
