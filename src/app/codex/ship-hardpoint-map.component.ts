import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { HardpointFrame, HardpointMarker, hardpointViewBox } from './hardpoint-map';

/**
 * Where a hardpoint physically sits on the hull (#137 part 3).
 *
 * Two orthographic schematics — top-down and from starboard — drawn from the
 * ship's OWN mesh data: the hardpoint positions and the box they live in both
 * come out of the hull `.cga` (see `hardpoint-map.ts` for the axis convention).
 * Hovering a hardpoint row in the loadout list lights up its marker here, and
 * hovering a marker lights up its row — the map and the list are two views of
 * one selection, driven by the raw port name.
 *
 * Deliberately a schematic, not a render: the hull outline is the mesh's real
 * bounding box, so a marker's relative position is real, while the silhouette is
 * honestly a box rather than a traced hull we do not have geometry for. The
 * component renders nothing at all when a ship carries no positions, which is
 * every ship until the desktop uploader has re-run against Data.p4k.
 */
@Component({
  selector: 'sc-ship-hardpoint-map',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (markers().length > 0) {
      <figure class="hp-map">
        <figcaption>
          <span class="ttl">{{ 'codex.hardpointMap.title' | translate }}</span>
          <span class="hint">
            {{ 'codex.hardpointMap.hint' | translate }}
            @if (approximate()) {
              · {{ 'codex.hardpointMap.approximate' | translate }}
            }
          </span>
        </figcaption>

        <div class="views">
          <!-- Top-down: nose points up. -->
          <div class="view">
            <span class="v-label">{{ 'codex.hardpointMap.viewTop' | translate }}</span>
            <svg
              [attr.viewBox]="'0 0 100 ' + box().top"
              role="img"
              [attr.aria-label]="'codex.hardpointMap.viewTopAria' | translate: { count: markers().length }"
            >
              <rect class="hull" x="1" y="1" [attr.width]="98" [attr.height]="box().top - 2" rx="6" />
              <line class="axis" x1="50" y1="1" x2="50" [attr.y2]="box().top - 1" />
              <text class="nose" x="50" y="9" text-anchor="middle">
                {{ 'codex.hardpointMap.nose' | translate }}
              </text>
              @for (m of markers(); track m.port) {
                <g
                  class="mk"
                  [class.on]="isActive(m)"
                  [class.edge]="m.clamped"
                  tabindex="0"
                  [attr.transform]="'translate(' + m.top.x * 100 + ',' + m.top.y * box().top + ')'"
                  (mouseenter)="hovered.emit([m.port])"
                  (mouseleave)="hovered.emit(null)"
                  (focus)="hovered.emit([m.port])"
                  (blur)="hovered.emit(null)"
                >
                  <title>{{ tip(m) }}</title>
                  <circle class="halo" r="5" />
                  <circle class="dot" r="2.2" />
                </g>
              }
            </svg>
          </div>

          <!-- From starboard: nose points right. -->
          <div class="view">
            <span class="v-label">{{ 'codex.hardpointMap.viewSide' | translate }}</span>
            <svg
              [attr.viewBox]="'0 0 100 ' + box().side"
              role="img"
              [attr.aria-label]="'codex.hardpointMap.viewSideAria' | translate: { count: markers().length }"
            >
              <rect class="hull" x="1" y="1" [attr.width]="98" [attr.height]="box().side - 2" rx="6" />
              <line class="axis" x1="1" [attr.y1]="box().side / 2" x2="99" [attr.y2]="box().side / 2" />
              <text class="nose" [attr.x]="94" [attr.y]="box().side / 2 - 2" text-anchor="end">
                {{ 'codex.hardpointMap.nose' | translate }}
              </text>
              @for (m of markers(); track m.port) {
                <g
                  class="mk"
                  [class.on]="isActive(m)"
                  [class.edge]="m.clamped"
                  tabindex="0"
                  [attr.transform]="'translate(' + m.side.x * 100 + ',' + m.side.y * box().side + ')'"
                  (mouseenter)="hovered.emit([m.port])"
                  (mouseleave)="hovered.emit(null)"
                  (focus)="hovered.emit([m.port])"
                  (blur)="hovered.emit(null)"
                >
                  <title>{{ tip(m) }}</title>
                  <circle class="halo" r="5" />
                  <circle class="dot" r="2.2" />
                </g>
              }
            </svg>
          </div>
        </div>

        <!-- The active hardpoint named in words: an SVG <title> is not enough
             on touch, where there is no hover at all. -->
        <p class="readout" [class.empty]="!activeLabel()">
          {{ activeLabel() || ('codex.hardpointMap.readoutIdle' | translate) }}
        </p>
      </figure>
    }
  `,
  styles: [`
    :host { display: block; }
    .hp-map { margin: 0 0 14px; }
    figcaption { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; }
    .ttl { font-size: max(0.68rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.07em; color: var(--sc-fg-1); }
    .hint { font-size: max(0.63rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .views { display: grid; gap: 10px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    @media (max-width: 720px) { .views { grid-template-columns: 1fr; } }

    .view { position: relative; border-radius: 8px; padding: 6px 8px 4px;
      background: var(--sc-bg-1); border: 1px solid var(--sc-border); min-width: 0; }
    .v-label { display: block; font-size: max(0.6rem, var(--sc-fs-floor)); text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--sc-fg-2); margin-bottom: 4px; }
    svg { display: block; width: 100%; height: auto; overflow: visible; }

    .hull { fill: color-mix(in srgb, var(--sc-accent) 4%, transparent);
      stroke: color-mix(in srgb, var(--sc-border) 90%, transparent); stroke-width: 0.6;
      stroke-dasharray: 3 2; }
    .axis { stroke: color-mix(in srgb, var(--sc-border) 70%, transparent); stroke-width: 0.4; }
    .nose { fill: var(--sc-fg-2); font-size: 5px; letter-spacing: 0.5px; }

    .mk { cursor: default; }
    .mk .dot { fill: var(--sc-fg-2); stroke: var(--sc-bg-0); stroke-width: 0.5; }
    .mk .halo { fill: transparent; }
    .mk:hover .dot, .mk.on .dot { fill: var(--sc-accent); }
    .mk.on .halo { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent);
      stroke: var(--sc-accent); stroke-width: 0.5; }
    /* A hardpoint that sat outside the frame is pinned to the edge — shown as a
       ring so it never passes for an exact position. */
    .mk.edge .dot { fill: transparent; stroke: var(--sc-fg-2); stroke-width: 0.8; }
    .mk.edge.on .dot { stroke: var(--sc-accent); }
    .mk:focus-visible { outline: none; }
    .mk:focus-visible .halo { fill: color-mix(in srgb, var(--sc-accent) 22%, transparent);
      stroke: var(--sc-accent); stroke-width: 0.6; }

    .readout { margin: 6px 0 0; min-height: 1.1em; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-accent); }
    .readout.empty { color: var(--sc-fg-2); font-style: italic; }
  `],
})
export class ShipHardpointMapComponent {
  /** Projected hardpoints — already validated, one per row the list shows. */
  readonly markers = input.required<HardpointMarker[]>();
  /** The frame the positions were projected in (drives the panel proportions). */
  readonly frame = input.required<HardpointFrame>();
  /** Raw port names currently highlighted (hovered row, or hovered marker). */
  readonly activePorts = input<readonly string[]>([]);
  /** A marker was hovered/focused (`null` = nothing). */
  readonly hovered = output<string[] | null>();

  readonly box = computed(() => hardpointViewBox(this.frame()));

  /** The frame had to be derived from the points, so extents are approximate. */
  readonly approximate = computed(() => this.frame().source === 'ports');

  isActive(m: HardpointMarker): boolean {
    return this.activePorts().includes(m.port);
  }

  /** "Left wing mount — Bulldog Repeater" for the tooltip and the readout. */
  tip(m: HardpointMarker): string {
    return m.itemName ? `${m.label} — ${m.itemName}` : m.label;
  }

  readonly activeLabel = computed(() => {
    const active = this.activePorts();
    if (active.length === 0) return '';
    const hits = this.markers().filter((m) => active.includes(m.port));
    if (hits.length === 0) return '';
    return hits.length === 1
      ? this.tip(hits[0])
      : `${hits.length}× ${this.tip(hits[0])}`;
  });
}
