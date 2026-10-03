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
import { currentHoloVariant } from '../holo-variant';
import { AssetPackageService } from './asset-package.service';
import type { PackageScene, ScreenPoint } from './asset-package-scene';
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
  listPlacements,
  placementVisible,
  plausibleBounds,
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

/**
 * Displays one pre-built 3D asset package (ship, FPS weapon, item): root GLB +
 * shared part GLBs (+ the interior layer, lazily) composed with three.js,
 * hologram look, group and per-placement show/hide, hotspots that x-ray the
 * hull and render the hovered component solid. Lazy by construction: three is
 * only reached through a dynamic import of `asset-package-scene`.
 */
@Component({
  selector: 'sc-asset-package-viewer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, ScTooltipDirective],
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
                  <span class="free">{{ 'codex.assetPackage.freeSlot' | translate: { types: r.p.port?.types?.join(', ') ?? '' } }}</span>
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
      :host { display: block; position: relative; min-height: 18rem; }
      .pkg { position: relative; width: 100%; height: 100%; min-height: inherit; }
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
      .chip:focus-visible, .eye:focus-visible, .name:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .plist {
        position: absolute; top: var(--sc-pad-2); right: var(--sc-pad-2); bottom: 3.5rem;
        width: min(20rem, calc(100% - 2 * var(--sc-pad-2))); overflow: auto; margin: 0; padding: var(--sc-pad-1);
        list-style: none; background: rgb(from var(--sc-bg-1) r g b / 0.92); border: 1px solid var(--sc-border);
        border-radius: 0.5rem;
      }
      .plist li { display: flex; align-items: center; gap: var(--sc-gap-1); padding: 0.125rem 0; font-size: 0.8125rem; }
      .plist li.off .name { color: var(--sc-fg-2); text-decoration: line-through; }
      .plist li.on .name { color: var(--sc-accent); }
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

  readonly status = signal<'loading' | 'ready' | 'error'>('loading');
  readonly errorKey = signal('errors.generic');
  readonly manifest = signal<AssetPackageManifest | null>(null);
  readonly groupsOn = signal<ReadonlySet<PlacementGroup>>(new Set(DEFAULT_GROUPS));
  readonly hidden = signal<ReadonlySet<string>>(new Set());
  readonly localFocus = signal<string | null>(null);
  readonly listOpen = signal(false);
  private readonly items = signal<ReadonlyMap<string, ItemRef>>(new Map());
  private readonly points = signal<ReadonlyMap<string, ScreenPoint>>(new Map());
  private readonly attempt = signal(0);

  private scene: PackageScene | null = null;
  private loadToken = 0;
  private interiorLoading = false;

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
  readonly focusIds = computed(() => {
    const m = this.manifest();
    return m ? focusedPlacementIds(m, this.localFocus(), this.activePorts()) : [];
  });
  readonly focusSet = computed(() => new Set(this.focusIds()));

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

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      this.loadToken++;
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
      untracked(() => this.scene?.setFocus(ids));
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
      type: [r.p.itemType, r.p.itemSubType].filter((t) => t && t !== 'UNDEFINED').join(' / ') || '–',
      size: r.p.itemSize === null ? '–' : String(r.p.itemSize),
    };
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
    this.localFocus.set(p.id);
    this.hovered.emit([p.portName]);
  }

  blur(p: PackagePlacement): void {
    if (this.localFocus() !== p.id) return;
    this.localFocus.set(null);
    this.hovered.emit(null);
  }

  /** The anchor navigates on its own; a plain left click also drops the x-ray before the route changes. */
  onActivate(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.localFocus.set(null);
  }

  retry(): void {
    this.attempt.update((n) => n + 1);
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
    try {
      const m = await this.service.manifest(row.manifestSha256);
      if (token !== this.loadToken) return;
      const { PackageScene } = await import('./asset-package-scene');
      if (token !== this.loadToken) return;
      const accent =
        parseRgbToken(getComputedStyle(this.host.nativeElement).getPropertyValue('--accent-primary-rgb')) ??
        HOLO_FALLBACK_ACCENT;
      const scene = new PackageScene(
        this.canvas().nativeElement,
        accent,
        this.reducedMotion(),
        () => this.reproject(),
        currentHoloVariant(),
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

  private reproject(): void {
    const m = this.manifest();
    if (!m || !this.scene) return;
    this.points.set(this.scene.project(hotspotPlacements(m).map((p) => p.id)));
  }
}
