import { signal } from '@angular/core';

/** Duration of one count (concept cine-countup: ~700 ms, the strip takes a touch longer to read). */
export const COUNT_UP_MS = 900;

interface Run {
  from: number;
  to: number;
  start: number;
}

/**
 * Counts displayed numbers up (concept 2026-09-20 cine-countup, re-accepted
 * 2026-11-01 cx-countup): a number that appears for the first time runs from
 * 0 to its value, a number that changes runs from where it stood to where it
 * lands. Keyed per display slot, so every number in the strip — percentiles,
 * the cohort size, the signature ranges, the coolant — moves on its own.
 *
 * `value()` is meant to be called from a template: it only reads signals and
 * records the start of a run; the animation frame that bumps {@link tick} is
 * scheduled outside the render. Reduced motion → every value stands at once.
 */
export class CountUp {
  /** Bumped every animation frame while any run is still going. */
  readonly tick = signal(0);
  private readonly runs = new Map<string, Run>();
  private raf: number | null = null;

  constructor(
    private readonly still: boolean,
    private readonly ms = COUNT_UP_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** The value to show for `key` right now. */
  value(key: string, target: number): number {
    this.tick();
    if (this.still || !Number.isFinite(target)) return target;
    const t = this.now();
    let run = this.runs.get(key);
    if (!run) {
      run = { from: 0, to: target, start: t };
      this.runs.set(key, run);
      this.schedule();
    } else if (run.to !== target) {
      run = { from: this.at(run, t), to: target, start: t };
      this.runs.set(key, run);
      this.schedule();
    }
    return this.at(run, t);
  }

  /** Every run is over. */
  get idle(): boolean {
    const t = this.now();
    for (const r of this.runs.values()) if (t - r.start < this.ms) return false;
    return true;
  }

  dispose(): void {
    if (this.raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private at(run: Run, t: number): number {
    const p = Math.min(1, Math.max(0, (t - run.start) / this.ms));
    if (p >= 1) return run.to;
    const eased = 1 - Math.pow(1 - p, 3);
    return run.from + (run.to - run.from) * eased;
  }

  private schedule(): void {
    if (this.raf !== null || typeof requestAnimationFrame !== 'function') return;
    const step = () => {
      this.raf = null;
      this.tick.update((n) => n + 1);
      if (!this.idle) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
}
