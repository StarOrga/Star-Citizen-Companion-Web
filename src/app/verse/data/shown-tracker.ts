/** Page focus a list needs before its items count as "shown" (Verse seen rule, part b). */
export const SHOWN_FOCUS_MS = 5000;

/** The browser surface the tracker needs — injectable for tests. */
export interface ShownTrackerEnv {
  readonly doc: Pick<Document, 'visibilityState' | 'hasFocus' | 'addEventListener' | 'removeEventListener'>;
  readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly now: () => number;
}

function browserEnv(): ShownTrackerEnv {
  return {
    doc: document,
    win: window,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  };
}

/**
 * Measures {@link SHOWN_FOCUS_MS} of ACCUMULATED focus (document visible AND
 * window focused). The clock pauses while the tab is hidden or blurred and
 * resumes afterwards; when it runs out `commit(keys)` fires exactly once and all
 * listeners are removed. Returns a cancel function (component teardown) —
 * cancelling before the time is up commits nothing. Empty `keys` is a no-op.
 */
export function trackShown(
  keys: readonly string[],
  commit: (keys: readonly string[]) => void,
  env: ShownTrackerEnv = browserEnv(),
): () => void {
  if (!keys.length) return () => undefined;
  let remaining = SHOWN_FOCUS_MS;
  let startedAt: number | null = null;
  let timer: unknown = null;
  let finished = false;

  const pause = (): void => {
    if (startedAt === null) return;
    env.clearTimeout(timer);
    timer = null;
    remaining -= env.now() - startedAt;
    startedAt = null;
  };
  const teardown = (): void => {
    finished = true;
    pause();
    env.doc.removeEventListener('visibilitychange', sync);
    env.win.removeEventListener('focus', sync);
    env.win.removeEventListener('blur', sync);
  };
  const fire = (): void => {
    timer = null;
    startedAt = null;
    teardown();
    commit(keys);
  };
  function sync(): void {
    if (finished) return;
    const active = env.doc.visibilityState === 'visible' && env.doc.hasFocus();
    if (!active) {
      pause();
      return;
    }
    if (startedAt !== null) return;
    startedAt = env.now();
    timer = env.setTimeout(fire, Math.max(0, remaining));
  }

  env.doc.addEventListener('visibilitychange', sync);
  env.win.addEventListener('focus', sync);
  env.win.addEventListener('blur', sync);
  sync();
  return teardown;
}
