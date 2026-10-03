import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type BlueprintViewName, type ShipBlueprint, blueprintView, viewBoxOf } from './ship-blueprint.model';

/**
 * One view of a ship blueprint, drawn from the parsed paths with the app's own
 * strokes (`currentColor`, so the host's colour token decides). Decorative:
 * whoever places it names the ship in words.
 *
 * `detail` picks the level of detail the size can carry:
 *   icon — outline + faint main lines (search rows, ~34 px)
 *   tile — outline + main lines (tile placeholder, ~100-300 px)
 *   full — everything, detail lines included (the schema view)
 */
@Component({
  selector: 'sc-ship-blueprint-art',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': "'d-' + detail()" },
  template: `
    @if (shown(); as v) {
      <svg [attr.viewBox]="box()" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
        <path class="hull" fill-rule="evenodd" [attr.d]="v.hull" />
        @if (v.major) {
          <path class="major" [attr.d]="v.major" />
        }
        @if (detail() === 'full' && v.minor) {
          <path class="minor" [attr.d]="v.minor" />
        }
      </svg>
    }
  `,
  styles: [`
    :host { display: block; line-height: 0; }
    svg { display: block; width: 100%; height: 100%; overflow: visible; }
    path { vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
    .hull { fill: color-mix(in srgb, currentColor 9%, transparent); stroke: currentColor; stroke-width: 1.4px; }
    .major { fill: none; stroke: currentColor; stroke-width: 0.9px; stroke-opacity: 0.72; }
    .minor { fill: none; stroke: currentColor; stroke-width: 0.6px; stroke-opacity: 0.38; }
    :host(.d-icon) .hull { stroke-width: 1.1px; fill: color-mix(in srgb, currentColor 14%, transparent); }
    :host(.d-icon) .major { stroke-width: 0.6px; stroke-opacity: 0.45; }
    :host(.d-tile) .hull { stroke-width: 1.3px; }
  `],
})
export class ShipBlueprintArtComponent {
  readonly blueprint = input.required<ShipBlueprint>();
  readonly view = input<BlueprintViewName>('top');
  readonly detail = input<'icon' | 'tile' | 'full'>('tile');

  readonly shown = computed(() => blueprintView(this.blueprint(), this.view()));
  /** A little air around the drawing so the outline stroke is never clipped. */
  readonly box = computed(() => {
    const v = this.shown();
    return v ? viewBoxOf(v, Math.max(v.box.w, v.box.h) * 0.01) : '0 0 1 1';
  });
}
