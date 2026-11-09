import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { SilThumb } from '../../shared/sil-thumb/sil-thumbs.service';

/**
 * The real silhouette of the ship that is loading, arriving from the jump point: a short flash, the hull stretching
 * to its length and the outline drawing itself. Nothing else (no sun, stars or streaks); the parent owns the box.
 * Reduced motion: the outline is simply there.
 */
@Component({
  selector: 'sc-ship-arrival',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <i class="flash" aria-hidden="true"></i>
    <svg class="hull" [attr.viewBox]="thumb().viewBox" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      <path class="outline" [attr.d]="thumb().path" [attr.transform]="thumb().transform || null" vector-effect="non-scaling-stroke" />
      @if (thumb().edges) {
        <path class="edges" [attr.d]="thumb().edges" vector-effect="non-scaling-stroke" stroke-width="0.8" />
      }
    </svg>
  `,
  styles: [
    `
      :host { position: absolute; inset: 0; display: grid; place-items: center; color: var(--sc-accent); pointer-events: none; }
      .flash { position: absolute; left: 50%; top: 50%; width: 14%; aspect-ratio: 1; margin: -7% 0 0 -7%; border-radius: 50%;
        background: radial-gradient(circle, color-mix(in srgb, var(--sc-accent) 85%, white) 0%, transparent 70%);
        opacity: 0; animation: arr-flash 0.7s ease-out both; }
      .hull { width: 76%; height: 62%; overflow: visible; filter: drop-shadow(0 0 8px color-mix(in srgb, var(--sc-accent) 55%, transparent));
        transform-origin: 50% 50%; animation: arr-stretch 0.9s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
      .outline { stroke-dasharray: 20000; stroke-dashoffset: 20000; animation: arr-draw 1.6s 0.15s ease-out forwards; }
      .edges { opacity: 0; animation: arr-edges 0.8s 1s ease-out forwards; }
      @keyframes arr-flash { 0% { opacity: 0; transform: scale(0.3); } 25% { opacity: 1; } 100% { opacity: 0; transform: scale(5); } }
      @keyframes arr-stretch { 0% { transform: scaleX(0.04); opacity: 0; } 30% { opacity: 1; } 100% { transform: scaleX(1); opacity: 1; } }
      @keyframes arr-draw { to { stroke-dashoffset: 0; } }
      @keyframes arr-edges { to { opacity: 0.5; } }
      @media (prefers-reduced-motion: reduce) {
        .flash { display: none; }
        .hull, .outline, .edges { animation: none; }
        .outline { stroke-dasharray: none; stroke-dashoffset: 0; }
        .edges { opacity: 0.5; }
      }
    `,
  ],
})
export class ShipArrivalComponent {
  readonly thumb = input.required<SilThumb>();
}
