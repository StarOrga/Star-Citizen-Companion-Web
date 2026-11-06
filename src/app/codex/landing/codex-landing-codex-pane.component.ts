import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
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

/** "+ N weitere in der Suche": the category's index filter, new-this-patch first. */
export function searchQueryFor(category: LandingCategory): Params {
  return { ...CATEGORY_INDEX_QUERY[category], sort: 'new' };
}

interface RowView {
  category: LandingCategory;
  count: number;
  /** Index of the category's item in the rotation, -1 = nothing to put on the table. */
  index: number;
  entries: (LandingCodexEntry & { onTable: boolean })[];
  more: number;
}

/**
 * The Codex list (round 4, "Zugewandte Kante"): a light pane, its glowing
 * edge facing the hologram. A horizontal category bar on top (d-tabs `active`:
 * icons, the active one with its name, the others name in a tooltip); below it
 * the active category lists its new items of the current patch (the one on the
 * table marked, announced ships tagged), the search link for the rest and
 * "Alle <Kategorie>". A tab click puts that category on the table and holds
 * it; the held tab again resumes the rotation. An entry click puts that entry
 * on the table (held) — its small arrow and a modified click open the subpage.
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
      @for (r of rows(); track r.category) {
        @if (r.category === active()) {
          <div class="open">
            <p class="sum">
              {{ 'codex.landing.codex.count' | translate: { count: r.count } }}
              @if (held()) { <span class="sc-sr-only">{{ 'codex.landing.codex.held' | translate }}</span> }
            </p>
            @if (r.entries.length) {
              <ul class="new">
                @for (e of r.entries; track e.id) {
                  <li [class.table]="e.onTable" [class.flash]="e.onTable && switchNo() > 0">
                    <a class="ent" [href]="href(e.route)" [attr.aria-current]="e.onTable ? 'true' : null"
                       (click)="onEntry($event, r.category, e)">
                      <span class="nm">{{ e.name }}</span>
                      @if (e.announced) { <em class="soon">{{ 'codex.landing.codex.announced' | translate }}</em> }
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
            } @else {
              <p class="none">{{ 'codex.landing.codex.noneNew' | translate }}</p>
            }
            @if (r.more > 0) {
              <a class="more" routerLink="/codex/index" [queryParams]="searchQuery(r.category)">
                {{ 'codex.landing.codex.more' | translate: { count: r.more } }} <i aria-hidden="true">↗</i>
              </a>
            }
            <a class="all" routerLink="/codex/index" [queryParams]="indexQuery(r.category)">
              {{ 'codex.landing.codex.all' | translate: { category: ('codex.landing.categories.' + r.category | translate) } }} <i aria-hidden="true">↗</i>
            </a>
          </div>
        }
      }
      <a class="keys" routerLink="/codex/keybinds"><span aria-hidden="true">⌨</span> {{ 'codex.landing.rail.keybinds' | translate }}</a>
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
        // The item on the table always appears in its list — first, when it is not among the new ones.
        if (cur?.category === category && !entries.some((e) => e.onTable)) {
          const shown = cur.announced ? cur : (item ?? cur);
          entries.unshift({ id: shown.className, name: shown.name, route: shown.detailRoute, announced: !!shown.announced, onTable: true });
        }
        return { category, count: n?.count ?? 0, index, entries, more: n?.more ?? 0 };
      },
    );
  });

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
  onEntry(ev: MouseEvent, category: LandingCategory, entry: LandingCodexEntry): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.pickEntry.emit({ category, entry });
  }
}
