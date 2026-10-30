import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Params, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
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

/** "+ N weitere in der Suche": ships pre-filtered to "new"; the rest to the matching index filter. */
export function searchQueryFor(category: LandingCategory): Params {
  return category === 'ship' ? { kind: 'ship', sort: 'new' } : CATEGORY_INDEX_QUERY[category];
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
 * edge facing the hologram. One row per category with its count of new
 * items; the category on the table is open and lists its new items of the
 * current patch (the one on the table marked, announced ships tagged), the
 * search link for the rest and "Alle <Kategorie>". A row click puts that
 * category on the table and holds it; the held row again resumes the rotation.
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
      <ul class="cats">
        @for (r of rows(); track r.category) {
          @let on = r.category === active();
          <li class="cat" [class.on]="on" [class.flashing]="on && switchNo() > 0">
            @if (r.index >= 0) {
              <button type="button" class="row" [class.held]="on && held()" [attr.aria-expanded]="on"
                      [scTooltip]="(on && held() ? 'codex.landing.holo.next' : 'codex.landing.holo.hold') | translate"
                      scTooltipTier="label" (click)="pick.emit(r.index)">
                <ng-container *ngTemplateOutlet="head; context: { $implicit: r, on }" />
              </button>
            } @else {
              <span class="row idle"><ng-container *ngTemplateOutlet="head; context: { $implicit: r, on }" /></span>
            }
            @if (on) {
              @for (c of [cycle()]; track c) {
                <i class="prog" aria-hidden="true" [style.animation-duration.ms]="cycleMs()"></i>
              }
              <div class="open">
                @if (r.entries.length) {
                  <ul class="new">
                    @for (e of r.entries; track e.id) {
                      <li>
                        <a [routerLink]="e.route" [class.table]="e.onTable" [class.flash]="e.onTable && switchNo() > 0">
                          <span class="nm">{{ e.name }}</span>
                          @if (e.announced) { <em class="soon">{{ 'codex.landing.codex.announced' | translate }}</em> }
                          @if (e.onTable) { <span class="here">{{ 'codex.landing.codex.onTable' | translate }}</span> }
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
          </li>
        }
      </ul>
      <a class="keys" routerLink="/codex/keybinds"><span aria-hidden="true">⌨</span> {{ 'codex.landing.rail.keybinds' | translate }}</a>
    </nav>
    <ng-template #head let-r let-on="on">
      <i class="gl" aria-hidden="true">{{ glyph(r.category) }}</i>
      <span class="nm">{{ 'codex.landing.categories.' + r.category | translate }}</span>
      <em class="cnt">{{ 'codex.landing.codex.count' | translate: { count: r.count } }}</em>
      @if (on && held()) { <span class="sc-sr-only">{{ 'codex.landing.codex.held' | translate }}</span> }
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
        if (item && cur?.category === category && !entries.some((e) => e.onTable)) {
          entries.unshift({ id: item.className, name: item.name, route: item.detailRoute, announced: false, onTable: true });
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
}
