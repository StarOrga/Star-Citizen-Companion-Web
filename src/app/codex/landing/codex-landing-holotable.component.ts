import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

/** Hologram box inside the air (in % of the air): anchors convert through it. */
const BOX = { left: 27, width: 46, top: 5, height: 84 } as const;
/** Callout column: right edge of the text (in % of the air width). */
const CALL_RIGHT = 23;

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
  imports: [RouterLink, TranslatePipe, ScDialogDirective, ScTooltipDirective, ShipSkinViewerComponent, CodexCategoryIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()', '[class.paused]': 'paused()', '[class.lit]': '!!item()' },
  templateUrl: './codex-landing-holotable.component.html',
  styleUrl: './codex-landing-holotable.component.scss',
})
export class CodexLandingHolotableComponent {
  private readonly translate = inject(TranslateService);
  private readonly lang = this.translate.currentLang;

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
    const { callouts } = splitCallouts(it.category, it.topValues);
    const slots = slotsFor(callouts.length);
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
        at: scanPassAt(this.start(), c.anchor.y),
        path: `M ${CALL_RIGHT + 0.8} ${y} H ${CALL_RIGHT + 3} L ${ax.toFixed(2)} ${ay.toFixed(2)}`,
      };
    });
  });

  readonly visiblePaints = computed(() => {
    const list = this.paints();
    return this.allPaints() || list.length <= PAINT_CHIPS + 1 ? list : list.slice(0, PAINT_CHIPS);
  });
  readonly hiddenPaints = computed(() => this.paints().length - this.visiblePaints().length);
  readonly nameChars = computed(() => Math.max(4, this.item()?.name.length ?? 8));

  /** Hull parts of the Kennung, all after the scan has built the upper half. */
  readonly idAt = computed(() => scanPassAt(this.start(), 30));


  private readonly noHullTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
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

/** Vertical callout slots (% of the air), evenly over the hologram's height. */
function slotsFor(n: number): number[] {
  if (n <= 1) return [48];
  if (n === 2) return [36, 62];
  return [26, 48, 70];
}
