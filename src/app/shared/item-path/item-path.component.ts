import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { isPlainLeftClick } from '../../core/modified-click.util';
import {
  ItemPathService,
  PLACE_BLUEPRINTS,
  PLACE_WITH_ME,
  ownWordOf,
  type ItemPathState,
  type OwnWord,
  type PathResult,
  type PathStep,
} from '../../hq/data/item-path.service';
import { hangarRedirectLink, hqStockLink, type HqPageLink } from '../../hq/hq-routes';
import { placeLabel } from '../../hq/now/hq-live.util';
import { WishCartService } from '../../shell/cart/wish-cart.service';
import { ScActionDirective } from '../action/sc-action.directive';
import { ScDialogDirective } from '../dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { UndoToastService } from '../undo-toast/undo-toast.service';
import { PATH_ICONS } from './path-icons';

export type ItemPathLevel = 'tertiary' | 'secondary' | 'primary';
type PopMode = 'place' | 'error';

/** A stop has something in it: the wish node when the item is wished, the second node when it is owned / collected. */
export function isFilled(s: ItemPathState, step: PathStep): boolean {
  switch (step) {
    case 'wish': return s.wished;
    case 'nachschub': return s.nachschubQty > 0;
    case 'inventar': return s.inventarQty > 0;
    case 'hangar': return s.inHangar;
  }
}

/** The second node's step of a state: Hangar for ships, Inventar for the rest (Sammlung is the Inventar step of blueprints). */
export function ownStepOf(s: ItemPathState): PathStep | null {
  return s.steps.find((x) => x === 'inventar' || x === 'hangar') ?? null;
}

/**
 * What the pill offers without an override: the next thing this reader can do with this item. Announced ships end at
 * the wish; an owned item has nothing left to do; a wished one can be put into the Inventar / Hangar / Sammlung.
 */
export function nextStepOf(s: ItemPathState): PathStep | null {
  if (s.hint === 'notYetInGame') return s.wished ? null : 'wish';
  const own = ownStepOf(s);
  if (own && isFilled(s, own)) return null;
  if (!s.wished) return 'wish';
  return own;
}

/**
 * `sc-item-path`: the one control of the way an item takes - two nodes, Wunschliste -> Inventar / Hangar / Sammlung by
 * kind (concept nachschub-hq r4-d1-s8). No Nachschub node (Nachschub lives in the HQ) and no "Besitz" word.
 *
 *   <sc-item-path [kind]="kind" [className]="cls" [name]="title" level="tertiary" />
 *
 * An empty wish node puts one piece on the wishlist; a filled one shows the count and opens the cart. An empty second node
 * adds the item (Inventar asks for the place first); a filled one is a real link to the item in HQ Bestand / the ship in
 * the Hangar, with the count on it. Levels: `tertiary` the two nodes with count bullets (search rows, cards); `secondary`
 * the pill - the nodes plus the next step as a button; `primary` the detail page: both stops in words, a stepper on the
 * wish and on the Inventar count. `(leave)` fires when a plain click leaves the page, so a floating host can close itself.
 */
@Component({
  selector: 'sc-item-path',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, ScActionDirective, ScDialogDirective, ScTooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.ip-primary]': "level() === 'primary'" },
  template: `
    <ng-template #rail>
      <span class="rail">
        <button scAction tier="tertiary" type="button" class="node" data-step="wish" [class.on]="state().wished" [class.cur]="state().wished && !ownOn()"
                [busy]="busy() === 'wish'" [scTooltip]="wishLabel()" scTooltipTier="label" [attr.aria-label]="ariaName(wishLabel())"
                (click)="onWish($event)">
          <svg class="sc-action-icon" [class.is-filled]="state().wished" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
          @if (state().wishQty > 0) { <i class="n">{{ countText(state().wishQty) }}</i> }
        </button>
        @if (own(); as o) {
          <i class="link" [class.on]="state().wished || ownOn()"></i>
          @if (ownOn()) {
            <a scAction tier="tertiary" class="node on cur" [attr.data-step]="o" [routerLink]="ownLink().commands" [fragment]="ownLink().fragment"
               [queryParams]="ownLink().queryParams" [scTooltip]="ownLabel()" scTooltipTier="label" [attr.aria-label]="ariaName(ownLabel())"
               (click)="onLink($event)">
              <svg class="sc-action-icon is-filled" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
              <i class="n">{{ countText(ownQty()) }}</i>
            </a>
          } @else {
            <button scAction tier="tertiary" type="button" class="node" [class.open]="mode() === 'place'" [attr.data-step]="o" [busy]="busy() === o"
                    [scTooltip]="ownLabel()" scTooltipTier="label" [attr.aria-label]="ariaName(ownLabel())"
                    [attr.aria-haspopup]="o === 'inventar' && kind() !== 'blueprint' ? 'dialog' : null" [attr.aria-expanded]="o === 'inventar' && kind() !== 'blueprint' ? mode() === 'place' : null"
                    (click)="onOwnAdd($event)">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
            </button>
          }
        }
      </span>
    </ng-template>

    <ng-template #hint>
      @if (state().hint) { <i class="rdy">{{ 'itemPath.hint.notYetInGame' | translate }}</i> }
    </ng-template>

    @switch (level()) {
      @case ('tertiary') {
        <ng-container [ngTemplateOutlet]="rail" />
      }
      @case ('secondary') {
        <span class="pill">
          <ng-container [ngTemplateOutlet]="rail" />
          @if (next(); as step) {
            <button scAction tier="secondary" type="button" class="go" [busy]="busy() === step" (click)="onGo($event, step)">
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of goIcon(step); track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ goKey(step) | translate }}</span>
            </button>
          }
          <ng-container [ngTemplateOutlet]="hint" />
        </span>
      }
      @case ('primary') {
        <div class="primary">
          <ol class="path" [class.single]="!own()">
            <li class="stop" [class.on]="state().wished">
              <span class="stop-h">
                <svg class="sc-action-icon" [class.is-filled]="state().wished" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
                <b>{{ 'pathCtl.node.wish' | translate }}</b>
              </span>
              @if (state().wished) {
                <span class="st" role="group" [attr.aria-label]="'pathCtl.wishQty' | translate">
                  <button type="button" [attr.aria-label]="'pathCtl.less' | translate" (click)="stepWish(-1)">−</button>
                  <b>{{ state().wishQty }}</b>
                  <button type="button" [attr.aria-label]="'pathCtl.more' | translate" [disabled]="state().wishQty >= 999" (click)="stepWish(1)">+</button>
                </span>
                <button type="button" class="txt" (click)="openCart($event)">{{ 'pathCtl.openCart' | translate }}</button>
              } @else {
                <p>{{ 'pathCtl.wishOff' | translate }}</p>
                <button scAction tier="primary" type="button" [busy]="busy() === 'wish'" (click)="onGo($event, 'wish')">
                  <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
                  <span>{{ 'pathCtl.go.wish' | translate }}</span>
                </button>
              }
            </li>
            @if (own(); as o) {
              <li class="stop" [class.on]="ownOn()">
                <span class="stop-h">
                  <svg class="sc-action-icon" [class.is-filled]="ownOn()" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
                  <b>{{ 'pathCtl.node.' + word() | translate }}</b>
                </span>
                @if (ownOn()) {
                  @if (o === 'inventar' && kind() !== 'blueprint' && state().places.length) {
                    <span class="st" role="group" [attr.aria-label]="'pathCtl.ownQty.' + word() | translate">
                      <button type="button" [attr.aria-label]="'pathCtl.less' | translate" (click)="stepPlace(state().places[0].location, -1)">−</button>
                      <b>{{ ownQty() }}</b>
                      <button type="button" [attr.aria-label]="'pathCtl.more' | translate" (click)="stepPlace(state().places[0].location, 1)">+</button>
                    </span>
                  } @else {
                    <p>{{ ('pathCtl.ownOn.' + word()) | translate: { n: ownQty() } }}</p>
                  }
                  <a class="alink" [routerLink]="ownLink().commands" [fragment]="ownLink().fragment" [queryParams]="ownLink().queryParams" (click)="onLink($event)">{{ 'pathCtl.view.' + word() | translate }}</a>
                } @else {
                  <p>{{ ('pathCtl.ownOff.' + word()) | translate }}</p>
                  <button scAction tier="secondary" type="button" [busy]="busy() === o" (click)="onGo($event, o)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[word()!]; track $index) { <path [attr.d]="d" /> }</svg>
                    <span>{{ 'pathCtl.go.' + word() | translate }}</span>
                  </button>
                }
              </li>
            }
          </ol>
          <ng-container [ngTemplateOutlet]="hint" />
        </div>
      }
    }

    <ng-template #pop>
      @if (mode() === 'error') {
        <div class="rp err" role="alert">{{ errorKey() | translate }}</div>
      } @else {
        <div class="rp" role="dialog" tabindex="-1" scDialog scDialogInitialFocus="first" [scDialogReturnFocus]="anchor()"
             [attr.aria-label]="'pathCtl.whereTitle' | translate" (scDialogEscape)="closePop()">
          <div class="rp-h">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.inventar; track $index) { <path [attr.d]="d" /> }</svg>
            <b>{{ 'pathCtl.whereTitle' | translate }}</b>
          </div>
          <div class="places">
            @for (p of placeOptions(); track p; let first = $first) {
              <button type="button" class="place" [class.on]="first" (click)="choosePlace(p)">{{ placeText(p) }}</button>
            }
            <button type="button" class="place" [class.on]="otherOpen()" [attr.aria-expanded]="otherOpen()" (click)="openOther()">{{ 'pathCtl.otherPlace' | translate }}</button>
          </div>
          @if (otherOpen()) {
            <div class="other">
              <input #placeInput type="text" maxlength="120" [attr.aria-label]="'pathCtl.whereTitle' | translate"
                     [attr.placeholder]="'pathCtl.otherPlaceholder' | translate" (keydown.enter)="choosePlace(placeInput.value)" />
              <button scAction tier="secondary" type="button" (click)="choosePlace(placeInput.value)"><span>{{ 'pathCtl.store' | translate }}</span></button>
            </div>
          }
        </div>
      }
    </ng-template>
  `,
  styles: [`
    :host { display: inline-flex; align-items: center; flex: none; }
    :host(.ip-primary) { display: block; }

    .rail { display: inline-flex; align-items: center; }
    .node.sc-action.sc-action--tertiary {
      position: relative; display: grid; place-items: center;
      width: max(30px, var(--sc-tap-min, 0px)); height: max(30px, var(--sc-tap-min, 0px));
      border: 1px solid var(--sc-border); border-radius: 50%;
      color: var(--sc-fg-2); background: color-mix(in srgb, var(--sc-bg-0) 90%, transparent);
    }
    .node.sc-action svg { width: 15px; height: 15px; }
    .node.is-busy svg { display: none; }
    .node.sc-action.sc-action--tertiary:hover:not(.is-busy), .node.sc-action.sc-action--tertiary.open {
      color: var(--sc-accent); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-bg-0) 90%, transparent); filter: none;
    }
    .node.sc-action.sc-action--tertiary.on { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 60%, transparent); }
    .node.sc-action.cur { box-shadow: 0 0 0 2px color-mix(in srgb, var(--sc-accent) 22%, transparent), 0 0 12px color-mix(in srgb, var(--sc-accent) 35%, transparent); }
    .node.sc-action.open { box-shadow: 0 0 0 3px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
    @media (hover: hover) {
      .node:not(.on):not(.is-busy):hover::after {
        content: "+"; position: absolute; right: -4px; bottom: -4px; width: 14px; height: 14px; border-radius: 50%;
        background: var(--sc-accent); color: var(--sc-bg-0); font: 700 12px/14px var(--sc-font-body); text-align: center;
      }
    }
    .n {
      position: absolute; right: -2px; top: -3px; min-width: 15px; height: 15px; padding: 0 3px; border-radius: 8px;
      background: var(--sc-accent); color: var(--sc-bg-0); font: 600 10px/15px var(--sc-font-body); font-style: normal; text-align: center;
    }
    .link { display: block; width: 9px; height: 2px; background: var(--sc-border); }
    .link.on { background: var(--sc-accent); }

    .pill {
      display: inline-flex; align-items: center; gap: 10px; padding: 5px 6px 5px 8px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 45%, transparent); border-radius: 999px;
      background: color-mix(in srgb, var(--sc-accent) 7%, transparent); box-shadow: 0 0 22px color-mix(in srgb, var(--sc-accent) 12%, transparent);
    }
    .go.sc-action.sc-action--secondary {
      min-height: max(34px, var(--sc-tap-min, 0px)); padding: 4px 14px; border: 0; box-shadow: none;
      background: var(--sc-accent); color: var(--sc-bg-0); font-weight: 600; font-size: 0.8125rem;
    }
    .rdy {
      flex: none; padding: 1px 8px; border: 1px solid var(--sc-accent); border-radius: 999px;
      font-style: normal; font-size: 0.72rem; color: var(--sc-accent); white-space: nowrap;
    }

    .primary {
      display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 16px;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 40%, transparent); border-radius: 12px;
      background: color-mix(in srgb, var(--sc-accent) 5%, transparent);
    }
    .path { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none; }
    .path.single { grid-template-columns: minmax(0, 1fr); }
    .stop {
      position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px 14px;
      border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
    }
    .stop + .stop::before { content: ""; position: absolute; left: -19px; top: 28px; width: 18px; height: 2px; background: var(--sc-border); }
    .stop.on + .stop::before { background: var(--sc-accent); }
    .stop.on { border-color: color-mix(in srgb, var(--sc-accent) 50%, transparent); }
    .stop-h { display: inline-flex; align-items: center; gap: 8px; color: var(--sc-fg-1); }
    .stop.on .stop-h { color: var(--sc-accent); }
    .stop-h b { font: 500 0.8125rem/1.2 var(--sc-font-display); letter-spacing: 0.05em; }
    .stop p { margin: 0; color: var(--sc-fg-1); font-size: 0.8125rem; }
    svg.sc-action-icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    svg.sc-action-icon.is-filled { fill: color-mix(in srgb, currentColor 28%, transparent); }

    .txt {
      min-height: var(--sc-tap-min, 0px); padding: 4px 2px; border: 0; background: none; cursor: pointer; font: inherit; font-size: 0.8125rem;
      color: var(--sc-accent); text-decoration: underline; text-underline-offset: 3px;
    }
    .txt:focus-visible, .alink:focus-visible, .place:focus-visible, .st button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }

    .rp {
      box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; width: min(310px, calc(100vw - 16px)); padding: 12px;
      max-height: 60vh; max-height: 60dvh; overflow-y: auto;
      border: 1px solid color-mix(in srgb, var(--sc-accent) 30%, var(--sc-border)); border-radius: 12px;
      background: var(--sc-bg-1); color: var(--sc-fg-0); font-size: 0.875rem; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.65);
    }
    .rp:focus { outline: none; }
    .rp.err { color: var(--sc-danger); border-color: color-mix(in srgb, var(--sc-danger) 55%, transparent); }
    .rp-h { display: flex; align-items: center; gap: 8px; color: var(--sc-accent); }
    .rp-h b { font-weight: 600; color: var(--sc-fg-0); }
    .alink { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 0px); color: var(--sc-accent); font-size: 0.8125rem; text-decoration: none; }
    .alink:hover { text-decoration: underline; text-underline-offset: 3px; }
    .st { display: inline-flex; align-items: center; gap: 2px; flex: none; }
    .st button {
      width: max(30px, var(--sc-tap-min, 0px)); height: max(30px, var(--sc-tap-min, 0px)); padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 7px; background: none; color: var(--sc-fg-1);
    }
    .st button:hover:not(:disabled) { color: var(--sc-accent); border-color: var(--sc-accent); }
    .st button:disabled { opacity: 0.4; cursor: default; }
    .st b { min-width: 30px; text-align: center; font-weight: 500; font-variant-numeric: tabular-nums; }
    .places { display: flex; gap: 6px; flex-wrap: wrap; }
    .place {
      display: inline-flex; align-items: center; gap: 6px; min-height: max(34px, var(--sc-tap-min, 0px)); padding: 4px 12px; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 999px; background: none; color: var(--sc-fg-1);
    }
    .place:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
    .place.on { border-color: var(--sc-accent); color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .other { display: flex; align-items: center; gap: 8px; }
    .other input {
      flex: 1 1 auto; min-width: 0; min-height: max(36px, var(--sc-tap-min, 0px)); padding: 4px 10px; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 6px; background: var(--sc-bg-0); color: var(--sc-fg-0);
    }
    .other input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }

    @media (max-width: 640px) {
      .node.sc-action.sc-action--tertiary { width: max(44px, var(--sc-tap-min, 0px)); height: max(44px, var(--sc-tap-min, 0px)); }
      .link { width: 6px; }
      .path { grid-template-columns: minmax(0, 1fr); }
      .stop + .stop::before { display: none; }
      .pill { flex-wrap: wrap; border-radius: 18px; }
      .rp { width: calc(100vw - 16px); }
    }
  `],
})
export class ItemPathComponent implements OnDestroy {
  readonly kind = input.required<string>();
  readonly className = input.required<string>();
  readonly name = input<string | null>(null);
  readonly level = input<ItemPathLevel>('tertiary');
  /** What the pill offers as next step; null follows the state. */
  readonly nextStep = input<PathStep | null>(null);
  /** A plain click on a link is leaving: a floating host can close itself. */
  readonly leave = output<void>();

  private readonly path = inject(ItemPathService);
  /** Resolved on click only: building the cart (wishlist store, Supabase client) is not the price of drawing a path control. */
  private readonly toast = inject(UndoToastService);
  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly popTpl = viewChild.required<TemplateRef<unknown>>('pop');
  private readonly placeInput = viewChild<ElementRef<HTMLInputElement>>('placeInput');

  readonly icons = PATH_ICONS;
  private readonly translate = inject(TranslateService);

  /** A stored place as the reader sees it ("Bei mir" shows as "With me" in EN, ingame names are tidied). */
  placeText(place: string): string {
    return placeLabel(place, this.translate.getCurrentLang());
  }

  readonly state = computed(() => this.path.state(this.kind(), this.className(), this.name())());
  readonly busy = signal<PathStep | null>(null);
  readonly mode = signal<PopMode | null>(null);
  readonly errorKey = signal('');
  readonly anchor = signal<HTMLElement | null>(null);
  readonly otherOpen = signal(false);

  /** The second node's step (Inventar / Hangar), null for an announced ship. */
  readonly own = computed(() => ownStepOf(this.state()));
  /** Its word: Inventar, Hangar, or Sammlung for a blueprint. */
  readonly word = computed<OwnWord | null>(() => ownWordOf(this.kind()));
  readonly ownOn = computed(() => {
    const o = this.own();
    return !!o && isFilled(this.state(), o);
  });
  readonly ownQty = computed(() => (this.own() === 'hangar' ? 1 : this.state().inventarQty));
  readonly ownLink = computed<HqPageLink>(() => {
    const s = this.state();
    if (this.own() === 'hangar') return { commands: s.hangarShipId ? hangarRedirectLink(s.hangarShipId) : hqStockLink({ tab: 'hangar' }).commands, fragment: undefined };
    return hqStockLink({ tab: this.kind() === 'blueprint' ? 'sammlung' : 'inventar', focus: this.className() });
  });

  readonly next = computed<PathStep | null>(() => {
    const s = this.state();
    const wanted = this.nextStep();
    return wanted && s.steps.includes(wanted) ? wanted : nextStepOf(s);
  });

  readonly placeOptions = computed(() => {
    const first = this.path.currentPlaceDefault();
    return [first, ...this.path.knownPlaces().filter((p) => p !== first)].slice(0, 5);
  });

  private ref: OverlayRef | null = null;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly onScroll = (ev: Event): void => {
    if (this.ref && !this.ref.overlayElement.contains(ev.target as Node)) this.closePop();
  };

  constructor() {
    effect(() => this.path.ensureLoaded());
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.closePop();
  }

  private get label(): string {
    return this.name() ?? this.className();
  }

  ariaName(label: string): string {
    return this.name() ? `${label}: ${this.name()}` : label;
  }

  countText(n: number): string {
    return n > 99 ? '99+' : String(n);
  }

  /** Tooltip and name of the wish node: add, or "n on the wishlist - open". */
  wishLabel(): string {
    const s = this.state();
    return this.translate.instant(s.wished ? 'pathCtl.tip.wishOn' : 'pathCtl.tip.wishOff', { qty: s.wishQty });
  }

  ownLabel(): string {
    const w = this.word();
    if (!w) return '';
    return this.translate.instant(this.ownOn() ? `pathCtl.tip.${w}On` : `pathCtl.tip.${w}Off`, { qty: this.ownQty() });
  }

  goKey(step: PathStep): string {
    return step === 'wish' ? 'pathCtl.go.wish' : `pathCtl.go.${this.word() ?? 'inventar'}`;
  }

  goIcon(step: PathStep): readonly string[] {
    return step === 'wish' ? this.icons.wish : this.icons[this.word() ?? 'inventar'];
  }

  // ── click logic: an empty node adds, a filled one leads somewhere ───────────

  /** Empty: one piece on the wishlist (undo in the toast). Filled: the cart opens. */
  async onWish(ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.state().wished) {
      this.openCart(ev);
      return;
    }
    await this.fill('wish', ev.currentTarget as HTMLElement);
  }

  /** The empty second node: adds the item (Inventar asks for the place first). */
  async onOwnAdd(ev: Event): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const o = this.own();
    if (o) await this.fill(o, ev.currentTarget as HTMLElement);
  }

  /** The pill and the primary buttons: an action in words. */
  async onGo(ev: Event, step: PathStep): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const at = this.host.querySelector<HTMLElement>(`.node[data-step="${step}"]`) ?? (ev.currentTarget as HTMLElement);
    await this.fill(step, at);
  }

  openCart(ev: Event): void {
    ev.preventDefault();
    this.closePop();
    this.leave.emit();
    void this.injector.get(WishCartService).open();
  }

  private async fill(step: PathStep, at: HTMLElement): Promise<void> {
    if (step === 'inventar' && this.kind() !== 'blueprint') {
      this.togglePlace(at);
      return;
    }
    this.busy.set(step);
    try {
      this.report(await this.write(step), at);
    } finally {
      this.busy.set(null);
    }
  }

  private write(step: PathStep): Promise<PathResult> | PathResult {
    switch (step) {
      case 'wish': return this.path.addWish(this.kind(), this.className(), this.name());
      case 'hangar': return this.path.addToHangar(this.className(), this.name());
      case 'inventar': return this.path.moveToInventar(this.kind(), this.className(), this.label, PLACE_BLUEPRINTS, 1);
      case 'nachschub': return { ok: false, key: 'itemPath.err.unavailable' };
    }
  }

  // ── detail page steppers ────────────────────────────────────────────────────

  async stepWish(delta: number): Promise<void> {
    const at = this.host.querySelector<HTMLElement>('.st') ?? this.host;
    this.report(await this.path.setWishQty(this.kind(), this.className(), this.name(), this.state().wishQty + delta), at);
  }

  async stepPlace(place: string, delta: number): Promise<void> {
    const at = this.host.querySelector<HTMLElement>('.st') ?? this.host;
    const res = await this.path.adjustInventar(this.className(), this.label, place, delta);
    if (!res.ok) this.report(res, at);
  }

  // ── place popover (Inventar asks where) ─────────────────────────────────────

  /** Stores one piece at the chosen place. */
  async choosePlace(place: string): Promise<void> {
    const where = place.trim();
    if (!where) return;
    const at = this.anchor();
    this.closePop();
    const res = await this.path.moveToInventar(this.kind(), this.className(), this.label, where, 1);
    this.report(res, at);
  }

  openOther(): void {
    this.otherOpen.set(true);
    afterNextRender(() => this.placeInput()?.nativeElement.focus(), { injector: this.injector });
  }

  onLink(ev: MouseEvent): void {
    if (!isPlainLeftClick(ev)) return;
    this.closePop();
    this.leave.emit();
  }

  // ── result: toast with undo, error at the node ─────────────────────────────

  private report(res: PathResult, at: HTMLElement | null): void {
    if (!res.ok) {
      this.showError(res.key, at);
      return;
    }
    const undo = res.undo;
    if (!undo) return;
    this.toast.offer({
      messageKey: this.toastKey(res),
      messageParams: this.toastParams(res),
      commit: () => undefined,
      onUndo: () => void undo().then((back) => { if (!back.ok) this.showError(back.key, at); }),
    });
  }

  /** The toast's `where` is a stored place; it is shown the way the popover shows it. */
  private toastParams(res: PathResult): PathResult['params'] {
    const where = res.params?.['where'];
    return typeof where === 'string' ? { ...res.params, where: this.placeText(where) } : res.params;
  }

  /** "liegt jetzt in Bei mir" reads wrong: the two fixed places have their own sentence. */
  private toastKey(res: PathResult): string {
    if (res.key !== 'itemPath.done.inventar') return res.key;
    if (res.params?.['where'] === PLACE_WITH_ME) return 'itemPath.done.inventarWithMe';
    return res.params?.['where'] === PLACE_BLUEPRINTS ? 'itemPath.done.inventarBlueprint' : res.key;
  }

  private showError(key: string, at: HTMLElement | null): void {
    if (this.destroyed || !at?.isConnected) return;
    this.closePop();
    this.errorKey.set(key);
    this.openPop('error', at);
    this.errorTimer = setTimeout(() => this.closePop(), 4000);
  }

  // ── overlay: in the CDK container, so a scrolling host cannot clip it ──────

  private togglePlace(at: HTMLElement): void {
    if (this.mode() === 'place') {
      this.closePop();
      return;
    }
    this.closePop();
    this.openPop('place', at);
  }

  private openPop(mode: PopMode, at: HTMLElement): void {
    const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;
    this.mode.set(mode);
    this.anchor.set(at);
    this.otherOpen.set(false);
    const ref = this.overlay.create({
      disposeOnNavigation: true,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      // Phones: above the launcher lane (--sc-fab-clear-block), never under the feedback button.
      positionStrategy: phone
        ? this.overlay.position().global().centerHorizontally().bottom('var(--sc-fab-clear-block)')
        : this.overlay
            .position()
            .flexibleConnectedTo(at)
            .withPositions([
              { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
              { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
              { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
              { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -8 },
            ])
            .withPush(true)
            .withViewportMargin(8)
            .withFlexibleDimensions(false),
    });
    ref.attach(new TemplatePortal(this.popTpl(), this.vcr));
    ref.outsidePointerEvents().subscribe((ev) => {
      // The node itself toggles; closing here as well would reopen it on the same click.
      if (!this.host.contains(ev.target as Node)) this.closePop();
    });
    ref.detachments().subscribe(() => {
      if (this.ref === ref) this.closePop();
    });
    // Phones: the sheet does not hang on the row, and the keyboard scrolls the window.
    if (!phone) window.addEventListener('scroll', this.onScroll, true);
    this.ref = ref;
  }

  closePop(): void {
    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
    const ref = this.ref;
    this.ref = null;
    if (typeof window !== 'undefined') window.removeEventListener('scroll', this.onScroll, true);
    ref?.dispose();
    this.mode.set(null);
  }
}
