/**
 * Boot splash lifecycle. The splash (`.scb` in src/index.html) is a sibling of <sc-root>, so
 * Angular's first render never destroys it. Its dark backdrop shows at once; the logo, star
 * streaks and word (`.scb-stage`) only fade in once the load has taken longer than
 * SPLASH_REVEAL_MS — a fast reload never flashes them. That delay lives in CSS
 * (`--scb-reveal` in index.html); keep both in step.
 *
 * Leaving: if the stage never became visible the splash is removed at once; otherwise it gets
 * `scb-leave` (fade plus a quick push-in on the logo) and is removed when that ends.
 */
export const SPLASH_REVEAL_MS = 600;
/** Mirrors the .scb-leave transition length in index.html. */
export const SPLASH_LEAVE_MS = 350;
/** The splash must never cover a dead app: removed after this regardless. */
export const SPLASH_FAILSAFE_MS = 10_000;

const SPLASH_SELECTOR = '.scb';

function stageVisible(splash: Element): boolean {
  const stage = splash.querySelector('.scb-stage');
  if (!stage) return false;
  return parseFloat(getComputedStyle(stage).opacity) > 0.02;
}

/** Remove the splash (animated only when its elements were showing). No-op without a splash. */
export function dismissBootSplash(doc: Document = document): void {
  const splash = doc.querySelector(SPLASH_SELECTOR);
  if (!splash) return;
  if (splash.classList.contains('scb-leave')) return;
  if (!stageVisible(splash)) {
    splash.remove();
    return;
  }
  splash.classList.add('scb-leave');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    splash.remove();
  };
  splash.addEventListener('transitionend', (e) => {
    if (e.target === splash) finish();
  });
  setTimeout(finish, SPLASH_LEAVE_MS + 250);
}

/** Hard removal after SPLASH_FAILSAFE_MS if nothing dismissed it (bootstrap failure, hung route). */
export function armBootSplashFailsafe(doc: Document = document): void {
  setTimeout(() => {
    doc.querySelector(SPLASH_SELECTOR)?.remove();
  }, SPLASH_FAILSAFE_MS);
}
