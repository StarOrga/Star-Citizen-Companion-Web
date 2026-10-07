import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { CodexService } from '../codex.service';
import { CodexCategoryIconComponent } from '../codex-category-icon.component';
import { ShipBlueprintIconComponent } from '../ship-blueprint/ship-blueprint-icon.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { PolySearchHit, isUpcomingHit, polyHitIconKind } from '../codex-poly-search';
import { CodexSearchEngine } from './codex-search-engine';
import { SearchOption, hitManufacturer, hitTitle, isLivery, pinKindOf } from './codex-search-model';

/**
 * The results of the ONE Codex search, rendered the same way under Ctrl+K,
 * the landing terminal and the Codex page bar: a listbox of kind groups, one
 * row per hit (icon, name, manufacturer, size/grade chips, add-to-hangar for
 * ships, compare pin on Codex pages) and an "all N in the index" link per
 * group. With an empty field it offers recent searches, the patch's new ships
 * and the Codex areas.
 *
 * Every row is a real anchor (middle click / Ctrl+click open a new tab) and an
 * ARIA option; the host's input owns focus and points at the active option
 * through aria-activedescendant — the keyboard model lives in the engine.
 */
@Component({
  selector: 'sc-codex-search-results',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, CodexCategoryIconComponent, ShipBlueprintIconComponent, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let e = engine();
    <div class="results" [class.roomy]="variant() === 'page'">
      @if (!e.input().trim()) {
        <div class="listbox" role="listbox" [id]="listboxId()" [attr.aria-label]="'codex.search.bar.suggestionsAria' | translate">
          @if (e.recent().length) {
            <div class="group" role="group" [attr.aria-labelledby]="listboxId() + '-h-recent'">
              <div class="group-head" role="presentation">
                <span [id]="listboxId() + '-h-recent'">{{ 'codex.search.bar.recent' | translate }}</span>
                <button type="button" class="head-action" (click)="forgetRecent()">{{ 'codex.search.bar.clearRecent' | translate }}</button>
              </div>
              <div class="chips" role="presentation">
                @for (o of recentOptions(); track o.id) {
                  <a class="chip" role="option" tabindex="-1" [id]="optId(o)"
                     [class.active]="isActive(o)" [attr.aria-selected]="isActive(o)"
                     [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                     (click)="onClick($event, o)" (mouseenter)="hover(o)">
                    <svg class="chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                         stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
                    {{ o.type === 'recent' ? o.term : '' }}
                  </a>
                }
              </div>
            </div>
          }
          @if (freshOptions().length) {
            <div class="group" role="group" [attr.aria-labelledby]="listboxId() + '-h-fresh'">
              <div class="group-head" role="presentation">
                <span [id]="listboxId() + '-h-fresh'">{{ 'codex.search.bar.fresh' | translate }}</span>
              </div>
              @for (o of freshOptions(); track o.id) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: o }" />
              }
            </div>
          }
          <div class="group" role="group" [attr.aria-labelledby]="listboxId() + '-h-areas'">
            <div class="group-head" role="presentation">
              <span [id]="listboxId() + '-h-areas'">{{ 'codex.search.bar.areas' | translate }}</span>
            </div>
            <div class="chips" role="presentation">
              @for (o of categoryOptions(); track o.id) {
                <a class="chip" role="option" tabindex="-1" [id]="optId(o)"
                   [class.active]="isActive(o)" [attr.aria-selected]="isActive(o)"
                   [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                   (click)="onClick($event, o)" (mouseenter)="hover(o)">
                  {{ (o.type === 'category' ? o.labelKey : '') | translate }}
                </a>
              }
            </div>
          </div>
        </div>
      } @else if (e.error(); as err) {
        <!-- A failed archive read is an error with a way forward, never "no results". -->
        <div class="state err" role="alert">
          <span>{{ 'codex.search.bar.failed' | translate }} — {{ err | translate }}</span>
          <button type="button" class="retry" (click)="e.retry()">{{ 'codex.error.retry' | translate }}</button>
        </div>
      } @else if (e.groups().length === 0) {
        @if (e.loading() || pending()) {
          <p class="state" role="status">{{ 'codex.search.bar.searching' | translate }}</p>
        } @else {
          <p class="state" role="status">{{ 'codex.search.bar.empty' | translate: { term: e.term().trim() } }}</p>
          @if (e.didYouMean().length) {
            <p class="did-you-mean">
              <span>{{ 'codex.search.didYouMean' | translate }}</span>
              @for (name of e.didYouMean(); track name) {
                <a class="dym" [routerLink]="['/codex']" [queryParams]="{ q: name }" (click)="onSuggest($event, name)">{{ name }}</a>
              }
            </p>
          }
        }
      } @else {
        <div class="listbox" role="listbox" [id]="listboxId()" [attr.aria-label]="'codex.search.bar.resultsAria' | translate"
             [attr.aria-busy]="e.loading()" [class.stale]="e.loading() || pending()">
          @for (g of e.groups(); track g.kind) {
            <div class="group" role="group" [attr.aria-labelledby]="listboxId() + '-h-' + g.kind">
              <div class="group-head" role="presentation">
                <span [id]="listboxId() + '-h-' + g.kind">{{ 'codex.kinds.' + g.kind | translate }}</span>
                <span class="count">{{ g.total }}</span>
              </div>
              @for (o of groupOptions(g.kind); track o.id) {
                @if (o.type === 'more') {
                  <a class="more" role="option" tabindex="-1" [id]="optId(o)"
                     [class.active]="isActive(o)" [attr.aria-selected]="isActive(o)"
                     [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
                     (click)="onClick($event, o)" (mouseenter)="hover(o)">
                    {{ (o.kind === 'upcoming' ? 'codex.search.bar.allUpcoming' : 'codex.search.bar.allInIndex') | translate: { n: o.total } }}
                    <span aria-hidden="true">→</span>
                  </a>
                } @else {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: o }" />
                }
              }
            </div>
          }
        </div>
      }
      @if (addFailed()) {
        <!-- Outside the listbox: an alert inside an option breaks the combobox semantics. -->
        <p class="state err" role="alert">{{ 'codex.card.addToHangarFailed' | translate }}</p>
      }
      <p class="nav-hint" aria-hidden="true">{{ 'codex.search.bar.navHint' | translate }}</p>
    </div>

    <ng-template #row let-o>
      @if (o.type === 'hit' || o.type === 'fresh') {
        <div class="row" role="presentation" [class.active]="isActive(o)" [class.upcoming]="isUpcoming(o.hit)">
          <a class="hit" role="option" tabindex="-1" [id]="optId(o)" [attr.aria-selected]="isActive(o)"
             [routerLink]="o.target.link" [queryParams]="o.target.queryParams"
             (click)="onClick($event, o)" (mouseenter)="hover(o)">
            <span class="icon" aria-hidden="true">
              @if (o.hit.kind === 'ship') {
                <sc-ship-blueprint-icon [shipId]="o.hit.classNameSlug">
                  <sc-codex-icon [kind]="iconKind(o.hit)" />
                </sc-ship-blueprint-icon>
              } @else {
                <sc-codex-icon [kind]="iconKind(o.hit)" />
              }
            </span>
            <span class="body">
              <span class="name">{{ title(o.hit) }}</span>
              <span class="meta">
                @if (o.type === 'fresh') {
                  <span class="kind">{{ 'codex.kindSingular.ship' | translate }}</span>
                }
                @if (mfr(o.hit); as m) { <span class="mfr">{{ m }}</span> }
                @if (o.hit.size != null) { <span class="badge">{{ 'codex.card.size' | translate: { size: o.hit.size } }}</span> }
                @if (o.hit.grade) { <span class="badge">{{ 'codex.search.bar.grade' | translate: { grade: o.hit.grade } }}</span> }
                @if (livery(o.hit)) { <span class="badge livery">{{ 'codex.search.bar.livery' | translate }}</span> }
                <!-- Says in words what the amber tint says in colour: announced, not in the build. -->
                @if (isUpcoming(o.hit)) { <span class="badge soon">{{ 'codex.search.bar.upcomingBadge' | translate }}</span> }
              </span>
            </span>
          </a>
          @if (o.hit.kind === 'ship' && auth.user()) {
            <!-- Add-to-hangar needs a session (RLS self-only) — hidden for anon (#131). -->
            @if (inHangar(o.hit.classNameSlug)) {
              <span class="in-hangar">{{ 'hangar.add.already' | translate }}</span>
            } @else {
              <button type="button" class="act add" (click)="addToHangar(o.hit.classNameSlug)"
                      [disabled]="adding().has(o.hit.classNameSlug)" [attr.aria-busy]="adding().has(o.hit.classNameSlug)"
                      [attr.aria-label]="'codex.search.bar.addToHangarAria' | translate: { name: title(o.hit) }">
                {{ 'quickSearch.addToHangar' | translate }}
              </button>
            }
          }
          @if (showPin() && pinKind(o.hit); as pk) {
            <button type="button" class="act pin" [class.pinned]="codex.isPinned(pk, o.hit.classNameSlug)"
                    (click)="codex.togglePin(pk, o.hit.classNameSlug)"
                    [attr.aria-pressed]="codex.isPinned(pk, o.hit.classNameSlug)"
                    [attr.aria-label]="(codex.isPinned(pk, o.hit.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                    [scTooltip]="(codex.isPinned(pk, o.hit.classNameSlug) ? 'codex.compare.pinned' : 'codex.compare.pin') | translate"
                    scTooltipTier="label">
              <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"
                   [attr.fill]="codex.isPinned(pk, o.hit.classNameSlug) ? 'currentColor' : 'none'">
                <path d="M12 3 L14.7 9.2 L21.5 9.9 L16.4 14.3 L17.9 21 L12 17.4 L6.1 21 L7.6 14.3 L2.5 9.9 L9.3 9.2 Z" />
              </svg>
            </button>
          }
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .results { display: flex; flex-direction: column; gap: 6px; }
    .listbox { display: flex; flex-direction: column; gap: 10px; transition: opacity 0.12s; }
    .listbox.stale { opacity: 0.6; }
    .group { display: flex; flex-direction: column; gap: 2px; }
    .group-head {
      display: flex; align-items: center; gap: 8px; padding: 2px 8px 4px;
      font-family: var(--sc-font-display); font-size: max(0.66rem, var(--sc-fs-floor));
      text-transform: uppercase; letter-spacing: 0.08em; color: var(--sc-fg-2);
    }
    .count {
      font-family: var(--sc-font-mono, monospace); font-variant-numeric: tabular-nums; letter-spacing: 0;
      padding: 0 6px; border-radius: 999px; background: var(--sc-bg-2); color: var(--sc-fg-1);
    }
    .head-action {
      margin-left: auto; background: none; border: 0; padding: 2px 4px; cursor: pointer; border-radius: 4px;
      color: var(--sc-fg-2); font: inherit; text-transform: none; letter-spacing: 0;
    }
    .head-action:hover { color: var(--sc-accent); }
    .head-action:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }

    .row {
      position: relative; display: flex; align-items: center; gap: 6px;
      border: 1px solid transparent; border-radius: 6px;
    }
    .row:hover, .row.active {
      border-color: color-mix(in srgb, var(--sc-accent) 70%, transparent);
      background: color-mix(in srgb, var(--sc-accent) 8%, transparent);
    }
    .row.upcoming { --tone: var(--sc-warning); }
    .row.upcoming:hover, .row.upcoming.active {
      border-color: color-mix(in srgb, var(--sc-warning) 70%, transparent);
      background: color-mix(in srgb, var(--sc-warning) 8%, transparent);
    }
    .hit {
      flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px;
      padding: 6px 8px; color: inherit; text-decoration: none; border-radius: inherit;
      min-height: 44px;
    }
    .hit:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .icon { flex: 0 0 auto; display: inline-flex; width: 30px; height: 30px; align-items: center; justify-content: center; color: var(--tone, var(--sc-accent)); }
    .icon:has(sc-ship-blueprint-art) { width: 44px; }
    .body { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
    /* Two lines before an ellipsis: "Aegis Gladius Thruster Main" and its
       siblings differ at the END of the name, which one line cut off. */
    .name {
      font-weight: 600; line-height: 1.25; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    }
    .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .kind { font-family: var(--sc-font-display); text-transform: uppercase; letter-spacing: 0.04em; color: var(--sc-accent); }
    .badge {
      padding: 0 6px; border-radius: 999px; font-size: max(0.66rem, var(--sc-fs-floor));
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, transparent);
      background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-1);
    }
    .badge.livery { border-color: var(--sc-border); background: var(--sc-bg-2); }
    .badge.soon {
      text-transform: uppercase; letter-spacing: 0.04em; color: var(--sc-warning);
      border-color: color-mix(in srgb, var(--sc-warning) 40%, transparent);
      background: color-mix(in srgb, var(--sc-warning) 14%, transparent);
    }
    .act {
      position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
      min-width: 36px; min-height: 36px; margin-right: 4px; border-radius: 6px; cursor: pointer;
      background: transparent; color: var(--sc-fg-2); border: 1px solid transparent; font-family: inherit;
    }
    .act:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
    .act.add {
      padding: 0 10px; border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent); color: var(--sc-accent);
      font-family: var(--sc-font-display); font-size: max(0.64rem, var(--sc-fs-floor)); letter-spacing: 0.05em; text-transform: uppercase;
    }
    .act.add:hover { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); }
    .act.pin svg { width: 18px; height: 18px; }
    .act.pin:hover, .act.pin.pinned { color: var(--sc-accent); }
    .in-hangar { flex: 0 0 auto; margin-right: 8px; font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); font-style: italic; }

    .more {
      align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; min-height: 36px;
      padding: 4px 10px; margin-left: 48px; border-radius: 6px; border: 1px solid transparent;
      color: var(--sc-accent); text-decoration: none; font-size: max(0.8rem, var(--sc-fs-floor));
    }
    .more:hover, .more.active { border-color: color-mix(in srgb, var(--sc-accent) 70%, transparent); background: color-mix(in srgb, var(--sc-accent) 8%, transparent); }

    .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 6px; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px; min-height: 34px; padding: 4px 12px;
      border-radius: 999px; border: 1px solid var(--sc-border); background: var(--sc-bg-0);
      color: var(--sc-fg-1); text-decoration: none; font-size: max(0.8rem, var(--sc-fs-floor));
    }
    .chip:hover, .chip.active { border-color: var(--sc-accent); color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-0)); }
    .chip-icon { width: 14px; height: 14px; color: var(--sc-fg-2); }

    .state { margin: 0; padding: 6px 8px; color: var(--sc-fg-2); font-size: 0.86rem; }
    .state.err { color: var(--sc-danger); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .retry {
      padding: 6px 14px; border-radius: 6px; background: transparent; cursor: pointer; font-family: inherit;
      border: 1px solid var(--sc-danger); color: var(--sc-danger);
    }
    .retry:focus-visible { outline: 2px solid var(--sc-danger); outline-offset: 2px; }
    .did-you-mean { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0; padding: 0 8px 6px; color: var(--sc-fg-2); }
    .dym { color: var(--sc-accent); text-decoration: none; border-radius: 4px; }
    .dym:hover { text-decoration: underline; }
    .dym:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
    .nav-hint {
      margin: 4px 0 0; padding: 6px 4px 0; border-top: 1px solid var(--sc-border); text-align: center;
      color: var(--sc-fg-2); font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.03em;
    }

    .roomy .hit { padding: 8px 10px; }
    .roomy .icon { width: 34px; height: 34px; }
    .roomy .icon:has(sc-ship-blueprint-art) { width: 52px; }

    @media (pointer: coarse) {
      .hit, .more, .chip, .act, .head-action, .dym, .retry { min-height: 48px; }
      .act { min-width: 48px; }
      .dym { display: inline-flex; align-items: center; padding: 0 4px; }
      .nav-hint { display: none; }
    }
  `],
})
export class CodexSearchResultsComponent {
  readonly codex = inject(CodexService);
  readonly auth = inject(AuthService);
  private readonly hangar = inject(HangarService);

  readonly engine = input.required<CodexSearchEngine>();
  /** id of the listbox — the input's aria-controls. */
  readonly listboxId = input.required<string>();
  /** 'overlay' (Ctrl+K, dense) or 'page' (Codex pages, roomier). */
  readonly variant = input<'overlay' | 'page'>('overlay');
  /** Compare pins only where the compare tray is (Codex pages). */
  readonly showPin = input(false);
  /** A plain click navigated away — the host closes / collapses. */
  readonly navigated = output<void>();
  /** A click ran a search in place — the host puts focus back into its field. */
  readonly searched = output<void>();

  readonly adding = signal<ReadonlySet<string>>(new Set());
  readonly addFailed = signal<string | null>(null);

  readonly pending = computed(() => {
    const e = this.engine();
    return e.input().trim() !== e.term().trim();
  });
  private readonly indexById = computed(() => new Map(this.engine().options().map((o, i) => [o.id, i])));
  readonly recentOptions = computed(() => this.engine().options().filter((o) => o.type === 'recent'));
  readonly freshOptions = computed(() => this.engine().options().filter((o) => o.type === 'fresh'));
  readonly categoryOptions = computed(() => this.engine().options().filter((o) => o.type === 'category'));
  private readonly hangarClassNames = computed(() => new Set(this.hangar.ships().map((s) => s.shipClassName)));

  constructor() {
    // The "already in hangar" marks need the hangar list — load it once, lazily.
    if (this.auth.user() && this.hangar.ships().length === 0) void this.hangar.loadAll();
  }

  groupOptions(kind: string): SearchOption[] {
    return this.engine()
      .options()
      .filter((o) => (o.type === 'hit' && o.hit.kind === kind) || (o.type === 'more' && o.kind === kind));
  }

  optId(o: SearchOption): string {
    return `${this.listboxId()}-${o.id}`;
  }

  isActive(o: SearchOption): boolean {
    return this.engine().activeOption()?.id === o.id;
  }

  hover(o: SearchOption): void {
    const i = this.indexById().get(o.id);
    if (i != null) this.engine().setActive(i);
  }

  /**
   * Plain left click: a recent search runs in place, anything else lets the
   * anchor's routerLink navigate and tells the host to close. Modified and
   * middle clicks are the browser's (new tab) and leave the search open.
   */
  onClick(ev: MouseEvent, o: SearchOption): void {
    if (o.type === 'hit' || o.type === 'more') this.engine().remember();
    if (!isPlainLeftClick(ev)) return;
    if (o.type === 'recent') {
      ev.preventDefault();
      this.engine().searchFor(o.term);
      this.searched.emit();
      return;
    }
    this.navigated.emit();
  }

  onSuggest(ev: MouseEvent, name: string): void {
    if (!isPlainLeftClick(ev)) return;
    ev.preventDefault();
    this.engine().searchFor(name);
    this.searched.emit();
  }

  forgetRecent(): void {
    this.engine().forgetRecent();
    this.searched.emit();
  }

  title(hit: PolySearchHit): string {
    return hitTitle(hit, this.engine().lang());
  }

  mfr(hit: PolySearchHit): string | null {
    return hitManufacturer(hit, this.engine().lang());
  }

  iconKind(hit: PolySearchHit) {
    return polyHitIconKind(hit);
  }

  isUpcoming(hit: PolySearchHit): boolean {
    return isUpcomingHit(hit);
  }

  livery(hit: PolySearchHit): boolean {
    return isLivery(hit);
  }

  pinKind(hit: PolySearchHit) {
    return pinKindOf(hit);
  }

  inHangar(classNameSlug: string): boolean {
    return this.hangarClassNames().has(classNameSlug);
  }

  async addToHangar(slug: string): Promise<void> {
    // A second click while the insert is in flight must not add the ship twice.
    if (this.adding().has(slug)) return;
    this.adding.update((s) => new Set(s).add(slug));
    this.addFailed.set(null);
    try {
      if (!(await this.hangar.addShip(slug, 'owned'))) this.addFailed.set(slug);
    } catch {
      this.addFailed.set(slug);
    } finally {
      this.adding.update((s) => {
        const next = new Set(s);
        next.delete(slug);
        return next;
      });
    }
  }
}
