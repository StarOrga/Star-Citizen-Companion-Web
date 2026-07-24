import { DOCUMENT, Injectable, inject } from '@angular/core';

/** One confetti particle's randomized flight parameters. */
interface Particle {
  color: string;
  size: number;
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  duration: number;
  round: boolean;
}

/**
 * SCC accent palette for the burst — the same tokens the board already uses for
 * its status pills (accent cyan, hot orange, success green, warning amber and
 * the Rückfrage violet). No new colours are invented here.
 */
const PALETTE = [
  'var(--sc-accent, #00d4ff)',
  'var(--sc-accent-hot, #ff5722)',
  'var(--sc-success, #4ade80)',
  'var(--sc-warning, #fbbf24)',
  '#a78bfa',
];

/** Particles per burst — enough to feel celebratory, cheap enough to stay 60fps. */
const DEFAULT_COUNT = 34;

/**
 * Tiny, dependency-free confetti burst for the admin feedback board.
 *
 * Deliberately hand-rolled instead of pulling in a confetti package: the whole
 * effect is ~40 lines of Web Animations API on absolutely positioned elements,
 * and the bundle stays untouched.
 *
 * Accessibility: {@link burst} is a no-op when the user asked for reduced
 * motion (`prefers-reduced-motion: reduce`), so the celebration never fires
 * against that preference. Callers can check {@link reducedMotion} to swap in a
 * static acknowledgement instead.
 */
@Injectable({ providedIn: 'root' })
export class CelebrationService {
  private readonly doc = inject(DOCUMENT);

  /** True when the user asked the OS/browser to cut animation down. */
  get reducedMotion(): boolean {
    const mm = this.doc.defaultView?.matchMedia;
    if (!mm) return false;
    try {
      return this.doc.defaultView!.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  }

  /**
   * Fire a confetti burst.
   *
   * @param origin Viewport coordinates to burst from. Defaults to the middle of
   *   the viewport's upper third, which reads well behind the docked panel.
   * @param count  Particle count override.
   */
  burst(origin?: { x: number; y: number }, count = DEFAULT_COUNT): void {
    if (this.reducedMotion) return;
    const view = this.doc.defaultView;
    const body = this.doc.body;
    if (!view || !body) return;

    const x = origin?.x ?? view.innerWidth / 2;
    const y = origin?.y ?? view.innerHeight / 3;

    const layer = this.doc.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:hidden;contain:strict;';

    let longest = 0;
    for (const p of this.particles(count)) {
      longest = Math.max(longest, p.delay + p.duration);
      layer.appendChild(this.spawn(p, x, y));
    }

    body.appendChild(layer);
    view.setTimeout(() => layer.remove(), longest + 120);
  }

  /**
   * Burst centred on an element — used so the celebration visually originates
   * from the card the admin just answered rather than from nowhere.
   */
  burstFrom(el: Element | null | undefined, count?: number): void {
    if (!el) {
      this.burst(undefined, count);
      return;
    }
    const r = el.getBoundingClientRect();
    this.burst({ x: r.left + r.width / 2, y: r.top + Math.min(r.height / 2, 120) }, count);
  }

  /** Randomized flight parameters for `count` particles in a fan-shaped spray. */
  private particles(count: number): Particle[] {
    const out: Particle[] = [];
    for (let i = 0; i < count; i++) {
      // Fan upwards: angles across the top half, with a randomized reach.
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const reach = 90 + Math.random() * 170;
      out.push({
        color: PALETTE[i % PALETTE.length],
        size: 5 + Math.random() * 6,
        dx: Math.cos(angle) * reach,
        dy: Math.sin(angle) * reach,
        rot: (Math.random() - 0.5) * 900,
        delay: Math.random() * 90,
        duration: 900 + Math.random() * 600,
        round: Math.random() < 0.4,
      });
    }
    return out;
  }

  /** Build one particle element and start its animation. */
  private spawn(p: Particle, x: number, y: number): HTMLElement {
    const el = this.doc.createElement('i');
    el.style.cssText = [
      'position:absolute',
      `left:${x}px`,
      `top:${y}px`,
      `width:${p.size}px`,
      `height:${p.size * (p.round ? 1 : 1.7)}px`,
      `background:${p.color}`,
      `border-radius:${p.round ? '50%' : '1px'}`,
      'will-change:transform,opacity',
    ].join(';');

    // Some test/browser environments stub out WAAPI — degrade to "no confetti"
    // rather than throwing inside a purely decorative code path.
    el.animate?.(
      [
        { transform: 'translate3d(0,0,0) rotate(0deg)', opacity: 1, offset: 0 },
        {
          transform: `translate3d(${p.dx * 0.7}px, ${p.dy}px, 0) rotate(${p.rot * 0.6}deg)`,
          opacity: 1,
          offset: 0.55,
        },
        {
          // Gravity: whatever went up comes back down past the origin.
          transform: `translate3d(${p.dx}px, ${p.dy + 260}px, 0) rotate(${p.rot}deg)`,
          opacity: 0,
          offset: 1,
        },
      ],
      { duration: p.duration, delay: p.delay, easing: 'cubic-bezier(0.18,0.7,0.4,1)', fill: 'forwards' },
    );

    return el;
  }
}
