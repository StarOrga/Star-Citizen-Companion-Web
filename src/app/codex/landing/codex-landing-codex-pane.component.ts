import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { Params, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { comparePatchVersion } from '../codex-format';
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

/** Rows shown before the pane has been measured, and on a phone (the pane there grows with its content). */
export const DEFAULT_ROWS = 5;
/** Gap between two rows (px, `.new` in the scss). */
const ROW_GAP_PX = 1;
/** Row height (px) before one has been rendered: `.new a` min-height, 48px on touch screens. */
const ROW_PX = 28;
const ROW_PX_COARSE = 48;
/** Rows kept in the DOM at most (the rest is behind "+ N weitere"): enough to fill any pane height. */
const MAX_RENDERED = 60;
/**
 * Rows earlier patches may fill up to (#318): what the list of a patch without news (its
 * discovery picks) already holds, so the fill never makes the pane taller than it is today.
 * A current patch with more rows keeps them all and gets no fill rows.
 */
export const FILL_ROWS = 16;

/**
 * The current patch's rows, then the earlier patches' groups (each opened by a header row
 * naming its patch, newest patch first) in the space up to {@link FILL_ROWS} rows. Inside a
 * group the new entries first, then the updated ones, each in the given (rotation) order.
 */
export function withEarlierPatches<T extends { isNew?: boolean; patch?: string }>(
  current: readonly T[],
  earlier: readonly T[],
  head: (patch: string, first: T) => T,
): T[] {
  const out = [...current];
  const budget = Math.max(current.length, FILL_ROWS);
  const patches = [...new Set(earlier.map((e) => e.patch).filter((p): p is string => !!p))];
  for (const p of patches) {
    // A header needs at least one entry under it.
    if (out.length + 2 > budget) break;
    const group = earlier.filter((e) => e.patch === p);
    const ordered = [...group.filter((e) => e.isNew), ...group.filter((e) => !e.isNew)];
    out.push(head(p, ordered[0]), ...ordered.slice(0, budget - out.length - 1));
  }
  return out;
}

/**
 * The rows of a fixed list: the first `capacity`, in order. The entry on the table is always
 * among them - when it stands further down it takes the last visible place.
 */
export function visibleEntries<T extends { onTable: boolean }>(entries: readonly T[], capacity: number): T[] {
  const cap = Math.max(1, capacity);
  if (entries.length <= cap) return [...entries];
  const shown = entries.slice(0, cap);
  const table = entries.findIndex((e) => e.onTable);
  if (table >= cap) shown[cap - 1] = entries[table];
  return shown;
}

interface RowView {
  category: LandingCategory;
  count: number;
  /** Nothing new: the entries are picks to discover (title without "neu", the index link without the fresh filter). */
  discover: boolean;
  /** Index of the category's item in the rotation, -1 = nothing to put on the table. */
  index: number;
  entries: (LandingCodexEntry & { onTable: boolean })[];
}

/** One row of the wheel: an entry of any category, tagged with it; `head` = the header row of an earlier patch's group. */
export type WheelEntry = LandingCodexEntry & { onTable: boolean; category: LandingCategory; head?: string };

/**
 * The Codex list (round 4, "Zugewandte Kante"): a light pane, its glowing
 * edge facing the hologram. A horizontal category bar on top (d-tabs `active`:
 * icons, the active one with its name, the others name in a tooltip); below it
 * every new and updated item of the current patch — ships, FPS weapons, armour,
 * components, tools, each row tagged with its category glyph (admin feedback #318) —
 * stands in one fixed list, the completely new ones first (tagged "neu"), then the updated
 * ones (#328), the active category first in each group: no wheel, the mouse wheel stays
 * with the page, as many rows as the pane's height holds (the entry on the table always
 * among them). The pane is as tall as its content, at most the shared height. A patch with
 * nothing new at all offers entries of the active category to discover instead (title
 * without "neu", never an empty middle). "+ N neue & aktualisierte" (discovery: "+ N weitere")
 * counts the active category's entries off the list, "Alle <Kategorie>" closes the pane. A tab click
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
          {{ (discovering() ? 'codex.landing.codex.titleDiscover' : onlyEarlier() ? 'codex.landing.codex.titleRecent' : 'codex.landing.codex.title') | translate: { patch } }}
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
      @if (entries().length) {
          <div class="open" #openList>
            <ul class="new">
              @for (e of shown(); track e.head ? 'patch:' + e.head : e.category + ':' + e.id; let i = $index) {
                @if (e.head) {
                  <li class="grp" [class.cut]="i >= visibleRows()" [attr.aria-hidden]="i >= visibleRows() ? 'true' : null">
                    <span class="grp-nm">{{ 'codex.landing.codex.patchGroup' | translate: { patch: e.head } }}</span>
                  </li>
                } @else {
                <li [class.table]="e.onTable" [class.own]="e.category === active()" [class.flash]="e.onTable && switchNo() > 0"
                    [class.cut]="i >= visibleRows()" [attr.aria-hidden]="i >= visibleRows() ? 'true' : null">
                  <a class="ent" [href]="href(e.route)" [attr.aria-current]="e.onTable ? 'true' : null"
                     [scTooltip]="e.name" scTooltipTier="label" (click)="onEntry($event, e)">
                    <i class="cat" aria-hidden="true">{{ glyph(e.category) }}</i>
                    <span class="sc-sr-only">{{ 'codex.landing.categories.' + e.category | translate }}:</span>
                    <span class="nm">{{ e.name }}</span>
                    @if (e.announced) { <em class="soon">{{ 'codex.landing.codex.announced' | translate }}</em> }
                    @if (e.isNew) { <em class="upd fresh">{{ 'codex.landing.codex.new' | translate }}</em> }
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
              }
            </ul>
          </div>
      }
      <div class="foot">
        @if (activeRow(); as r) {
          @if (r.entries.length) {
            <div class="more-slot">
              @if (more() > 0) {
                <a class="more" routerLink="/codex/index" [queryParams]="r.discover ? indexQuery(r.category) : searchQuery(r.category)">
                  {{ (r.discover ? 'codex.landing.codex.moreDiscover' : 'codex.landing.codex.more') | translate: { count: more() } }} <i aria-hidden="true">↗</i>
                </a>
              }
            </div>
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
        const inEarlier = !!cur && (n?.earlier ?? []).some((e) => e.id === cur.className);
        if (entries.length && cur?.category === category && !inEarlier && !entries.some((e) => e.onTable)) {
          const shown = cur.announced ? cur : (item ?? cur);
          entries.unshift({ id: shown.className, name: shown.name, route: shown.detailRoute, announced: !!shown.announced, onTable: true });
        }
        return { category, count: n?.count ?? 0, discover: !!n?.discover, index, entries };
      },
    );
  });

  readonly activeRow = computed(() => this.rows().find((r) => r.category === this.active()) ?? null);
  /**
   * The list: every category's completely new entries first, then the updated ones (#328);
   * inside each group the active category first, then the others in rotation order (#318). Only when no category has anything new: the active
   * category's picks to discover.
   */
  readonly entries = computed<WheelEntry[]>(() => {
    const rows = this.rows();
    const real = rows.filter((r) => !r.discover && r.entries.length);
    const from = Math.max(0, LANDING_CATEGORIES.indexOf(this.active() ?? LANDING_CATEGORIES[0]));
    const order = (c: LandingCategory) => (LANDING_CATEGORIES.indexOf(c) - from + LANDING_CATEGORIES.length) % LANDING_CATEGORIES.length;
    const earlier = this.earlier(order);
    if (!real.length && !earlier.length) {
      const r = this.activeRow();
      return r ? r.entries.map((e) => ({ ...e, category: r.category })) : [];
    }
    const all = [...real]
      .sort((a, b) => order(a.category) - order(b.category))
      .flatMap((r) => r.entries.map((e) => ({ ...e, category: r.category })));
    // Every completely new entry first, then the updated ones; each group keeps the rotation order (#328).
    const current = [...all.filter((e) => e.isNew), ...all.filter((e) => !e.isNew)];
    // The space the current patch leaves goes to the patches before it, each under its own header (#318).
    return withEarlierPatches<WheelEntry>(current, earlier, (patch, first) => ({
      id: `patch:${patch}`,
      name: patch,
      route: [],
      announced: false,
      onTable: false,
      category: first.category,
      head: patch,
    }));
  });
  /** The earlier patches' entries of every category, newest patch first, each patch in rotation order. */
  private earlier(order: (c: LandingCategory) => number): WheelEntry[] {
    const cats = [...(this.codex()?.categories ?? [])].sort((a, b) => order(a.category) - order(b.category));
    const cur = this.current();
    const all = cats.flatMap((c) =>
      (c.earlier ?? []).map((e) => ({ ...e, onTable: !!cur && cur.category === c.category && e.id === cur.className, category: c.category })),
    );
    const patches = [...new Set(all.map((e) => e.patch ?? ''))].sort((a, b) => comparePatchVersion(b, a));
    return patches.flatMap((p) => all.filter((e) => (e.patch ?? '') === p));
  }
  /** The whole list is nothing but discovery picks (title without "neu"). */
  readonly discovering = computed(
    () =>
      !this.rows().some((r) => !r.discover && r.entries.length) &&
      !(this.codex()?.categories ?? []).some((c) => c.earlier?.length) &&
      !!this.activeRow()?.discover,
  );
  /** The current patch brought nothing, the list shows earlier patches only (title "zuletzt neu"). */
  readonly onlyEarlier = computed(() => {
    const list = this.entries();
    return list.length > 0 && !!list[0].head;
  });
  /** How many rows the pane's height holds; rows past it stay laid out but hidden, so the height never feeds back. */
  readonly capacity = signal(DEFAULT_ROWS);
  private readonly openList = viewChild<ElementRef<HTMLElement>>('openList');
  /** The list in display order; the entry on the table always within the first {@link capacity} rows. */
  readonly shown = computed(() => {
    const all = this.entries();
    const visible = visibleEntries(all, this.capacity());
    const keep = new Set(visible);
    return [...visible, ...all.filter((e) => !keep.has(e))].slice(0, Math.max(MAX_RENDERED, visible.length));
  });
  /** Rows shown: the capacity, less a group header that would stand last with nothing under it. */
  readonly visibleRows = computed(() => {
    const cap = this.capacity();
    return this.shown()[cap - 1]?.head ? cap - 1 : cap;
  });
  /** Entries of the active category beyond the visible rows ("+ N neue & aktualisierte" opens them in the index). */
  readonly more = computed(() => {
    // A category with nothing new while others have news: its discovery picks are not in the list, nothing "weitere".
    if (this.activeRow()?.discover && !this.discovering()) return 0;
    const cat = this.active();
    const visible = this.shown()
      .slice(0, this.capacity())
      .filter((e) => e.category === cat && !e.head && !e.patch).length;
    return Math.max(0, (this.activeRow()?.entries.length ?? 0) - visible);
  });

  constructor() {
    // The list fills the pane between tabs and foot (scss `.open`); the rows that fit are counted
    // from its height. On a phone the pane grows with its content, so there is a fixed count.
    effect((onCleanup) => {
      const el = this.openList()?.nativeElement;
      if (!el || typeof ResizeObserver === 'undefined') return;
      const measure = () => {
        if (window.matchMedia('(max-width: 720px)').matches) {
          this.capacity.set(DEFAULT_ROWS);
          return;
        }
        const li = el.querySelector<HTMLElement>('li');
        const row = (li?.offsetHeight || (window.matchMedia('(pointer: coarse)').matches ? ROW_PX_COARSE : ROW_PX)) + ROW_GAP_PX;
        this.capacity.set(Math.max(1, Math.floor((el.clientHeight + ROW_GAP_PX) / row)));
      };
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      measure();
      onCleanup(() => ro.disconnect());
    });
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
