import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { STEP_KINDS, STEP_SHAPES, ScStepComponent, type StepKind } from '../../../shared/step/sc-step.component';
import { MAP_CX, MAP_CY, MAP_H, MAP_W, colorSlots, layoutSystems, qtySize, type NodeView, type SystemView } from './hq-map-layout';
import type { MapNeed, MapPlace, PlanView, RouteStep } from './hq-map.types';

const MAX_GLYPHS = 4;

/**
 * Planen map (plan §4.6, D29): a schematic, one stage per system. The start
 * system is open, every other system is an accordion strip with its step count.
 * Shape = step kind (`STEP_SHAPES`, same as `sc-step`), size = amount, colour =
 * need (`colorKey`), fill = status; in "Wie" the route is numbered, travel legs
 * dashed, transport legs thick, the current step pulses (static under reduced
 * motion). Every place is a real button; on phones a list twin follows the map.
 * The map draws exactly the needs it gets — filtering is the plan's job (D27).
 */
@Component({
  selector: 'sc-hq-plan-map',
  standalone: true,
  imports: [TranslatePipe, ScStepComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-view]': 'view()' },
  template: `
    <section class="map" [attr.aria-label]="(view() === 'how' ? 'hq.map.routeTitle' : 'hq.map.title') | translate">
      @if (systems().length === 0) {
        <p class="empty">{{ 'hq.map.empty' | translate }}</p>
      }
      @for (sys of systems(); track sys.key) {
        <div class="sys" [class.open]="isOpen(sys)" [attr.data-system]="sys.key">
          <button type="button" class="strip" [attr.aria-expanded]="isOpen(sys)" (click)="toggle(sys)">
            <svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
            <b class="name">{{ sys.name }}</b>
            @if (sys.isStart) { <span class="tag">{{ 'hq.map.startHere' | translate }}</span> }
            <em class="count">{{ (sys.steps === 1 ? 'hq.map.stepsOne' : 'hq.map.steps') | translate: { n: sys.steps } }}</em>
          </button>
          @if (isOpen(sys)) {
            <div class="scroll">
              <div class="stage">
                <svg class="bg" [attr.viewBox]="'0 0 ' + w + ' ' + h" aria-hidden="true">
                  @for (p of sys.planets; track p.key) {
                    <ellipse class="orbit" [attr.cx]="cx" [attr.cy]="cy" [attr.rx]="p.rx" [attr.ry]="p.ry" />
                  }
                  <circle class="halo" [attr.cx]="cx" [attr.cy]="cy" r="26" />
                  <circle class="star" [attr.cx]="cx" [attr.cy]="cy" r="10" />
                  @for (p of sys.planets; track p.key) {
                    <circle class="planet" [attr.cx]="p.x" [attr.cy]="p.y" r="6" />
                    <text class="pl" [attr.x]="p.x" [attr.y]="p.y - 12">{{ p.name }}</text>
                  }
                  @if (view() === 'how') {
                    @for (l of sys.legs; track $index) {
                      <path class="leg" [class.transport]="l.leg === 'transport'" [attr.d]="l.d" />
                    }
                  }
                </svg>
                @for (n of sys.nodes; track n.place.id) {
                  <button type="button" class="node" [class.start]="n.isStart" [class.current]="isCurrent(n)"
                          [style.left.%]="(n.x / w) * 100" [style.top.%]="(n.y / h) * 100"
                          [attr.aria-label]="nodeLabel(n) | translate: nodeParams(n)"
                          (click)="placeSelected.emit(n.place)">
                    @if (view() === 'how' && n.ords.length) {
                      <span class="ord mono" aria-hidden="true">{{ n.ords.join('·') }}</span>
                    }
                    <span class="glyphs" aria-hidden="true">
                      @for (need of n.needs.slice(0, maxGlyphs); track need.id) {
                        <svg class="g" viewBox="0 0 24 24" [attr.data-kind]="need.kind" [attr.data-size]="size(need)"
                             [attr.data-status]="need.status" [attr.data-color]="slot(need)">
                          @if (shape(need.kind) === 'circle') {
                            <circle class="o" cx="12" cy="12" r="9" />
                            @if (need.status !== 'open') { <circle class="f" cx="12" cy="12" r="9" /> }
                          } @else {
                            <polygon class="o" [attr.points]="shape(need.kind)" />
                            @if (need.status !== 'open') { <polygon class="f" [attr.points]="shape(need.kind)" /> }
                          }
                        </svg>
                      }
                      @if (n.needs.length > maxGlyphs) { <span class="more mono">+{{ n.needs.length - maxGlyphs }}</span> }
                      @if (n.isStart && n.needs.length === 0) { <span class="you"></span> }
                    </span>
                    <span class="loc">{{ n.place.location }}</span>
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
      @if (unplaced() > 0) {
        <p class="unplaced">{{ 'hq.map.unplaced' | translate: { n: unplaced() } }}</p>
      }

      <div class="legend" role="group" [attr.aria-label]="'hq.map.legend.title' | translate">
        <div class="lg">
          <span class="lt">{{ 'hq.map.legend.shape' | translate }}</span>
          @for (k of kinds; track k) {
            <span class="li">
              <svg class="g" viewBox="0 0 24 24" data-size="s" data-status="open" aria-hidden="true">
                @if (shape(k) === 'circle') { <circle class="o" cx="12" cy="12" r="9" /> }
                @else { <polygon class="o" [attr.points]="shape(k)" /> }
              </svg>
              {{ 'hq.step.kind.' + k | translate }}
            </span>
          }
        </div>
        <div class="lg">
          <span class="lt">{{ 'hq.map.legend.size' | translate }}</span>
          @for (s of sizes; track s) {
            <span class="li">
              <svg class="g" viewBox="0 0 24 24" [attr.data-size]="s" data-status="done" aria-hidden="true">
                <polygon class="o" [attr.points]="shapes.craft" /><polygon class="f" [attr.points]="shapes.craft" />
              </svg>
              {{ 'hq.map.legend.size_' + s | translate }}
            </span>
          }
        </div>
        <div class="lg">
          <span class="lt">{{ 'hq.map.legend.fill' | translate }}</span>
          @for (st of statuses; track st) {
            <span class="li">
              <svg class="g" viewBox="0 0 24 24" data-size="s" [attr.data-status]="st" aria-hidden="true">
                <polygon class="o" [attr.points]="shapes.buy" />
                @if (st !== 'open') { <polygon class="f" [attr.points]="shapes.buy" /> }
              </svg>
              {{ 'hq.map.status.' + st | translate }}
            </span>
          }
        </div>
        <div class="lg">
          <span class="lt">{{ 'hq.map.legend.line' | translate }}</span>
          <span class="li"><svg class="ln" viewBox="0 0 28 8" aria-hidden="true"><path class="leg" d="M1 4H27" /></svg>{{ 'hq.map.legend.travel' | translate }}</span>
          <span class="li"><svg class="ln" viewBox="0 0 28 8" aria-hidden="true"><path class="leg transport" d="M1 4H27" /></svg>{{ 'hq.map.legend.transport' | translate }}</span>
        </div>
        @if (colors().length) {
          <div class="lg">
            <span class="lt">{{ 'hq.map.legend.colour' | translate }}</span>
            @for (c of colors(); track c.key) {
              <span class="li"><span class="sw" [attr.data-color]="c.slot" aria-hidden="true"></span>{{ c.label }}</span>
            }
          </div>
        }
      </div>

      <div class="twin">
        <h3 class="twin-h">{{ 'hq.map.listTwin' | translate }}</h3>
        @if (view() === 'how' && route()) {
          <ol class="twin-l" role="list">
            @for (s of route(); track s.ord) {
              <sc-step [kind]="s.kind" [label]="s.ord + '. ' + s.label" [location]="path(s.place)" />
            }
          </ol>
        } @else {
          @for (sys of systems(); track sys.key) {
            <h4 class="twin-s">{{ sys.name }}</h4>
            <ul class="twin-l" role="list">
              @for (need of sys.needs; track need.id) {
                <sc-step [kind]="need.kind" [label]="need.label" [qty]="need.qty" [location]="path(need.place)"
                         [state]="need.status === 'done' ? 'done' : 'todo'" />
              }
            </ul>
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        /* Six categorical need colours (D29 colour = need), tuned for the dark surface: equal
           lightness band, distinct hues, none of them red (red = elevated access). */
        --hq-need-0: #8fb8ff;
        --hq-need-1: #ffb380;
        --hq-need-2: #9fe07f;
        --hq-need-3: #ec8fd6;
        --hq-need-4: #f2d479;
        --hq-need-5: #a58bff;
      }
      .map { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .empty, .unplaced { margin: 0; color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
      .sys { border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-1); }
      .strip {
        display: flex; align-items: center; gap: var(--sc-space-3, 12px); width: 100%;
        padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 0; border-radius: 12px;
        background: transparent; color: var(--sc-fg-1); font: inherit; text-align: left; cursor: pointer;
      }
      .strip:hover { background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }
      .strip:focus-visible, .node:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .chev { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; transition: transform 160ms ease; }
      .sys.open .chev { transform: rotate(90deg); }
      .name { font-family: var(--sc-font-display); font-size: max(0.75rem, var(--sc-fs-floor)); letter-spacing: 0.16em; text-transform: uppercase; color: var(--sc-fg-0); }
      .tag { font-size: max(0.75rem, var(--sc-fs-floor)); color: var(--sc-accent); }
      .count { margin-left: auto; font-style: normal; color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .scroll { overflow-x: auto; padding: 0 var(--sc-space-2, 8px) var(--sc-space-2, 8px); }
      .stage { position: relative; min-width: 560px; aspect-ratio: 640 / 280; }
      .bg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
      .orbit { fill: none; stroke: color-mix(in srgb, var(--sc-accent) 16%, transparent); stroke-width: 1; }
      .halo { fill: color-mix(in srgb, var(--sc-warning) 14%, transparent); }
      .star { fill: var(--sc-warning); }
      .planet { fill: var(--sc-bg-3); stroke: color-mix(in srgb, var(--sc-accent) 50%, transparent); stroke-width: 1.2; }
      .pl { fill: var(--sc-fg-1); font-size: 11px; text-anchor: middle; }
      .leg { fill: none; stroke: var(--sc-accent); stroke-width: 1.6; stroke-dasharray: 5 4; opacity: 0.85; }
      .leg.transport { stroke-width: 4; stroke-dasharray: none; stroke-linecap: round; }
      .node {
        position: absolute; transform: translate(-50%, -50%);
        display: flex; flex-direction: column; align-items: center; gap: 2px;
        min-width: 32px; min-height: 32px; padding: 3px 5px; border: 1px solid transparent; border-radius: 8px;
        background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); color: var(--sc-fg-1); font: inherit; cursor: pointer;
      }
      .node:hover { border-color: color-mix(in srgb, var(--sc-accent) 55%, transparent); box-shadow: 0 0 10px color-mix(in srgb, var(--sc-accent) 30%, transparent); }
      .node.start { border-color: color-mix(in srgb, var(--sc-accent) 45%, transparent); }
      .node.current { border-color: var(--sc-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 30%, transparent); }
      @media (prefers-reduced-motion: no-preference) {
        .node.current { animation: hq-map-pulse 1.8s ease-in-out infinite; }
      }
      @keyframes hq-map-pulse {
        0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
        50% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--sc-accent) 0%, transparent); }
      }
      .glyphs { display: flex; align-items: center; gap: 2px; }
      .ord { padding: 0 4px; border-radius: 4px; background: var(--sc-accent); color: var(--sc-bg-0); font-size: 11px; font-weight: 700; line-height: 15px; }
      .loc { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-1); white-space: nowrap; }
      .more { font-size: 11px; color: var(--sc-fg-2); }
      .you { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--sc-accent); }
      .g { --c: var(--sc-accent); flex: none; overflow: visible; }
      .g[data-size='s'] { width: 14px; height: 14px; }
      .g[data-size='m'] { width: 19px; height: 19px; }
      .g[data-size='l'] { width: 25px; height: 25px; }
      .g .o { fill: none; stroke: var(--c); stroke-width: 2.2; stroke-linejoin: round; }
      .g .f { fill: var(--c); stroke: none; }
      .g[data-status='partial'] .f { clip-path: inset(50% 0 0 0); }
      [data-color='0'] { --c: var(--hq-need-0); }
      [data-color='1'] { --c: var(--hq-need-1); }
      [data-color='2'] { --c: var(--hq-need-2); }
      [data-color='3'] { --c: var(--hq-need-3); }
      [data-color='4'] { --c: var(--hq-need-4); }
      [data-color='5'] { --c: var(--hq-need-5); }
      .legend { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px) var(--sc-space-4, 16px); padding: var(--sc-space-2, 8px) var(--sc-space-1, 4px); font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
      .lg { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-1, 4px) var(--sc-space-3, 12px); }
      .lt { color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.08em; font-size: max(0.7rem, var(--sc-fs-floor)); }
      .li { display: inline-flex; align-items: center; gap: 5px; }
      .ln { width: 28px; height: 8px; overflow: visible; }
      .sw { width: 12px; height: 12px; border-radius: 3px; background: var(--c); }
      .twin { display: none; }
      .twin-h { margin: var(--sc-space-2, 8px) 0 0; font-size: max(0.85rem, var(--sc-fs-floor)); color: var(--sc-fg-0); }
      .twin-s { margin: var(--sc-space-2, 8px) 0 0; font-size: max(0.75rem, var(--sc-fs-floor)); letter-spacing: 0.12em; text-transform: uppercase; color: var(--sc-fg-2); }
      .twin-l { margin: 0; padding: 0; list-style: none; }
      @media (max-width: 719.98px) {
        .twin { display: block; }
      }
    `,
  ],
})
export class HqPlanMapComponent {
  readonly needs = input<readonly MapNeed[]>([]);
  readonly route = input<readonly RouteStep[] | null>(null);
  readonly view = input<PlanView>('what');
  /** Where the user starts (optional): its system is the open one; else the route's first or the busiest system. */
  readonly start = input<MapPlace | null>(null);
  /** The current route step ("Wie"); defaults to the first. */
  readonly currentOrd = input<number | null>(null);
  readonly placeSelected = output<MapPlace>();

  protected readonly w = MAP_W;
  protected readonly h = MAP_H;
  protected readonly cx = MAP_CX;
  protected readonly cy = MAP_CY;
  protected readonly maxGlyphs = MAX_GLYPHS;
  protected readonly kinds = STEP_KINDS;
  protected readonly shapes = STEP_SHAPES;
  protected readonly sizes = ['s', 'm', 'l'] as const;
  protected readonly statuses = ['open', 'partial', 'done'] as const;

  /** Systems whose open state the user flipped (start system: closed; others: open). */
  private readonly flipped = signal<ReadonlySet<string>>(new Set());

  protected readonly systems = computed<SystemView[]>(() =>
    layoutSystems(this.needs(), this.view() === 'how' ? this.route() : null, this.start()),
  );
  private readonly slots = computed(() => colorSlots(this.needs()));
  protected readonly colors = computed(() => {
    const seen = new Map<string, { key: string; slot: number; label: string }>();
    for (const n of this.needs()) {
      if (!seen.has(n.colorKey)) seen.set(n.colorKey, { key: n.colorKey, slot: this.slots().get(n.colorKey)!, label: n.colorLabel ?? n.colorKey });
    }
    return [...seen.values()];
  });
  protected readonly unplaced = computed(() => this.needs().filter((n) => !n.place).length);
  private readonly current = computed(() => this.currentOrd() ?? this.route()?.[0]?.ord ?? null);

  protected isOpen(sys: SystemView): boolean {
    return sys.isStart !== this.flipped().has(sys.key);
  }

  protected toggle(sys: SystemView): void {
    const next = new Set(this.flipped());
    if (next.has(sys.key)) next.delete(sys.key);
    else next.add(sys.key);
    this.flipped.set(next);
  }

  protected isCurrent(n: NodeView): boolean {
    const c = this.current();
    return this.view() === 'how' && c !== null && n.ords.includes(c);
  }

  protected shape(kind: StepKind): string {
    return STEP_SHAPES[kind];
  }

  protected size(n: MapNeed): string {
    return qtySize(n.qty);
  }

  protected slot(n: MapNeed): number {
    return this.slots().get(n.colorKey) ?? 0;
  }

  protected path(p: MapPlace | null): string | null {
    return p ? [p.system, p.planet, p.location].filter(Boolean).join(' › ') : null;
  }

  protected nodeLabel(n: NodeView): string {
    if (n.needs.length === 0) return 'hq.map.node.start';
    return this.view() === 'how' && n.ords.length ? 'hq.map.node.step' : 'hq.map.node.needs';
  }

  protected nodeParams(n: NodeView): Record<string, string | number> {
    return {
      place: n.place.location,
      path: this.path(n.place) ?? '',
      needs: n.needs.map((x) => `${x.label} ×${x.qty}`).join(', '),
      ords: n.ords.join(', '),
      count: n.needs.length,
    };
  }
}
