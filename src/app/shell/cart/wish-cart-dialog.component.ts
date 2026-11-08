import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { polyHitLink, type PolyHitKind } from '../../codex/codex-poly-search';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { hqNachschubPickLink } from '../../hq/hq-routes';
import { pickedShare, setPicked, toggleGroup, type FlowGroup } from '../../hq/plan/hq-nachschub-flow.util';
import { HQ_DIALOG_STYLES } from '../../hq/plan/hq-dialog.styles';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScEntryDirective } from '../../shared/entry-motion/entry-motion';
import { PATH_ICONS } from '../../shared/item-path/path-icons';
import { SilThumbComponent } from '../../shared/sil-thumb/sil-thumb.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { NachschubService } from '../../hq/nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS } from '../../hq/nachschub/step-icons';
import type { Recommendation } from '../../hq/nachschub/recommend';
import type { CartItem } from './wish-cart.model';
import { WishCartService } from './wish-cart.service';

const TRASH = ['M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5'] as const;
const PLUS = ['M12 5v14M5 12h14'] as const;
const MINUS = ['M5 12h14'] as const;
const CLOSE = ['M6 6l12 12M18 6L6 18'] as const;
const OPEN = ['M14 5h5v5M19 5l-8 8M17 14v5H5V7h5'] as const;

/**
 * `<sc-wish-cart>` - the Warenkorb (concept nachschub-hq, r4-d1-s2). The wishlist as a dialog with its own URL
 * (`?cart=1`, opened through {@link WishCartService}): grouped (Waffen first, craft groups last), a checkbox per group and
 * per position, larger silhouettes that are never stretched, a stepper and a red trash per position and per group
 * (undo toast, no question), the "Passt dazu" row with 3 suggestions, and one primary "In einen Nachschub" that carries
 * the selection to HQ Planen.
 */
@Component({
  selector: 'sc-wish-cart',
  standalone: true,
  imports: [RouterLink, TranslatePipe, ScActionDirective, ScDialogDirective, ScEntryDirective, ScTooltipDirective, SilThumbComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- The scrim does not close the cart (a selection would be lost): the X, Escape or the browser's back do. -->
    <div class="scrim">
      <section class="sheet cart" role="dialog" aria-modal="true" scDialog [scEntry]="'cart'" (scDialogEscape)="cart.close()"
               [attr.aria-label]="'cart.title' | translate" data-cart>
        <header class="dlg-head ce" style="--ce: 0">
          <span class="dlg-ic" aria-hidden="true"><svg viewBox="0 0 24 24">@for (d of wishPath; track $index) { <path [attr.d]="d" /> }</svg></span>
          <h2 class="dlg-title">
            {{ 'cart.title' | translate }}
            <small>{{ 'cart.summary' | translate: { n: cart.count(), g: cart.groups().length } }}</small>
          </h2>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'cart.close' | translate" [scTooltip]="'cart.close' | translate" scTooltipTier="label" (click)="cart.close()">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="close[0]" /></svg>
          </button>
        </header>

        <div class="dlg-body cart-body">
          @if (cart.count() === 0) {
            <div class="empty">
              <p class="empty-t">{{ 'cart.empty' | translate }}</p>
              <p class="empty-h">{{ 'cart.emptyHint' | translate }}</p>
            </div>
          } @else {
            <div class="groups">
              @for (g of cart.groups(); track g.id) {
                <section class="group ce" [class.bp]="g.type === 'blueprint'" [style.--n]="span(g)" [style.--ce]="$index + 1" [attr.aria-label]="groupTitle(g)">
                  <h3 class="g-head">
                    <input type="checkbox" class="chk" [checked]="share(g) === 1" [indeterminate]="share(g) === 0.5"
                           [attr.aria-label]="'cart.selectGroup' | translate: { name: groupTitle(g) }" (change)="onGroup(g)" />
                    @if (g.type === 'blueprint') { <span class="bp-node" aria-hidden="true"></span> }
                    <span class="g-name">{{ groupTitle(g) }}</span>
                    <small>{{ g.type === 'blueprint' && g.blueprint ? ('cart.blueprintQty' | translate: { n: g.blueprint.qty, name: blueprintName(g) }) : g.rows.length }}</small>
                    <button type="button" scAction tier="tertiary" tone="danger" class="g-trash"
                            [attr.aria-label]="'cart.removeGroup' | translate: { name: groupTitle(g) }"
                            [scTooltip]="'cart.removeGroup' | translate: { name: groupTitle(g) }" scTooltipTier="label" (click)="removeGroup(g)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="trash[0]" /></svg>
                    </button>
                  </h3>
                  <div class="tiles">
                    @for (r of g.rows; track r.key) {
                      @let it = cart.byKey().get(r.key);
                      @if (it) {
                        @let chkId = 'cart-chk-' + g.id + '-' + $index;
                        <div class="tile" [class.sel]="(picks().get(r.key) ?? 0) > 0">
                          <input type="checkbox" class="chk tile-chk" [id]="chkId" [checked]="(picks().get(r.key) ?? 0) > 0"
                                 [attr.aria-label]="'cart.select' | translate: { name: cart.nameOf(it) }" (change)="onTile(g, r.key, r.qty)" />
                          <!-- A click on the picture or the name ticks the position (the label of its checkbox); the Codex page is the arrow. -->
                          <label class="pickarea" [for]="chkId">
                            <span class="sil"><sc-sil-thumb [kind]="it.kind" [className]="it.className" /></span>
                            <span class="nm">{{ cart.nameOf(it) }}</span>
                            <small class="sub">{{ ('cart.kind.' + kindKey(it)) | translate }}@if (it.manufacturer) { · {{ it.manufacturer }} }</small>
                          </label>
                          <a scAction tier="tertiary" class="open" [routerLink]="link(it)" (click)="onOpen($event)"
                             [attr.aria-label]="'cart.open' | translate: { name: cart.nameOf(it) }" [scTooltip]="'cart.open' | translate: { name: cart.nameOf(it) }" scTooltipTier="label">
                            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="openIcon[0]" /></svg>
                          </a>
                          <span class="foot">
                            <span class="step" role="group" [attr.aria-label]="'cart.qtyOf' | translate: { name: cart.nameOf(it) }">
                              <button type="button" [disabled]="it.qty <= 1" [attr.aria-label]="'cart.less' | translate" (click)="bump(it, -1)">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="minus[0]" /></svg>
                              </button>
                              <b>{{ it.qty }}@if (it.kind === 'material') { <small class="unit"> {{ 'blueprint.detail.unitScu' | translate }}</small> }</b>
                              <button type="button" [disabled]="it.qty >= 999" [attr.aria-label]="'cart.more' | translate" (click)="bump(it, 1)">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="plus[0]" /></svg>
                              </button>
                            </span>
                            <button type="button" scAction tier="tertiary" tone="danger"
                                    [attr.aria-label]="'cart.remove' | translate: { name: cart.nameOf(it) }"
                                    [scTooltip]="'cart.remove' | translate: { name: cart.nameOf(it) }" scTooltipTier="label" (click)="cart.remove([it])">
                              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="trash[0]" /></svg>
                            </button>
                          </span>
                        </div>
                      }
                    }
                  </div>
                </section>
              }
            </div>

          }
        </div>

      @if (cart.suggestions().length) {
        <section class="sugs ce" style="--ce: 5" [attr.aria-label]="'cart.suggest.title' | translate">
          <h3 class="s-head">{{ 'cart.suggest.title' | translate }} <small>{{ 'cart.suggest.count' | translate: { n: cart.suggestions().length } }}</small></h3>
          <div class="s-row">
            @for (s of cart.suggestions(); track s.className) {
              <div class="sug">
                <span class="sug-img"><sc-sil-thumb [kind]="sugKind(s)" [className]="s.className" /></span>
                <span class="sug-t">
                  <b>{{ s.name }}</b>
                  <span class="reason">{{ ('hq.nachschub.rec.reason.' + s.reason) | translate: s.params }}</span>
                  <span class="sug-act">
                    <button type="button" scAction tier="secondary" (click)="addSug(s)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="plus[0]" /></svg>
                      <span>{{ 'cart.suggest.add' | translate }}</span>
                    </button>
                    <button type="button" scAction tier="tertiary" [attr.aria-label]="'cart.suggest.dismiss' | translate: { name: s.name }"
                            [scTooltip]="'cart.suggest.dismiss' | translate: { name: s.name }" scTooltipTier="label" (click)="cart.dismiss(s.className)">
                      <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="close[0]" /></svg>
                    </button>
                  </span>
                </span>
              </div>
            }
          </div>
        </section>
      }

        <footer class="dlg-foot ce" style="--ce: 6">
          <span class="sel-count" role="status"><b>{{ selectedCount() }}</b> {{ 'cart.selected' | translate }}</span>
          <span class="sp"></span>
          @if (ns.newBlock()) {
            <span class="full-hint" role="status">{{ 'cart.slotsFullHint' | translate }}</span>
          }
          <button type="button" scAction tier="secondary" [disabled]="picks().size === 0" (click)="picks.set(emptyPicks)"><span>{{ 'cart.clear' | translate }}</span></button>
          <a scAction tier="primary" class="go" [class.off]="picks().size === 0" [attr.aria-disabled]="picks().size === 0 ? 'true' : null"
             [routerLink]="['/hq']" [fragment]="'planen'" [queryParams]="pickParams()" (click)="onGo($event)">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of nachschubPath; track $index) { <path [attr.d]="d" /> }</svg>
            <span>{{ (ns.newBlock() ? 'cart.toExisting' : 'cart.toNachschub') | translate }}</span>
          </a>
        </footer>
      </section>
    </div>
  `,
  styles: [
    HQ_DIALOG_STYLES,
    `
      :host { display: contents; }
      .dlg-foot { flex-wrap: wrap; }
      .full-hint { color: var(--sc-fg-2); font-size: max(0.82rem, var(--sc-fs-floor, 0.75rem)); max-width: 46ch; flex: 1 1 18ch; }
      .cart { --dlg-w: min(1180px, 100%); --dlg-h: min(860px, 100%); }
      .cart-body { gap: 14px; }
      .groups { flex: none; }
      /* Passt dazu sits outside the scrolling groups: a long wishlist never pushes it below the fold. */
      .sugs { flex: none; margin: 0 var(--sc-space-4, 16px) 12px; }
      .groups { display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; }
      .group {
        --n: 1; flex: var(--n) 1 calc(var(--n) * 168px); min-width: min(100%, 168px); display: flex; flex-direction: column;
        padding: 4px 8px 8px; border: 1px solid var(--sc-border); border-radius: 12px; background: color-mix(in srgb, var(--sc-bg-0) 40%, transparent);
      }
      .g-head { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 8px; margin: 0; min-height: 40px; font: 600 0.78rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-accent); }
      .g-head small { font: 500 0.78rem var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); }
      .g-name { min-width: 0; overflow-wrap: break-word; }
      .g-trash { margin-left: auto; }
      .bp-node { width: 9px; height: 9px; flex: none; border-radius: 2px; transform: rotate(45deg); border: 1.5px solid var(--sc-accent); }
      .tiles { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 8px; }
      .tile { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 8px; border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-1) 85%, transparent); min-width: 0; }
      .tile.sel { border-color: var(--sc-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--sc-accent) 25%, transparent); }
      .tile-chk { position: absolute; top: 8px; left: 8px; z-index: 1; }
      .pickarea { display: flex; flex-direction: column; gap: 2px; min-width: 0; cursor: pointer; }
      .open { position: absolute; top: 4px; right: 4px; z-index: 1; }
      .sil { display: block; height: 96px; margin-bottom: 4px; padding: 10px 8px; border-radius: 8px; color: var(--sc-fg-1);
        background: radial-gradient(ellipse at 50% 80%, color-mix(in srgb, var(--sc-accent) 14%, transparent), transparent 70%), color-mix(in srgb, var(--sc-accent) 4%, transparent); }
      .pickarea:hover .sil { background-color: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
      .nm { font-size: 0.82rem; font-weight: 600; color: var(--sc-fg-0); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sub { font-size: max(0.72rem, var(--sc-fs-floor, 0.75rem)); color: var(--sc-fg-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .foot { display: flex; align-items: center; justify-content: space-between; margin-top: 4px; gap: 4px; }
      .step { display: inline-flex; align-items: center; border: 1px solid var(--sc-border); border-radius: 999px; overflow: hidden; }
      .step button { display: grid; place-items: center; width: 30px; height: 30px; border: 0; background: transparent; color: var(--sc-fg-1); cursor: pointer; }
      .step button:hover:not(:disabled) { background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-fg-0); }
      .step button:disabled { opacity: 0.4; cursor: default; }
      .step button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .step svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .step b .unit { font-size: 0.68rem; font-weight: 600; color: var(--sc-fg-2); }
      .step b { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; font-size: 0.85rem; }
      .chk {
        appearance: none; -webkit-appearance: none; width: 20px; height: 20px; flex: none; margin: 0; display: grid; place-content: center; cursor: pointer;
        border: 1.5px solid color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); border-radius: 6px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
      }
      .chk:checked, .chk:indeterminate { background: var(--sc-accent); border-color: var(--sc-accent); }
      .chk:checked::after { content: ''; width: 5px; height: 10px; border: solid var(--sc-bg-0); border-width: 0 2.4px 2.4px 0; transform: translateY(-1px) rotate(45deg); }
      .chk:indeterminate::after { content: ''; width: 10px; height: 2.4px; background: var(--sc-bg-0); border-radius: 2px; }
      .chk:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .sugs { padding: 10px 14px 12px; border: 1px solid color-mix(in srgb, var(--sc-warning) 35%, transparent); border-radius: 12px; background: linear-gradient(90deg, color-mix(in srgb, var(--sc-warning) 7%, transparent), transparent); }
      .s-head { margin: 0 0 8px; font: 600 0.78rem/1.2 var(--sc-font-display, inherit); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-warning); }
      .s-head small { font: 500 0.78rem var(--sc-font-body, inherit); letter-spacing: 0; text-transform: none; color: var(--sc-fg-2); margin-left: 6px; }
      .s-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .sug { display: grid; grid-template-columns: 84px minmax(0, 1fr); align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 50%, transparent); }
      .sug-img { display: block; height: 64px; padding: 4px; border-radius: 7px; background: color-mix(in srgb, var(--sc-accent) 6%, transparent); color: var(--sc-fg-1); }
      .sug-t { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; min-width: 0; }
      .sug-t b { font-size: 0.85rem; overflow-wrap: anywhere; }
      .reason { padding: 1px 8px; border-radius: 999px; background: color-mix(in srgb, var(--sc-warning) 14%, transparent); font-size: 0.74rem; color: var(--sc-warning); }
      .sug-act { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
      .sel-count { font-size: 0.85rem; color: var(--sc-fg-1); }
      .sel-count b { color: var(--sc-accent); font-variant-numeric: tabular-nums; }
      .go.off { opacity: 0.45; cursor: default; }
      .empty { display: grid; place-items: center; gap: 4px; padding: 40px 16px; text-align: center; }
      .empty-t { margin: 0; font-weight: 600; }
      .empty-h { margin: 0; color: var(--sc-fg-2); font-size: 0.85rem; }
      @media (max-width: 900px) {
        .group { flex-basis: 100%; }
        .s-row { grid-template-columns: 1fr; }
      }
      @media (pointer: coarse), (max-width: 749px) {
        .step button { width: 44px; height: 44px; }
        .chk { width: 24px; height: 24px; }
      }
    `,
  ],
})
export class WishCartDialogComponent {
  protected readonly cart = inject(WishCartService);
  /** `newBlock()` is set while all 7 slots are taken: the selection can then only join an existing Nachschub. */
  protected readonly ns = inject(NachschubService);

  protected readonly wishPath = PATH_ICONS.wish;
  protected readonly nachschubPath = NACHSCHUB_ICON_PATHS;
  protected readonly trash = TRASH;
  protected readonly plus = PLUS;
  protected readonly minus = MINUS;
  protected readonly close = CLOSE;
  protected readonly openIcon = OPEN;
  protected readonly emptyPicks: ReadonlyMap<string, number> = new Map();

  /** The selection: position key -> picked quantity (the whole quantity unless a split was made in Planen). */
  protected readonly picks = signal<ReadonlyMap<string, number>>(this.emptyPicks);
  protected readonly selectedCount = computed(() => this.picks().size);
  protected readonly pickParams = computed(() => hqNachschubPickLink([...this.picks()].map(([key, qty]) => ({ key, qty }))).queryParams ?? {});

  constructor() {
    this.cart.ensureCatalogue();
    void this.ns.ensureLoaded();
    // A removed position drops out of the selection.
    effect(() => {
      const have = this.cart.byKey();
      const cur = this.picks();
      if ([...cur.keys()].some((k) => !have.has(k))) this.picks.set(new Map([...cur].filter(([k]) => have.has(k))));
    });
  }

  protected span(g: FlowGroup): number {
    return Math.min(3, Math.max(1, g.rows.length));
  }

  protected share(g: FlowGroup): number {
    return pickedShare(g.rows, this.picks());
  }

  private readonly translate = inject(TranslateService);

  /** "Waffen", "Rüstung", ... or, for a blueprint group, "für Gallant craften" (the blueprint's catalogue name). */
  protected groupTitle(g: FlowGroup): string {
    if (g.type !== 'blueprint') return g.titleKey ? this.translate.instant(g.titleKey) : '';
    const className = g.blueprint?.className ?? g.rows.find((r) => r.forClassName)?.forClassName ?? '';
    const name = this.cart.nameOf({ kind: 'blueprint', className, name: g.blueprint?.name ?? null });
    return this.translate.instant('cart.forBlueprint', { name });
  }

  protected blueprintName(g: FlowGroup): string {
    const className = g.blueprint?.className ?? g.rows.find((r) => r.forClassName)?.forClassName ?? '';
    return this.cart.nameOf({ kind: 'blueprint', className, name: g.blueprint?.name ?? null });
  }

  protected onGroup(g: FlowGroup): void {
    this.picks.set(toggleGroup(g, this.picks()));
  }

  protected onTile(g: FlowGroup, key: string, qty: number): void {
    const on = (this.picks().get(key) ?? 0) > 0;
    this.picks.set(setPicked(g, this.picks(), key, on ? 0 : qty));
  }

  protected removeGroup(g: FlowGroup): void {
    const items = g.rows.map((r) => this.cart.byKey().get(r.key)).filter((i): i is CartItem => !!i);
    this.cart.remove(items, 'cart.removedGroup', { name: this.groupTitle(g), n: items.length });
  }

  protected bump(i: CartItem, by: number): void {
    void this.cart.setQty(i, i.qty + by);
    // A picked position follows its new quantity.
    const have = this.picks().get(i.key);
    if (have !== undefined) this.picks.update((m) => new Map(m).set(i.key, Math.min(999, Math.max(1, i.qty + by))));
  }

  protected link(i: CartItem): string[] {
    return polyHitLink({ kind: (i.kind === 'upcoming' ? 'upcoming' : i.kind) as PolyHitKind, classNameSlug: i.className });
  }

  protected kindKey(i: CartItem): string {
    return ['ship', 'vehicle', 'upcoming', 'weapon', 'component', 'item', 'blueprint', 'material', 'ammunition'].includes(i.kind) ? i.kind : 'item';
  }

  protected sugKind(s: Recommendation): string {
    return s.bucket === 'weapon' ? 'weapon' : 'item';
  }

  protected addSug(s: Recommendation): void {
    void this.cart.addSuggestion(s);
  }

  /** The Codex page of a position: a plain click leaves the cart for it, a modified click opens a tab and keeps it. */
  protected onOpen(ev: MouseEvent): void {
    if (isPlainLeftClick(ev)) void this.cart.close();
  }

  protected onGo(ev: MouseEvent): void {
    if (this.picks().size === 0) ev.preventDefault();
  }
}
