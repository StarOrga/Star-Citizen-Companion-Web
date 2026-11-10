import { Injectable, computed, signal } from '@angular/core';
import {
  CameraPose,
  POSES,
  SCENE_FADE_MS,
  SCENE_FLIGHT_MS,
  ScenePoseId,
  VerseAnchors,
  VwRect,
  easeInOutCubic,
  poseCam,
  poseAt,
  poseTransform,
  skyTransform,
} from './scene.model';

/** Marker on `<html>` while the reduced-motion crossfade runs (the scene stylesheet times it to 420 ms). */
export const SCENE_FADE_ATTR = 'data-sc-scene-fade';

/** Keyframes per flight: enough that the linear segments between them read as the curve. */
const SAMPLES = 32;

export interface SceneFlyOptions {
  /** Start pose; default = wherever the camera stands right now (mid-flight retarget). */
  from?: ScenePoseId | CameraPose;
  /** Flight length; default 1100 ms. Ignored under reduced motion (420 ms crossfade). */
  durationMs?: number;
  /**
   * State that belongs to the new scene (target pose, push veil): applied as the flight starts —
   * under reduced motion inside the crossfade, so the old scene state is captured untouched.
   */
  apply?: () => void;
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
  /** The hub's layout lent to the world (G1): the verse camera and the doors' pieces follow it. */
  readonly verseAnchors = signal<VerseAnchors | null>(null);
  /** The admin hub's free cell beside its cards (vw at scroll 0): the station is framed into it. */
  readonly adminSlot = signal<VwRect | null>(null);
  /** The live planet in the scene: 'drawn' once it stands, 'failed' when none comes (the CSS planet stays). */
  readonly planetState = signal<'pending' | 'drawn' | 'failed'>('pending');

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
  /** The camera stands at a pose other than its target's until the next flight (the entrance's depth). */
  private held = false;

  /** True while the camera waits at the entrance depth for the hub's dolly. */
  isHeld(): boolean {
    return this.held;
  }

  /** The scene component hands over its layers; returns the detach function. */
  attach(world: HTMLElement, sky: HTMLElement, at: ScenePoseId, standAt?: CameraPose): () => void {
    this.world = world;
    this.sky = sky;
    this.target.set(at);
    this.jump(standAt ?? this.camOf(at));
    this.held = !!standAt;
    return () => {
      this.stop();
      if (this.world === world) this.world = this.sky = null;
    };
  }

  /** The camera of a named pose (following the hub's lent layout). */
  camOf(id: ScenePoseId): CameraPose {
    return poseCam(id, this.verseAnchors(), this.adminSlot());
  }

  /**
   * The admin hub lends the cell its station stands in. Standing at the admin pose the camera
   * re-stands; mid-flight it keeps flying, on to the corrected framing, in the time that is left.
   */
  setAdminSlot(slot: VwRect | null): void {
    const prev = this.adminSlot();
    if (JSON.stringify(prev) === JSON.stringify(slot)) return;
    this.adminSlot.set(slot);
    if (this.target() !== 'admin' || !this.world) return;
    const f = this.flight;
    const left = f ? f.start + f.duration - this.now() : 0;
    if (f && left > 80 && !this.reducedMotion()) void this.flyTo('admin', { durationMs: left });
    else this.jump(this.camOf('admin'));
  }

  /**
   * The hub hands over (or updates) its layout. Standing at the hub, the camera re-stands at
   * once so the world's planet stays exactly on the hub's; mid-flight the flight keeps its path.
   */
  setVerseAnchors(a: VerseAnchors): void {
    const prev = this.verseAnchors();
    if (prev && JSON.stringify(prev) === JSON.stringify(a)) return;
    this.verseAnchors.set(a);
    if (this.target() === 'verse' && !this.flight && !this.held) this.jump(this.camOf('verse'));
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
    const dest = typeof to === 'string' ? this.camOf(to) : to;
    const apply = (): void => {
      if (typeof to === 'string') this.target.set(to);
      opts.apply?.();
    };
    const from = opts.from === undefined ? this.current() : typeof opts.from === 'string' ? this.camOf(opts.from) : opts.from;
    this.held = false;
    this.stop();
    if (!this.world || !this.sky) {
      apply();
      this.pose = dest;
      return Promise.resolve();
    }
    if (this.reducedMotion()) return this.crossfade(dest, apply);
    apply();
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
    const flight: Flight = { from, to: dest, start: this.now(), duration };
    this.flight = flight;
    this.pose = dest;
    this.flying.set(true);
    const timing: KeyframeAnimationOptions = { duration, easing: 'linear', fill: 'forwards' };
    this.anims = [this.world.animate(worldFrames, timing), this.sky.animate(skyFrames, timing)];
    // The flight's clock is the animation's own: a busy first frame (a cold route) starts it late,
    // and a retarget must read the camera where the screen shows it (C4: the full 1100 ms move).
    const world = this.anims[0];
    world.ready.then(
      () => {
        const t = typeof world.startTime === 'number' ? world.startTime : null;
        if (this.flight === flight && t !== null) flight.start = t;
      },
      () => undefined,
    );
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

  /**
   * Reduced motion: no flight — the scene crossfades in 420 ms from the old camera state to the new
   * one (C8). A View Transition captures the old state, the camera jumps and the new state is
   * applied inside its update; the old picture fades out over the live new one. Without the API (or
   * while another transition runs) the new scene fades in instead.
   */
  private crossfade(dest: CameraPose, apply: () => void): Promise<void> {
    const doc = this.world?.ownerDocument;
    const root = doc?.documentElement;
    const busy = !!root && ('verseFlight' in root.dataset || root.hasAttribute(SCENE_FADE_ATTR));
    if (!doc || !root || typeof doc.startViewTransition !== 'function' || doc.visibilityState !== 'visible' || busy) {
      apply();
      this.jump(dest);
      this.fadeTick.update((n) => n + 1);
      return new Promise((r) => setTimeout(r, SCENE_FADE_MS));
    }
    root.setAttribute(SCENE_FADE_ATTR, '');
    let applied = false;
    const cut = (): void => {
      if (applied) return;
      applied = true;
      apply();
      this.jump(dest);
    };
    try {
      const vt = doc.startViewTransition(cut);
      vt.ready.catch(() => undefined);
      vt.updateCallbackDone.catch(cut);
      const done = (): void => root.removeAttribute(SCENE_FADE_ATTR);
      return vt.finished.then(done, () => {
        cut();
        done();
      });
    } catch {
      root.removeAttribute(SCENE_FADE_ATTR);
      cut();
      return Promise.resolve();
    }
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
