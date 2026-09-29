import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { CodexItemPort } from '../codex.types';
import { humanizePortType } from '../codex-format';
import type { HardpointFrame, HardpointMarker } from '../hardpoint-map';
import { ShipHardpointMapComponent } from '../ship-hardpoint-map.component';
import type { PortCompat, PortGroup } from './codex-detail.types';

/**
 * The body of the codex detail page's "Hardpoints" card: ports grouped by
 * category, each one folding out its compatible items. Shared by the classic
 * view and the Holotable drawer (AUD-090, AUD-116). The card frame, its
 * heading and hint stay in codex-detail, so the card looks the same.
 *
 * State stays in the parent (which port is open, the lazily loaded compatible
 * items), so switching classic and Holotable keeps an open port open. This
 * component renders and reports: portToggle when a port head is pressed, hovered
 * when a located port lights up its marker on the hull map.
 */
@Component({
  selector: 'sc-codex-port-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ShipHardpointMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The hull map lives with the loadout list when there is one; a
         ship with only structural ports gets it here instead, so it is
         never shown twice and never withheld. -->
    @if (showMap() && frame(); as frame) {
      <sc-ship-hardpoint-map
        [markers]="markers()"
        [frame]="frame"
        [activePorts]="activePorts()"
        (hovered)="hovered.emit($event)" />
    }
    @for (g of groups(); track g.category) {
      <div class="hp-group">
        <h3 class="hp-cat">
          {{ ('codex.portCategory.' + g.category) | translate }}
          <span class="hp-ct">{{ g.ports.length }}</span>
        </h3>
        <ul class="hp-list">
          @for (port of g.ports; track port.portIndex) {
            <li class="hp" [class.expandable]="port.types.length > 0" [class.open]="expandedPort() === port.portIndex"
                [class.located]="isPortLocated(port)" [class.on]="isPortActive(port)"
                (mouseenter)="hoverPort(port)" (mouseleave)="hovered.emit(null)">
              <button type="button" class="hp-head" (click)="portToggle.emit(port)" [disabled]="port.types.length === 0">
                <span class="hp-caret">{{ port.types.length ? (expandedPort() === port.portIndex ? '▾' : '▸') : '·' }}</span>
                <span class="hp-name">{{ humanizePort(port.portName) }}</span>
                <span class="hp-meta">
                  <span class="hp-size">{{ sizeRange(port.minSize, port.maxSize) }}</span>
                  @for (t of port.types; track t) { <span class="chip">{{ humanizeType(t) }}</span> }
                </span>
              </button>
              @if (expandedPort() === port.portIndex) {
                <div class="compat">
                  @if (compat().get(port.portIndex); as c) {
                    @if (c.loading) {
                      <span class="muted">{{ 'codex.detail.compatLoading' | translate }}</span>
                    } @else if (c.error) {
                      <span class="err-inline">{{ c.error | translate }}</span>
                    } @else if (c.items.length === 0) {
                      <span class="muted">{{ 'codex.detail.compatNone' | translate }}</span>
                    } @else {
                      <div class="compat-head">{{ 'codex.detail.compatCount' | translate: { count: c.items.length } }}</div>
                      <ul class="compat-list">
                        @for (it of c.items; track it.kind + it.classNameSlug) {
                          <li>
                            <a class="compat-link" [routerLink]="['/codex', it.kind, it.classNameSlug]">
                              {{ it.nameLocalized || it.classNameSlug }}
                            </a>
                            <span class="compat-meta">
                              @if (it.size != null) { <span class="chip">S{{ it.size }}</span> }
                              @if (it.grade) { <span class="chip">{{ it.grade }}</span> }
                              @if (it.manufacturerCode) { <span class="chip">{{ it.manufacturerCode }}</span> }
                            </span>
                          </li>
                        }
                      </ul>
                    }
                  }
                </div>
              }
            </li>
          }
        </ul>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .hp-group { margin-top: 12px; }
    .hp-group:first-of-type { margin-top: 0; }
    .hp-cat { margin: 0 0 6px; font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; color: var(--sc-fg-1);
      display: flex; align-items: center; gap: 6px; }
    .hp-cat .hp-ct { font-size: max(0.64rem, var(--sc-fs-floor)); padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--sc-fg-2) 18%, transparent); color: var(--sc-fg-2); }
    .hp-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }

    .hp { border-radius: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border); overflow: hidden; }
    .hp.open { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
    /* A port whose position on the hull is known gets a locator rail; hovering
       it lights up its marker on the hull map (and vice versa). Ports without
       coordinates look exactly as they did before. */
    .hp.located { border-left: 2px solid color-mix(in srgb, var(--sc-accent) 30%, transparent); }
    .hp.located.on { border-left-color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 8%, var(--sc-bg-1)); }
    .hp-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: transparent; border: none;
      color: inherit; font: inherit; text-align: left; cursor: default; }
    .hp.expandable .hp-head { cursor: pointer; }
    .hp.expandable .hp-head:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
    .hp-caret { width: 14px; color: var(--sc-fg-2); flex: 0 0 auto; }
    .hp.open .hp-caret { color: var(--sc-accent); }
    .hp-name { font-size: 0.82rem; color: var(--sc-fg-0); flex: 1 1 auto; overflow-wrap: anywhere; }
    .hp-meta { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; justify-content: flex-end; flex: 0 1 auto; }
    .hp-size { font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-family: var(--sc-font-mono, monospace); }
    .compat { padding: 4px 12px 12px 34px; background: var(--sc-bg-0); }
    .compat-head { color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); text-transform: uppercase; letter-spacing: 0.06em; margin: 4px 0 8px; }

    /* Shared with codex-detail (Used in, recipe, Where to buy) — copied, not
       moved: the parent still renders these classes itself. */
    .chip { font-size: max(10px, var(--sc-fs-floor)); padding: 0 3px; border-radius: 2px; background: transparent; color: var(--sc-fg-1); border: 1px solid var(--sc-border); white-space: nowrap; }
    .muted { color: var(--sc-fg-2); margin: 0; font-size: 0.82rem; }
    .err-inline { color: var(--sc-danger); font-size: 0.8rem; }
    .compat-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
    .compat-list li { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 4px; background: var(--sc-bg-1); }
    .compat-link { color: var(--sc-accent); text-decoration: none; font-size: 0.8rem; overflow-wrap: anywhere; }
    .compat-link:hover { text-decoration: underline; }
    .compat-meta { display: inline-flex; gap: 4px; flex-shrink: 0; }
  `],
})
export class CodexPortListComponent {
  readonly groups = input.required<readonly PortGroup[]>();
  readonly frame = input<HardpointFrame | null>(null);
  /** The hull map renders here only when no loadout card hosts it. */
  readonly showMap = input(false);
  readonly markers = input<HardpointMarker[]>([]);
  readonly activePorts = input<readonly string[]>([]);
  readonly locatablePorts = input<readonly string[]>([]);
  readonly expandedPort = input<number | null>(null);
  readonly compat = input<ReadonlyMap<number, PortCompat>>(new Map());

  readonly portToggle = output<CodexItemPort>();
  readonly hovered = output<string[] | null>();

  protected isPortLocated(port: CodexItemPort): boolean {
    return !!port.portName && this.locatablePorts().includes(port.portName);
  }
  protected isPortActive(port: CodexItemPort): boolean {
    return !!port.portName && this.activePorts().includes(port.portName);
  }
  protected hoverPort(port: CodexItemPort): void {
    this.hovered.emit(this.isPortLocated(port) ? [port.portName as string] : null);
  }
  protected humanizePort(name: string | null): string {
    return name ? humanizePortType(name) : '—';
  }
  protected humanizeType(t: string): string {
    return humanizePortType(t);
  }
  protected sizeRange(min: number | null, max: number | null): string {
    if (min == null && max == null) return '—';
    if (min === max || max == null) return 'S' + String(min ?? max);
    if (min == null) return 'S' + String(max);
    return `S${min}–${max}`;
  }
}
