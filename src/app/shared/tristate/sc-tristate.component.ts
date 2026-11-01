import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** What a tri-state value reads as. */
export type TristateState = 'empty' | 'partial' | 'full';

export function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** 0 → empty, 1 → full, anything between → partial; NaN and out-of-range values are clamped. */
export function tristateOf(value: number): TristateState {
  const v = clampFraction(value);
  return v <= 0 ? 'empty' : v >= 1 ? 'full' : 'partial';
}

const RING_R = 9;
const RING_C = 2 * Math.PI * RING_R;

/**
 * App-wide tri-state control (concept 2026-10-30 D28): `value` is a fraction 0..1.
 *
 * - `ring`      empty = not chosen · arc = partly (1/2, 1/4 …) · full ring with a sheen = all;
 * - `checkbox`  the same three states as a box: empty · dash (mixed) · tick.
 *
 * A real `<button role="checkbox">` with `aria-checked="mixed"` for the partial state. The
 * component only reports the click (`toggled`, with the value a click should lead to: anything
 * but full → 1, full → 0); the host owns the model. The sheen only runs under
 * `prefers-reduced-motion: no-preference`.
 */
@Component({
  selector: 'sc-tristate',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-state]': 'state()', '[attr.data-variant]': 'variant()' },
  template: `
    <button type="button" class="tri" role="checkbox" [attr.aria-checked]="ariaChecked()"
            [attr.aria-label]="label()" [disabled]="disabled()" (click)="onClick()">
      @if (variant() === 'ring') {
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle class="track" cx="12" cy="12" [attr.r]="r" />
          @if (state() !== 'empty') {
            <circle class="arc" cx="12" cy="12" [attr.r]="r" [attr.stroke-dasharray]="dash()"
                    transform="rotate(-90 12 12)" />
          }
        </svg>
        @if (state() === 'full') { <span class="sheen" aria-hidden="true"></span> }
      } @else {
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect class="box" x="3.5" y="3.5" width="17" height="17" rx="3" />
          @if (state() === 'full') { <path class="mark" d="M7.5 12.5l3 3 6-7" /> }
          @if (state() === 'partial') { <path class="mark" d="M7.5 12h9" /> }
        </svg>
      }
    </button>
  `,
  styles: [
    `
      :host { display: inline-flex; }
      .tri {
        position: relative;
        display: inline-grid;
        place-items: center;
        width: var(--sc-tristate-size, 28px);
        height: var(--sc-tristate-size, 28px);
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: none;
        color: var(--sc-fg-2);
        cursor: pointer;
      }
      :host([data-variant='checkbox']) .tri { border-radius: 6px; }
      .tri:disabled { cursor: default; opacity: 0.5; }
      .tri:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .tri:hover:not(:disabled) { color: var(--sc-fg); }
      svg { width: 100%; height: 100%; overflow: visible; }
      .track, .box { fill: none; stroke: currentColor; stroke-width: 1.6; opacity: 0.55; }
      .arc { fill: none; stroke: var(--sc-accent); stroke-width: 2.6; stroke-linecap: round; }
      .mark { fill: none; stroke: var(--sc-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      :host([data-state='partial']) .box, :host([data-state='full']) .box { stroke: var(--sc-accent); opacity: 1; }
      :host([data-state='full'][data-variant='ring']) .tri {
        box-shadow: 0 0 10px color-mix(in srgb, var(--sc-accent) 45%, transparent);
      }
      .sheen {
        position: absolute;
        inset: 3px;
        border-radius: 50%;
        background: conic-gradient(from 0deg, transparent 0 70%, color-mix(in srgb, var(--sc-accent) 55%, transparent) 85%, transparent);
        pointer-events: none;
        -webkit-mask: radial-gradient(circle, transparent 56%, #000 58%);
        mask: radial-gradient(circle, transparent 56%, #000 58%);
      }
      @media (prefers-reduced-motion: no-preference) {
        .sheen { animation: sc-tri-sheen 3.2s linear infinite; }
        .arc { transition: stroke-dasharray 0.3s ease; }
      }
      @keyframes sc-tri-sheen { to { transform: rotate(360deg); } }
      @media (pointer: coarse) { .tri { min-width: 48px; min-height: 48px; } }
    `,
  ],
})
export class ScTristateComponent {
  /** Fraction 0..1. */
  readonly value = input<number>(0);
  readonly variant = input<'ring' | 'checkbox'>('ring');
  /** Accessible name. */
  readonly label = input<string>('');
  readonly disabled = input<boolean>(false);
  /** The value a click leads to; the host decides whether to apply it. */
  readonly toggled = output<number>();

  readonly r = RING_R;
  readonly state = computed<TristateState>(() => tristateOf(this.value()));
  readonly ariaChecked = computed(() => (this.state() === 'full' ? 'true' : this.state() === 'partial' ? 'mixed' : 'false'));
  /** SVG dash pattern drawing `value` of the circle. */
  readonly dash = computed(() => {
    const on = clampFraction(this.value()) * RING_C;
    return `${on.toFixed(2)} ${(RING_C - on + 0.01).toFixed(2)}`;
  });

  onClick(): void {
    this.toggled.emit(this.state() === 'full' ? 0 : 1);
  }
}
