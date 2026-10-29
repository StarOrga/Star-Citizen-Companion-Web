import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';

/** Two taps closer than this count as a double tap. */
export const ASTEROID_TAP_MS = 400;
/** …and no further apart than this (px). */
export const ASTEROID_TAP_PX = 40;
/** The whole fly-by. */
export const ASTEROID_MS = 2600;
/** Closest pass over the rim, as a share of the fly-by (the quake). */
export const ASTEROID_PASS = 0.52;

/**
 * The sky patch left of the hero (the three faint stars), in viewport x and
 * stage-relative y — the same terms the sky behind it uses.
 */
export function inAsteroidZone(x: number, y: number, vw: number, stage: DOMRect): boolean {
  const fx = x / vw;
  const fy = (y - stage.top) / stage.height;
  return fx >= 0.12 && fx <= 0.25 && fy >= 0.17 && fy <= 0.38;
}

/** Anything the reader can actually use: a click there is never the egg. */
const INTERACTIVE = 'a, button, input, textarea, select, label, [role="button"], [tabindex]:not([tabindex="-1"]), [contenteditable]';

/** Reduced-motion check; a field so specs can swap it. */
function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The fly-by path in viewport px: in from the upper right, grazing the
 * planet's rim at the screen centre, out to the left. A quadratic curve whose
 * midpoint sits just above the rim (`rimY` = the rim's top in the viewport).
 * `mid` is that midpoint's share of the arc length — where the rock has to be
 * at the closest pass, since offset-distance runs by length, not by curve t.
 */
export function asteroidPath(w: number, h: number, rimY: number, size: number): { d: string; mid: number } {
  const rim = Math.min(Math.max(rimY, h * 0.35), h * 0.92);
  const x0 = w + size * 1.2;
  const y0 = rim - h * 0.78;
  const x2 = -size * 1.6;
  const y2 = rim - h * 0.3;
  // Midpoint (t = 0.5) a hair above the rim: the near miss.
  const mx = w * 0.5;
  const my = rim - size * 0.62;
  const cx = 2 * mx - (x0 + x2) / 2;
  const cy = 2 * my - (y0 + y2) / 2;
  const at = (t: number, a: number, c: number, b: number): number => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
  let len = 0;
  let half = 0;
  for (let i = 1, px = x0, py = y0; i <= 200; i++) {
    const x = at(i / 200, x0, cx, x2);
    const y = at(i / 200, y0, cy, y2);
    len += Math.hypot(x - px, y - py);
    if (i === 100) half = len;
    px = x;
    py = y;
  }
  const r = (n: number): number => Math.round(n);
  return { d: `M ${r(x0)} ${r(y0)} Q ${r(cx)} ${r(cy)} ${r(x2)} ${r(y2)}`, mid: len ? half / len : 0.5 };
}

/**
 * Easter egg on the Verse stage: a double click (or double tap) on one
 * patch of empty sky sends an asteroid across the screen that only just
 * misses the planet. There is no hotspot element — the stage hands its
 * pointer events in and the zone is plain geometry (`inAsteroidZone`), so
 * nothing can show a cursor, focus ring, outline or selection there, and the
 * rock comes in from off screen. Decorative throughout (aria-hidden); reduced
 * motion keeps the sky still.
 */
@Component({
  selector: 'sc-briefing-asteroid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    @if (path(); as p) {
      <div class="fly" [style.--path]="p" [style.--size]="size() + 'px'" [style.--ms]="ms + 'ms'" [style.--pass-x]="passX() + 'px'" [style.--pass-y]="passY() + 'px'" [style.--mid]="mid() + '%'">
        <i class="flash"></i>
        <span class="tail"><i class="dust"></i><i class="bit b1"></i><i class="bit b2"></i><i class="bit b3"></i><i class="bit b4"></i><i class="bit b5"></i></span>
        <span class="rock">
          <svg viewBox="-50 -50 100 100" focusable="false">
            <defs>
              <radialGradient id="sc-ast-body" cx="34%" cy="30%" r="78%">
                <stop offset="0" stop-color="#b9a48c" />
                <stop offset="0.38" stop-color="#7a6553" />
                <stop offset="0.75" stop-color="#3d322a" />
                <stop offset="1" stop-color="#17120f" />
              </radialGradient>
              <radialGradient id="sc-ast-crater" cx="40%" cy="35%" r="70%">
                <stop offset="0" stop-color="#241c17" />
                <stop offset="1" stop-color="#5b4a3c" />
              </radialGradient>
            </defs>
            <path class="body" d="M-6-46C10-48 26-41 36-30 46-20 49-6 45 8 42 22 46 30 36 39 25 48 8 46-6 45-20 44-33 40-41 28-48 17-46 4-47-9-48-22-41-33-30-40-22-45-14-45-6-46Z" />
            <ellipse class="cr" cx="-14" cy="-12" rx="11" ry="9" />
            <ellipse class="cr" cx="17" cy="14" rx="8" ry="7" />
            <ellipse class="cr" cx="10" cy="-24" rx="5" ry="4" />
            <ellipse class="cr" cx="-22" cy="20" rx="6" ry="5" />
            <ellipse class="cr" cx="28" cy="-6" rx="4" ry="3.5" />
            <path class="lip" d="M-24-17A11 9 0 0 1-3-14M10 9A8 7 0 0 1 24 12" />
            <path class="shade" d="M45 8C42 22 46 30 36 39 25 48 8 46-6 45-20 44-33 40-41 28 -20 38 8 40 24 30 38 22 44 14 45 8Z" />
          </svg>
        </span>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      /* The fly-by: one fixed layer over the page, never in the way of a click. */
      .fly { position: fixed; inset: 0; z-index: 60; pointer-events: none; overflow: hidden; }
      .rock, .tail {
        position: absolute; left: 0; top: 0;
        offset-path: path(var(--path)); offset-anchor: center;
        animation: sc-ast-fly var(--ms) linear both;
      }
      .rock {
        width: var(--size); aspect-ratio: 1; offset-rotate: 0deg;
        filter: drop-shadow(0 0 calc(var(--size) * 0.06) rgba(255, 196, 140, 0.35)) drop-shadow(0 calc(var(--size) * 0.05) calc(var(--size) * 0.12) rgba(0, 0, 0, 0.7));
      }
      .rock svg { display: block; width: 100%; height: 100%; animation: sc-ast-spin var(--ms) linear both; }
      .body { fill: url(#sc-ast-body); stroke: rgba(255, 220, 180, 0.25); stroke-width: 0.8; }
      .cr { fill: url(#sc-ast-crater); opacity: 0.85; }
      .lip { fill: none; stroke: rgba(255, 228, 196, 0.45); stroke-width: 1.4; stroke-linecap: round; }
      .shade { fill: rgba(5, 8, 14, 0.55); }
      /* The tail follows the path direction (+x = travel), so it trails behind (−x). */
      .tail { width: var(--size); height: var(--size); offset-rotate: auto; }
      .dust {
        position: absolute; right: 50%; top: 50%; width: calc(var(--size) * 4.2); height: calc(var(--size) * 0.62);
        translate: 0 -50%; border-radius: 50%;
        background: linear-gradient(to left, rgba(255, 214, 170, 0.55), rgba(170, 200, 230, 0.22) 35%, rgba(120, 160, 200, 0.06) 75%, transparent);
        filter: blur(calc(var(--size) * 0.08));
        mask-image: linear-gradient(to left, #000 20%, transparent);
      }
      .bit { position: absolute; top: 50%; border-radius: 40%; background: #6b5848; box-shadow: 0 0 4px rgba(255, 200, 150, 0.4); }
      .b1 { right: 95%; width: 7%; aspect-ratio: 1.3; translate: 0 -160%; }
      .b2 { right: 140%; width: 5%; aspect-ratio: 1; translate: 0 120%; }
      .b3 { right: 190%; width: 4%; aspect-ratio: 1.2; translate: 0 -60%; }
      .b4 { right: 240%; width: 3%; aspect-ratio: 1; translate: 0 200%; }
      .b5 { right: 300%; width: 2.5%; aspect-ratio: 1; translate: 0 -220%; }
      /* The near miss: the atmosphere flares where the rock skims the rim. */
      .flash {
        position: absolute; left: var(--pass-x); top: var(--pass-y); width: 70vw; height: 16vh; translate: -50% -50%;
        border-radius: 50%; opacity: 0;
        background: radial-gradient(closest-side, rgba(150, 225, 255, 0.55), rgba(82, 193, 230, 0.18) 55%, transparent);
        animation: sc-ast-flash var(--ms) ease-out both;
      }
      /* Far and slow at first, rushing past the rim at 52 %, then out towards the camera. */
      @keyframes sc-ast-fly {
        0% { offset-distance: 0%; transform: scale(0.12); opacity: 0; animation-timing-function: cubic-bezier(0.55, 0, 0.85, 0.55); }
        8% { opacity: 1; }
        52% { offset-distance: var(--mid); transform: scale(1); animation-timing-function: cubic-bezier(0.15, 0.45, 0.45, 1); }
        100% { offset-distance: 100%; transform: scale(1.7); opacity: 1; }
      }
      @keyframes sc-ast-spin { from { rotate: 0deg; } to { rotate: -150deg; } }
      @keyframes sc-ast-flash { 0%, 44% { opacity: 0; } 53% { opacity: 1; } 80%, 100% { opacity: 0; } }
    `,
  ],
})
export class BriefingAsteroidComponent {
  /** The planet's disc, for the rim position at launch. */
  readonly planet = input<HTMLElement | null>(null);
  /** The closest pass — the stage shakes once. */
  readonly passing = output<void>();

  readonly ms = ASTEROID_MS;
  readonly path = signal<string | null>(null);
  readonly size = signal(0);
  readonly passX = signal(0);
  readonly passY = signal(0);
  /** Arc-length share (%) of the closest pass. */
  readonly mid = signal(50);

  /** Swappable for specs. */
  reducedMotion: () => boolean = reducedMotion;

  private last = { t: 0, x: 0, y: 0 };
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
  }

  /** Stage mousedown: a second press in the zone must not select anything nearby. */
  guard(e: MouseEvent, stage: HTMLElement): void {
    if (e.detail > 1 && this.hit(e, stage)) e.preventDefault();
  }

  /** Stage pointerup: two quick taps in the zone launch the rock. */
  tap(e: PointerEvent, stage: HTMLElement): void {
    if (e.button !== 0 || !this.hit(e, stage)) return;
    const prev = this.last;
    this.last = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    const double = e.timeStamp - prev.t < ASTEROID_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < ASTEROID_TAP_PX;
    if (!double) return;
    this.last = { t: 0, x: 0, y: 0 };
    this.launch();
  }

  private hit(e: MouseEvent, stage: HTMLElement): boolean {
    // Only controls inside the stage count: the page frame around it (<main tabindex="-1">) is no control.
    const control = e.target instanceof Element ? e.target.closest(INTERACTIVE) : null;
    if (control && stage.contains(control)) return false;
    return inAsteroidZone(e.clientX, e.clientY, window.innerWidth, stage.getBoundingClientRect());
  }

  /** One fly-by; ignored while one is running. */
  launch(): void {
    if (this.path() || this.reducedMotion() || typeof window === 'undefined') return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const size = Math.round(Math.min(Math.max(Math.min(w, h) * 0.3, 140), 320));
    const rimY = this.planet()?.getBoundingClientRect().top ?? h * 0.72;
    const { d, mid } = asteroidPath(w, h, rimY, size);
    this.size.set(size);
    this.passX.set(Math.round(w / 2));
    this.passY.set(Math.round(Math.min(Math.max(rimY, h * 0.35), h * 0.92)));
    this.mid.set(Math.round(mid * 1000) / 10);
    this.path.set(`'${d}'`);
    this.timers.push(
      setTimeout(() => this.passing.emit(), ASTEROID_MS * ASTEROID_PASS),
      setTimeout(() => {
        this.path.set(null);
        this.timers = [];
      }, ASTEROID_MS + 50),
    );
  }
}
