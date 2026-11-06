/** How many stars twinkle at the same time (concept 2026-11-06, the owner's pick). */
export const SPARKLE_COUNT = 3;

const DURATION_MIN_MS = 1600;
const DURATION_SPAN_MS = 2900;
const GAP_MIN_MS = 200;
const GAP_SPAN_MS = 2800;
const PEAK_MIN = 0.7;
const PEAK_SPAN = 0.3;

// The part of `.sky` the viewport shows in the open-sky pose (its inset is -8% -24% -8% -8%), in percent.
const LEFT_MIN = 6;
const LEFT_SPAN = 76;
const TOP_MIN = 7;
const TOP_SPAN = 86;

/**
 * The sky's twinkle: a few tiny stars light up once each, at a new random spot
 * with a random duration, peak and gap, so no pattern ever repeats. It replaces
 * an endless opacity animation on a layer far larger than the window, which the
 * compositor had to blend every frame.
 */
export class StarSparkle {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly running = new Set<Animation>();
  private active = 0;
  private stopped = false;
  private paused = false;

  /** `adopt` takes over the clock of each star (SlowMotionService); without it the browser runs them. */
  constructor(
    private readonly host: HTMLElement,
    private readonly count = SPARKLE_COUNT,
    private readonly rnd: () => number = Math.random,
    private readonly adopt?: (anim: Animation) => void,
  ) {
    this.fill();
  }

  /** Stands still without losing its place: running stars hold, none starts. */
  pause(): void {
    this.paused = true;
    this.clearTimers();
    for (const a of this.running) a.pause();
  }

  resume(): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    if (!this.adopt) for (const a of this.running) a.play();
    this.fill();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    for (const a of this.running) a.cancel();
    this.running.clear();
    this.host.querySelectorAll('.spark').forEach((el) => el.remove());
  }

  /** Brings the stars back up to `count`, staggered so they do not all light up at once. */
  private fill(): void {
    for (let i = this.active + this.timers.size; i < this.count; i++) this.later(this.rnd() * (GAP_MIN_MS + GAP_SPAN_MS));
  }

  private later(ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      this.light();
    }, ms);
    this.timers.add(t);
  }

  private light(): void {
    if (this.stopped || this.paused) return;
    const el = document.createElement('i');
    el.className = 'spark';
    el.style.left = `${LEFT_MIN + this.rnd() * LEFT_SPAN}%`;
    el.style.top = `${TOP_MIN + this.rnd() * TOP_SPAN}%`;
    this.host.appendChild(el);
    this.active++;
    const peak = PEAK_MIN + this.rnd() * PEAK_SPAN;
    const anim = el.animate(
      [{ opacity: 0, transform: 'scale(0.5)' }, { opacity: peak, transform: 'scale(1.1)' }, { opacity: 0, transform: 'scale(0.5)' }],
      { duration: DURATION_MIN_MS + this.rnd() * DURATION_SPAN_MS, easing: 'ease-in-out' },
    );
    this.adopt?.(anim);
    this.running.add(anim);
    const done = () => {
      this.running.delete(anim);
      el.remove();
      this.active--;
    };
    anim.onfinish = () => {
      done();
      if (!this.stopped && !this.paused) this.later(GAP_MIN_MS + this.rnd() * GAP_SPAN_MS);
    };
    anim.oncancel = () => {
      if (this.running.has(anim)) done();
    };
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}
