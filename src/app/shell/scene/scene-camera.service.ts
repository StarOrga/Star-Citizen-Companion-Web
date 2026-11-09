import { Injectable, computed, signal } from '@angular/core';
import {
  CameraPose,
  POSES,
  SCENE_FADE_MS,
  SCENE_FLIGHT_MS,
  ScenePoseId,
  easeInOutCubic,
  poseAt,
  poseTransform,
  skyTransform,
} from './scene.model';

/** Keyframes per flight: enough that the linear segments between them read as the curve. */
const SAMPLES = 32;

export interface SceneFlyOptions {
  /** Start pose; default = wherever the camera stands right now (mid-flight retarget). */
  from?: ScenePoseId | CameraPose;
  /** Flight length; default 1100 ms. Ignored under reduced motion (420 ms crossfade). */
  durationMs?: number;
}

interface Flight {
  from: CameraPose;
  to: CameraPose;
  start: number;
  duration: number;
}

/** Reduced-motion check; swappable for specs via the service field. */
export function cameraReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The camera over the shell scene (beta `shell`). Public API for every part
 * of the app that has to move the background:
 *
 *   flyTo(pose, { from?, durationMs? })  → Promise that settles when the camera stands
 *   current()                            → the pose the camera shows right now (sampled, no layout read)
 *   target / flying                      → signals: where the camera is going, whether it moves
 *
 * A call mid-flight retargets from the current pose — nothing waits for a
 * flight to end (C3). The path is straight (`poseAt`, eased in-out cubic).
 * Under reduced motion the camera jumps and the scene crossfades in 420 ms.
 * The shell scene component attaches its layers; without them (shell beta off)
 * every call resolves at once.
 */
@Injectable({ providedIn: 'root' })
export class SceneCameraService {
  /** The named pose the camera flies to / stands at; drives the per-pose object isolation. */
  readonly target = signal<ScenePoseId>('verse');
  /** A pushed-in (detail) page: extra veil. */
  readonly pushed = signal(false);
  readonly flying = signal(false);
  /** Bumped on every reduced-motion jump so the crossfade restarts. */
  readonly fadeTick = signal(0);
  /** Length of the running flight (for the object fades), ms. */
  readonly moveMs = signal(SCENE_FLIGHT_MS);
  readonly veil = computed(() => POSES[this.target()].veil);

  /** Swappable for specs. */
  reducedMotion: () => boolean = cameraReducedMotion;
  /** Swappable for specs. */
  now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  private world: HTMLElement | null = null;
  private sky: HTMLElement | null = null;
  private pose: CameraPose = POSES.verse.cam;
  private flight: Flight | null = null;
  private anims: Animation[] = [];
  private settle: (() => void) | null = null;

  /** The scene component hands over its layers; returns the detach function. */
  attach(world: HTMLElement, sky: HTMLElement, at: ScenePoseId): () => void {
    this.world = world;
    this.sky = sky;
    this.target.set(at);
    this.jump(POSES[at].cam);
    return () => {
      this.stop();
      if (this.world === world) this.world = this.sky = null;
    };
  }

  /** The pose the camera shows right now. */
  current(): CameraPose {
    const f = this.flight;
    if (!f) return this.pose;
    const t = f.duration > 0 ? (this.now() - f.start) / f.duration : 1;
    if (t >= 1) return f.to;
    return poseAt(f.from, f.to, easeInOutCubic(t));
  }

  /**
   * Flies to `to` (a named pose or a free camera pose). A named target also
   * switches the object isolation; a free pose keeps the current one.
   */
  flyTo(to: ScenePoseId | CameraPose, opts: SceneFlyOptions = {}): Promise<void> {
    const dest = typeof to === 'string' ? POSES[to].cam : to;
    if (typeof to === 'string') this.target.set(to);
    const from = opts.from === undefined ? this.current() : typeof opts.from === 'string' ? POSES[opts.from].cam : opts.from;
    this.stop();
    if (!this.world || !this.sky) {
      this.pose = dest;
      return Promise.resolve();
    }
    if (this.reducedMotion()) {
      this.jump(dest);
      this.fadeTick.update((n) => n + 1);
      return new Promise((r) => setTimeout(r, SCENE_FADE_MS));
    }
    const duration = Math.max(0, opts.durationMs ?? SCENE_FLIGHT_MS);
    if (duration === 0 || same(from, dest)) {
      this.jump(dest);
      return Promise.resolve();
    }
    this.moveMs.set(duration);
    const worldFrames: Keyframe[] = [];
    const skyFrames: Keyframe[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const p = poseAt(from, dest, easeInOutCubic(i / SAMPLES));
      worldFrames.push({ transform: poseTransform(p), offset: i / SAMPLES });
      skyFrames.push({ transform: skyTransform(p), offset: i / SAMPLES });
    }
    this.flight = { from, to: dest, start: this.now(), duration };
    this.pose = dest;
    this.flying.set(true);
    const timing: KeyframeAnimationOptions = { duration, easing: 'linear', fill: 'forwards' };
    this.anims = [this.world.animate(worldFrames, timing), this.sky.animate(skyFrames, timing)];
    return new Promise<void>((resolve) => {
      this.settle = resolve;
      this.anims[0].finished.then(
        () => {
          if (this.settle !== resolve) return;
          this.jump(dest);
          this.settle = null;
          resolve();
        },
        () => undefined,
      );
    });
  }

  /** Stands the camera at `p` without motion (inline transform, running animations dropped). */
  private jump(p: CameraPose): void {
    this.stop();
    this.pose = p;
    if (this.world) this.world.style.transform = poseTransform(p);
    if (this.sky) this.sky.style.transform = skyTransform(p);
  }

  /** Ends the running flight where it stands (the caller sets the next pose). */
  private stop(): void {
    if (this.flight) this.pose = this.current();
    this.flight = null;
    this.anims.splice(0).forEach((a) => a.cancel());
    if (this.world) this.world.style.transform = poseTransform(this.pose);
    if (this.sky) this.sky.style.transform = skyTransform(this.pose);
    this.flying.set(false);
    const s = this.settle;
    this.settle = null;
    s?.();
  }
}

function same(a: CameraPose, b: CameraPose): boolean {
  return Math.abs(a.s - b.s) < 1e-6 && Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4;
}
