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
import { formatQuantity } from '../../codex/codex-format';
import { isPlainLeftClick } from '../../core/modified-click.util';
import { ItemPathService, PLACE_BLUEPRINTS, PLACE_WITH_ME, type ItemPathState, type PathResult, type PathStep } from '../../hq/data/item-path.service';
import type { StepKind } from '../step/sc-step.component';
import { hqListLink, hqPage, hangarRedirectLink, type HqPageLink } from '../../hq/hq-routes';
import { placeLabel } from '../../hq/now/hq-live.util';
import { ScActionDirective } from '../action/sc-action.directive';
import { ScDialogDirective } from '../dialog/sc-dialog.directive';
import { ScConfirmService } from '../dialog/sc-confirm.service';
import { ScTooltipDirective } from '../tooltip/sc-tooltip.directive';
import { UndoToastService } from '../undo-toast/undo-toast.service';
import { PATH_ICONS } from './path-icons';

export type ItemPathLevel = 'tertiary' | 'secondary' | 'primary';
type PopMode = PathStep | 'place' | 'error';

/** What "Besorgt" stores: everything still open (exact for SCU), else one piece. */
export function besorgtQty(s: ItemPathState): number {
  return s.nachschubQty > 0 ? s.nachschubQty : 1;
}

/** A stop has something in it. Steps run in parallel, so several can be filled at once. */
export function isFilled(s: ItemPathState, step: PathStep): boolean {
  switch (step) {
    case 'wish': return s.wished;
    case 'nachschub': return s.nachschubQty > 0;
    case 'inventar': return s.inventarQty > 0;
    case 'hangar': return s.inHangar;
  }
}

/**
 * What the pill offers without an override: the next thing this reader can do with this item.
 * Announced ships end at the wish; an owned ship has nothing left; stock can be fetched again.
 */
export function nextStepOf(s: ItemPathState): PathStep | null {
  if (s.hint === 'notYetInGame') return s.wished ? null : 'wish';
  const third = s.steps[s.steps.length - 1];
  if (s.nachschubQty > 0) return third;
  if (s.wished) return 'nachschub';
  if (s.inHangar) return null;
  if (s.inventarQty > 0) return 'nachschub';
  return 'wish';
}

/**
 * `sc-item-path`: the one control of the path wish -> Nachschub -> Inventar / Hangar
 * (concept gegenstand-weg, design `bahn`, spec rounds/02.html).
 *
 *   <sc-item-path [kind]="kind" [className]="cls" [name]="title" level="tertiary" />
 *
 * Levels: `tertiary` the rail with count bullets; `secondary` the pill, rail plus the next step
 * as a button (`[nextStep]` overrides what it offers, the context decides); `primary` the three
 * stops in words. A click on an empty node adds, a click on a filled node opens its popover
 * (state, -/+, a real anchor, Entfernen); the empty Inventar node asks for the place. `(leave)`
 * fires when a plain click on a popover anchor navigates, so a floating host can close itself.
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
        @for (n of nodes(); track n.step; let first = $first) {
          @if (!first) { <i class="link" [class.on]="n.linkOn"></i> }
          @let label = (n.labelKey | translate: n.params) + (state().hint ? ' · ' + ('itemPath.hint.notYetInGame' | translate) : '');
          <button scAction tier="tertiary" type="button" class="node" [class.on]="n.on" [class.cur]="n.cur" [class.open]="popStep() === n.step"
                  [busy]="busy() === n.step" [attr.data-step]="n.step"
                  [scTooltip]="label" scTooltipTier="label"
                  [attr.aria-label]="ariaName(label)"
                  [attr.aria-haspopup]="n.popover ? 'dialog' : null" [attr.aria-expanded]="n.popover ? popStep() === n.step : null"
                  (click)="onNode($event, n.step)">
            <svg class="sc-action-icon" [class.is-filled]="n.on" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[n.step]; track $index) { <path [attr.d]="d" /> }</svg>
            @if (n.count) { <i class="n">{{ n.count }}</i> }
          </button>
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
              <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[step]; track $index) { <path [attr.d]="d" /> }</svg>
              <span>{{ 'itemPath.go.' + step | translate }}</span>
            </button>
          }
          <ng-container [ngTemplateOutlet]="hint" />
        </span>
      }
      @case ('primary') {
        <div class="primary">
          <ol class="path" [class.single]="stops().length === 1">
            @for (s of stops(); track s.step) {
              <li class="stop" [class.on]="s.on" [class.next]="s.next">
                <span class="stop-h">
                  <svg class="sc-action-icon" [class.is-filled]="s.on" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[s.step]; track $index) { <path [attr.d]="d" /> }</svg>
                  <b>{{ 'itemPath.step.' + s.step | translate }}</b>
                </span>
                <p>{{ s.textKey | translate: s.params }}</p>
                @if (s.next) {
                  <button scAction tier="primary" type="button" [busy]="busy() === s.step" (click)="onGo($event, s.step)">
                    <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons[s.step]; track $index) { <path [attr.d]="d" /> }</svg>
                    <span>{{ 'itemPath.go.' + s.step | translate }}</span>
                  </button>
                } @else {
                  <button type="button" class="txt" (click)="onNode($event, s.step)">{{ (s.on ? 'itemPath.full.change' : 'itemPath.full.direct') | translate }}</button>
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
        <div class="rp" role="dialog" tabindex="-1" scDialog
             [scDialogInitialFocus]="mode() === 'place' ? 'first' : 'container'" [scDialogReturnFocus]="anchor()"
             [attr.aria-label]="'itemPath.step.' + (mode() === 'place' ? 'inventar' : mode()) | translate"
             (scDialogEscape)="closePop()">
          @switch (mode()) {
            @case ('wish') {
              <div class="rp-h">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.wish; track $index) { <path [attr.d]="d" /> }</svg>
                <b>{{ 'itemPath.step.wish' | translate }}</b>
                <span class="sp"></span>
                <ng-container [ngTemplateOutlet]="hint" />
              </div>
              <div class="rp-f">
                <a class="alink" [routerLink]="links().wish.commands" [fragment]="links().wish.fragment" [queryParams]="links().wish.queryParams" (click)="onLink($event)">{{ 'itemPath.pop.viewWish' | translate }}</a>
                <button type="button" class="txt quiet" (click)="removeOpen()">{{ 'itemPath.pop.remove' | translate }}</button>
              </div>
            }
            @case ('nachschub') {
              <div class="rp-h">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.nachschub; track $index) { <path [attr.d]="d" /> }</svg>
                <b>{{ 'itemPath.step.nachschub' | translate }}</b>
                <span class="rp-q">{{ state().nachschubUnit === 'scu' ? nachschubText() : state().nachschubQty + '×' }}</span>
                <span class="sp"></span>
                <span class="st">
                  <button type="button" [attr.aria-label]="'itemPath.pop.less' | translate" (click)="stepNachschub(-1)">−</button>
                  <b>{{ nachschubText() }}</b>
                  <button type="button" [attr.aria-label]="'itemPath.pop.more' | translate" (click)="stepNachschub(1)">+</button>
                </span>
              </div>
              @if (missionLink(); as to) {
                <a class="alink to-mission" [routerLink]="to" (click)="onLink($event)">{{ 'itemPath.pop.toMission' | translate }}</a>
              }
              <div class="rp-f">
                <a class="alink" [routerLink]="links().nachschub.commands" [fragment]="links().nachschub.fragment" [queryParams]="links().nachschub.queryParams" (click)="onLink($event)">{{ 'itemPath.pop.viewNachschub' | translate }}</a>
                <button type="button" class="txt quiet" (click)="removeOpen()">{{ 'itemPath.pop.remove' | translate }}</button>
              </div>
            }
            @case ('inventar') {
              <div class="rp-h">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.inventar; track $index) { <path [attr.d]="d" /> }</svg>
                <b>{{ 'itemPath.step.inventar' | translate }}</b>
                <span class="rp-q">{{ state().inventarQty }}×</span>
              </div>
              @if (kind() === 'blueprint') {
                <p class="rp-t">{{ 'itemPath.full.inventarBlueprint' | translate }}</p>
              } @else {
                <ul class="rp-places">
                  @for (p of state().places; track p.location) {
                    <li>
                      <span class="pn">{{ placeText(p.location) }}</span>
                      <span class="st">
                        <button type="button" [attr.aria-label]="'itemPath.pop.less' | translate" (click)="stepPlace(p.location, -1)">−</button>
                        <b>{{ p.qty }}</b>
                        <button type="button" [attr.aria-label]="'itemPath.pop.more' | translate" (click)="stepPlace(p.location, 1)">+</button>
                      </span>
                    </li>
                  }
                </ul>
                <button type="button" class="txt rp-more" (click)="toPlace()">{{ 'itemPath.pop.otherPlace' | translate }}</button>
              }
              <div class="rp-f">
                <a class="alink" [routerLink]="links().inventar.commands" [fragment]="links().inventar.fragment" (click)="onLink($event)">{{ 'itemPath.pop.viewInventar' | translate }}</a>
                <button type="button" class="txt quiet" (click)="removeOpen()">{{ 'itemPath.pop.remove' | translate }}</button>
              </div>
            }
            @case ('hangar') {
              <div class="rp-h">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.hangar; track $index) { <path [attr.d]="d" /> }</svg>
                <b>{{ 'itemPath.step.hangar' | translate }}</b>
              </div>
              <div class="rp-f">
                <a class="alink" [routerLink]="links().hangar.commands" [fragment]="links().hangar.fragment" (click)="onLink($event)">{{ 'itemPath.pop.viewHangar' | translate }}</a>
                <button type="button" class="txt quiet" (click)="removeOpen()">{{ 'itemPath.pop.remove' | translate }}</button>
              </div>
            }
            @case ('place') {
              <div class="rp-h">
                <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true">@for (d of icons.inventar; track $index) { <path [attr.d]="d" /> }</svg>
                <b>{{ 'itemPath.pop.whereTitle' | translate }}</b>
              </div>
              <div class="places">
                @for (p of placeOptions(); track p; let first = $first) {
                  <button type="button" class="place" [class.on]="first" (click)="choosePlace(p)">{{ placeText(p) }}</button>
                }
                <button type="button" class="place" [class.on]="otherOpen()" [attr.aria-expanded]="otherOpen()" (click)="openOther()">{{ 'itemPath.pop.otherPlace' | translate }}</button>
              </div>
              @if (otherOpen()) {
                <div class="other">
                  <input #placeInput type="text" maxlength="120" [attr.aria-label]="'itemPath.pop.whereTitle' | translate"
                         [attr.placeholder]="'itemPath.pop.otherPlaceholder' | translate" (keydown.enter)="choosePlace(placeInput.value)" />
                  <button scAction tier="secondary" type="button" (click)="choosePlace(placeInput.value)"><span>{{ 'itemPath.pop.store' | translate }}</span></button>
                </div>
              }
            }
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
    .path { display: grid; width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; margin: 0; padding: 0; list-style: none; }
    .path.single { grid-template-columns: minmax(0, 1fr); }
    .stop {
      position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 14px;
      border: 1px solid var(--sc-border); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent);
    }
    .stop + .stop::before { content: ""; position: absolute; left: -19px; top: 28px; width: 18px; height: 2px; background: var(--sc-border); }
    .stop.on + .stop::before { background: var(--sc-accent); }
    .stop.on { border-color: color-mix(in srgb, var(--sc-accent) 50%, transparent); }
    .stop.next { border-color: var(--sc-accent); box-shadow: 0 0 22px color-mix(in srgb, var(--sc-accent) 16%, transparent); }
    .stop-h { display: inline-flex; align-items: center; gap: 8px; color: var(--sc-fg-1); }
    .stop.on .stop-h, .stop.next .stop-h { color: var(--sc-accent); }
    .stop-h b { font: 500 0.8125rem/1.2 var(--sc-font-display); letter-spacing: 0.05em; }
    .stop p { margin: 0; color: var(--sc-fg-1); font-size: 0.8125rem; }
    svg.sc-action-icon { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    svg.sc-action-icon.is-filled { fill: color-mix(in srgb, currentColor 28%, transparent); }

    .txt {
      min-height: var(--sc-tap-min, 0px); padding: 4px 2px; border: 0; background: none; cursor: pointer; font: inherit; font-size: 0.8125rem;
      color: var(--sc-accent); text-decoration: underline; text-underline-offset: 3px;
    }
    .txt.quiet { color: var(--sc-fg-2); }
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
    .rp-q { font-weight: 600; color: var(--sc-accent); font-variant-numeric: tabular-nums; }
    .rp-f { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .rp-t { margin: 0; color: var(--sc-fg-1); font-size: 0.8125rem; }
    .rp-more { align-self: flex-start; }
    .rp-places { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .rp-places li { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .pn { min-width: 0; overflow-wrap: anywhere; color: var(--sc-fg-1); }
    .sp { flex: 1 1 auto; }
    .alink { display: inline-flex; align-items: center; min-height: var(--sc-tap-min, 0px); color: var(--sc-accent); font-size: 0.8125rem; text-decoration: none; }
    .alink:hover { text-decoration: underline; text-underline-offset: 3px; }
    .st { display: inline-flex; align-items: center; gap: 2px; flex: none; }
    .st button {
      width: max(30px, var(--sc-tap-min, 0px)); height: max(30px, var(--sc-tap-min, 0px)); padding: 0; cursor: pointer; font: inherit;
      border: 1px solid var(--sc-border); border-radius: 7px; background: none; color: var(--sc-fg-1);
    }
    .st button:hover { color: var(--sc-accent); border-color: var(--sc-accent); }
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
  /** What the pill and the full form offer as next step; null follows the state. */
  readonly nextStep = input<PathStep | null>(null);
  /** What a new Nachschub line of this item is: a blueprint with a known mission is a mission step. */
  readonly stepKind = input<StepKind | null>(null);
  /** Where that step is done; the Nachschub popover offers it as a real anchor. */
  readonly missionLink = input<readonly string[] | null>(null);
  /** A plain click on a popover anchor is leaving: a floating host can close itself. */
  readonly leave = output<void>();

  private readonly path = inject(ItemPathService);
  private readonly toast = inject(UndoToastService);
  private readonly confirm = inject(ScConfirmService);
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
  /** The Nachschub quantity as the reader reads it: "0,36 SCU" for an exact amount, else the piece count. */
  readonly nachschubText = computed(() => {
    const s = this.state();
    return s.nachschubUnit === 'scu' ? `${formatQuantity(s.nachschubQty)} SCU` : String(s.nachschubQty);
  });
  readonly busy = signal<PathStep | null>(null);
  readonly mode = signal<PopMode | null>(null);
  readonly errorKey = signal('');
  readonly anchor = signal<HTMLElement | null>(null);
  readonly otherOpen = signal(false);
  /** The stop whose popover is open: the place popover belongs to the Inventar stop. */
  readonly popStep = computed<PathStep | null>(() => {
    const m = this.mode();
    return m === 'error' || m === null ? null : m === 'place' ? 'inventar' : m;
  });

  readonly nodes = computed(() => {
    const s = this.state();
    const lastOn = s.steps.reduce((last, step, i) => (isFilled(s, step) ? i : last), -1);
    return s.steps.map((step, i) => {
      const on = isFilled(s, step);
      const qty = step === 'nachschub' ? s.nachschubQty : step === 'inventar' ? s.inventarQty : 0;
      return {
        step,
        on,
        cur: i === lastOn,
        linkOn: i <= lastOn,
        count: on && qty ? (qty > 99 ? '99+' : step === 'nachschub' && s.nachschubUnit === 'scu' ? formatQuantity(qty) : String(qty)) : null,
        labelKey: `itemPath.node.${step}.${on ? 'on' : 'off'}`,
        params: { qty: step === 'nachschub' && s.nachschubUnit === 'scu' ? `${formatQuantity(qty)} SCU` : qty },
        popover: on || (step === 'inventar' && this.kind() !== 'blueprint'),
      };
    });
  });

  readonly next = computed<PathStep | null>(() => {
    const s = this.state();
    const wanted = this.nextStep();
    return wanted && s.steps.includes(wanted) ? wanted : nextStepOf(s);
  });

  readonly stops = computed(() => {
    const s = this.state();
    const next = this.next();
    return s.steps.map((step) => {
      const on = isFilled(s, step);
      return { step, on, next: step === next, textKey: this.stopText(s, step, on), params: { qty: this.nachschubText(), inv: s.inventarQty, places: s.places.length } };
    });
  });

  readonly links = computed<Record<PathStep, HqPageLink>>(() => {
    const id = this.state().hangarShipId;
    return {
      wish: hqListLink('wish'),
      nachschub: hqListLink('nachschub'),
      inventar: hqPage('inventar'),
      hangar: { commands: id ? hangarRedirectLink(id) : hqPage('start').commands, fragment: undefined },
    };
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

  // ── click logic: empty adds, filled opens ──────────────────────────────────

  async onNode(ev: Event, step: PathStep): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const at = ev.currentTarget as HTMLElement;
    if (isFilled(this.state(), step)) {
      this.togglePop(step, at);
      return;
    }
    await this.fill(step, at);
  }

  /** The pill and the primary button: an action in words, on a filled stop it opens like its node. */
  async onGo(ev: Event, step: PathStep): Promise<void> {
    ev.preventDefault();
    ev.stopPropagation();
    const at = this.host.querySelector<HTMLElement>(`.node[data-step="${step}"]`) ?? (ev.currentTarget as HTMLElement);
    if ((step === 'wish' || step === 'hangar') && isFilled(this.state(), step)) {
      this.togglePop(step, at);
      return;
    }
    await this.fill(step, at);
  }

  private async fill(step: PathStep, at: HTMLElement): Promise<void> {
    if (step === 'inventar' && this.kind() !== 'blueprint') {
      this.togglePop('place', at);
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
    const s = this.state();
    switch (step) {
      case 'wish': return this.path.addWish(this.kind(), this.className(), this.name());
      case 'nachschub': {
        const stepKind = this.stepKind();
        return stepKind
          ? this.path.addToNachschub(this.kind(), this.className(), this.label, 1, { stepKind })
          : this.path.addToNachschub(this.kind(), this.className(), this.label, 1);
      }
      case 'hangar': return this.path.addToHangar(this.className(), this.name());
      case 'inventar': return this.path.moveToInventar(this.kind(), this.className(), this.label, PLACE_BLUEPRINTS, besorgtQty(s), { unit: s.nachschubUnit });
    }
  }

  /**
   * A host's "Zum Einsatz" anchor: going to the mission puts the step on the list. The anchor
   * navigates regardless, so nobody signed out is stopped by a sign-in question on the way.
   */
  async ensureNachschubStep(): Promise<void> {
    const s = this.state();
    if (!s.signedIn || isFilled(s, 'nachschub')) return;
    this.report(await this.write('nachschub'), null);
  }

  // ── popover actions ────────────────────────────────────────────────────────

  /** Stores everything still open in Nachschub, or one piece, at the chosen place (C3). */
  async choosePlace(place: string): Promise<void> {
    const where = place.trim();
    if (!where) return;
    const at = this.anchor();
    this.closePop();
    const res = await this.path.moveToInventar(this.kind(), this.className(), this.label, where, besorgtQty(this.state()), { unit: this.state().nachschubUnit });
    this.report(res, at);
  }

  toPlace(): void {
    const at = this.anchor();
    this.closePop();
    if (at) this.togglePop('place', at);
  }

  openOther(): void {
    this.otherOpen.set(true);
    afterNextRender(() => this.placeInput()?.nativeElement.focus(), { injector: this.injector });
  }

  stepNachschub(delta: number): void {
    const res = this.path.changeNachschubQty(this.kind(), this.className(), delta);
    if (!res.ok || this.state().nachschubQty === 0) {
      const at = this.anchor();
      this.closePop();
      this.report(res, at);
    }
  }

  async stepPlace(place: string, delta: number): Promise<void> {
    const at = this.anchor();
    const res = await this.path.adjustInventar(this.className(), this.label, place, delta);
    if (!res.ok || this.state().inventarQty === 0) {
      this.closePop();
      this.report(res, at);
    }
  }

  /** "Entfernen". Only the hangar row asks: everything else comes back through the toast. */
  async removeOpen(): Promise<void> {
    const mode = this.mode();
    const at = this.anchor();
    this.closePop();
    switch (mode) {
      case 'wish':
        this.report(await this.path.removeWish(this.kind(), this.className(), this.name()), at);
        break;
      case 'nachschub':
        this.report(this.path.removeFromNachschub(this.kind(), this.className()), at);
        break;
      case 'inventar':
        this.report(await this.path.removeFromInventar(this.kind(), this.className(), this.label), at);
        break;
      case 'hangar': {
        const yes = await this.confirm.confirm({
          titleKey: 'itemPath.pop.removeHangarTitle',
          messageKey: 'itemPath.pop.removeHangarMessage',
          params: { name: this.label },
          confirmKey: 'itemPath.pop.remove',
          tone: 'danger',
        });
        if (yes) this.report(await this.path.removeFromHangar(this.className(), this.name()), at);
        break;
      }
    }
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

  private togglePop(mode: PopMode, at: HTMLElement): void {
    if (this.mode() === mode) {
      this.closePop();
      return;
    }
    this.closePop();
    this.openPop(mode, at);
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

  private stopText(s: ItemPathState, step: PathStep, on: boolean): string {
    switch (step) {
      case 'wish': return on ? 'itemPath.full.wishOn' : 'itemPath.full.wish';
      case 'nachschub': return on ? 'itemPath.full.nachschubOn' : 'itemPath.full.nachschub';
      case 'hangar': return on ? 'itemPath.full.hangarOn' : 'itemPath.full.hangar';
      case 'inventar':
        if (s.kind === 'blueprint') return 'itemPath.full.inventarBlueprint';
        return on ? 'itemPath.full.inventarOn' : 'itemPath.full.inventar';
    }
  }
}
