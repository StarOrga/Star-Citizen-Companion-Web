import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScActionDirective } from '../../../shared/action/sc-action.directive';
import { STEP_KINDS, type StepKind } from '../../../shared/step/sc-step.component';
import { ScTooltipDirective } from '../../../shared/tooltip/sc-tooltip.directive';
import { NACHSCHUB_ICON_PATHS, STEP_ICON_PATHS, TRANSPORT_WHEELS } from '../../nachschub/step-icons';
import { RouteFilterStore } from './route-filter.store';
import { ROUTE_H, ROUTE_W, type RouteGraphStep, kindsIn, layoutRoute } from './route-layout';

/** A stop that also serves another Nachschub (a quiet clickable hint on the route). */
export interface RouteSharedStop {
  readonly location: string;
  readonly nachschubId: string;
  readonly name: string;
}

export const ROUTE_ZOOM_MIN = 0.6;
export const ROUTE_ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;

/**
 * The route of an Einsatz as a schematic map (concept round 4): one area per star system, a node per place with
 * its action icons (the seven kinds of a step), legs between them and jump legs between systems. It is always
 * fitted and centred, zooms (buttons, wheel, keys) and pans (drag, arrow keys), and has a hidden legend whose
 * kinds can be shown or hidden - remembered per route (`filterKey`). Nothing here scrolls the page.
 */
@Component({
  selector: 'sc-hq-route-graphic',
  standalone: true,
  imports: [TranslatePipe, ScActionDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="map"
      tabindex="0"
      role="group"
      [attr.aria-label]="'hq.route.aria' | translate: { n: steps().length }"
      (keydown)="onKey($event)">
      <svg
        #svg
        class="route"
        [attr.viewBox]="'0 0 ' + W + ' ' + H"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        [attr.aria-label]="summary()"
        (wheel)="onWheel($event)"
        (pointerdown)="onDown($event)"
        (pointermove)="onMove($event)"
        (pointerup)="onUp($event)"
        (pointercancel)="onUp($event)">
        <g [attr.transform]="transform()">
          @for (s of layout().systems; track s.name; let i = $index) {
            <ellipse class="sys" [class.alt]="i % 2 === 1" [attr.cx]="s.cx" [attr.cy]="s.cy" [attr.rx]="s.rx" [attr.ry]="s.ry" />
            <circle class="star" [attr.cx]="s.cx" [attr.cy]="s.cy" r="6" />
            <text class="sysname" [attr.x]="s.cx - s.rx + 18" y="34">{{ s.name }}</text>
          }
          @for (l of layout().legs; track $index) {
            <path class="leg" [class.jump]="l.jump" [class.done]="l.done" [attr.d]="l.d" />
          }
          @for (n of layout().nodes; track n.id) {
            <g class="node" [class.cur]="n.state === 'cur'" [class.done]="n.state === 'done'" [class.dim]="n.dim">
              @if (n.state === 'cur') {
                <circle class="halo" [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="n.r + 11" />
              }
              <circle class="dot" [attr.cx]="n.x" [attr.cy]="n.y" [attr.r]="n.r" />
              @for (b of n.badges; track b.kind) {
                <g class="badge" [class.k-done]="badgeDone(b.ords)">
                  <rect [attr.x]="b.x" [attr.y]="b.y" width="22" height="22" rx="6" />
                  <g [attr.transform]="'translate(' + (b.x + 3) + ' ' + (b.y + 3) + ') scale(0.667)'" class="ic">
                    @for (p of paths[b.kind]; track p) {
                      <path [attr.d]="p" />
                    }
                    @if (b.kind === 'transport') {
                      @for (w of wheels; track w.cx) {
                        <circle [attr.cx]="w.cx" [attr.cy]="w.cy" [attr.r]="w.r" />
                      }
                    }
                  </g>
                </g>
              }
              <text class="ords" [attr.x]="n.x" [attr.y]="n.ordsY" text-anchor="middle">{{ n.ords.join(' · ') }}</text>
              <text class="name" [attr.x]="n.x" [attr.y]="n.nameY" text-anchor="middle">{{ n.name }}</text>
              @if (sharedFor(n.location); as sh) {
                <g
                  class="shared"
                  role="button"
                  tabindex="0"
                  [attr.aria-label]="'hq.route.shared' | translate: { place: n.name, name: sh.name }"
                  (pointerdown)="$event.stopPropagation()"
                  (click)="sharedPick.emit(sh)"
                  (keydown.enter)="sharedPick.emit(sh)"
                  (keydown.space)="sharedPick.emit(sh); $event.preventDefault()">
                  <circle [attr.cx]="n.x + n.r + 8" [attr.cy]="n.y - n.r - 4" r="9" />
                  <g [attr.transform]="'translate(' + (n.x + n.r + 2) + ' ' + (n.y - n.r - 10) + ') scale(0.5)'" class="ic">
                    @for (p of tray; track p) {
                      <path [attr.d]="p" />
                    }
                  </g>
                </g>
              }
            </g>
          }
        </g>
      </svg>

      <div class="ctl" role="group" [attr.aria-label]="'hq.route.zoomGroup' | translate">
        <button type="button" scAction tier="tertiary" class="g" [attr.aria-label]="'hq.route.zoomIn' | translate" [scTooltip]="'hq.route.zoomIn' | translate" scTooltipTier="label" (click)="zoomBy(1.25)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2M11 8v6M8 11h6" /></svg>
        </button>
        <button type="button" scAction tier="tertiary" class="g" [attr.aria-label]="'hq.route.zoomOut' | translate" [scTooltip]="'hq.route.zoomOut' | translate" scTooltipTier="label" (click)="zoomBy(0.8)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2M8 11h6" /></svg>
        </button>
        <button type="button" scAction tier="tertiary" class="g" [attr.aria-label]="'hq.route.fit' | translate" [scTooltip]="'hq.route.fit' | translate" scTooltipTier="label" (click)="fit()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>

      <div class="legend" [class.open]="legendOpen()">
        @if (legendOpen()) {
          <div class="pop" role="group" [attr.aria-label]="'hq.route.legendAria' | translate">
            @for (k of kinds(); track k) {
              <button type="button" class="row" role="switch" [attr.aria-checked]="!hidden().has(k)" [class.off]="hidden().has(k)" (click)="toggle(k)">
                <span class="lic"><svg viewBox="0 0 24 24" aria-hidden="true">
                  @for (p of paths[k]; track p) { <path [attr.d]="p" /> }
                  @if (k === 'transport') { @for (w of wheels; track w.cx) { <circle [attr.cx]="w.cx" [attr.cy]="w.cy" [attr.r]="w.r" /> } }
                </svg></span>
                <span class="lt">{{ 'hq.step.kind.' + k | translate }}</span>
                <i class="eye" aria-hidden="true"></i>
              </button>
            }
          </div>
        }
        <button type="button" class="lg-btn" [attr.aria-expanded]="legendOpen()" (click)="legendOpen.set(!legendOpen())">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h3M10 6h10M4 12h3M10 12h10M4 18h3M10 18h10" /></svg>
          <span>{{ 'hq.route.legend' | translate }}</span>
          <i>{{ kinds().length - hiddenCount() }}/{{ kinds().length }}</i>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 0; min-width: 0; height: 100%; }
      .map { position: relative; height: 100%; min-height: 160px; border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 10px); background: radial-gradient(120% 90% at 50% 40%, color-mix(in srgb, var(--sc-accent) 7%, var(--sc-bg-0)), var(--sc-bg-0)); overflow: hidden; touch-action: none; }
      .map:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .route { display: block; width: 100%; height: 100%; cursor: grab; user-select: none; }
      .route:active { cursor: grabbing; }
      .sys { fill: color-mix(in srgb, var(--sc-accent) 5%, transparent); stroke: color-mix(in srgb, var(--sc-accent) 28%, transparent); stroke-width: 1.2; }
      .sys.alt { stroke: color-mix(in srgb, var(--sc-warning) 30%, transparent); fill: color-mix(in srgb, var(--sc-warning) 4%, transparent); }
      .star { fill: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
      .sysname { fill: var(--sc-fg-2); font: 600 13px var(--sc-font-display, inherit); letter-spacing: 0.18em; text-transform: uppercase; }
      .leg { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 50%, transparent); stroke-width: 2; stroke-dasharray: 6 6; }
      .leg.done { stroke: var(--sc-accent); stroke-dasharray: none; stroke-width: 2.6; }
      .leg.jump { stroke: color-mix(in srgb, var(--sc-warning) 70%, var(--sc-accent)); stroke-width: 3; stroke-dasharray: 2 5; }
      .leg.jump.done { stroke-dasharray: none; }
      .dot { fill: var(--sc-bg-0); stroke: var(--sc-accent); stroke-width: 2; }
      .node.done .dot { fill: var(--sc-accent); }
      .node.cur .dot { fill: var(--sc-fg-0); stroke-width: 3; }
      .halo { fill: color-mix(in srgb, var(--sc-accent) 18%, transparent); stroke: var(--sc-accent); stroke-width: 1; animation: pulse 2.4s ease-in-out infinite; transform-box: fill-box; transform-origin: center; }
      @keyframes pulse { 50% { opacity: 0.35; } }
      .node.dim .dot { stroke: color-mix(in srgb, var(--sc-accent) 35%, transparent); }
      .badge rect { fill: var(--sc-bg-1); stroke: color-mix(in srgb, var(--sc-accent) 55%, transparent); stroke-width: 1; }
      .badge.k-done rect { fill: color-mix(in srgb, var(--sc-accent) 22%, var(--sc-bg-1)); }
      .ic { fill: none; stroke: var(--sc-accent); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
      .name { fill: var(--sc-fg-0); font: 600 12px var(--sc-font-body, inherit); paint-order: stroke; stroke: var(--sc-bg-0); stroke-width: 3px; }
      .ords { fill: var(--sc-fg-2); font: 11px var(--sc-font-mono, monospace); }
      .shared { cursor: pointer; }
      .shared circle { fill: var(--sc-bg-1); stroke: var(--sc-accent); stroke-width: 1.2; }
      .shared .ic { stroke-width: 3; }
      .shared:focus-visible circle, .shared:hover circle { stroke-width: 2.4; fill: color-mix(in srgb, var(--sc-accent) 25%, var(--sc-bg-1)); outline: none; }
      .ctl { position: absolute; top: 8px; right: 8px; display: flex; flex-direction: column; gap: 4px; }
      .ctl .g svg, .lg-btn svg, .lic svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .ctl .g { background: color-mix(in srgb, var(--sc-bg-0) 80%, transparent); backdrop-filter: blur(4px); }
      .ctl .g svg { width: 18px; height: 18px; }
      .legend { position: absolute; right: 8px; bottom: 8px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
      .lg-btn { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; padding: 0 10px; border: 1px solid var(--sc-border); border-radius: 999px; background: color-mix(in srgb, var(--sc-bg-0) 85%, transparent); color: var(--sc-fg-1); font: inherit; font-size: 0.8rem; cursor: pointer; }
      .lg-btn svg { width: 15px; height: 15px; }
      .lg-btn i { font-style: normal; color: var(--sc-fg-2); font-size: 0.75rem; }
      .lg-btn:hover, .legend.open .lg-btn { border-color: var(--sc-accent); color: var(--sc-fg-0); }
      .lg-btn:focus-visible, .row:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .pop { display: grid; grid-template-columns: repeat(2, auto); gap: 2px 12px; padding: 8px 10px; border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 94%, transparent); box-shadow: 0 8px 28px rgb(0 0 0 / 0.45); }
      .row { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 4px; border: 0; border-radius: 6px; background: transparent; color: var(--sc-fg-1); font: inherit; font-size: 0.8rem; text-align: start; cursor: pointer; }
      .row:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .lic { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-accent); }
      .lic svg { width: 13px; height: 13px; }
      .lt { flex: 1; }
      .eye { position: relative; width: 24px; height: 14px; border-radius: 999px; background: color-mix(in srgb, var(--sc-accent) 60%, transparent); }
      .eye::after { content: ''; position: absolute; top: 2px; right: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--sc-fg-0); transition: right 0.15s, left 0.15s; }
      .row.off { color: var(--sc-fg-2); }
      .row.off .lic { opacity: 0.45; }
      .row.off .eye { background: color-mix(in srgb, var(--sc-fg-2) 40%, transparent); }
      .row.off .eye::after { right: auto; left: 2px; }
      @media (prefers-reduced-motion: reduce) { .halo { animation: none; } .eye::after { transition: none; } }
      @media (pointer: coarse) { .lg-btn { min-height: 44px; } .row { min-height: 44px; } }
    `,
  ],
})
export class HqRouteGraphicComponent {
  readonly steps = input.required<readonly RouteGraphStep[]>();
  /** Ord of the next open step (null = none). */
  readonly current = input<number | null>(null);
  /** The filter is remembered under this key (see `routeFilterKey`); without one it lives in this component only. */
  readonly filterKey = input<string | null>(null);
  readonly openLabel = input('?');
  readonly shared = input<readonly RouteSharedStop[]>([]);
  readonly sharedPick = output<RouteSharedStop>();

  protected readonly W = ROUTE_W;
  protected readonly H = ROUTE_H;
  protected readonly paths = STEP_ICON_PATHS;
  protected readonly wheels = TRANSPORT_WHEELS;
  protected readonly tray = NACHSCHUB_ICON_PATHS;

  private readonly store = inject(RouteFilterStore);
  private readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('svg');
  private readonly local = signal<ReadonlySet<StepKind>>(new Set());

  protected readonly legendOpen = signal(false);
  /** Zoom and pan (view box units). Fit = 1 / 0 / 0. */
  readonly zoom = signal(1);
  protected readonly tx = signal(0);
  protected readonly ty = signal(0);

  readonly hidden = computed<ReadonlySet<StepKind>>(() => {
    const key = this.filterKey();
    return key ? new Set(this.store.all()[key] ?? []) : this.local();
  });
  protected readonly hiddenCount = computed(() => this.kinds().filter((k) => this.hidden().has(k)).length);
  protected readonly kinds = computed(() => (this.steps().length ? kindsIn(this.steps()) : [...STEP_KINDS]));
  protected readonly layout = computed(() => layoutRoute(this.steps(), { hidden: this.hidden(), current: this.current(), openLabel: this.openLabel() }));
  protected readonly summary = computed(() => {
    const n = this.layout().nodes;
    return n.map((x) => x.name).join(', ');
  });
  protected readonly transform = computed(() => {
    const cx = ROUTE_W / 2;
    const cy = ROUTE_H / 2;
    return `translate(${cx + this.tx()} ${cy + this.ty()}) scale(${this.zoom()}) translate(${-cx} ${-cy})`;
  });

  private drag: { id: number; x: number; y: number } | null = null;

  protected badgeDone(ords: readonly number[]): boolean {
    const byOrd = new Map(this.steps().map((s) => [s.ord, s.state] as const));
    return ords.every((o) => byOrd.get(o) === 'done');
  }

  protected sharedFor(location: string): RouteSharedStop | null {
    if (!location) return null;
    const l = location.toLowerCase();
    return this.shared().find((s) => s.location.toLowerCase() === l) ?? null;
  }

  protected toggle(k: StepKind): void {
    const next = new Set(this.hidden());
    if (next.has(k)) next.delete(k);
    else next.add(k);
    const key = this.filterKey();
    if (key) this.store.set(key, next);
    else this.local.set(next);
  }

  fit(): void {
    this.zoom.set(1);
    this.tx.set(0);
    this.ty.set(0);
  }

  zoomBy(factor: number, at?: { x: number; y: number }): void {
    const z = this.zoom();
    const z2 = Math.min(ROUTE_ZOOM_MAX, Math.max(ROUTE_ZOOM_MIN, z * factor));
    if (z2 === z) return;
    if (at) {
      // Keep the point under the cursor where it is (view box coordinates).
      const cx = ROUTE_W / 2;
      const cy = ROUTE_H / 2;
      this.tx.set(this.clampPan(at.x - cx - (z2 * (at.x - cx - this.tx())) / z, z2, ROUTE_W));
      this.ty.set(this.clampPan(at.y - cy - (z2 * (at.y - cy - this.ty())) / z, z2, ROUTE_H));
    } else {
      this.tx.set(this.clampPan((this.tx() * z2) / z, z2, ROUTE_W));
      this.ty.set(this.clampPan((this.ty() * z2) / z, z2, ROUTE_H));
    }
    this.zoom.set(z2);
    if (z2 <= 1) this.fitIfNear();
  }

  private fitIfNear(): void {
    if (this.zoom() <= 1) {
      this.tx.set(this.clampPan(this.tx(), this.zoom(), ROUTE_W));
      this.ty.set(this.clampPan(this.ty(), this.zoom(), ROUTE_H));
    }
  }

  private clampPan(v: number, z: number, size: number): number {
    const max = (size * Math.max(z, 1)) / 2;
    return Math.min(max, Math.max(-max, v));
  }

  /** Pixels to view box units of the rendered svg (the box is fitted with "meet"). */
  private unit(): number {
    const el = this.svgRef()?.nativeElement;
    const w = el?.clientWidth || ROUTE_W;
    const h = el?.clientHeight || ROUTE_H;
    return 1 / Math.min(w / ROUTE_W, h / ROUTE_H);
  }

  protected onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const el = this.svgRef()?.nativeElement;
    let at: { x: number; y: number } | undefined;
    const ctm = el?.getScreenCTM?.();
    if (el && ctm) {
      const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
      at = { x: pt.x, y: pt.y };
    }
    this.zoomBy(ev.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, at);
  }

  protected onDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }

  protected onMove(ev: PointerEvent): void {
    if (!this.drag || this.drag.id !== ev.pointerId) return;
    const u = this.unit();
    this.tx.set(this.clampPan(this.tx() + (ev.clientX - this.drag.x) * u, this.zoom(), ROUTE_W));
    this.ty.set(this.clampPan(this.ty() + (ev.clientY - this.drag.y) * u, this.zoom(), ROUTE_H));
    this.drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  }

  protected onUp(ev: PointerEvent): void {
    if (this.drag?.id === ev.pointerId) this.drag = null;
  }

  protected onKey(ev: KeyboardEvent): void {
    if (ev.target !== ev.currentTarget) return;
    const step = 40;
    switch (ev.key) {
      case '+':
      case '=':
        this.zoomBy(ZOOM_STEP);
        break;
      case '-':
        this.zoomBy(1 / ZOOM_STEP);
        break;
      case '0':
        this.fit();
        break;
      case 'ArrowLeft':
        this.tx.set(this.clampPan(this.tx() + step, this.zoom(), ROUTE_W));
        break;
      case 'ArrowRight':
        this.tx.set(this.clampPan(this.tx() - step, this.zoom(), ROUTE_W));
        break;
      case 'ArrowUp':
        this.ty.set(this.clampPan(this.ty() + step, this.zoom(), ROUTE_H));
        break;
      case 'ArrowDown':
        this.ty.set(this.clampPan(this.ty() - step, this.zoom(), ROUTE_H));
        break;
      default:
        return;
    }
    ev.preventDefault();
  }
}
