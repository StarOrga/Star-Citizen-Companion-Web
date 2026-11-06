import { Injectable, NgZone, inject } from '@angular/core';
import { WindowFocusService } from './window-focus.service';

/** The background's frame rate, the same 15 Hz as the planet and the moons. */
export const SLOW_TICK_MS = 66;
const COLLECT_MS = 1000;
/** A throttled timer must not make the background jump. */
const MAX_STEP_MS = 250;
/** Where endless animations are background and not feedback the user waits for. */
const SCOPE = 'sc-shell-scene, sc-fusion-bar, sc-verse-briefing';

interface Driven {
  /** Its CSS says paused: the stage's pause button, a phase that does not show it. */
  held: boolean;
  end: number;
}

/**
 * Runs the endless background animations at 15 Hz instead of at the display's rate.
 *
 * One running animation, however tiny, makes the browser produce and draw whole
 * frames at the display's rate: three 5 px stars alone cost about half a core at
 * 150 Hz (2026-11-06). So the page's cost at rest follows from how often anything
 * moves, not from what moves. Slow, soft motion loses nothing visible at 15 Hz.
 *
 * Each animation is paused and its time advanced by hand. Without the window's
 * focus the clock stops entirely; the stylesheet's own pause holds what is new.
 */
@Injectable({ providedIn: 'root' })
export class SlowMotionService {
  private readonly focus = inject(WindowFocusService);
  private readonly zone = inject(NgZone);
  private readonly driven = new Map<Animation, Driven>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private collectTimer: ReturnType<typeof setInterval> | null = null;
  private last = 0;

  /** Starts the clock. Returns the function that stops it and hands every animation back. */
  start(): () => void {
    const stopFocus = this.focus.onChange((focused) => (focused ? this.run() : this.halt()));
    if (this.focus.focused()) this.run();
    return () => {
      stopFocus();
      this.halt();
      for (const a of this.driven.keys()) a.play();
      this.driven.clear();
    };
  }

  /** Takes over an animation the caller just started. */
  adopt(anim: Animation): void {
    anim.pause();
    this.driven.set(anim, { held: false, end: Number(anim.effect?.getComputedTiming().endTime ?? Infinity) });
  }

  private run(): void {
    if (this.tickTimer !== null) return;
    this.last = Date.now();
    this.collect();
    this.zone.runOutsideAngular(() => {
      this.tickTimer = setInterval(() => this.tick(), SLOW_TICK_MS);
      this.collectTimer = setInterval(() => this.collect(), COLLECT_MS);
    });
  }

  private halt(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    if (this.collectTimer !== null) clearInterval(this.collectTimer);
    this.tickTimer = this.collectTimer = null;
  }

  private tick(): void {
    const now = Date.now();
    const step = Math.min(now - this.last, MAX_STEP_MS);
    this.last = now;
    for (const [anim, d] of this.driven) {
      if (anim.playState === 'idle' || anim.playState === 'finished') {
        this.driven.delete(anim);
      } else if (!d.held) {
        const t = Number(anim.currentTime ?? 0) + step;
        if (t >= d.end) {
          this.driven.delete(anim);
          anim.finish();
        } else {
          anim.currentTime = t;
        }
      }
    }
  }

  /** Finds new endless animations, and reads again which ones their CSS holds. */
  private collect(): void {
    if (typeof document.getAnimations !== 'function') return;
    for (const anim of document.getAnimations()) {
      if (!(anim instanceof CSSAnimation) || !(anim.effect instanceof KeyframeEffect)) continue;
      const target = anim.effect.target;
      if (!target) continue;
      let d = this.driven.get(anim);
      if (!d) {
        if (anim.effect.getComputedTiming().iterations !== Infinity || !target.closest(SCOPE)) continue;
        anim.pause();
        d = { held: false, end: Infinity };
        this.driven.set(anim, d);
      }
      d.held = getComputedStyle(target, anim.effect.pseudoElement ?? undefined).animationPlayState.includes('paused');
    }
  }
}
