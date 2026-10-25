import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import type { Lang, ShipDeck } from './codex.types';
import { buildDeckPlans, DeckPlan, DeckPlanRoom } from './deck-plan';

/** Counter behind each plan's DOM id prefix. */
let nextDeckPlanId = 0;

/**
 * 2D deck schematic of a ship (#797): one top view per deck, nose up, the
 * rooms drawn from their real floor footprints (`deck-plan.ts`). The deck
 * switcher uses the deck names of #796; every deck shares one frame, so a
 * room keeps its place when the reader flips between decks.
 *
 * Renders nothing when the ship's extract carries no rooms — every ship until
 * the desktop uploader has re-run against Data.p4k, and every ship without
 * authored decks.
 */
@Component({
  selector: 'sc-ship-deck-plan',
  standalone: true,
  imports: [TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (plans(); as set) {
      <section class="sc-card deck-plan">
        <header class="dp-head">
          <h2>{{ 'codex.deckPlan.title' | translate }}</h2>
          <p class="hint">{{ 'codex.deckPlan.hint' | translate }}</p>
        </header>

        @if (set.decks.length > 1) {
          <div class="switch" role="tablist" [attr.aria-label]="'codex.deckPlan.switchAria' | translate">
            @for (d of set.decks; track d.key) {
              <button
                type="button"
                role="tab"
                class="tab"
                [attr.id]="uid + '-tab-' + $index"
                [attr.aria-controls]="uid + '-panel'"
                [class.on]="d.key === deck()?.key"
                [attr.aria-selected]="d.key === deck()?.key"
                [attr.tabindex]="d.key === deck()?.key ? 0 : -1"
                (click)="select(d)"
                (keydown)="onTabKey($event, set.decks)"
              >
                {{ d.label }}
                <span class="n">{{ d.rooms.length }}</span>
              </button>
            }
          </div>
        }

        @if (deck(); as d) {
          <div class="stage" [attr.id]="uid + '-panel'" [attr.role]="set.decks.length > 1 ? 'tabpanel' : null"
               [attr.aria-labelledby]="set.decks.length > 1 ? uid + '-tab-' + deckIndex() : null">
            <svg
              [attr.viewBox]="set.viewBox"
              role="group"
              [attr.aria-label]="'codex.deckPlan.aria' | translate: { deck: d.label, count: d.rooms.length }"
            >
              <text class="nose" [attr.x]="set.width / 2" [attr.y]="fontSize() * 1.1" text-anchor="middle"
                    [attr.font-size]="fontSize()">
                ▲ {{ 'codex.deckPlan.nose' | translate }}
              </text>
              @for (r of d.rooms; track r.key) {
                <g
                  class="room"
                  [class.on]="r.label === activeLabel()"
                  [class.pin]="!r.paths.length && !r.mesh"
                  role="img"
                  [attr.aria-label]="r.label"
                  [scTooltip]="r.label"
                  scTooltipTier="label"
                  (mouseenter)="hovered.set(r.key)"
                  (mouseleave)="hovered.set(null)"
                  (click)="pin(r)"
                >
                  @if (r.mesh) {
                    <path class="mesh" [attr.d]="r.mesh" />
                  }
                  @for (p of r.paths; track $index) {
                    <path [attr.d]="p" />
                  }
                  @if (!r.paths.length && !r.mesh) {
                    <circle [attr.cx]="r.anchor.x" [attr.cy]="r.anchor.y" [attr.r]="fontSize() * 0.6" />
                  }
                  @if (showsLabel(r)) {
                    <text class="lbl" [attr.x]="r.anchor.x" [attr.y]="r.anchor.y" text-anchor="middle"
                          dominant-baseline="middle" [attr.font-size]="labelSize()">{{ r.label }}</text>
                  }
                </g>
              }
            </svg>
          </div>
          <!-- The active room in words: a tooltip needs a long press on touch,
               this line answers a plain tap too. -->
          <p class="readout" [class.empty]="!activeLabel()">
            {{ activeLabel() || ('codex.deckPlan.readoutIdle' | translate) }}
          </p>
          <!-- Every room by name: the plan's own labels only fit the larger
               rooms, and a list reads on a phone where hovering does not. -->
          <ul class="legend" [attr.aria-label]="'codex.deckPlan.roomsAria' | translate: { deck: d.label }">
            @for (r of legend(); track r.key) {
              <li>
                <!-- The chips are the keyboard path through the rooms; the plan's
                     own shapes stay out of the tab order. -->
                <button type="button" class="chip" [class.on]="r.label === activeLabel()"
                        [attr.aria-pressed]="r.label === pinnedLabel()"
                        (mouseenter)="hovered.set(r.key)" (mouseleave)="hovered.set(null)"
                        (focus)="hovered.set(r.key)" (blur)="hovered.set(null)"
                        (click)="pin(r)">{{ r.label }}</button>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .deck-plan { margin: 0 0 14px; }
    .dp-head h2 { margin: 0 0 2px; }
    .hint { margin: 0 0 10px; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .switch { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .tab { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 12px;
      border-radius: 999px; border: 1px solid var(--sc-border); background: var(--sc-bg-1);
      color: var(--sc-fg-1); font: inherit; font-size: max(0.75rem, var(--sc-fs-floor)); cursor: pointer; }
    .tab:hover { border-color: var(--sc-accent); }
    .tab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .tab.on { border-color: var(--sc-accent); color: var(--sc-accent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
    .tab .n { font-size: 0.85em; color: var(--sc-fg-2); }
    @media (pointer: coarse) { .tab { min-height: 48px; } }

    .stage { border-radius: 8px; padding: 6px; background: var(--sc-bg-1); border: 1px solid var(--sc-border);
      display: flex; justify-content: center; min-width: 0; }
    /* A long hull is tall in a nose-up view: the panel caps its height so the
       page never needs a second scroll, and the SVG scales down to fit. */
    svg { display: block; width: 100%; height: auto; max-height: 70vh; max-height: 70dvh; overflow: visible; }

    .nose { fill: var(--sc-fg-2); letter-spacing: 0.05em; }
    .room path { fill: color-mix(in srgb, var(--sc-accent) 10%, transparent);
      stroke: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); stroke-width: 1px;
      vector-effect: non-scaling-stroke; }
    .room path.mesh { stroke: none; }
    .room circle { fill: var(--sc-fg-2); }
    .room .lbl { fill: var(--sc-fg-1); pointer-events: none; }
    .room:hover path, .room.on path { fill: color-mix(in srgb, var(--sc-accent) 30%, transparent); stroke: var(--sc-accent); }
    .room:hover path.mesh, .room.on path.mesh { stroke: none; }
    .room:hover circle, .room.on circle { fill: var(--sc-accent); }

    .legend { list-style: none; display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding: 0; }
    .chip { min-height: 32px; padding: 2px 10px; border-radius: 6px; border: 1px solid var(--sc-border);
      background: transparent; color: var(--sc-fg-1); font: inherit; font-size: max(0.7rem, var(--sc-fs-floor)); cursor: pointer; }
    .chip:hover, .chip.on { border-color: var(--sc-accent); color: var(--sc-accent); }
    .chip:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    @media (pointer: coarse) { .chip { min-height: 48px; } }

    .readout { margin: 6px 0 0; min-height: 1.1em; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-accent); }
    .readout.empty { color: var(--sc-fg-2); font-style: italic; }
  `],
})
export class ShipDeckPlanComponent {
  /** Per-instance id prefix: the classic and holo layouts may both mount a plan. */
  readonly uid = `dp-${++nextDeckPlanId}`;

  readonly decks = input<readonly ShipDeck[] | null | undefined>(null);
  readonly lang = input<Lang>('en');

  readonly plans = computed(() => buildDeckPlans(this.decks(), this.lang()));

  private readonly picked = signal<string | null>(null);
  /** Room under the pointer or a focused chip — transient. */
  readonly hovered = signal<string | null>(null);
  /** Room a click/tap selected — holds until another click or a deck switch. */
  readonly pinned = signal<string | null>(null);
  /** What the plan highlights and the readout names: hover wins over the pin. */
  readonly active = computed(() => this.hovered() ?? this.pinned());

  /** The picked deck, else the one with the most rooms (the ship's main deck in practice). */
  readonly deck = computed<DeckPlan | null>(() => {
    const set = this.plans();
    if (!set) return null;
    const key = this.picked();
    return set.decks.find((d) => d.key === key)
      ?? set.decks.reduce((best, d) => (d.rooms.length > best.rooms.length ? d : best), set.decks[0]);
  });

  readonly deckIndex = computed(() => {
    const set = this.plans();
    return set ? Math.max(0, set.decks.findIndex((d) => d.key === this.deck()?.key)) : 0;
  });

  /**
   * Label size in metres. A long nose-up plan is capped by height, not width,
   * so the font follows the plan's longer side to stay readable on an Idris.
   */
  readonly fontSize = computed(() => {
    const set = this.plans();
    const span = set ? Math.max(set.width, set.height * 0.6) : 40;
    return Math.max(span / 40, 0.6);
  });

  /** Inline room labels run smaller than the nose mark. */
  readonly labelSize = computed(() => this.fontSize() * 0.7);

  /** The deck's rooms by name, alphabetical, one entry per distinct label. */
  readonly legend = computed<DeckPlanRoom[]>(() => {
    const rooms = this.deck()?.rooms ?? [];
    const seen = new Set<string>();
    return [...rooms]
      .sort((a, b) => a.label.localeCompare(b.label))
      .filter((r) => (seen.has(r.label) ? false : (seen.add(r.label), true)));
  });

  private labelOf(key: string | null): string {
    return key ? this.deck()?.rooms.find((r) => r.key === key)?.label ?? '' : '';
  }

  readonly activeLabel = computed(() => this.labelOf(this.active()));
  readonly pinnedLabel = computed(() => this.labelOf(this.pinned()));

  pin(r: DeckPlanRoom): void {
    this.pinned.update((k) => (k === r.key ? null : r.key));
  }

  select(d: DeckPlan): void {
    this.picked.set(d.key);
    this.hovered.set(null);
    this.pinned.set(null);
  }

  /**
   * A room carries its name inline only when the name fits inside its largest
   * footprint (~0.55 em per character); every other room names itself through
   * the tooltip and the readout.
   */
  showsLabel(r: DeckPlanRoom): boolean {
    const fs = this.labelSize();
    return r.box.w * 0.9 >= r.label.length * fs * 0.55 && r.box.h >= fs * 1.4;
  }

  onTabKey(event: KeyboardEvent, decks: readonly DeckPlan[]): void {
    const i = decks.findIndex((d) => d.key === this.deck()?.key);
    const step: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1 + decks.length, Home: 0, End: decks.length - 1 };
    if (!(event.key in step)) return;
    const next = decks[step[event.key] % decks.length];
    event.preventDefault();
    this.select(next);
    const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
    tabs?.[decks.indexOf(next)]?.focus();
  }
}
