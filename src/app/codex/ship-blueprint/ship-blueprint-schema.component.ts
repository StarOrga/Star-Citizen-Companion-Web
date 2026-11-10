import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { formatNumber } from '../codex-format';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CodexHoloCalloutComponent } from '../holo/codex-holo-callout.component';
import type { CalloutValue } from '../asset-package/asset-package-viewer.component';
import { calloutSize } from '../asset-package/holo-overlay';
import {
  type BlueprintViewName,
  type SchemaMarker,
  type ShipBlueprint,
  blueprintView,
  humanizeType,
  viewBoxOf,
} from './ship-blueprint.model';

/** The callout of one marker: the shared card's content (type header, name, three values, swap). */
export interface SchemaCallout {
  port: string;
  title: string;
  type: string | null;
  values: readonly CalloutValue[];
  swappable: boolean;
  /** Differs from the stock loadout (C19). */
  diff: boolean;
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
  imports: [TranslatePipe, ScTooltipDirective, CodexHoloCalloutComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (current(); as t) {
      <figure class="schema">
        <div class="sheet" #sheet>
          <svg class="plan" #plan [attr.viewBox]="box()" preserveAspectRatio="xMidYMid meet" role="img"
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
          </svg>
          @if (calloutBox(); as co) {
            <!-- The same callout card as the 3D view (sc-holo-callout), in sheet pixels over the drawing. -->
            <svg class="co-lead" aria-hidden="true">
              <line [attr.x1]="co.ax" [attr.y1]="co.ay" [attr.x2]="co.lx" [attr.y2]="co.ly" />
              <circle [attr.cx]="co.ax" [attr.cy]="co.ay" r="11" />
            </svg>
            <sc-holo-callout class="co-card" [style.left.px]="co.x" [style.top.px]="co.y"
              [type]="co.type" [name]="co.title" [values]="co.values" [swappable]="co.swappable" [diff]="co.diff"
              (swap)="swap.emit(co.port)" />
          }
        </div>
        <figcaption>
          <span class="ttl">{{ 'codex.shipBlueprint.schema.title' | translate }}</span>
          @if (blueprint().extentM; as e) {
            <span class="dim">{{ 'codex.shipBlueprint.schema.extent' | translate: { length: dim(e[0]), beam: dim(e[1]), height: dim(e[2]) } }}</span>
          }
          <span class="legend">
            @for (g of groups(); track g) {
              <span class="lg"><i class="sw" [class]="'sw g-' + g" aria-hidden="true"></i>{{ ('codex.shipBlueprint.group.' + g) | translate }}</span>
            }
          </span>
          <span class="hint">{{ (markers().length ? hintKey() : 'codex.shipBlueprint.schema.noPositions') | translate }}</span>
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
    /* The callout of the part picked on the drawing or in the panel: a card over the sheet. */
    .sheet { position: relative; }
    .co-lead { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
    .co-lead line { stroke: var(--sc-accent); stroke-width: 1.4px; }
    .co-lead circle { fill: none; stroke: var(--sc-accent); stroke-width: 1.4px; opacity: 0.8; }
    .co-card { position: absolute; --co-u: clamp(0.8px, calc(0.5px + 100vw / 3840), 1px); }
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
  /** One decimal in the page's number locale: "19,7 × 17,4 × 5,1 m", never the English point (round-7 E3). */
  protected dim(v: number): string {
    return formatNumber(v, undefined, 1);
  }

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
  /** The caption names the view actually on the sheet (top: nose right; side: nose right, seen from port; front: seen nose-on). */
  readonly hintKey = computed(() => {
    const v = this.current()?.view ?? 'top';
    return v === 'side' ? 'codex.shipBlueprint.schema.hintSide' : v === 'front' ? 'codex.shipBlueprint.schema.hintFront' : 'codex.shipBlueprint.schema.hint';
  });
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

  /** Emitted when the callout's swap button is pressed. */
  readonly swap = output<string>();

  private readonly planRef = viewChild<ElementRef<SVGSVGElement>>('plan');
  /** The drawing's box inside the sheet, CSS px (0 until measured). */
  private readonly planPx = signal({ left: 0, top: 0, w: 0, h: 0, sheetW: 0, sheetH: 0 });

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver !== 'function') return;
      let ro: ResizeObserver | null = null;
      let watched: SVGSVGElement | null = null;
      let raf = 0;
      const measure = () => {
        const el = watched;
        const sheet = el?.parentElement;
        if (!el || !sheet) return;
        const r = el.getBoundingClientRect();
        const s = sheet.getBoundingClientRect();
        this.planPx.set({ left: r.left - s.left - sheet.clientLeft, top: r.top - s.top - sheet.clientTop, w: r.width, h: r.height, sheetW: sheet.clientWidth, sheetH: sheet.clientHeight });
      };
      // The drawing is rendered once the blueprint arrives: poll the view child through a cheap rAF until it exists.
      const attach = () => {
        const el = this.planRef()?.nativeElement ?? null;
        if (el === watched) return;
        ro?.disconnect();
        watched = el;
        if (!el) return;
        // Next frame: the measured box moves the callout, a write inside the callback is a ResizeObserver loop.
        ro = new ResizeObserver(() => { raf ||= requestAnimationFrame(() => { raf = 0; measure(); }); });
        ro.observe(el);
        if (el.parentElement) ro.observe(el.parentElement);
        measure();
      };
      const mo = new MutationObserver(attach);
      mo.observe(this.host.nativeElement, { childList: true, subtree: true });
      attach();
      destroyRef.onDestroy(() => { mo.disconnect(); ro?.disconnect(); cancelAnimationFrame(raf); });
    });
  }
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Callout geometry in sheet px (the drawing is meet-scaled into its box). The card stands OUTSIDE
   * the hull where the sheet has room (above, below, left or right of it), else on the free side with
   * the fewest hardpoints under it — it never sits on the dots it is meant to explain.
   */
  readonly calloutBox = computed(() => {
    const c = this.callout();
    const m = c ? this.markers().find((k) => k.port === c.port) : null;
    const px = this.planPx();
    const v = this.current();
    if (!c || !m || !v || px.w <= 0 || px.h <= 0) return null;
    const [vx, vy, vw, vh] = this.box().split(' ').map(Number);
    if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) return null;
    const s = Math.min(px.w / vw, px.h / vh);
    const ox = px.left + (px.w - vw * s) / 2;
    const oy = px.top + (px.h - vh * s) / 2;
    const toPx = (x: number, y: number) => ({ x: ox + (x - vx) * s, y: oy + (y - vy) * s });
    const a = toPx(m.x, m.y);
    const hullA = toPx(v.box.x, v.box.y);
    const hull = { l: hullA.x, t: hullA.y, r: hullA.x + v.box.w * s, b: hullA.y + v.box.h * s };
    const { w, h } = calloutSize(typeof window === 'undefined' ? 1920 : window.innerWidth);
    const gap = 14;
    const pad = 6;
    // Shot 05: the card keeps a margin to the sheet frame, never flush on its edge.
    const edge = 12;
    const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));
    const cx = clamp(a.x - w / 2, edge, px.sheetW - w - edge);
    const cy = clamp(a.y - h / 2, edge, px.sheetH - h - edge);
    const candidates = [
      { x: cx, y: hull.t - gap - h },
      { x: cx, y: hull.b + gap },
      { x: hull.l - gap - w, y: cy },
      { x: hull.r + gap, y: cy },
      { x: a.x + 22, y: a.y - 22 - h },
      { x: a.x - 22 - w, y: a.y - 22 - h },
      { x: a.x + 22, y: a.y + 22 },
      { x: a.x - 22 - w, y: a.y + 22 },
    ].map((p) => ({ x: clamp(p.x, edge, px.sheetW - w - edge), y: clamp(p.y, edge, px.sheetH - h - edge) }));
    const dots = this.markers().map((k) => toPx(k.x, k.y));
    const score = (p: { x: number; y: number }) => {
      let covered = 0;
      for (const d of dots) if (d.x > p.x - pad && d.x < p.x + w + pad && d.y > p.y - pad && d.y < p.y + h + pad) covered++;
      const overHull = Math.max(0, Math.min(p.x + w, hull.r) - Math.max(p.x, hull.l)) * Math.max(0, Math.min(p.y + h, hull.b) - Math.max(p.y, hull.t));
      const dist = Math.hypot(p.x + w / 2 - a.x, p.y + h / 2 - a.y);
      return covered * 1e7 + overHull * 10 + dist;
    };
    const best = candidates.reduce((b, p) => (score(p) < score(b) ? p : b));
    // The leader ends on the card edge nearest the marker.
    const lx = clamp(a.x, best.x, best.x + w);
    const ly = clamp(a.y, best.y, best.y + h);
    return { ...c, x: best.x, y: best.y, ax: a.x, ay: a.y, lx, ly };
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
