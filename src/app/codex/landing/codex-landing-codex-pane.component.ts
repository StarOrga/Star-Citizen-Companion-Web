import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { Params, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { CATEGORY_GLYPH } from './codex-landing-holotable.component';
import { LANDING_CATEGORIES, LandingCategory, LandingCodex, LandingCodexEntry, LandingItem } from './codex-landing-data.types';

/** Index filter per category: "Alle <Kategorie>" and, outside ships, the search link. */
export const CATEGORY_INDEX_QUERY: Record<LandingCategory, Params> = {
  ship: { kind: 'ship' },
  fpsWeapon: { kind: 'weapon', weaponClass: 'FPS' },
  armor: { kind: 'armor' },
  component: { kind: 'component' },
  tool: { kind: 'weapon', wg: 'ship', wsg: 'utility' },
};

/** "+ N weitere": the category's index, filtered to what is new or updated in the last patch. */
export function searchQueryFor(category: LandingCategory): Params {
  return { ...CATEGORY_INDEX_QUERY[category], fresh: '1' };
}

/**
 * Rows of the entry wheel. Fixed and odd, so the entry on the table stands in
 * the middle. The pane is as tall as its content (at most 400px,
 * codex-landing.component.scss): title, tabs, five rows and the foot fit it
 * down to a 1280x720 window (codex-landing-codex-pane.component.spec).
 */
export const WHEEL_ROWS = 5;
/** Wheel distance (px, summed) that turns the entry wheel by one row. */
const WHEEL_STEP_PX = 40;

/** The window of a wheel over `count` entries: indices in display order, centred on `centre`. */
export function wheelWindow(count: number, centre: number, rows = WHEEL_ROWS): number[] {
  if (count <= rows) return Array.from({ length: count }, (_, i) => i);
  const half = (rows - 1) / 2;
  return Array.from({ length: rows }, (_, i) => (((centre - half + i) % count) + count) % count);
}

/**
 * Where the wheel stands before it is turned: the entry on the table, else the
 * first entry of the active category or the next one in rotation order.
 */
export function wheelCentre(entries: readonly WheelEntry[], active: LandingCategory | null): number {
  const table = entries.findIndex((e) => e.onTable);
  if (table >= 0) return table;
  const from = active ? LANDING_CATEGORIES.indexOf(active) : 0;
  const next = entries.findIndex((e) => LANDING_CATEGORIES.indexOf(e.category) >= from);
  return Math.max(0, next);
}

interface RowView {
  category: LandingCategory;
  count: number;
  /** Index of the category's item in the rotation, -1 = nothing to put on the table. */
  index: number;
  entries: (LandingCodexEntry & { onTable: boolean })[];
}

/** One row of the wheel: an entry of any category, tagged with it. */
export type WheelEntry = LandingCodexEntry & { onTable: boolean; category: LandingCategory };

/**
 * The Codex list (round 4, "Zugewandte Kante"): a light pane, its glowing
 * edge facing the hologram. A horizontal category bar on top (d-tabs `active`:
 * icons, the active one with its name, the others name in a tooltip); below it
 * every new and updated item of the current patch — ships, FPS weapons, armour,
 * components, tools, each row tagged with its category glyph — stands in one
 * wheel of {@link WHEEL_ROWS} rows (the one on the table in the middle, else the
 * active category's first; announced ships tagged). A category with nothing new
 * of its own still shows the others' (admin feedback #318); only a patch with
 * nothing new at all drops the middle. The pane is as tall as its content.
 * "+ N weitere" counts the active category's entries off the wheel, "Alle
 * <Kategorie>" closes the pane. A tab click
 * puts that category on the table and holds it; the held tab again resumes the
 * rotation. An entry click puts that entry on the table (held) — its small arrow
 * and a modified click open the subpage.
 */
@Component({
  selector: 'sc-codex-landing-codex-pane',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.still]': 'still()', '[class.paused]': 'paused()' },
  template: `
    <span class="edge" aria-hidden="true"></span>
    <nav class="body" [attr.aria-label]="'codex.landing.codex.label' | translate">
      <h2 class="ph">
        @if (codex()?.patch; as patch) {
          {{ 'codex.landing.codex.title' | translate: { patch } }}
        } @else {
          {{ 'codex.landing.codex.titleNoPatch' | translate }}
        }
      </h2>
      <ul class="tabs" [attr.aria-label]="'codex.landing.codex.categories' | translate">
        @for (r of rows(); track r.category) {
          @let on = r.category === active();
          @let name = 'codex.landing.categories.' + r.category | translate;
          <li class="tab-li" [class.on]="on" [class.flashing]="on && switchNo() > 0">
            @if (r.index >= 0) {
              <button type="button" class="tab" [class.on]="on" [class.held]="on && held()"
                      [attr.aria-pressed]="on" [attr.aria-label]="name"
                      [scTooltip]="on ? '' : name" scTooltipTier="label" (click)="pick.emit(r.index)">
                <ng-container *ngTemplateOutlet="head; context: { $implicit: r, on, name }" />
              </button>
            } @else {
              <span class="tab idle" role="img" [attr.aria-label]="name" [scTooltip]="on ? '' : name" scTooltipTier="label">
                <ng-container *ngTemplateOutlet="head; context: { $implicit: r, on, name }" />
              </span>
            }
            @if (on) {
              @for (c of [cycle()]; track c) {
                <i class="prog" aria-hidden="true" [style.animation-duration.ms]="cycleMs()"></i>
              }
            }
          </li>
        }
      </ul>
      @if (held()) { <p class="sc-sr-only">{{ 'codex.landing.codex.held' | translate }}</p> }
      @if (wheel().length) {
          <div class="open">
            <ul class="new" [class.spins]="spins()" (wheel)="onWheel($event)" (keydown)="onWheelKey($event)">
              @for (e of wheel(); track e.category + ':' + e.id; let i = $index) {
                <li [class.table]="e.onTable" [class.own]="e.category === active()" [class.flash]="e.onTable && switchNo() > 0"
                    [class.far]="spins() && (i === 0 || i === wheel().length - 1)">
                  <a class="ent" [href]="href(e.route)" [attr.aria-current]="e.onTable ? 'true' : null"
                     [scTooltip]="e.name" scTooltipTier="label" (click)="onEntry($event, e)">
                    <i class="cat" aria-hidden="true">{{ glyph(e.category) }}</i>
                    <span class="sc-sr-only">{{ 'codex.landing.categories.' + e.category | translate }}:</span>
                    <span class="nm">{{ e.name }}</span>
                    @if (e.announced) { <em class="soon">{{ 'codex.landing.codex.announced' | translate }}</em> }
                    @if (e.updated) { <em class="upd">{{ 'codex.landing.codex.updated' | translate }}</em> }
                    @if (e.onTable) { <span class="here">{{ 'codex.landing.codex.onTable' | translate }}</span> }
                  </a>
                  <a class="go" [routerLink]="e.route"
                     [attr.aria-label]="'codex.landing.codex.openPage' | translate: { name: e.name }"
                     [scTooltip]="'codex.landing.codex.openPage' | translate: { name: e.name }" scTooltipTier="label">
                    <i aria-hidden="true">↗</i>
                  </a>
                </li>
              }
            </ul>
          </div>
      }
      <div class="foot">
        @if (activeRow(); as r) {
          @if (more() > 0) {
            <a class="more" routerLink="/codex/index" [queryParams]="searchQuery(r.category)">
              {{ 'codex.landing.codex.more' | translate: { count: more() } }} <i aria-hidden="true">↗</i>
            </a>
          }
          <a class="all" routerLink="/codex/index" [queryParams]="indexQuery(r.category)">
            {{ 'codex.landing.codex.all' | translate: { category: ('codex.landing.categories.' + r.category | translate) } }} <i aria-hidden="true">↗</i>
          </a>
        }
        <a class="keys" routerLink="/codex/keybinds"><span aria-hidden="true">⌨</span> {{ 'codex.landing.rail.keybinds' | translate }}</a>
      </div>
    </nav>
    <ng-template #head let-r let-on="on" let-name="name">
      <i class="gl" aria-hidden="true">{{ glyph(r.category) }}</i>
      @if (on) { <span class="nm" aria-hidden="true">{{ name }}</span> }
    </ng-template>
  `,
  styleUrl: './codex-landing-codex-pane.component.scss',
})
export class CodexLandingCodexPaneComponent {
  readonly codex = input<LandingCodex | null>(null);
  readonly items = input<readonly LandingItem[]>([]);
  readonly active = input<LandingCategory | null>(null);
  readonly current = input<LandingItem | null>(null);
  readonly held = input(false);
  readonly paused = input(false);
  readonly still = input(false);
  readonly cycle = input(0);
  readonly cycleMs = input(8000);
  readonly switchNo = input(0);
  readonly pick = output<number>();
  /** A plain left click on an entry: that entry goes onto this page's table and is held. */
  readonly pickEntry = output<{ category: LandingCategory; entry: LandingCodexEntry }>();

  private readonly router = inject(Router);
  private readonly location = inject(Location);

  readonly rows = computed<RowView[]>(() => {
    const items = this.items();
    const news = this.codex()?.categories ?? [];
    const cur = this.current();
    return LANDING_CATEGORIES.filter((c) => items.some((i) => i.category === c) || news.some((n) => n.category === c && n.count > 0)).map(
      (category) => {
        const n = news.find((x) => x.category === category);
        const index = items.findIndex((i) => i.category === category);
        const item = index >= 0 ? items[index] : null;
        const entries = (n?.entries ?? []).map((e) => ({ ...e, onTable: !!cur && cur.category === category && e.id === cur.className }));
        // The item on the table joins a list that has entries — first, when it is not among them.
        // With nothing new or updated there is no list: the middle of the pane stays away.
        if (entries.length && cur?.category === category && !entries.some((e) => e.onTable)) {
          const shown = cur.announced ? cur : (item ?? cur);
          entries.unshift({ id: shown.className, name: shown.name, route: shown.detailRoute, announced: !!shown.announced, onTable: true });
        }
        return { category, count: n?.count ?? 0, index, entries };
      },
    );
  });

  readonly activeRow = computed(() => this.rows().find((r) => r.category === this.active()) ?? null);
  /** Every category's new and updated entries in one list, rotation order. */
  readonly entries = computed<WheelEntry[]>(() => this.rows().flatMap((r) => r.entries.map((e) => ({ ...e, category: r.category }))));
  /** More entries than rows: the list is a wheel. */
  readonly spins = computed(() => this.entries().length > WHEEL_ROWS);
  /** Rows the reader turned the wheel; a new entry on the table centres it again. */
  private readonly spin = linkedSignal({
    source: () => `${this.active()}:${this.current()?.className ?? ''}`,
    computation: () => 0,
  });
  /** The rows on screen, the entry on the table in the middle until the wheel is turned. */
  readonly wheel = computed(() => {
    const entries = this.entries();
    return wheelWindow(entries.length, wheelCentre(entries, this.active()) + this.spin()).map((i) => entries[i]);
  });
  /** Entries of the active category beyond the rows on screen ("+ N weitere" opens them in the index). */
  readonly more = computed(() => {
    const cat = this.active();
    const shown = this.wheel().filter((e) => e.category === cat).length;
    return Math.max(0, (this.activeRow()?.entries.length ?? 0) - shown);
  });

  private wheelSum = 0;

  /** Turns the wheel; only then the turn is taken from the page (which would open the index at its end). */
  onWheel(ev: WheelEvent): void {
    if (!this.spins()) return;
    ev.preventDefault();
    if (Math.sign(ev.deltaY) !== Math.sign(this.wheelSum)) this.wheelSum = 0;
    this.wheelSum += ev.deltaMode === 1 ? ev.deltaY * WHEEL_STEP_PX : ev.deltaY;
    const steps = Math.trunc(this.wheelSum / WHEEL_STEP_PX);
    if (!steps) return;
    this.wheelSum -= steps * WHEEL_STEP_PX;
    this.spin.update((s) => s + steps);
  }

  onWheelKey(ev: KeyboardEvent): void {
    if (!this.spins() || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
    ev.preventDefault();
    this.spin.update((s) => s + (ev.key === 'ArrowDown' ? 1 : -1));
  }

  glyph(cat: LandingCategory): string {
    return CATEGORY_GLYPH[cat];
  }
  searchQuery(cat: LandingCategory): Params {
    return searchQueryFor(cat);
  }
  indexQuery(cat: LandingCategory): Params {
    return CATEGORY_INDEX_QUERY[cat];
  }

  /** The entry's real href: middle click, Ctrl/⌘+click and "open in new tab" use it. */
  href(route: readonly string[]): string {
    return this.location.prepareExternalUrl(this.router.serializeUrl(this.router.createUrlTree([...route])));
  }

  /** Plain left click: onto the table of this page; every other activation falls through to the anchor. */
  onEntry(ev: MouseEvent, e: WheelEntry): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    const entry: LandingCodexEntry = { id: e.id, name: e.name, route: e.route, announced: e.announced, ...(e.updated ? { updated: true } : {}) };
    this.pickEntry.emit({ category: e.category, entry });
  }
}
