import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { ResolvedEntity, fpsArmorSlot, pickLocalized, toLang } from '../codex.service';
import { cleanLocaleValue, formatNumber, humanizeClassName } from '../codex-format';
import { EntityPayloadEntry, armorSlotsFromLoadout } from '../codex-landing-kpi';
import { CodexBoardFigureComponent } from '../codex-board-figure.component';
import { FIGURE_ASPECT } from '../codex-board-suit';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { CodexStageComponent } from '../stage/codex-stage.component';
import { HangarPickerItem } from '../stage/hangar-picker.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { ArmorRatingRow, SetLensId, lensValueFor } from './set-rating';
import { setReadiness } from './set-readiness';
import { ARM_TTL_MS, SET_SLOT_TRANSITION_NAME, SetArsenalTransition, nameForTransition } from './set-arsenal-transition';

/** Which column a slot's tile sits in — the figure's default anchor side, so a line never crosses the body. */
const LEFT_SLOTS = ['helmet', 'core', 'arms'] as const;
const RIGHT_SLOTS = ['backpack', 'legs', 'undersuit'] as const;

/** Length of the horizontal elbow a leader line leaves its tile with, in px. */
const ELBOW_PX = 16;

/** One armour tile as the stage renders it. */
export interface SetStageTile {
  slot: string;
  labelKey: string;
  attachType: string;
  side: 'left' | 'right';
  filled: boolean;
  className: string | null;
  /** Localized item name; '' for an open slot. */
  name: string;
  /** "N im Arsenal" for an open slot; null when unknown or filled. */
  archiveCount: string | null;
  /** The arsenal, filtered to this slot, with the equip intent for this set. */
  query: Record<string, string>;
  /** The active lens' readout for this piece, when the lens has one. */
  lens: { text: string; warn: boolean } | null;
}

/** One permanent leader line, in stage pixels. */
export interface SetStageLine {
  slot: string;
  points: string;
  cx: number;
  cy: number;
  open: boolean;
}

/**
 * The set page's masthead stage (concept 2026-09-26 "Set-Seite Doppelungen",
 * round 3, design C1 "ausgebaut" — AUD-065). ONE figure on the page: the
 * `sc-codex-stage kind="person"` frame (set picker, role + "Rüstung n/6", set
 * name) carries the 3D figure in its centre with the six armour slots as
 * tiles around it, each joined to its body part by a permanent leader line.
 * The six-slot board panel that used to repeat figure, name and role below
 * the hero is gone; its per-slot data lives on here.
 *
 * Geometry: the figure reports its part anchors as fractions of its own box
 * (width = host width, height = width / FIGURE_ASPECT). The stage measures the
 * figure host and every tile relative to `.rig` (ResizeObserver on both) and
 * draws the lines in rig pixels: from the tile's inner edge a short horizontal
 * elbow, then straight to the anchor, ending in a dot. Below ~700px of
 * container width the lines go and the tiles become a two-column list under
 * the figure.
 */
@Component({
  selector: 'sc-codex-set-stage',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslatePipe,
    CodexStageComponent,
    CodexBoardFigureComponent,
    CodexCategoryIconComponent,
    ScTooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-codex-stage
      class="hero"
      kind="person"
      [eyebrow]="roleLabel()"
      [eyebrowSuffix]="equipSuffix()"
      [title]="set().name"
      pickerKind="set"
      [pickerItems]="pickerItems()"
      (pick)="pick.emit($event)"
      (open)="open.emit()"
    >
      <div stageOverlay class="rig" #rig>
        <div class="rdy" role="list" [attr.aria-label]="'codex.set.stage.readinessAria' | translate">
          @for (r of readiness(); track r.key) {
            <!-- role=img + label: the state must not live in a hover-only tooltip. -->
            <span class="rdy-ic" role="listitem" [class.on]="r.ok"
                  [attr.aria-label]="(r.labelKey | translate) + ' — ' + (r.stateKey | translate)"
                  [scTooltip]="(r.labelKey | translate) + ' — ' + (r.stateKey | translate)" scTooltipTier="label">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="r.icon" /></svg>
            </span>
          }
        </div>

        <svg class="leads" aria-hidden="true">
          @for (l of lines(); track l.slot) {
            <polyline class="lead" [class.open]="l.open" [class.lit]="lit() === l.slot"
                      [attr.data-slot]="l.slot" [attr.points]="l.points" />
            <circle class="dot" [class.open]="l.open" [class.lit]="lit() === l.slot"
                    [attr.data-slot]="l.slot" [attr.cx]="l.cx" [attr.cy]="l.cy" r="3.6" />
          }
        </svg>

        <div class="doll">
          <div class="col left" role="group" [attr.aria-label]="'codex.set.stage.slotsAria' | translate">
            @for (t of leftTiles(); track t.slot) {
              <ng-container *ngTemplateOutlet="tileTpl; context: { $implicit: t }" />
            }
          </div>
          <div class="fig-wrap">
            <sc-codex-board-figure
              class="fig"
              [filled]="filled()"
              [decorative]="true"
              [interactive]="true"
              [highlight]="lit()"
              (partHover)="partHovered.set($event)"
            />
          </div>
          <div class="col right" role="group" [attr.aria-label]="'codex.set.stage.slotsAria' | translate">
            @for (t of rightTiles(); track t.slot) {
              <ng-container *ngTemplateOutlet="tileTpl; context: { $implicit: t }" />
            }
          </div>
        </div>
      </div>
    </sc-codex-stage>

    <ng-template #tileTpl let-t>
      <a
        #tile
        class="tile"
        [class.left]="t.side === 'left'"
        [class.open]="!t.filled"
        [class.lit]="lit() === t.slot"
        [attr.data-slot]="t.slot"
        [routerLink]="['/codex', 'fps']"
        [queryParams]="t.query"
        [scTooltip]="t.labelKey | translate"
        scTooltipTier="label"
        [style.view-transition-name]="transition.isLandingOn(t.slot, 'toSet') ? transitionName : null"
        (pointerenter)="hoveredTile.set(t.slot)"
        (pointerleave)="leaveTile(t.slot)"
        (focus)="hoveredTile.set(t.slot)"
        (blur)="leaveTile(t.slot)"
        (click)="onTileClick($event, t.slot, tile)"
      >
        <span class="ic" aria-hidden="true"><sc-codex-icon kind="item" [attachType]="t.attachType" /></span>
        <span class="txt">
          <!-- The slot's name is the tooltip; assistive tech gets it as text. -->
          <span class="sr">{{ t.labelKey | translate }}: </span>
          @if (t.filled) {
            <span class="name">{{ t.name }}</span>
          } @else {
            <span class="name free">
              {{ 'codex.set.stage.free' | translate }}
              @if (t.archiveCount) {
                <span class="count">· {{ 'codex.landing.board.archiveCount' | translate: { count: t.archiveCount } }}</span>
              }
            </span>
            <span class="cta">{{ 'codex.set.equipInArchive' | translate }} <span aria-hidden="true">→</span></span>
          }
          @if (t.lens) {
            <span class="lens" [class.warn]="t.lens.warn">
              {{ t.lens.text }}
              @if (t.lens.warn) {
                <span class="sr"> — {{ 'codex.set.stage.lensLimits' | translate }}</span>
              }
            </span>
          }
        </span>
      </a>
    </ng-template>
  `,
  styles: [
    `
      /* --tint = equipped, --idle = open (the codex vocabulary the board panel
         carried); the accent is only ever the two-way highlight. */
      :host {
        display: block;
        min-width: 0;
        container: setstage / inline-size;
        --tint: var(--sc-warning);
        --idle: var(--sc-idle);
        --idle-bg: var(--sc-idle-bg);
      }
      .hero {
        display: block;
        height: 420px;
        border-radius: 4px;
        overflow: hidden;
        border: 1px solid var(--sc-border);
        --stage-halo-x: 50%;
      }
      /* N5: 30px title on the set page's hero; no archive line here. */
      .hero ::ng-deep .stage-title { font-size: 30px; }
      .hero ::ng-deep .stage-archive { display: none; }
      /* A long set name wraps before it runs under the right tile column. */
      .hero ::ng-deep .stage-text { max-width: calc(50% - 120px); }

      .rig { position: absolute; inset: 0; pointer-events: none; }

      .rdy { position: absolute; top: 12px; right: 16px; z-index: 1; display: flex; gap: 5px; pointer-events: auto; }
      .rdy-ic {
        width: 26px; height: 26px; border-radius: 5px;
        display: flex; align-items: center; justify-content: center;
        border: 1px solid var(--idle); background: var(--idle-bg); color: var(--idle);
      }
      .rdy-ic svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; }
      .rdy-ic.on {
        border-color: var(--tint);
        background: color-mix(in srgb, var(--tint) 15%, transparent);
        color: var(--tint);
        box-shadow: 0 0 11px color-mix(in srgb, var(--tint) 32%, transparent);
      }

      .leads { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
      .lead { fill: none; stroke: color-mix(in srgb, var(--tint) 60%, transparent); stroke-width: 1.2; }
      .lead.open { stroke: color-mix(in srgb, var(--idle) 80%, var(--sc-fg-0)); stroke-dasharray: 4 3; }
      .dot { fill: var(--tint); stroke: var(--tint); stroke-width: 1.2; }
      .dot.open { fill: var(--sc-bg-0); stroke: color-mix(in srgb, var(--idle) 80%, var(--sc-fg-0)); }
      .lead.lit { stroke: var(--sc-accent); stroke-width: 1.6; }
      .dot.lit { fill: var(--sc-accent); stroke: var(--sc-accent); }
      .dot.open.lit { fill: var(--sc-bg-0); }

      .doll {
        position: absolute;
        left: 50%;
        top: 52px;
        bottom: 36px;
        width: min(640px, calc(100% - 32px));
        transform: translateX(-50%);
        display: grid;
        grid-template-columns: minmax(0, 1fr) 168px minmax(0, 1fr);
        column-gap: 36px;
      }
      .col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
      .col.right { justify-content: space-between; padding-top: 24px; }
      .fig-wrap { display: flex; align-items: center; justify-content: center; min-width: 0; }
      /* An explicit width: the anchors are fractions of this box. */
      .fig { width: 168px; pointer-events: auto; }

      .tile {
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        min-height: max(52px, var(--sc-tap-min, 0px));
        box-sizing: border-box;
        padding: 6px 10px;
        border: 1px solid color-mix(in srgb, var(--tint) 32%, var(--sc-border));
        border-radius: 4px;
        background: color-mix(in srgb, var(--sc-bg-0) 74%, transparent);
        color: var(--sc-fg-0);
        text-decoration: none;
      }
      .tile.open { border-style: dashed; border-color: color-mix(in srgb, var(--idle) 80%, var(--sc-border)); }
      .tile:hover, .tile:focus-visible, .tile.lit {
        border-color: var(--sc-accent);
        background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0));
      }
      .tile:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .ic { flex: none; width: 28px; height: 28px; display: inline-flex; --sc-icon-max: 20px; }
      .ic sc-codex-icon { width: 100%; height: 100%; }
      .tile.open .ic { opacity: 0.6; }
      .txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
      .name { font-size: max(0.82rem, var(--sc-fs-floor, 0.7rem)); line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .name.free { color: color-mix(in srgb, var(--idle) 62%, var(--sc-fg-0)); font-style: italic; }
      .count { font-style: normal; color: var(--sc-fg-2); }
      .cta { color: var(--sc-accent); font-size: max(0.72rem, var(--sc-fs-floor, 0.7rem)); }
      .lens { color: var(--sc-fg-2); font-size: max(0.72rem, var(--sc-fs-floor, 0.7rem)); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lens.warn { color: var(--sc-warning); }
      .sr {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
      }

      /* Phone / narrow column: no lines, the figure centred, the six tiles as
         a two-column list under it. The stage grows to its content; the bottom
         padding keeps the set name (bottom-left in the stage) clear. */
      @container setstage (max-width: 699px) {
        .hero { height: auto; }
        .hero ::ng-deep .stage-overlay { position: relative; inset: auto; }
        /* With the overlay in the flow, the stage's set picker would follow it to
           the bottom edge and vanish under overflow:hidden — pin it to the top-left
           corner as on every wider stage; the rig starts below that row. */
        .hero ::ng-deep .stage-picker { position: absolute; top: 12px; left: 12px; }
        .hero ::ng-deep .stage-text { max-width: none; right: 24px; }
        .rig { position: relative; padding: 56px 12px 112px; }
        .rdy { top: 12px; right: 12px; flex-wrap: wrap; justify-content: flex-end; max-width: 50%; }
        .leads { display: none; }
        .doll {
          position: static;
          transform: none;
          width: auto;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .col { display: contents; }
        .fig-wrap { grid-column: 1 / -1; order: -1; margin-bottom: 8px; }
        .fig { width: 120px; }
      }
    `,
  ],
})
export class CodexSetStageComponent {
  private readonly t = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  readonly transition = inject(SetArsenalTransition);
  readonly transitionName = SET_SLOT_TRANSITION_NAME;

  /** The set on screen. */
  readonly set = input.required<HangarRoleLoadout>();
  /** Names for everything the set carries. */
  readonly resolved = input<Map<string, ResolvedEntity>>(new Map());
  /** Payloads — the readiness class lives in subType. */
  readonly payloads = input<Map<string, EntityPayloadEntry>>(new Map());
  /** How many candidates the archive holds per still-open attach type. */
  readonly archiveDepth = input<Map<string, number>>(new Map());
  /** Rating rows of the equipped armour; null = not (yet) available. */
  readonly ratingRows = input<ArmorRatingRow[] | null>(null);
  /** The Einsatz lens; anything but 'all' adds a readout line to every tile. */
  readonly lens = input<SetLensId>('all');
  readonly pickerItems = input<readonly HangarPickerItem[]>([]);

  readonly pick = output<string>();
  readonly open = output<void>();

  /** UI language — re-derived on every language switch. */
  private readonly lang = signal(toLang(this.t.getCurrentLang()));

  /** Tile under the pointer or keyboard focus. */
  readonly hoveredTile = signal<string | null>(null);
  /** Body part under the pointer (figure hit zones). */
  readonly partHovered = signal<string | null>(null);
  /** The one slot lit on figure, line, dot and tile — the tile wins over the figure. */
  readonly lit = computed(() => this.hoveredTile() ?? this.partHovered());

  readonly roleLabel = computed(() => this.t.instant('hangar.roles.' + this.set().role));
  readonly equipSuffix = computed(
    () => '· ' + this.t.instant('codex.stage.armorEquipped', { filled: this.filled().size, total: 6 }),
  );

  readonly tiles = computed<SetStageTile[]>(() => {
    const set = this.set();
    const resolved = this.resolved();
    const depth = this.archiveDepth();
    const rows = this.ratingRows() ?? [];
    const lens = this.lens();
    const lang = this.lang();
    return armorSlotsFromLoadout(set.items).map((s) => {
      const side: 'left' | 'right' = (LEFT_SLOTS as readonly string[]).includes(s.roleSlot) ? 'left' : 'right';
      const query: Record<string, string> = { cat: 'armor', slot: fpsArmorSlot(s.attachType) ?? '', equipInto: set.id };
      if (!s.className) {
        const count = depth.get(s.attachType);
        return {
          slot: s.roleSlot, labelKey: s.labelKey, attachType: s.attachType, side,
          filled: false, className: null, name: '',
          archiveCount: count != null ? formatNumber(count) : null,
          query, lens: null,
        };
      }
      const entity = resolved.get(s.className);
      const name =
        pickLocalized(entity?.name, lang) || cleanLocaleValue(entity?.nameLocalized) || humanizeClassName(s.className);
      const row = rows.find((r) => r.className === s.className);
      return {
        slot: s.roleSlot, labelKey: s.labelKey, attachType: s.attachType, side,
        filled: true, className: s.className, name, archiveCount: null, query,
        lens: lens === 'all' ? null : lensValueFor(row, lens, rows, lang),
      };
    });
  });
  readonly leftTiles = computed(() => orderBy(this.tiles(), LEFT_SLOTS));
  readonly rightTiles = computed(() => orderBy(this.tiles(), RIGHT_SLOTS));

  readonly filled = computed<ReadonlySet<string>>(
    () => new Set(this.tiles().filter((t) => t.filled).map((t) => t.slot)),
  );

  readonly readiness = computed(() => setReadiness(this.set().items, this.payloads(), this.set().role));

  /** The leader lines, measured after render. */
  readonly lines = signal<SetStageLine[]>([]);

  private readonly rigEl = viewChild<ElementRef<HTMLElement>>('rig');
  private readonly figure = viewChild(CodexBoardFigureComponent);
  private readonly figureEl = viewChild(CodexBoardFigureComponent, { read: ElementRef });
  private readonly tileEls = viewChildren<ElementRef<HTMLElement>>('tile');
  /** Bumped by the ResizeObserver — re-runs the measurement. */
  private readonly layoutTick = signal(0);
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor() {
    this.t.onLangChange.pipe(takeUntilDestroyed()).subscribe((e) => this.lang.set(toLang(e.lang)));

    afterRenderEffect(() => {
      this.layoutTick();
      this.tiles();
      const anchors = this.figure()?.partAnchors();
      this.tileEls();
      untracked(() => this.measure(anchors ?? null));
    });

    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(() => this.layoutTick.update((n) => n + 1));
      const rig = this.rigEl()?.nativeElement;
      const fig = this.figureEl()?.nativeElement as HTMLElement | undefined;
      if (rig) ro.observe(rig);
      if (fig) ro.observe(fig);
      this.destroyRef.onDestroy(() => ro.disconnect());
    });

    this.destroyRef.onDestroy(() => {
      for (const id of this.timers) clearTimeout(id);
      this.timers.clear();
    });
  }

  leaveTile(slot: string): void {
    if (this.hoveredTile() === slot) this.hoveredTile.set(null);
  }

  /**
   * Arms the set → arsenal view transition for a plain left click only; the
   * anchor navigates on its own. A modified click (new tab) must not arm a
   * hop that never happens here. The name is cleared again after the arm's
   * lifetime, so a cancelled navigation cannot leave it on the tile.
   */
  onTileClick(ev: MouseEvent, slot: string, el: HTMLElement): void {
    if (!isPlainLeftClick(ev)) return;
    this.transition.arm(slot, 'toArsenal');
    nameForTransition(el, true);
    const id = setTimeout(() => {
      this.timers.delete(id);
      nameForTransition(el, false);
    }, ARM_TTL_MS);
    this.timers.add(id);
  }

  /** Tile inner edge → elbow → part anchor, in rig pixels. */
  private measure(anchors: Record<string, { x: number; y: number }> | null): void {
    const rig = this.rigEl()?.nativeElement;
    const figHost = this.figureEl()?.nativeElement as HTMLElement | undefined;
    const next: SetStageLine[] = [];
    if (rig && figHost && anchors) {
      const r = rig.getBoundingClientRect();
      const f = figHost.getBoundingClientRect();
      if (r.width > 0 && f.width > 0) {
        const figH = f.width / FIGURE_ASPECT;
        const filled = this.filled();
        for (const ref of this.tileEls()) {
          const el = ref.nativeElement;
          const slot = el.dataset['slot'];
          const a = slot ? anchors[slot] : undefined;
          if (!slot || !a) continue;
          const tr = el.getBoundingClientRect();
          const left = el.classList.contains('left');
          const x0 = round((left ? tr.right : tr.left) - r.left);
          const y0 = round(tr.top + tr.height / 2 - r.top);
          const x1 = round(x0 + (left ? ELBOW_PX : -ELBOW_PX));
          const ax = round(f.left - r.left + a.x * f.width);
          const ay = round(f.top - r.top + a.y * figH);
          next.push({ slot, points: `${x0},${y0} ${x1},${y0} ${ax},${ay}`, cx: ax, cy: ay, open: !filled.has(slot) });
        }
      }
    }
    if (!sameLines(this.lines(), next)) this.lines.set(next);
  }
}

function orderBy(tiles: SetStageTile[], order: readonly string[]): SetStageTile[] {
  return order.map((slot) => tiles.find((t) => t.slot === slot)).filter((t): t is SetStageTile => !!t);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function sameLines(a: SetStageLine[], b: SetStageLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.slot === b[i].slot && l.points === b[i].points && l.open === b[i].open);
}
