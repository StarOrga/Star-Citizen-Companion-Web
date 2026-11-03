import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ShipSkinViewerComponent } from '../ship-skin-viewer.component';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { LandingCategory, LandingItem, LandingPaint } from './codex-landing-data.types';
import { CalloutValue, ValueComparison, compareValue, splitCallouts, valueLabel, valueText } from './codex-landing-values';
import type { HardpointPortRef } from '../hardpoint-port-ref';
import { CodexLandingCalloutSetService, hasLoadoutSet, valuesForSet } from './codex-landing-callout-set.service';
import { CodexLandingSetToggleComponent } from './codex-landing-set-toggle.component';

/** How long a "no hull" answer of the viewer is doubted: its first emit precedes the skin catalog read. */
const NO_HULL_GRACE_MS = 3000;

/** Tiny etched glyph per rotation category (decorative, the label carries the meaning). */
export const CATEGORY_GLYPH: Record<LandingCategory, string> = {
  ship: '⛭',
  fpsWeapon: '✶',
  armor: '⛨',
  component: '◈',
  tool: '⚒',
};

/** Paint chips before the "+ N" chip (brief: show 3, then + N). */
export const PAINT_CHIPS = 3;

/**
 * Choreography (concept 2026-10-30-codex-holo-buehne, rounds 1–4), seconds.
 * First build: emitter ignites → beam extends → the scan disc rises out of the
 * emitter and the hologram exists only below it → name types → each callout
 * draws when the scan passes its anchor height. A switch: the scan descends
 * and erases the old hologram into the beam, the emitter pulses, a new scan
 * rises.
 */
export const HOLO_TIMING = {
  /** Scan start after the first item arrived (ignition + beam). */
  bootStart: 1.45,
  /** Scan start of a switch: after the erase ({@link erase}) and the emitter pulse. */
  switchStart: 1.05,
  /** Erase of the old hologram (the scan descends). */
  erase: 0.9,
  /** Build: the scan disc rises through the hologram box. */
  build: 1.5,
} as const;

/** Second at which the rising scan passes an anchor at `y` % of the hologram box (0 = top). */
export function scanPassAt(start: number, y: number, build = HOLO_TIMING.build): number {
  const t = 1 - Math.min(100, Math.max(0, y)) / 100;
  return Math.round((start + build * t) * 100) / 100;
}

/** Hologram box inside the air (in % of the air, centred on the emitter): anchors convert through it. Mirrors --hx/--hw/--ht/--hh. */
const BOX = { left: 30, width: 40, top: 14, height: 72 } as const;
/** Callout column: right edge of the text (in % of the air width). */
const CALL_RIGHT = 21;

interface CalloutView {
  key: string;
  label: string;
  text: string;
  cmp: ValueComparison | null;
  /** Vertical slot of the callout (% of the air). */
  y: number;
  /** Anchor on the hologram in air %. */
  ax: number;
  ay: number;
  /** Seconds after mount at which the scan passes the anchor. */
  at: number;
  path: string;
}

/**
 * The holotable of the Codex landing (concept 2026-10-30-codex-holo-buehne,
 * round 4 "Zugewandte Kante"): emitter + light beam, the item's hologram
 * built by a rising scan disc, three callouts with leader lines, the Kennung
 * (name, size facts, paint chips) top right of the object, and a table with a
 * metallic rim, glass disc, radar rings + sweep and the rotation progress in
 * the rim.
 *
 * Ships render through the ship page's own holo viewer (texture-free hull) —
 * never tinted by a paint: a paint chip opens that paint's RSI image beside
 * the Kennung. Everything without a 3D hull gets a holo-style icon silhouette.
 */
@Component({
  selector: 'sc-codex-landing-holotable',
  standalone: true,
  imports: [
    RouterLink,
    TranslatePipe,
    ScDialogDirective,
    ScTooltipDirective,
    ShipSkinViewerComponent,
    CodexCategoryIconComponent,
    CodexLandingSetToggleComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()', '[class.paused]': 'paused()', '[class.lit]': '!!item()' },
  templateUrl: './codex-landing-holotable.component.html',
  styleUrls: ['./codex-landing-holotable.component.scss', './codex-landing-holotable.table.scss'],
})
export class CodexLandingHolotableComponent {
  private readonly translate = inject(TranslateService);
  private readonly lang = this.translate.currentLang;
  private readonly calloutSet = inject(CodexLandingCalloutSetService);

  readonly item = input<LandingItem | null>(null);
  readonly paints = input<readonly LandingPaint[]>([]);
  readonly paused = input(false);
  readonly still = input(false);
  readonly loading = input(false);
  /** 0 = the first build of this visit (ignition); every later item is a switch. */
  readonly switchNo = input(0);
  /** Bumps on every rotation step: restarts the rim progress. */
  readonly cycle = input(0);
  readonly cycleMs = input(8000);
  /** A paint preview is open — the landing holds the rotation meanwhile. */
  readonly paintOpen = model(false);

  /** Ships whose viewer reported "no 3D hull": they fall back to the silhouette. */
  protected readonly no3d = signal<ReadonlySet<string>>(new Set());
  protected readonly allPaints = signal(false);
  protected readonly preview = signal<LandingPaint | null>(null);

  readonly key = computed(() => {
    const it = this.item();
    return it ? `${it.category}:${it.className}` : '';
  });
  readonly boot = computed(() => this.switchNo() === 0);
  /** Second at which the scan starts rising in this piece. */
  readonly start = computed(() => (this.still() ? 0 : this.boot() ? HOLO_TIMING.bootStart : HOLO_TIMING.switchStart));

  readonly callouts = computed<CalloutView[]>(() => {
    this.lang();
    const it = this.item();
    if (!it) return [];
    const set = this.calloutSet.set();
    const { callouts } = splitCallouts(it.category, valuesForSet(it, set));
    const slots = slotsFor(callouts.length);
    // A set switch on the shown item redraws at once (a short stagger), not
    // with the scan's timing. Bookkeeping only, no signal: the item key and the
    // set are both dependencies of this computed already.
    const key = this.key();
    if (key !== this.shown.key) this.shown = { key, set, switched: false };
    else if (set !== this.shown.set) this.shown = { key, set, switched: true };
    const switched = this.shown.switched;
    return callouts.map((c: CalloutValue, i) => {
      const ax = BOX.left + (c.anchor.x / 100) * BOX.width;
      const ay = BOX.top + (c.anchor.y / 100) * BOX.height;
      const y = slots[i];
      return {
        key: c.value.key,
        label: valueLabel(this.translate, c.value.key),
        text: valueText(c.value),
        cmp: compareValue(c.value),
        y,
        ax,
        ay,
        at: switched ? i * 0.08 : scanPassAt(this.start(), c.anchor.y),
        path: leaderPath(y, ax, ay),
      };
    });
  });

  /** The ship offers the Flug / Loadout switch (#884). */
  readonly canSwitch = computed(() => hasLoadoutSet(this.item()));
  /** The item the callouts were last built for and whether its set was switched since. */
  private shown: { key: string; set: string; switched: boolean } = { key: '', set: '', switched: false };

  readonly visiblePaints = computed(() => {
    const list = this.paints();
    return this.allPaints() || list.length <= PAINT_CHIPS + 1 ? list : list.slice(0, PAINT_CHIPS);
  });
  readonly hiddenPaints = computed(() => this.paints().length - this.visiblePaints().length);
  readonly nameChars = computed(() => Math.max(4, this.item()?.name.length ?? 8));

  /**
   * Ship callouts end at real hardpoints (cx-anchors): every candidate port of
   * the callout values goes to the viewer, which places the ones its glb has
   * a locator for as inert anchors and reports them back.
   */
  readonly anchorRefs = computed<HardpointPortRef[]>(() => {
    const it = this.item();
    if (!it || it.category !== 'ship' || !it.anchorPorts) return [];
    const keys = new Set(this.callouts().map((c) => c.key));
    const out: HardpointPortRef[] = [];
    for (const [key, ports] of Object.entries(it.anchorPorts)) {
      if (keys.has(key)) for (const port of ports) out.push({ port, label: key, itemName: null });
    }
    return out;
  });
  /** Ports the viewer could place on the model. */
  readonly located = signal<readonly string[]>([]);
  /** The viewer has answered for this item (or there is no 3D hull): unplaced anchors are now known to be zones. */
  private readonly locatedOnce = signal(false);
  /**
   * Loadout callouts (#884) whose part has no placeable mount: their dot sits on
   * the part type's hull zone, drawn as a dashed ring with "≈ Zone" in the label.
   */
  readonly zoneKeys = computed(() => {
    const it = this.item();
    if (!it || !(this.locatedOnce() || this.no3d().has(it.className))) return new Set<string>();
    const anchored = this.anchorPortOf();
    return new Set(this.callouts().filter((c) => c.key.startsWith('loadout.') && !anchored.has(c.key)).map((c) => c.key));
  });

  onLocated(ports: readonly string[]): void {
    this.located.set(ports);
    this.locatedOnce.set(true);
  }
  /** Callout key -> the hardpoint its leader line ends at; a callout without one keeps its hull zone. */
  readonly anchorPortOf = computed(() => {
    const it = this.item();
    const placed = new Set(this.located());
    const out = new Map<string, string>();
    for (const c of this.callouts()) {
      const hit = it?.anchorPorts?.[c.key]?.find((p) => placed.has(p));
      if (hit) out.set(c.key, hit);
    }
    return out;
  });

  /** Hull parts of the Kennung, all after the scan has built the upper half. */
  readonly idAt = computed(() => scanPassAt(this.start(), 30));


  private readonly noHullTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private anchorRaf = 0;

  constructor() {
    // A new item: the previous model's located ports no longer apply.
    effect(() => {
      this.key();
      untracked(() => {
        this.located.set([]);
        this.locatedOnce.set(false);
      });
    });
    // Leader lines follow their hardpoints while the hull turns: once per
    // frame, straight into the DOM (no change detection per frame).
    effect(() => {
      const anchored = this.anchorPortOf();
      const key = this.key();
      untracked(() => this.trackAnchors(anchored, key));
    });
    inject(DestroyRef).onDestroy(() => this.stopAnchors());
    // A new item: compact chips, no preview open.
    effect(() => {
      this.key();
      untracked(() => {
        this.allPaints.set(false);
        this.closePreview();
      });
    });
    inject(DestroyRef).onDestroy(() => this.noHullTimers.forEach((t) => clearTimeout(t)));
  }

  private stopAnchors(): void {
    if (this.anchorRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.anchorRaf);
    this.anchorRaf = 0;
  }

  private trackAnchors(anchored: ReadonlyMap<string, string>, key: string): void {
    this.stopAnchors();
    if (!anchored.size || !key || typeof requestAnimationFrame !== 'function') return;
    const slots = new Map(this.callouts().map((c) => [c.key, c.y]));
    const step = () => {
      this.anchorRaf = requestAnimationFrame(step);
      const air = this.host.querySelector<HTMLElement>('.air');
      const piece = air?.querySelector<HTMLElement>(`.piece[data-k="${cssEscape(key)}"]`);
      const viewer = piece?.querySelector('model-viewer') as (HTMLElement & { loaded?: boolean }) | null | undefined;
      if (!air || !piece || !viewer?.loaded) return;
      const box = air.getBoundingClientRect();
      for (const [callout, port] of anchored) {
        const el = piece.querySelector<HTMLElement>(`.hp-anchor[data-port="${cssEscape(port)}"]`);
        const pt = el ? anchorPoint(box, el.getBoundingClientRect()) : null;
        if (!pt) continue;
        const y = slots.get(callout) ?? pt.y;
        piece.querySelector(`.leaders path[data-key="${cssEscape(callout)}"]`)?.setAttribute('d', leaderPath(y, pt.x, pt.y));
        const dot = piece.querySelector<HTMLElement>(`.dot[data-key="${cssEscape(callout)}"]`);
        if (dot) {
          dot.style.left = `${pt.x}%`;
          dot.style.top = `${pt.y}%`;
        }
      }
    };
    this.anchorRaf = requestAnimationFrame(step);
  }

  label(cat: LandingCategory): string {
    return `codex.landing.category.${cat}`;
  }

  togglePaint(p: LandingPaint): void {
    if (this.preview()?.id === p.id) {
      this.closePreview();
      return;
    }
    this.preview.set(p);
    this.paintOpen.set(true);
  }

  closePreview(): void {
    this.preview.set(null);
    this.paintOpen.set(false);
  }

  /**
   * The viewer emits false at once (skin list still empty) and true when the
   * catalog arrives, so a false only counts as "no 3D hull" if no true
   * follows within the grace period.
   */
  onAvailable(className: string, available: boolean): void {
    const pending = this.noHullTimers.get(className);
    if (pending) clearTimeout(pending);
    if (available) {
      this.noHullTimers.delete(className);
      return;
    }
    this.noHullTimers.set(
      className,
      setTimeout(() => {
        this.noHullTimers.delete(className);
        this.no3d.update((s) => new Set([...s, className]));
      }, NO_HULL_GRACE_MS),
    );
  }
}

/** Leader line from the callout column (slot `y`) to an anchor, all in air %. */
export function leaderPath(y: number, ax: number, ay: number): string {
  const x = Math.max(CALL_RIGHT + 4, ax);
  return `M ${CALL_RIGHT + 0.8} ${y} H ${CALL_RIGHT + 3} L ${x.toFixed(2)} ${ay.toFixed(2)}`;
}

/**
 * Centre of a projected hardpoint anchor in % of the air, or null while it is
 * not laid out (model-viewer parks hotspots at 0x0 before the first frame) or
 * outside the air.
 */
export function anchorPoint(
  air: { left: number; top: number; width: number; height: number },
  el: { left: number; top: number; width: number; height: number },
): { x: number; y: number } | null {
  if (!(air.width > 0) || !(air.height > 0)) return null;
  if (el.left === 0 && el.top === 0 && el.width === 0 && el.height === 0) return null;
  const x = ((el.left + el.width / 2 - air.left) / air.width) * 100;
  const y = ((el.top + el.height / 2 - air.top) / air.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return null;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

function cssEscape(v: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Vertical callout slots (% of the air), evenly over the hologram's height. */
function slotsFor(n: number): number[] {
  if (n <= 1) return [50];
  if (n === 2) return [38, 62];
  return [30, 50, 70];
}
