import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { toErrorKey } from '../../core/describe-error';
import { logWarn } from '../../core/log';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { CodexService, type CodexKind } from '../codex.service';
import { HOLO_FALLBACK_ACCENT, parseRgbToken } from '../ship-hologram';
import { type Rgb, manufacturerAccent, rgbToken } from '../holo-manufacturer';
import { AssetPackageService } from './asset-package.service';
import type { PackageScene, ScreenPoint } from './asset-package-scene';
import { type LabelPlacement, type Rect, type Size, cycleId, placeLabel } from './holo-overlay';
import {
  type AssetPackageManifest,
  type AssetPackageRow,
  DEFAULT_GROUPS,
  type PackagePlacement,
  type PlacementGroup,
  availableGroups,
  focusedPlacementIds,
  hotspotPlacements,
  isFreeSlot,
  isPlaced,
  listPlacements,
  placementVisible,
  plausibleBounds,
  selectablePlacements,
} from './asset-package.model';

interface ItemRef {
  readonly kind: CodexKind;
  readonly name: string;
}

export interface PlacementRow {
  readonly p: PackagePlacement;
  readonly name: string;
  readonly link: readonly string[] | null;
  readonly visible: boolean;
  readonly free: boolean;
}

/** The component label beside the hull: the selected slot, where it sits, and the leader line to it. */
export interface ComponentLabel extends LabelPlacement {
  readonly row: PlacementRow;
  /** Empty slot (no component docked): the label names the port and what it accepts. */
  readonly empty: boolean;
}

/** Hover grace: the pointer may travel from a hotspot to the label without losing the selection. */
export const HOVER_GRACE_MS = 280;

/** Label size before the first measurement. */
const LABEL_SIZE_GUESS: Size = { w: 240, h: 56 };

/**
 * Displays one pre-built 3D asset package (ship, FPS weapon, item): root GLB +
 * shared part GLBs (+ the interior layer, lazily) composed with three.js in
 * the concept-hologram look, group and per-placement show/hide, hotspots that
 * x-ray the hull and light the hovered component in the manufacturer accent.
 * The selected slot gets a label outside the hull silhouette with a leader
 * line to it: it links to the component's codex page and steps to the other
 * slots. Lazy by construction: three is only reached through a dynamic import
 * of `asset-package-scene`.
 */
@Component({
  selector: 'sc-asset-package-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective],
  host: { '[style.--holo-mfr-rgb]': 'mfrRgb()' },
  template: `
    <div class="pkg" [class.xray]="focusIds().length > 0" [class.ready]="status() === 'ready'">
      <canvas #canvas class="stage" aria-hidden="true"></canvas>

      @if (status() === 'loading') {
        <p class="state" role="status">{{ 'codex.assetPackage.loading' | translate }}</p>
      } @else if (status() === 'error') {
        <div class="state err" role="alert">
          <p>{{ errorKey() | translate }}</p>
          <button type="button" class="sc-btn" (click)="retry()">{{ 'codex.assetPackage.retry' | translate }}</button>
        </div>
      }

      @if (status() === 'ready') {
        <div class="hotspots">
          @for (h of hotspots(); track h.p.id) {
            @if (h.link) {
              <a class="hs" [class.on]="focusSet().has(h.p.id)" [routerLink]="h.link"
                 [style.left.px]="h.x" [style.top.px]="h.y"
                 [scTooltip]="'codex.assetPackage.hotspotTip' | translate: tipParams(h)"
                 [attr.aria-label]="'codex.assetPackage.hotspotTip' | translate: tipParams(h)"
                 (mouseenter)="focus(h.p)" (mouseleave)="blur(h.p)" (focus)="focus(h.p)" (blur)="blur(h.p)"
                 (click)="onActivate($event)"></a>
            } @else {
              <span class="hs" tabindex="0" role="img" [class.on]="focusSet().has(h.p.id)"
                    [style.left.px]="h.x" [style.top.px]="h.y"
                    [scTooltip]="'codex.assetPackage.hotspotTip' | translate: tipParams(h)"
                    [attr.aria-label]="'codex.assetPackage.hotspotTip' | translate: tipParams(h)"
                    (mouseenter)="focus(h.p)" (mouseleave)="blur(h.p)" (focus)="focus(h.p)" (blur)="blur(h.p)"></span>
            }
          }
        </div>

        @if (label(); as l) {
          <!-- Leader line from the component (or the empty slot) to its label. -->
          <svg class="leader" aria-hidden="true">
            <line [attr.x1]="l.line.x1" [attr.y1]="l.line.y1" [attr.x2]="l.line.x2" [attr.y2]="l.line.y2" />
            <circle class="tip" [attr.cx]="l.line.x1" [attr.cy]="l.line.y1" r="3" />
          </svg>
          <div #labelBox class="clabel" role="group" [attr.data-side]="l.side" [class.empty]="l.empty"
               [style.left.px]="l.left" [style.top.px]="l.top"
               [attr.aria-label]="'codex.assetPackage.label.aria' | translate: { name: l.row.name }"
               (mouseenter)="holdLabel()" (mouseleave)="releaseLabel()"
               (focusin)="holdLabel()" (focusout)="releaseLabel()" (keydown.escape)="unpin()"
               (keydown.arrowleft)="step(-1)" (keydown.arrowright)="step(1)">
            @if (slotCount() > 1) {
              <button type="button" class="step" (click)="step(-1)"
                      [attr.aria-label]="'codex.assetPackage.label.prev' | translate"
                      [scTooltip]="'codex.assetPackage.label.prev' | translate" scTooltipTier="label">‹</button>
            }
            <div class="txt">
              @if (l.row.link) {
                <a class="nm" [routerLink]="l.row.link" (click)="onActivate($event)"
                   [attr.aria-label]="'codex.assetPackage.label.open' | translate: { name: l.row.name }">{{ l.row.name }}</a>
              } @else {
                <span class="nm">{{ l.empty ? ('codex.assetPackage.label.emptySlot' | translate) : l.row.name }}</span>
              }
              <span class="meta">{{ labelMeta(l) }}</span>
            </div>
            @if (slotCount() > 1) {
              <button type="button" class="step" (click)="step(1)"
                      [attr.aria-label]="'codex.assetPackage.label.next' | translate"
                      [scTooltip]="'codex.assetPackage.label.next' | translate" scTooltipTier="label">›</button>
            }
            @if (pinned()) {
              <button type="button" class="step close" (click)="unpin()"
                      [attr.aria-label]="'codex.assetPackage.label.close' | translate"
                      [scTooltip]="'codex.assetPackage.label.close' | translate" scTooltipTier="label">×</button>
            }
          </div>
        }

        <div class="bar" role="toolbar" [attr.aria-label]="'codex.assetPackage.groupsAria' | translate">
          @for (g of groups(); track g) {
            <button type="button" class="chip" [attr.aria-pressed]="groupsOn().has(g)" (click)="toggleGroup(g)">
              {{ 'codex.assetPackage.groups.' + g | translate }}
            </button>
          }
          @if (rows().length) {
            <button type="button" class="chip list-toggle" [attr.aria-expanded]="listOpen()" (click)="listOpen.set(!listOpen())">
              {{ 'codex.assetPackage.parts' | translate: { count: rows().length } }}
            </button>
          }
        </div>

        @if (listOpen()) {
          <ul class="plist">
            @for (r of rows(); track r.p.id) {
              <li [class.off]="!r.visible" [class.on]="focusSet().has(r.p.id)">
                @if (r.free) {
                  @if (placed(r.p)) {
                    <span class="free" tabindex="0" (mouseenter)="focus(r.p)" (mouseleave)="blur(r.p)"
                          (focus)="focus(r.p)" (blur)="blur(r.p)">{{ 'codex.assetPackage.freeSlot' | translate: { types: r.p.port?.types?.join(', ') ?? '' } }}</span>
                  } @else {
                    <span class="free">{{ 'codex.assetPackage.freeSlot' | translate: { types: r.p.port?.types?.join(', ') ?? '' } }}</span>
                  }
                } @else {
                  <button type="button" class="eye" [attr.aria-pressed]="!hidden().has(r.p.id)"
                          [attr.aria-label]="(hidden().has(r.p.id) ? 'codex.assetPackage.show' : 'codex.assetPackage.hide') | translate: { name: r.name }"
                          [scTooltip]="(hidden().has(r.p.id) ? 'codex.assetPackage.show' : 'codex.assetPackage.hide') | translate: { name: r.name }"
                          scTooltipTier="label"
                          (click)="togglePlacement(r.p.id)">{{ hidden().has(r.p.id) ? '○' : '●' }}</button>
                  @if (r.link) {
                    <a class="name" [routerLink]="r.link" (mouseenter)="focus(r.p)" (mouseleave)="blur(r.p)"
                       (focus)="focus(r.p)" (blur)="blur(r.p)" (click)="onActivate($event)">{{ r.name }}</a>
                  } @else {
                    <span class="name" tabindex="0" (mouseenter)="focus(r.p)" (mouseleave)="blur(r.p)"
                          (focus)="focus(r.p)" (blur)="blur(r.p)">{{ r.name }}</span>
                  }
                  <span class="meta">{{ 'codex.assetPackage.groups.' + r.p.group | translate }}@if (r.p.itemSize !== null) { · S{{ r.p.itemSize }} }</span>
                }
              </li>
            }
          </ul>
        }
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; position: relative; min-height: 18rem; --holo-mfr: rgb(var(--holo-mfr-rgb, var(--accent-primary-rgb))); }
      .pkg { position: relative; width: 100%; height: 100%; min-height: inherit; overflow: hidden; }
      .stage { display: block; width: 100%; height: 100%; min-height: inherit; touch-action: none; }
      .state {
        position: absolute; inset: 0; display: grid; place-content: center; gap: var(--sc-gap-2);
        text-align: center; color: var(--sc-fg-2); margin: 0;
      }
      .state.err { color: var(--sc-fg-1); }
      .hotspots { position: absolute; inset: 0; pointer-events: none; }
      .hs {
        position: absolute; width: 0.75rem; height: 0.75rem; margin: -0.375rem 0 0 -0.375rem;
        border-radius: 50%; border: 1px solid var(--sc-accent); background: rgb(from var(--sc-accent) r g b / 0.25);
        pointer-events: auto; transition: transform 0.15s ease, background 0.15s ease;
      }
      .hs::after { content: ''; position: absolute; inset: -0.75rem; border-radius: 50%; }
      .hs:hover, .hs:focus-visible, .hs.on { background: var(--sc-accent); transform: scale(1.35); outline: none; }
      .hs:focus-visible { box-shadow: 0 0 0 2px var(--sc-bg-0), 0 0 0 4px var(--sc-accent); }
      .leader { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
      .leader line { stroke: var(--holo-mfr); stroke-width: 1.25; stroke-dasharray: 4 3; opacity: 0.9; }
      .leader .tip { fill: var(--holo-mfr); }
      .clabel {
        position: absolute; display: flex; align-items: center; gap: var(--sc-gap-1);
        max-width: min(18rem, calc(100% - 1rem)); padding: var(--sc-pad-1);
        background: rgb(from var(--sc-bg-1) r g b / 0.9); border: 1px solid var(--sc-accent);
        border-radius: 0.375rem; box-shadow: 0 0 0.75rem rgb(from var(--sc-accent) r g b / 0.25);
        backdrop-filter: blur(4px);
      }
      .clabel .txt { display: grid; min-width: 0; padding: 0 var(--sc-pad-1); }
      .clabel .nm {
        color: var(--sc-fg-0); font-weight: 600; font-size: 0.875rem; text-decoration: none;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .clabel a.nm:hover { color: var(--sc-accent); text-decoration: underline; }
      .clabel .meta { color: var(--sc-fg-2); font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .clabel.empty .nm { color: var(--sc-fg-1); font-style: italic; font-weight: 500; }
      .step {
        flex: none; width: 2rem; height: 2rem; display: grid; place-items: center; padding: 0;
        border: 1px solid var(--sc-border); border-radius: 0.375rem; background: transparent;
        color: var(--sc-accent); font: inherit; font-size: 1rem; line-height: 1; cursor: pointer;
      }
      .step:hover { border-color: var(--sc-accent); }
      .clabel .nm:focus-visible, .step:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      @media (pointer: coarse) { .step { width: 3rem; height: 3rem; } }
      .bar {
        position: absolute; left: var(--sc-pad-2); right: var(--sc-pad-2); bottom: var(--sc-pad-2);
        display: flex; flex-wrap: wrap; gap: var(--sc-gap-1);
      }
      .chip {
        min-height: var(--sc-tap-min, 2.25rem); padding: 0 var(--sc-pad-2); border-radius: 999px;
        border: 1px solid var(--sc-border); background: rgb(from var(--sc-bg-1) r g b / 0.8);
        color: var(--sc-fg-2); font: inherit; font-size: 0.8125rem; cursor: pointer;
      }
      .chip[aria-pressed='true'], .chip[aria-expanded='true'] { border-color: var(--sc-accent); color: var(--sc-accent); }
      .chip:focus-visible, .eye:focus-visible, .name:focus-visible, .free:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .plist {
        position: absolute; top: var(--sc-pad-2); right: var(--sc-pad-2); bottom: 3.5rem;
        width: min(20rem, calc(100% - 2 * var(--sc-pad-2))); overflow: auto; margin: 0; padding: var(--sc-pad-1);
        list-style: none; background: rgb(from var(--sc-bg-1) r g b / 0.92); border: 1px solid var(--sc-border);
        border-radius: 0.5rem;
      }
      .plist li { display: flex; align-items: center; gap: var(--sc-gap-1); padding: 0.125rem 0; font-size: 0.8125rem; }
      .plist li.off .name { color: var(--sc-fg-2); text-decoration: line-through; }
      .plist li.on .name, .plist li.on .free { color: var(--sc-accent); }
      .eye {
        flex: none; width: 2rem; height: 2rem; border: 1px solid var(--sc-border); border-radius: 0.375rem;
        background: transparent; color: var(--sc-accent); cursor: pointer; font: inherit;
      }
      .name { flex: 1; min-width: 0; color: var(--sc-fg-0); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      a.name:hover { color: var(--sc-accent); }
      .meta { flex: none; color: var(--sc-fg-2); font-size: 0.75rem; }
      .free { color: var(--sc-fg-2); font-style: italic; padding-left: 2.5rem; }
      @media (prefers-reduced-motion: reduce) { .hs { transition: none; } }
    `,
  ],
})
export class AssetPackageViewerComponent {
  readonly row = input.required<AssetPackageRow>();
  /** Raw port names an outside list points at (hover on the holo stage's component list). */
  readonly activePorts = input<readonly string[]>([]);
  /** Reduced motion from the host page; the OS setting is honoured as well. */
  readonly still = input(false);

  /** A hotspot / list entry was hovered or focused: its raw port name, or null on leave. */
  readonly hovered = output<string[] | null>();
  /** Port names this package can show — drives the "locate" affordance in the host's list. */
  readonly locatable = output<string[]>();

  private readonly service = inject(AssetPackageService);
  private readonly codex = inject(CodexService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly labelBox = viewChild<ElementRef<HTMLElement>>('labelBox');

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorKey = signal('errors.generic');
  readonly manifest = signal<AssetPackageManifest | null>(null);
  readonly groupsOn = signal<ReadonlySet<PlacementGroup>>(new Set(DEFAULT_GROUPS));
  readonly hidden = signal<ReadonlySet<string>>(new Set());
  /** Hovered/focused placement (hotspot, list row, label). */
  readonly localFocus = signal<string | null>(null);
  /** Placement the label's step buttons selected; stays until closed or replaced. */
  readonly pinned = signal<string | null>(null);
  readonly listOpen = signal(false);
  /** `r, g, b` of the manufacturer accent (leader line), null = app accent. */
  readonly mfrRgb = signal<string | null>(null);
  private readonly items = signal<ReadonlyMap<string, ItemRef>>(new Map());
  private readonly points = signal<ReadonlyMap<string, ScreenPoint>>(new Map());
  private readonly silhouette = signal<Rect | null>(null);
  private readonly viewport = signal<Size>({ w: 0, h: 0 });
  private readonly labelSize = signal<Size>(LABEL_SIZE_GUESS);
  private readonly attempt = signal(0);

  private scene: PackageScene | null = null;
  private loadToken = 0;
  private interiorLoading = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly byId = computed(() => new Map((this.manifest()?.placements ?? []).map((p) => [p.id, p] as const)));
  readonly groups = computed(() => {
    const m = this.manifest();
    return m ? availableGroups(m) : [];
  });
  readonly visibleIds = computed(() => {
    const m = this.manifest();
    if (!m) return new Set<string>();
    const g = this.groupsOn();
    const h = this.hidden();
    const byId = this.byId();
    return new Set(m.placements.filter((p) => placementVisible(p, g, h, byId)).map((p) => p.id));
  });
  /** The slot the viewer itself points at: hover/focus first, else the pinned one. */
  readonly selectedId = computed(() => this.localFocus() ?? this.pinned());
  readonly focusIds = computed(() => {
    const m = this.manifest();
    return m ? focusedPlacementIds(m, this.selectedId(), this.activePorts()) : [];
  });
  readonly focusSet = computed(() => new Set(this.focusIds()));

  /** Slots the label steps through (visible, positioned, filled hotspot or empty port). */
  readonly slots = computed(() => {
    const m = this.manifest();
    if (!m) return [];
    const visible = this.visibleIds();
    return selectablePlacements(m).filter((p) => visible.has(p.id));
  });
  readonly slotCount = computed(() => this.slots().length);

  readonly rows = computed<PlacementRow[]>(() => {
    const m = this.manifest();
    if (!m) return [];
    const visible = this.visibleIds();
    return listPlacements(m).map((p) => this.toRow(p, visible.has(p.id)));
  });

  readonly hotspots = computed(() => {
    const m = this.manifest();
    if (!m) return [];
    const pts = this.points();
    const visible = this.visibleIds();
    const out: (PlacementRow & { x: number; y: number })[] = [];
    for (const p of hotspotPlacements(m)) {
      const pt = pts.get(p.id);
      if (!pt?.onScreen || !visible.has(p.id)) continue;
      out.push({ ...this.toRow(p, true), x: pt.x, y: pt.y });
    }
    return out;
  });

  /** The placement the label describes: the viewer's own selection, else the first one the host points at. */
  readonly labelTarget = computed<PackagePlacement | null>(() => {
    const id = this.selectedId() ?? this.focusIds()[0] ?? null;
    const p = id ? this.byId().get(id) : undefined;
    return p && isPlaced(p) ? p : null;
  });

  /** Label + leader line, laid out beside the projected hull and clamped to the viewer. */
  readonly label = computed<ComponentLabel | null>(() => {
    const p = this.labelTarget();
    const vp = this.viewport();
    if (!p || vp.w <= 0 || vp.h <= 0) return null;
    const pt = this.points().get(p.id);
    if (!pt) return null;
    const placement = placeLabel(pt, this.silhouette(), this.labelSize(), vp);
    return { ...placement, row: this.toRow(p, true), empty: !p.itemClass };
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.loadToken++;
      this.clearGrace();
      this.resizeObs?.disconnect();
      this.scene?.dispose();
      this.scene = null;
    });

    effect(() => {
      const row = this.row();
      this.attempt();
      untracked(() => void this.load(row));
    });
    effect(() => {
      const visible = this.visibleIds();
      const interiorOn = this.groupsOn().has('interior');
      untracked(() => {
        this.scene?.setVisibility(visible, interiorOn);
        if (interiorOn) void this.ensureInterior();
      });
    });
    effect(() => {
      const ids = this.focusIds();
      untracked(() => {
        this.scene?.setFocus(ids);
        this.reproject();
      });
    });
  }

  private resizeObs: ResizeObserver | null = null;

  private toRow(p: PackagePlacement, visible: boolean): PlacementRow {
    const ref = p.itemClass ? this.items().get(p.itemClass) : undefined;
    return {
      p,
      name: ref?.name || p.itemClass || p.portName,
      link: ref && p.itemClass ? ['/codex', ref.kind, p.itemClass] : null,
      visible,
      free: !p.itemClass && isFreeSlot(p),
    };
  }

  tipParams(r: PlacementRow): Record<string, string> {
    return {
      name: r.name,
      type: typeOf(r.p) || '–',
      size: r.p.itemSize === null ? '–' : String(r.p.itemSize),
    };
  }

  /** Second label line: size + type of a component; port name + accepted types of an empty slot. */
  labelMeta(l: ComponentLabel): string {
    const p = l.row.p;
    if (l.empty) {
      const types = p.port?.types?.join(', ') ?? '';
      const size = p.port?.maxSize !== null && p.port?.maxSize !== undefined ? `S${p.port.maxSize}` : '';
      return [p.portName, size, types].filter(Boolean).join(' · ');
    }
    return [p.itemSize !== null ? `S${p.itemSize}` : '', typeOf(p)].filter(Boolean).join(' · ');
  }

  placed(p: PackagePlacement): boolean {
    return isPlaced(p);
  }

  toggleGroup(g: PlacementGroup): void {
    const next = new Set(this.groupsOn());
    if (next.has(g)) next.delete(g);
    else next.add(g);
    this.groupsOn.set(next);
  }

  togglePlacement(id: string): void {
    const next = new Set(this.hidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.hidden.set(next);
  }

  focus(p: PackagePlacement): void {
    this.clearGrace();
    this.localFocus.set(p.id);
    this.hovered.emit([p.portName]);
  }

  /** Leaving a hotspot/row: the selection lingers briefly so the pointer can reach the label. */
  blur(p: PackagePlacement): void {
    if (this.localFocus() !== p.id) return;
    this.scheduleClear();
  }

  /** Pointer/focus entered the label: keep its slot selected. */
  holdLabel(): void {
    this.clearGrace();
  }

  /** Pointer/focus left the label. */
  releaseLabel(): void {
    if (this.localFocus()) this.scheduleClear();
  }

  /** Step to the previous/next slot (pins it, so it stays without hover). */
  step(dir: 1 | -1): void {
    const slots = this.slots();
    const current = this.labelTarget()?.id ?? null;
    const id = cycleId(
      slots.map((p) => p.id),
      current,
      dir,
    );
    const p = id ? this.byId().get(id) : undefined;
    if (!p) return;
    this.clearGrace();
    this.localFocus.set(null);
    this.pinned.set(p.id);
    this.hovered.emit([p.portName]);
  }

  /** Drop the pinned slot (close button / Escape). */
  unpin(): void {
    if (!this.pinned()) return;
    this.pinned.set(null);
    if (!this.localFocus()) this.hovered.emit(null);
  }

  /** The anchor navigates on its own; a plain left click also drops the x-ray before the route changes. */
  onActivate(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    this.clearGrace();
    this.localFocus.set(null);
    this.pinned.set(null);
  }

  retry(): void {
    this.attempt.update((n) => n + 1);
  }

  private scheduleClear(): void {
    this.clearGrace();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      if (!this.localFocus()) return;
      this.localFocus.set(null);
      this.hovered.emit(this.pinned() ? [this.byId().get(this.pinned()!)?.portName ?? this.pinned()!] : null);
    }, HOVER_GRACE_MS);
  }

  private clearGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  private reducedMotion(): boolean {
    return this.still() || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  private async load(row: AssetPackageRow): Promise<void> {
    const token = ++this.loadToken;
    this.status.set('loading');
    this.scene?.dispose();
    this.scene = null;
    this.interiorLoading = false;
    this.pinned.set(null);
    try {
      const m = await this.service.manifest(row.manifestSha256);
      if (token !== this.loadToken) return;
      const { PackageScene } = await import('./asset-package-scene');
      if (token !== this.loadToken) return;
      const base: Rgb =
        parseRgbToken(getComputedStyle(this.host.nativeElement).getPropertyValue('--accent-primary-rgb')) ??
        HOLO_FALLBACK_ACCENT;
      // Body in the app accent for every ship, accents in the manufacturer's colour.
      const accent = manufacturerAccent(row.shipId ?? row.entityClass, base);
      this.mfrRgb.set(rgbToken(accent));
      const scene = new PackageScene(this.canvas().nativeElement, base, accent, this.reducedMotion(), () =>
        this.reproject(),
      );
      this.scene = scene;
      this.observeSize(scene);

      const urls = this.service.urls;
      if (m.root) await scene.setRoot(await this.service.glb(urls.root(m.kind, m.root.sha256)));
      const shas = [...new Set(m.placements.filter((p) => p.partSha256 && p.position).map((p) => p.partSha256!))];
      // A single broken part must not take the whole package down.
      await Promise.all(
        shas.map(async (sha) => {
          try {
            await scene.addPart(sha, await this.service.glb(urls.part(sha)));
          } catch (err) {
            logWarn('asset-package', 'part failed', { sha, err });
          }
        }),
      );
      if (token !== this.loadToken) return;
      scene.place(m.placements);
      this.manifest.set(m);
      scene.setVisibility(this.visibleIds(), this.groupsOn().has('interior'));
      scene.frame(plausibleBounds(m.root?.bounds));
      scene.setFocus(this.focusIds());
      this.status.set('ready');
      this.locatable.emit(hotspotPlacements(m).map((p) => p.portName));
      void this.resolveItems(m);
    } catch (err) {
      if (token !== this.loadToken) return;
      this.errorKey.set(toErrorKey('asset-package', 'load', err, { manifest: row.manifestSha256 }));
      this.status.set('error');
    }
  }

  private async ensureInterior(): Promise<void> {
    const m = this.manifest();
    const scene = this.scene;
    if (!m?.interior || !scene || scene.hasInterior() || this.interiorLoading) return;
    this.interiorLoading = true;
    try {
      await scene.setInterior(await this.service.glb(this.service.urls.interior(m.interior.sha256)));
      scene.setVisibility(this.visibleIds(), this.groupsOn().has('interior'));
    } catch (err) {
      logWarn('asset-package', 'interior failed', { err });
    } finally {
      this.interiorLoading = false;
    }
  }

  private async resolveItems(m: AssetPackageManifest): Promise<void> {
    const classes = m.placements.map((p) => p.itemClass).filter((c): c is string => !!c);
    try {
      const res = await this.codex.resolveEntities(classes);
      const map = new Map<string, ItemRef>();
      for (const [cls, e] of res) map.set(cls, { kind: e.kind, name: e.nameLocalized ?? cls });
      this.items.set(map);
    } catch (err) {
      // Names and links are an enrichment; the model stays usable without them.
      logWarn('asset-package', 'resolve items failed', { err });
    }
  }

  private observeSize(scene: PackageScene): void {
    this.resizeObs?.disconnect();
    const el = this.canvas().nativeElement;
    const apply = () => scene.resize(el.clientWidth, el.clientHeight);
    apply();
    if (typeof ResizeObserver === 'function') {
      this.resizeObs = new ResizeObserver(apply);
      this.resizeObs.observe(el);
    }
  }

  /**
   * Per frame: hotspot and label anchors, the hull's screen rectangle, the
   * viewer and label sizes. Signals only change when a value did — the look
   * animates every frame, the camera mostly does not.
   */
  private reproject(): void {
    const m = this.manifest();
    const scene = this.scene;
    if (!m || !scene) return;
    const ids = hotspotPlacements(m).map((p) => p.id);
    const target = this.labelTarget();
    if (target && !ids.includes(target.id)) ids.push(target.id);
    const next = scene.project(ids);
    if (!samePoints(this.points(), next)) this.points.set(next);
    const sil = scene.silhouette();
    if (!sameRect(this.silhouette(), sil)) this.silhouette.set(sil);
    const el = this.canvas().nativeElement;
    const vp = { w: el.clientWidth, h: el.clientHeight };
    if (!sameSize(this.viewport(), vp)) this.viewport.set(vp);
    const box = this.labelBox()?.nativeElement;
    if (box) {
      const size = { w: box.offsetWidth, h: box.offsetHeight };
      if (size.w > 0 && !sameSize(this.labelSize(), size)) this.labelSize.set(size);
    }
  }
}

function typeOf(p: PackagePlacement): string {
  return [p.itemType, p.itemSubType].filter((t) => t && t !== 'UNDEFINED').join(' / ');
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

function samePoints(a: ReadonlyMap<string, ScreenPoint>, b: ReadonlyMap<string, ScreenPoint>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, p] of b) {
    const q = a.get(id);
    if (!q || q.onScreen !== p.onScreen || !near(q.x, p.x) || !near(q.y, p.y)) return false;
  }
  return true;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return near(a.left, b.left) && near(a.top, b.top) && near(a.right, b.right) && near(a.bottom, b.bottom);
}

function sameSize(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h;
}
