import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Angles (deg) and start delays (s, negative = already running) of the 30 streaks, from the approved round-3 mock. */
const STREAKS: readonly { r: number; d: number }[] = [
  { r: 0, d: -0.1 }, { r: 12, d: -1.3 }, { r: 25, d: -0.6 }, { r: 37, d: -1.7 }, { r: 49, d: -0.3 },
  { r: 62, d: -1.1 }, { r: 73, d: -0.8 }, { r: 86, d: -1.9 }, { r: 97, d: -0.45 }, { r: 109, d: -1.45 },
  { r: 121, d: -0.2 }, { r: 134, d: -1 }, { r: 146, d: -1.6 }, { r: 158, d: -0.7 }, { r: 169, d: -1.25 },
  { r: 182, d: -0.05 }, { r: 194, d: -0.95 }, { r: 205, d: -1.75 }, { r: 217, d: -0.35 }, { r: 230, d: -1.4 },
  { r: 241, d: -0.85 }, { r: 254, d: -1.55 }, { r: 266, d: -0.25 }, { r: 278, d: -1.15 }, { r: 289, d: -0.6 },
  { r: 301, d: -1.85 }, { r: 313, d: -0.5 }, { r: 325, d: -1.2 }, { r: 337, d: -0.9 }, { r: 349, d: -1.65 },
];

/**
 * The quantum streak field (concept 2026-11-09, round 3): thin cyan streaks
 * fanning out from the centre of the nearest positioned ancestor. Used by the
 * 404 page (fast, then slow) and the slow-navigation card (slow). Purely
 * decorative, so `aria-hidden`; it never takes pointer events.
 *
 * `speed` "fast" is the loading tempo, "slow" the calmer one (about 2.6x
 * longer cycles). `fadeOut` plays a single 1.1 s fade-out and keeps the
 * field hidden afterwards (the 404 hand-over). `far` is how far the streaks
 * travel from the centre. Reduced motion freezes the field into a still burst.
 */
@Component({
  selector: 'sc-quantum-streaks',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[class.slow]': "speed() === 'slow'",
    '[class.fade-out]': 'fadeOut()',
    '[style.--far-base.px]': 'far()',
  },
  template: `@for (s of streaks; track s.r) {<i [style.--r.deg]="s.r" [style.--d.s]="s.d * (speed() === 'slow' ? 2.6 : 1)"></i>}`,
  styles: [`
    :host {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 0;
      height: 0;
      pointer-events: none;
      --hi: #8fe3ff;
    }
    i {
      position: absolute;
      left: 0;
      top: -.75px;
      width: var(--w, 130px);
      height: 1.5px;
      border-radius: 2px;
      background: linear-gradient(90deg, transparent, rgba(143, 227, 255, .18) 35%, var(--hi));
      transform-origin: 0 50%;
      opacity: 0;
      --w: 130px;
      --t: 1.65s;
      --far: var(--far-base, 420px);
      animation: qs-streak var(--t) cubic-bezier(.55, 0, 1, .45) var(--d, 0s) infinite;
    }
    i:nth-child(3n) { --w: 190px; --t: 1.95s; }
    i:nth-child(3n+1) { --w: 84px; --t: 1.4s; }
    i:nth-child(4n) { height: 1px; background: linear-gradient(90deg, transparent, rgba(82, 193, 230, .75)); }
    i:nth-child(5n) { --far: calc(var(--far-base, 420px) * .78); }
    :host(.slow) i { --t: 4.2s; }
    :host(.slow) i:nth-child(3n) { --t: 4.8s; }
    :host(.slow) i:nth-child(3n+1) { --t: 3.6s; }
    :host(.fade-out) { animation: qs-out 1.1s ease-in both; }
    @keyframes qs-streak {
      0% { transform: rotate(var(--r)) translateX(34px) scaleX(.04); opacity: 0; }
      14% { opacity: .95; }
      100% { transform: rotate(var(--r)) translateX(var(--far)) scaleX(1); opacity: 0; }
    }
    @keyframes qs-out {
      0% { opacity: 1; transform: scale(1.1); }
      100% { opacity: 0; transform: scale(.8); }
    }
    @media (prefers-reduced-motion: reduce) {
      i { animation: none; opacity: .5; transform: rotate(var(--r)) translateX(calc(var(--far) * .55)) scaleX(.7); }
      :host(.fade-out) { animation: none; display: none; }
    }
  `],
})
export class QuantumStreaksComponent {
  readonly streaks = STREAKS;
  readonly speed = input<'fast' | 'slow'>('fast');
  readonly fadeOut = input(false);
  readonly far = input(420);
}
