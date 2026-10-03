import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import {
  type SchemaMarker,
  type ShipBlueprint,
  blueprintView,
  humanizeType,
  viewBoxOf,
} from './ship-blueprint.model';

/**
 * The static hardpoint schematic: the ship's blueprint seen from above (nose
 * to the right) with every hardpoint marked, the side elevation under it, and
 * the same hardpoints as a list.
 *
 * Mouse: hovering a marker names it (size, type) and lights it on the other
 * views of the stage; a click opens it in the inspector — the same component
 * info the 3D view leads to. Keyboard and screen readers use the list: every
 * hardpoint is one button there, focus lights its marker, Enter opens it.
 * Markers are pointer targets on top of that, not a second tab path.
 */
@Component({
  selector: 'sc-ship-blueprint-schema',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (top(); as t) {
      <figure class="schema">
        <div class="sheet">
          <svg class="plan" [attr.viewBox]="topBox()" preserveAspectRatio="xMidYMid meet" role="img"
               [attr.aria-label]="'codex.shipBlueprint.schema.topAria' | translate: { count: markers().length }">
            <path class="hull" fill-rule="evenodd" [attr.d]="t.hull" />
            @if (t.minor) { <path class="minor" [attr.d]="t.minor" /> }
            @if (t.major) { <path class="major" [attr.d]="t.major" /> }
            @for (m of markers(); track m.port) {
              <g class="mk" [class]="'mk g-' + m.group" [class.on]="isActive(m)" [class.sel]="inspectedPort() === m.port"
                 [attr.transform]="'translate(' + m.x + ' ' + m.y + ')'"
                 [scTooltip]="tip(m, (('codex.shipBlueprint.group.' + m.group) | translate), sizeLabel(m) ? (sizeLabel(m)! | translate: { size: m.size }) : '')"
                 scTooltipTier="label"
                 (mouseenter)="hovered.emit([m.port])"
                 (mouseleave)="hovered.emit(null)"
                 (click)="inspect.emit(m.port)">
                <circle class="hit" [attr.r]="radius() * 2.4" />
                <circle class="halo" [attr.r]="radius() * 1.9" />
                <circle class="dot" [attr.r]="radius()" />
              </g>
            }
          </svg>
          @if (side(); as s) {
            <svg class="elevation" [attr.viewBox]="sideBox()" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
              <path class="hull" fill-rule="evenodd" [attr.d]="s.hull" />
              @if (s.minor) { <path class="minor" [attr.d]="s.minor" /> }
              @if (s.major) { <path class="major" [attr.d]="s.major" /> }
            </svg>
          }
        </div>
        <figcaption>
          <span class="ttl">{{ 'codex.shipBlueprint.schema.title' | translate }}</span>
          @if (blueprint().extentM; as e) {
            <span class="dim">{{ 'codex.shipBlueprint.schema.extent' | translate: { length: (e[0] | number: '1.0-1'), beam: (e[1] | number: '1.0-1'), height: (e[2] | number: '1.0-1') } }}</span>
          }
          <span class="legend">
            @for (g of groups(); track g) {
              <span class="lg"><i class="sw" [class]="'sw g-' + g" aria-hidden="true"></i>{{ ('codex.shipBlueprint.group.' + g) | translate }}</span>
            }
          </span>
          <span class="hint">{{ (markers().length ? 'codex.shipBlueprint.schema.hint' : 'codex.shipBlueprint.schema.noPositions') | translate }}</span>
        </figcaption>
        @if (markers().length) {
          <ol class="hp-list" [attr.aria-label]="'codex.shipBlueprint.schema.listLabel' | translate">
            @for (m of markers(); track m.port) {
              <li>
                <button type="button" class="hp" [class]="'hp g-' + m.group" [class.on]="isActive(m)"
                        [attr.aria-pressed]="inspectedPort() === m.port"
                        (mouseenter)="hovered.emit([m.port])" (mouseleave)="hovered.emit(null)"
                        (focus)="hovered.emit([m.port])" (blur)="hovered.emit(null)"
                        (click)="inspect.emit(m.port)">
                  <i class="sw" aria-hidden="true">{{ m.index ?? '' }}</i>
                  <span class="nm">{{ m.label }}</span>
                  <span class="meta">
                    {{ ('codex.shipBlueprint.group.' + m.group) | translate }}@if (sizeLabel(m); as key) { · {{ key | translate: { size: m.size } }} }@if (typeLabel(m); as type) { · {{ type }} }
                  </span>
                </button>
              </li>
            }
          </ol>
        }
      </figure>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; color: var(--sc-accent); }
    .schema { margin: 0; display: flex; flex-direction: column; gap: 10px; min-height: 0; height: 100%; }
    .sheet { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 12px; align-items: stretch;
      padding: 14px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, var(--sc-border));
      background:
        linear-gradient(color-mix(in srgb, var(--sc-accent) 6%, transparent) 1px, transparent 1px) 0 0 / 24px 24px,
        linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 6%, transparent) 1px, transparent 1px) 0 0 / 24px 24px,
        color-mix(in srgb, var(--sc-bg-0) 80%, transparent); }
    svg { display: block; width: 100%; overflow: visible; }
    .plan { flex: 3 1 0; min-height: 160px; }
    .elevation { flex: 1 1 0; min-height: 60px; max-height: 26%; opacity: 0.85; }
    path { vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
    .hull { fill: color-mix(in srgb, currentColor 7%, transparent); stroke: currentColor; stroke-width: 1.5px; }
    .major { fill: none; stroke: currentColor; stroke-width: 0.9px; stroke-opacity: 0.7; }
    .minor { fill: none; stroke: currentColor; stroke-width: 0.6px; stroke-opacity: 0.32; }

    /* Markers: weapons in the accent, missiles gold (the stage legend's colour),
       components and the rest neutral — the group is also named in words. */
    .mk { cursor: pointer; --mk: var(--sc-fg-1); }
    .mk.g-weapons { --mk: var(--sc-accent); }
    .mk.g-missiles { --mk: var(--holo-gold); }
    .mk .hit { fill: transparent; }
    .mk .dot { fill: var(--mk); stroke: var(--sc-bg-0); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
    .mk .halo { fill: none; stroke: var(--mk); stroke-opacity: 0; stroke-width: 1.2px; vector-effect: non-scaling-stroke; }
    .mk:hover .halo, .mk.on .halo, .mk.sel .halo { stroke-opacity: 0.9; }
    .mk.on .halo, .mk.sel .halo { fill: color-mix(in srgb, var(--mk) 22%, transparent); }

    figcaption { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; color: var(--sc-fg-2);
      font-size: max(0.66rem, var(--sc-fs-floor)); }
    .ttl { text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-1); font-family: var(--sc-font-display); }
    .dim { font-family: var(--font-monospace, monospace); color: var(--sc-fg-1); }
    .legend { display: inline-flex; gap: 10px; flex-wrap: wrap; }
    .lg { display: inline-flex; align-items: center; gap: 5px; }
    .sw { display: inline-grid; place-items: center; min-width: 10px; height: 10px; border-radius: 50%;
      background: var(--sw, var(--sc-fg-1)); color: var(--sc-bg-0); font-style: normal; font-size: 0.55rem; line-height: 1; }
    .g-weapons { --sw: var(--sc-accent); }
    .g-missiles { --sw: var(--holo-gold); }
    .hint { flex-basis: 100%; }

    .hp-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); max-height: 180px; overflow: auto; }
    .hp { width: 100%; display: grid; grid-template-columns: auto 1fr; gap: 0 8px; align-items: center; text-align: left;
      padding: 6px 8px; border-radius: 6px; border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); font: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); cursor: pointer; min-height: 44px; }
    .hp .sw { grid-row: span 2; min-width: 18px; height: 18px; font-size: 0.6rem; }
    .hp .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hp .meta { color: var(--sc-fg-2); font-size: max(0.64rem, var(--sc-fs-floor)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .hp:hover, .hp.on { border-color: var(--sc-accent); }
    .hp[aria-pressed='true'] { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, var(--sc-bg-1)); }
    .hp:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
  `],
})
export class ShipBlueprintSchemaComponent {
  /** The full-detail drawing (top + side). */
  readonly blueprint = input.required<ShipBlueprint>();
  /** Hardpoints already projected onto the top view (`placeSchemaMarkers`). */
  readonly markers = input<readonly SchemaMarker[]>([]);
  readonly activePorts = input<readonly string[]>([]);
  readonly inspectedPort = input<string | null>(null);
  /** A hardpoint was hovered or focused (`null` = none). */
  readonly hovered = output<string[] | null>();
  /** Open this port's component info. */
  readonly inspect = output<string>();

  readonly top = computed(() => blueprintView(this.blueprint(), 'top'));
  readonly side = computed(() => blueprintView(this.blueprint(), 'side'));
  readonly topBox = computed(() => {
    const v = this.top();
    return v ? viewBoxOf(v, this.radius() * 3) : '0 0 1 1';
  });
  readonly sideBox = computed(() => {
    const v = this.side();
    return v ? viewBoxOf(v, Math.max(v.box.w, v.box.h) * 0.01) : '0 0 1 1';
  });
  /** Marker radius in drawing units: readable on a fighter and on a capital ship alike. */
  readonly radius = computed(() => {
    const v = this.top();
    return v ? Math.max(v.box.w, v.box.h) * 0.0085 : 1;
  });
  readonly groups = computed(() => {
    const present = new Set(this.markers().map((m) => m.group));
    return (['weapons', 'missiles', 'components', 'other'] as const).filter((g) => present.has(g));
  });

  isActive(m: SchemaMarker): boolean {
    return this.activePorts().includes(m.port);
  }

  sizeLabel(m: SchemaMarker): string | null {
    return m.size != null ? 'codex.shipBlueprint.schema.size' : null;
  }

  typeLabel(m: SchemaMarker): string | null {
    return humanizeType(m.type);
  }

  /** "Nose gun · Weapons · Size 3 · Weapon Gun" — the marker's tooltip. */
  tip(m: SchemaMarker, group: string, size: string): string {
    return [m.label, group, size, this.typeLabel(m)].filter(Boolean).join(' · ');
  }
}
