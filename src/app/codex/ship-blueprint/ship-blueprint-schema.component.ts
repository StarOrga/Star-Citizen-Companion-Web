import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import {
  type BlueprintViewName,
  type SchemaMarker,
  type ShipBlueprint,
  blueprintView,
  humanizeType,
  viewBoxOf,
} from './ship-blueprint.model';

/** The callout of one marker: the part's name and its short stat. */
export interface SchemaCallout {
  port: string;
  title: string;
  meta: string | null;
}

/**
 * The static hardpoint schematic: one view of the ship's blueprint (from above,
 * from the side or from the front) large on the sheet with every hardpoint
 * marked, and the same hardpoints as a list.
 *
 * Mouse: hovering a marker names it (size, type) and lights it on the other
 * views of the stage; a click opens it in the inspector — the same component
 * info the 3D view leads to — and draws its callout on the sheet (concept
 * holotisch-unten r1-callout: in the perspective views a callout appears on
 * click or when the part is picked from the panel's list).
 *
 * Keyboard and screen readers (r1-a11y): every marker is a button of its own
 * — focus lights it, Enter/Space open it. The hardpoint list under the drawing
 * left the screen (the panel's list does that job); it stays in the document,
 * out of the tab order, so a screen reader can still read every hardpoint in order.
 */
@Component({
  selector: 'sc-ship-blueprint-schema',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (current(); as t) {
      <figure class="schema">
        <div class="sheet">
          <svg class="plan" [attr.viewBox]="box()" preserveAspectRatio="xMidYMid meet" role="img"
               [attr.aria-label]="'codex.shipBlueprint.schema.topAria' | translate: { count: markers().length }">
            <path class="hull" fill-rule="evenodd" [attr.d]="t.hull" />
            @if (t.minor) { <path class="minor" [attr.d]="t.minor" /> }
            @if (t.major) { <path class="major" [attr.d]="t.major" /> }
            @for (m of markers(); track m.port) {
              @let tipText = tip(m, (('codex.shipBlueprint.group.' + m.group) | translate), sizeLabel(m) ? (sizeLabel(m)! | translate: { size: m.size }) : '');
              <g class="mk" [class]="'mk g-' + m.group" [class.on]="isActive(m)" [class.sel]="inspectedPort() === m.port"
                 [attr.transform]="'translate(' + m.x + ' ' + m.y + ')'"
                 tabindex="0" role="button" [attr.aria-label]="tipText" [attr.aria-pressed]="inspectedPort() === m.port"
                 [attr.data-port]="m.port"
                 [scTooltip]="tipText"
                 scTooltipTier="label"
                 (mouseenter)="hovered.emit([m.port])"
                 (mouseleave)="hovered.emit(null)"
                 (focus)="hovered.emit([m.port])"
                 (blur)="hovered.emit(null)"
                 (keydown.enter)="activate($event, m.port)"
                 (keydown.space)="activate($event, m.port)"
                 (click)="inspect.emit(m.port)">
                <circle class="hit" [attr.r]="radius() * 2.4" />
                <circle class="halo" [attr.r]="radius() * 1.9" />
                <circle class="dot" [attr.r]="radius()" />
              </g>
            }
            @if (calloutBox(); as co) {
              <g class="co" aria-hidden="true">
                <line class="co-line" [attr.x1]="co.ax" [attr.y1]="co.ay" [attr.x2]="co.lx" [attr.y2]="co.ly" />
                <rect class="co-box" [attr.x]="co.x" [attr.y]="co.y" [attr.width]="co.w" [attr.height]="co.h" [attr.rx]="co.fs * 0.45" />
                <text class="co-t" [attr.x]="co.x + co.pad" [attr.y]="co.y + co.pad + co.fs * 0.85" [attr.font-size]="co.fs">{{ co.title }}</text>
                @if (co.meta) {
                  <text class="co-m" [attr.x]="co.x + co.pad" [attr.y]="co.y + co.pad + co.fs * 2.05" [attr.font-size]="co.fs * 0.82">{{ co.meta }}</text>
                }
              </g>
            }
          </svg>
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
          <ol class="hp-list" [class.sr-list]="listHidden()" [attr.aria-label]="'codex.shipBlueprint.schema.listLabel' | translate">
            @for (m of markers(); track m.port) {
              <li>
                <button type="button" class="hp" [class]="'hp g-' + m.group" [class.on]="isActive(m)"
                        [attr.tabindex]="listHidden() ? -1 : null"
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
    .sheet { flex: 1 1 0; min-height: 240px; display: grid; grid-template-rows: minmax(0, 1fr);
      padding: 14px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, var(--sc-border));
      background:
        linear-gradient(color-mix(in srgb, var(--sc-accent) 6%, transparent) 1px, transparent 1px) 0 0 / 24px 24px,
        linear-gradient(90deg, color-mix(in srgb, var(--sc-accent) 6%, transparent) 1px, transparent 1px) 0 0 / 24px 24px,
        color-mix(in srgb, var(--sc-bg-0) 80%, transparent); }
    /* The view fits the sheet whatever its height: it fills the grid row, meet-scaled. */
    svg { display: block; width: 100%; height: 100%; min-height: 0; overflow: visible; }
    path { vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }
    .hull { fill: color-mix(in srgb, currentColor 7%, transparent); stroke: currentColor; stroke-width: 1.5px; }
    .major { fill: none; stroke: currentColor; stroke-width: 0.9px; stroke-opacity: 0.55; }
    .minor { fill: none; stroke: currentColor; stroke-width: 0.6px; stroke-opacity: 0.22; }
    /* The drawing steps back so the markers read first. */
    .plan .hull { fill: color-mix(in srgb, currentColor 5%, transparent); stroke-opacity: 0.8; }

    /* Markers: weapons in the accent, missiles gold (the stage legend's colour),
       components and the rest neutral — the group is also named in words. */
    .mk { cursor: pointer; --mk: var(--sc-fg-1); }
    .mk.g-weapons { --mk: var(--sc-accent); }
    .mk.g-missiles { --mk: var(--holo-gold); }
    .mk .hit { fill: transparent; }
    .mk:focus { outline: none; }
    .mk:focus-visible .halo { stroke: var(--sc-fg-0); stroke-opacity: 1; stroke-width: 2px; }
    /* The callout of the part picked on the drawing or in the panel. */
    .co { pointer-events: none; }
    .co-line { stroke: var(--sc-accent); stroke-width: 1.2px; vector-effect: non-scaling-stroke; }
    .co-box { fill: color-mix(in srgb, var(--sc-bg-0) 92%, transparent); stroke: var(--sc-accent); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .co-t { fill: var(--sc-fg-0); font-weight: 600; }
    .co-m { fill: var(--sc-fg-2); font-family: var(--font-monospace, monospace); }
    .mk .dot { fill: var(--mk); stroke: var(--sc-bg-0); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
    .mk .halo { fill: none; stroke: var(--mk); stroke-opacity: 0.35; stroke-width: 1.2px; vector-effect: non-scaling-stroke; }
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

    /* Off screen, still read (r1-a11y): the markers carry the keyboard path. */
    .hp-list.sr-list { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
    .hp-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); max-height: 128px; overflow: auto; }
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
  /** The full-detail drawing. */
  readonly blueprint = input.required<ShipBlueprint>();
  /** The view on the sheet; a drawing without it falls back to its top view. */
  readonly view = input<BlueprintViewName>('top');
  /** Hardpoints already projected onto that view (`placeSchemaMarkers`). */
  readonly markers = input<readonly SchemaMarker[]>([]);
  readonly activePorts = input<readonly string[]>([]);
  readonly inspectedPort = input<string | null>(null);
  /** The callout for the picked part; null = none (the view shows only points). */
  readonly callout = input<SchemaCallout | null>(null);
  /** The list under the drawing leaves the screen (the Holotable has its panel list). */
  readonly listHidden = input(false);
  /** A hardpoint was hovered or focused (null = none). */
  readonly hovered = output<string[] | null>();
  /** Open this port's component info. */
  readonly inspect = output<string>();

  readonly current = computed(() => blueprintView(this.blueprint(), this.view()) ?? blueprintView(this.blueprint(), 'top'));
  readonly box = computed(() => {
    const v = this.current();
    return v ? viewBoxOf(v, this.radius() * 3) : '0 0 1 1';
  });
  /** Marker radius in drawing units: readable on a fighter and on a capital ship alike. */
  readonly radius = computed(() => {
    const v = this.current();
    return v ? Math.max(v.box.w, v.box.h) * 0.012 : 1;
  });
  readonly groups = computed(() => {
    const present = new Set(this.markers().map((m) => m.group));
    return (['weapons', 'missiles', 'components', 'other'] as const).filter((g) => present.has(g));
  });

  /** Callout geometry in drawing units, beside its marker and inside the sheet. */
  readonly calloutBox = computed(() => {
    const c = this.callout();
    const m = c ? this.markers().find((k) => k.port === c.port) : null;
    if (!c || !m) return null;
    const [vx, vy, vw, vh] = this.box().split(' ').map(Number);
    if (![vx, vy, vw, vh].every(Number.isFinite)) return null;
    const r = this.radius();
    const fs = r * 1.5;
    const pad = fs * 0.6;
    const longest = Math.max(c.title.length, c.meta?.length ?? 0);
    const w = Math.min(vw, longest * fs * 0.56 + pad * 2);
    const h = c.meta ? fs * 2.6 + pad * 1.4 : fs * 1.3 + pad * 1.4;
    const right = m.x < vx + vw / 2;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    const x = clamp(right ? m.x + r * 3.5 : m.x - r * 3.5 - w, vx, vx + vw - w);
    const y = clamp(m.y - r * 3.5 - h, vy, vy + vh - h);
    return { title: c.title, meta: c.meta, fs, pad, x, y, w, h, ax: m.x, ay: m.y, lx: right ? x : x + w, ly: y + h };
  });

  /** Enter/Space on a focused marker: the same as a click. */
  activate(ev: Event, port: string): void {
    ev.preventDefault();
    this.inspect.emit(port);
  }

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
