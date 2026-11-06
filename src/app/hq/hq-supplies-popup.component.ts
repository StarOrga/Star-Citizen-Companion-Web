import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { isPlainLeftClick } from '../core/modified-click.util';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { OverlayFrameComponent } from '../shared/overlay-frame/overlay-frame.component';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';
import { ScActionDirective } from '../shared/action/sc-action.directive';
import { UndoToastService } from '../shared/undo-toast/undo-toast.service';
import { HangarService } from '../hangar/hangar.service';
import { ItemPathService, PLACE_WITH_ME, type PathResult } from './data/item-path.service';
import { WishlistStore, type WishRow } from './data/wishlist.store';
import { type HqListTab } from './hq-routes';
import { placeLabel } from './now/hq-live.util';
import { ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';
import { HqOwnershipService } from './hq-ownership.service';
import { WishNamesService } from '../codex/search/wish-names.service';
import { humanizeClassName } from '../codex/codex-format';
import { HqSuppliesService, SUPPLY_QTY_MAX, SupplyItem, lineAmount, setKey, supplyQtyText } from './hq-supplies.service';
import { buildPlanSets } from './plan/hq-plan-needs';

/**
 * "Nachschub" as a popup (shell beta, implement.md §12): a task list crossed with
 * a shopping cart - lines you tick off ("besorgt"), each with a quantity, and a
 * cart-style footer with what is still open. Built on the shared overlay frame
 * (`popup` mode): a centred sheet on desktop, a sheet on tablets, full screen in
 * `dvh` on phones. Close = X, Escape, scrim.
 *
 * New lines come from the search, never as free text: a line has to be a real item, or nothing can
 * say where to get it.
 */
@Component({
  selector: 'sc-hq-supplies-popup',
  standalone: true,
  imports: [TranslatePipe, FormsModule, RouterLink, ScTooltipDirective, ScActionDirective, OverlayFrameComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <sc-overlay-frame [heading]="'hq.supplies.title' | translate" [popup]="true" (closed)="closed.emit()">
      <div class="tabs" role="tablist" [attr.aria-label]="'hq.supplies.tabsAria' | translate">
        <button type="button" role="tab" class="tab" id="sup-tab-wish" aria-controls="sup-panel" [attr.aria-selected]="tab() === 'wish'"
                [attr.tabindex]="tab() === 'wish' ? 0 : -1" (click)="tab.set('wish')">
          {{ 'hq.supplies.tabs.wish' | translate }} <b class="mono">{{ wishRows().length }}</b>
        </button>
        <button type="button" role="tab" class="tab" id="sup-tab-nachschub" aria-controls="sup-panel" [attr.aria-selected]="tab() === 'nachschub'"
                [attr.tabindex]="tab() === 'nachschub' ? 0 : -1" (click)="tab.set('nachschub')">
          {{ 'hq.supplies.tabs.nachschub' | translate }} <b class="mono">{{ svc.open().length }}</b>
        </button>
      </div>
      <div id="sup-panel" role="tabpanel" [attr.aria-labelledby]="'sup-tab-' + tab()">
      <div class="add">
        <button type="button" scAction tier="secondary" (click)="searchItem()"><span>{{ 'hq.supplies.add.search' | translate }}</span></button>
      </div>

      @if (tab() === 'wish') {
        @if (wishRows().length === 0) {
          <div class="empty">
            <p class="empty-title">{{ 'hq.supplies.wish.empty' | translate }}</p>
            <p class="hint">{{ 'hq.supplies.wish.emptyHint' | translate }}</p>
          </div>
        } @else {
          <ul class="list">
            @for (w of wishRows(); track w.kind + ':' + w.className) {
              <li class="line">
                <span class="check"><span class="name-txt">{{ wishName(w) }}</span></span>
                @if (w.kind === 'upcoming') {
                  <span class="chip">{{ 'hq.supplies.wish.notYet' | translate }}</span>
                } @else {
                  <button type="button" scAction tier="secondary" (click)="toNachschub(w, $event)"><span>{{ 'hq.supplies.wish.toNachschub' | translate }}</span></button>
                }
                <button type="button" class="step rm" [attr.aria-label]="'hq.supplies.wish.remove' | translate: { name: wishName(w) }"
                        [scTooltip]="'hq.supplies.wish.remove' | translate: { name: wishName(w) }" scTooltipTier="label" (click)="removeWish(w)">✕</button>
              </li>
            }
          </ul>
        }
      } @else {
      @if (svc.items().length === 0) {
        <div class="empty">
          <p class="empty-title">{{ 'hq.supplies.empty' | translate }}</p>
          <p class="hint">{{ 'hq.supplies.emptyHint' | translate }}</p>
        </div>
      } @else {
        <ul class="list">
          @for (i of svc.items(); track i.id) {
            <li class="line" [class.done]="i.done">
              <label class="check">
                <input type="checkbox" [checked]="i.done" (change)="svc.toggle(i.id)" />
                <span class="name-txt">{{ i.name }}</span>
              </label>
              <span class="meta">
                @if (setName(i); as sn) { <span class="set">{{ 'hq.supply.forSet' | translate: { name: sn } }}</span> }
                @if (i.forClassName; as bp) { <span class="set">{{ 'hq.supply.forBlueprint' | translate: { name: blueprintName(bp) } }}</span> }
                @if (i.stepKind === 'mission' && i.entityKind === 'blueprint' && i.className) {
                  <a class="chip chip-link" [routerLink]="['/codex/blueprint', i.className]" (click)="leaveOnPlainClick($event)">{{ 'hq.step.kind.mission' | translate }}</a>
                } @else if (i.stepKind) {
                  <span class="chip">{{ 'hq.step.kind.' + i.stepKind | translate }}</span>
                }
                @if (i.done) { <span class="chip ready">{{ 'hq.supply.ready' | translate }}</span> }
              </span>
              @if (i.setId) {
                <label class="wanted" [scTooltip]="'hq.supply.wanted' | translate" scTooltipTier="label">
                  <input type="checkbox" [checked]="i.wanted" [attr.aria-label]="'hq.supply.wantedAria' | translate: { name: i.name }"
                         (change)="svc.setWanted(i.id, !i.wanted)" />
                </label>
              }
              <span class="stepper" role="group" [attr.aria-label]="'hq.supplies.qtyOf' | translate: { name: i.name }">
                <button type="button" class="step" [disabled]="i.qty <= 1" [attr.aria-label]="'hq.supplies.less' | translate"
                        [scTooltip]="'hq.supplies.less' | translate" scTooltipTier="label" (click)="svc.setQty(i.id, i.qty - 1)">−</button>
                <b class="n mono">{{ qtyText(i) }}</b>
                <button type="button" class="step" [disabled]="i.qty >= qtyMax" [attr.aria-label]="'hq.supplies.more' | translate"
                        [scTooltip]="'hq.supplies.more' | translate" scTooltipTier="label" (click)="svc.setQty(i.id, i.qty + 1)">+</button>
              </span>
              @if (!i.done && i.className && i.entityKind) {
                <button type="button" scAction tier="secondary" [attr.aria-expanded]="gotId() === i.id" (click)="openGot(i)"><span>{{ 'hq.supplies.got' | translate }}</span></button>
              }
              <button type="button" class="step rm" [attr.aria-label]="'hq.supplies.remove' | translate: { name: i.name }"
                      [scTooltip]="'hq.supplies.remove' | translate: { name: i.name }" scTooltipTier="label" (click)="svc.remove(i.id)">✕</button>
              @if (gotId() === i.id) {
                <div class="place" role="group" [attr.aria-label]="'hq.supplies.place.title' | translate">
                  <span class="place-title">{{ 'hq.supplies.place.title' | translate }}</span>
                  <span class="place-opts">
                    @for (p of placeOptions(); track p) {
                      <button type="button" class="chip-btn" [class.on]="!otherOn() && place() === p" [attr.aria-pressed]="!otherOn() && place() === p"
                              (click)="pickPlace(p)">{{ placeText(p) }}</button>
                    }
                    <button type="button" class="chip-btn" [class.on]="otherOn()" [attr.aria-pressed]="otherOn()" (click)="otherOn.set(true)">{{ 'hq.supplies.place.other' | translate }}</button>
                  </span>
                  @if (otherOn()) {
                    <input class="place-in" type="text" maxlength="200" autocomplete="off" [ngModel]="place()" (ngModelChange)="place.set($event)"
                           [attr.placeholder]="'hq.supplies.place.otherPlaceholder' | translate" [attr.aria-label]="'hq.supplies.place.otherPlaceholder' | translate" />
                  }
                  <span class="place-acts">
                    <button type="button" scAction tier="secondary" [disabled]="!place().trim()" (click)="store(i)"><span>{{ 'hq.supplies.place.store' | translate }}</span></button>
                    <button type="button" scAction tier="secondary" (click)="tickOnly(i)"><span>{{ 'hq.supplies.place.tickOnly' | translate }}</span></button>
                  </span>
                </div>
              }
            </li>
          }
        </ul>
        <footer class="cart">
          <span class="sum" role="status">{{ 'hq.supplies.sum' | translate: { open: svc.open().length, units: svc.openUnits(), done: svc.done().length } }}</span>
          @if (svc.done().length) {
            <button type="button" class="sc-btn small ghost" (click)="svc.clearDone()">{{ 'hq.supplies.clearDone' | translate }}</button>
          }
        </footer>
      }
      }
      </div>
    </sc-overlay-frame>
  `,
  styles: [
    `
      :host { display: contents; }
      .tabs { display: flex; gap: var(--sc-space-1, 4px); margin-bottom: var(--sc-space-3, 12px); border-bottom: 1px solid var(--sc-border); }
      .tab { display: inline-flex; align-items: center; gap: 6px; min-height: var(--sc-tap-min, 44px); padding: 0 var(--sc-space-3, 12px); background: none; border: 0;
        border-bottom: 2px solid transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .tab:hover { color: var(--sc-fg-0); }
      .tab[aria-selected='true'] { color: var(--sc-accent); border-bottom-color: var(--sc-accent); }
      .tab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .line { flex-wrap: wrap; }
      @media (max-width: 720px) {
        .line .check { flex: 1 1 100%; }
        .line .rm { margin-inline-start: auto; }
      }
      .place { flex: 1 1 100%; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px); border-radius: 8px;
        background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
      .place-title { color: var(--sc-fg-1); }
      .place-opts, .place-acts { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); align-items: center; }
      .chip-btn { min-height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--sc-border); background: none; color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .chip-btn.on { border-color: var(--sc-accent); color: var(--sc-accent); }
      .chip-btn:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .place-in { min-height: 40px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--sc-border); background: var(--sc-bg-1); color: var(--sc-fg-0); font: inherit; }
      .place-in:focus { outline: none; border-color: var(--sc-accent); }
      @media (pointer: coarse) { .tab, .chip-btn, .place-in { min-height: 48px; } }
      .add { display: flex; gap: var(--sc-space-2, 8px); flex-wrap: wrap; margin-bottom: var(--sc-space-4, 16px); }
      .empty { display: flex; flex-direction: column; gap: 6px; }
      .empty-title { margin: 0; color: var(--sc-fg-0); }
      .hint { margin: 0; color: var(--sc-fg-2); }
      .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; border-top: 1px solid var(--sc-border); }
      .line { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) 0; border-bottom: 1px solid var(--sc-border); }
      .check { display: flex; align-items: center; gap: var(--sc-space-3, 12px); flex: 1 1 auto; min-width: 0; min-height: var(--sc-tap-min, 44px); cursor: pointer; }
      .check input { width: 20px; height: 20px; flex: 0 0 auto; accent-color: var(--sc-accent); cursor: pointer; }
      .check input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .name-txt { overflow-wrap: anywhere; color: var(--sc-fg-0); }
      .line.done .name-txt { color: var(--sc-fg-2); text-decoration: line-through; }
      .meta { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 0 1 auto; }
      .set { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .chip-link { color: var(--sc-accent); text-decoration: none; }
      .chip-link:hover, .chip-link:focus-visible { border-color: var(--sc-accent); }
      .chip { padding: 0 8px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: max(0.75rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .chip.ready { color: var(--sc-accent); border-color: var(--sc-accent); }
      .wanted { display: inline-grid; place-items: center; min-width: 36px; min-height: 36px; cursor: pointer; }
      .wanted input { width: 18px; height: 18px; accent-color: var(--sc-accent); cursor: pointer; }
      .stepper { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
      .n { min-width: 2.2em; text-align: center; font-variant-numeric: tabular-nums; }
      .step { display: inline-grid; place-items: center; min-width: 36px; min-height: 36px; border-radius: 8px; border: 1px solid var(--sc-border);
        background: var(--sc-bg-0); color: var(--sc-fg-1); font: inherit; cursor: pointer; }
      .step:hover:not(:disabled), .step:focus-visible { border-color: var(--sc-accent); color: var(--sc-accent); outline: none; }
      .step:focus-visible { box-shadow: 0 0 0 2px var(--sc-accent); }
      .step:disabled { opacity: 0.4; cursor: default; }
      .rm { border-color: transparent; background: none; }
      .cart { display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-3, 12px); flex-wrap: wrap;
        margin-top: var(--sc-space-4, 16px); padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border-radius: 8px;
        background: var(--sc-bg-0); border: 1px solid var(--sc-border); }
      .sum { color: var(--sc-fg-1); }
      @media (pointer: coarse) { .step { min-width: 44px; min-height: 44px; } }
    `,
  ],
})
export class HqSuppliesPopupComponent {
  protected readonly svc = inject(HqSuppliesService);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly chrome = inject(ShellChromeService);
  private readonly path = inject(ItemPathService);
  private readonly wishlist = inject(WishlistStore);
  private readonly toast = inject(UndoToastService);
  private readonly wishNames = inject(WishNamesService);
  private readonly translate = inject(TranslateService);
  readonly closed = output<void>();

  /** A plain click on a link leaves the popup with it; Ctrl/⌘/middle click keeps it open. */
  protected leaveOnPlainClick(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) this.closed.emit();
  }

  /** Which tab opens first (`/hq?list=wish#planen` opens the wishlist). */
  readonly startTab = input<HqListTab>('nachschub');
  protected readonly tab = signal<HqListTab>('nachschub');

  /** The one wishlist: the table rows (announced ships included) plus the hangar's wished live ships. */
  protected readonly wishRows = computed<readonly WishRow[]>(() => {
    const rows: WishRow[] = [
      ...this.wishlist.rows(),
      ...this.hangar.ships().filter((s) => s.status === 'wishlist').map((s): WishRow => ({
        kind: 'ship', className: s.shipClassName, name: null, manufacturer: null, rsiUrl: null, notes: null, createdAt: s.createdAt,
      })),
    ];
    // Entries stored without a name resolve from the catalog; the row shows the class name meanwhile.
    this.wishNames.request(rows.filter((w) => !w.name && w.kind !== 'upcoming').map((w) => w.className));
    return rows;
  });

  protected wishName(w: WishRow): string {
    return w.name || this.wishNames.nameOf(w.kind, w.className) || humanizeClassName(w.className);
  }

  /** The line whose place step is open, and what it would write. */
  protected readonly gotId = signal<string | null>(null);
  protected readonly place = signal(PLACE_WITH_ME);
  protected readonly otherOn = signal(false);
  protected readonly placeOptions = computed(() => {
    const first = this.path.currentPlaceDefault();
    return [first, ...this.path.knownPlaces().filter((p) => p !== first)].slice(0, 5);
  });

  constructor() {
    void this.wishlist.ensureLoaded();
    void this.path.ensureLoaded();
    queueMicrotask(() => this.tab.set(this.startTab()));
  }

  protected placeText(p: string): string {
    return placeLabel(p, this.translate.getCurrentLang());
  }

  protected openGot(i: SupplyItem): void {
    if (this.gotId() === i.id) {
      this.gotId.set(null);
      return;
    }
    this.place.set(this.path.currentPlaceDefault());
    this.otherOn.set(false);
    this.gotId.set(i.id);
  }

  protected pickPlace(p: string): void {
    this.otherOn.set(false);
    this.place.set(p);
  }

  protected async store(i: SupplyItem): Promise<void> {
    if (!i.className || !i.entityKind) return;
    this.report(await this.path.moveToInventar(i.entityKind, i.className, i.name, this.place(), lineAmount(i), { lineId: i.id, unit: i.unit ?? 'pcs' }));
    this.gotId.set(null);
  }

  protected tickOnly(i: SupplyItem): void {
    if (!i.className) return;
    this.report(this.path.tickOnly(i.className, i.id));
    this.gotId.set(null);
  }

  protected async toNachschub(w: WishRow, ev: Event): Promise<void> {
    (ev.currentTarget as HTMLElement | null)?.blur();
    this.report(await this.path.addToNachschub(w.kind, w.className, this.wishName(w), 1));
  }

  protected async removeWish(w: WishRow): Promise<void> {
    this.report(await this.path.removeWish(w.kind, w.className, w.name));
  }

  /** A write's result: its toast with undo, or the translated error as a toast without. */
  private report(res: PathResult): void {
    const undo = res.undo;
    this.toast.offer({
      messageKey: res.key,
      messageParams: res.params,
      commit: () => undefined,
      onUndo: () => void undo?.(),
    });
  }

  private readonly setNames = computed(
    () =>
      new Map(
        buildPlanSets(this.hangar.ships(), this.ownership.configs(), this.hangar.roleLoadouts(), this.svc.items()).map(
          (s) => [s.key, s.name] as const,
        ),
      ),
  );

  protected setName(i: SupplyItem): string | null {
    return i.setKind && i.setId ? (this.setNames().get(setKey(i.setKind, i.setId)) ?? null) : null;
  }

  protected readonly qtyMax = SUPPLY_QTY_MAX;
  protected readonly qtyText = supplyQtyText;

  protected blueprintName(className: string): string {
    return this.wishNames.nameOf('blueprint', className) || humanizeClassName(className);
  }

  /** The popup makes way for the search; the frame hands the focus back first, so the search asks after it. */
  protected searchItem(): void {
    this.closed.emit();
    setTimeout(() => this.chrome.startSupplySearch());
  }
}
