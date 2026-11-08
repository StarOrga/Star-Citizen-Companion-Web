import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { toErrorKey } from '../../core/describe-error';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { type Einsatz, HqEinsatzService } from '../data/hq-einsatz.service';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { NachschubNamingService } from '../nachschub/nachschub-naming';
import { pickablePlaces } from './map/hq-places';
import { NachschubFocusService } from '../nachschub/nachschub-focus.service';
import { EINSATZ_NAME_MAX, NACHSCHUB_NAME_MAX, type Nachschub, clampName } from '../nachschub/nachschub.model';
import { NachschubService } from '../nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS, STEP_ICON_PATHS, TRANSPORT_WHEELS } from '../nachschub/step-icons';
import { EventHqService } from '../events/event-hq.service';
import { isEventNachschub } from '../events/event-nachschub';
import { HqEventSectionComponent } from '../events/hq-event-section.component';
import { HqRouteGraphicComponent, type RouteSharedStop } from './route/route-graphic.component';
import { routeFilterKey } from './route/route-filter.store';
import type { RouteGraphStep } from './route/route-layout';
import type { StepKind } from '../../shared/step/sc-step.component';

/** The kinds a manual Einsatz can be (one step each). */
type AddKind = Extract<StepKind, 'buy' | 'mission' | 'mine' | 'pickup'>;

/** What a card says about its goods: the steps that bring something in, summed per label. */
export interface EinsatzGood {
  readonly label: string;
  readonly qty: number;
  readonly done: boolean;
}

const GOOD_KINDS: readonly StepKind[] = ['buy', 'mine', 'mission', 'pickup', 'refine'];

/** Goods of an Einsatz as chips (the secondary line of a card): "16x Aluminium", done when all its steps are. */
export function goodsOf(e: Pick<Einsatz, 'steps'>): EinsatzGood[] {
  const out = new Map<string, { label: string; qty: number; done: boolean }>();
  for (const s of e.steps) {
    if (!GOOD_KINDS.includes(s.kind) || s.kind === 'refine') continue;
    const key = (s.className ?? s.label).toLowerCase();
    const cur = out.get(key);
    const q = s.qty ?? 1;
    if (cur) {
      cur.qty += q;
      cur.done = cur.done && s.state === 'done';
    } else {
      out.set(key, { label: s.label, qty: q, done: s.state === 'done' });
    }
  }
  return [...out.values()];
}

/** The summary line under a card title: "4 Schritte · Stanton · ArcCorp". */
export function systemsOf(e: Pick<Einsatz, 'steps'>): string[] {
  return [...new Set(e.steps.map((s) => s.system).filter((x): x is string => !!x))];
}

/**
 * The selected Nachschub in full (round 4, s3): header with in-place rename and the actions (Bearbeiten, Löschen - no
 * "Leeren": an emptied Nachschub is a deleted one; no "In Jetzt ausführen": Jetzt runs the Nachschub picked here on its
 * own), the Einsätze first as cards with what they bring as chips behind them and a guided "Einsatz hinzufügen" inline
 * at their end, and the route of the chosen Einsatz as a zoomable graphic with its hidden legend (the filter is
 * remembered per Nachschub and Einsatz).
 */
@Component({
  selector: 'sc-hq-nachschub-panel',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, FormsModule, ScActionDirective, ScSelectComponent, ScTooltipDirective, HqRouteGraphicComponent, HqEventSectionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" [attr.aria-label]="nachschub().name">
      <header class="head">
        <span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of tray; track p) { <path [attr.d]="p" /> }</svg></span>
        @if (renaming()) {
          <input #nameInput class="rename" type="text" [maxlength]="nameMax" [ngModel]="draft()" (ngModelChange)="draft.set($event)"
                 [attr.aria-label]="'hq.panel.renameAria' | translate" (keydown.enter)="commitRename(true)" (keydown.escape)="cancelRename()" (blur)="commitRename(false)" />
        } @else {
          <h3 class="name">{{ nachschub().name }}
            <button #penBtn type="button" scAction tier="tertiary" class="pen" [attr.aria-label]="'hq.panel.rename' | translate" [scTooltip]="'hq.panel.rename' | translate" scTooltipTier="label" (click)="startRename()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
            </button>
          </h3>
        }
        <span class="prog" role="status">
          <span class="track"><i [style.width.%]="progressPct()"></i></span>
          <b>{{ progress().done }}/{{ progress().total }}</b> {{ 'hq.panel.positions' | translate }}
        </span>
        <span class="acts">
          <button type="button" scAction tier="secondary" (click)="edit.emit(1)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg><span>{{ 'hq.panel.edit' | translate }}</span>
          </button>
          <button type="button" scAction tier="tertiary" tone="danger" [attr.aria-label]="'hq.slots.delete' | translate: { name: nachschub().name }"
                  [scTooltip]="'hq.slots.delete' | translate: { name: nachschub().name }" scTooltipTier="label" (click)="remove.emit()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
          </button>
        </span>
      </header>

      @if (isEvent()) {
        <sc-hq-event-section [nachschub]="nachschub()" (abortAsk)="abortEvent()" />
      } @else if (einsaetze().length === 0) {
        <div class="none">
          <p class="n-title">{{ 'hq.panel.noEinsaetze' | translate }}</p>
          <p class="n-hint">{{ 'hq.panel.noEinsaetzeHint' | translate }}</p>
          <button type="button" scAction tier="secondary" (click)="edit.emit(2)">{{ 'hq.panel.proposeEinsaetze' | translate }}</button>
          <div class="add-wrap"><ng-container *ngTemplateOutlet="addTpl" /></div>
        </div>
      } @else {
        <div class="body">
          <div class="elist">
            <h4 class="h4">{{ 'hq.panel.einsaetze' | translate }} <small>{{ einsaetze().length }} · {{ 'hq.panel.stepsTotal' | translate: { n: stepsTotal() } }}</small></h4>
            <div class="cards" role="list">
              @for (e of einsaetze(); track e.id; let i = $index) {
                <article class="ecard" role="listitem" [class.on]="e.id === selectedId()" [class.fin]="e.status === 'done'">
                  <header>
                    <span class="eid">E{{ i + 1 }}</span>
                    @if (renamingE() === e.id) {
                      <input #eInput class="erename" type="text" [maxlength]="einsatzMax" [ngModel]="eDraft()" (ngModelChange)="eDraft.set($event)"
                             [attr.aria-label]="'hq.einsatz.rename.aria' | translate" [attr.aria-invalid]="eError() ? 'true' : null" [attr.aria-describedby]="eError() ? 'eerr-' + e.id : null"
                             (keydown.enter)="commitEinsatzRename(e.id, true)" (keydown.escape)="cancelEinsatzRename(e.id)" (blur)="commitEinsatzRename(e.id, false)" />
                    } @else {
                      <button type="button" class="pick" [attr.aria-pressed]="e.id === selectedId()" (click)="selectedId.set(e.id)">{{ e.title }}</button>
                      <button type="button" scAction tier="tertiary" class="epen" [attr.data-epen]="e.id" [attr.aria-label]="'hq.einsatz.rename.action' | translate: { name: e.title }"
                              [scTooltip]="'hq.einsatz.rename.action' | translate: { name: e.title }" scTooltipTier="label" (click)="startEinsatzRename(e)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
                      </button>
                    }
                    <span class="kinds">
                      @for (k of kindsOf(e); track k) {
                        <span class="kic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of icons[k]; track p) { <path [attr.d]="p" /> }@if (k === 'transport') { @for (w of wheels; track w.cx) { <circle [attr.cx]="w.cx" [attr.cy]="w.cy" [attr.r]="w.r" /> } }</svg></span>
                      }
                    </span>
                  </header>
                  @if (renamingE() === e.id && eError(); as err) { <p class="eerr" role="alert" [id]="'eerr-' + e.id">{{ err | translate }}</p> }
                  <p class="meta">
                    {{ 'hq.panel.steps' | translate: { done: doneOf(e), n: e.steps.length } }}
                    @for (s of systems(e); track s) { · {{ s }} }
                  </p>
                  <p class="goods">
                    <span class="lbl">{{ 'hq.panel.gets' | translate }}</span>
                    @for (g of goods(e); track $index) {
                      <span class="good" [class.done]="g.done">
                        @if (g.done) { <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg> }{{ g.qty }}× {{ g.label }}
                      </span>
                    }
                  </p>
                </article>
              }
              <ng-container *ngTemplateOutlet="addTpl" />
            </div>
          </div>
          <div class="mapcol">
            <h4 class="h4">{{ 'hq.panel.route' | translate }} @if (selected(); as sel) { <small>{{ sel.title }} · {{ 'hq.panel.places' | translate: { n: placeCount() } }}</small> }</h4>
            <sc-hq-route-graphic class="map" [steps]="graphSteps()" [current]="currentOrd()" [filterKey]="filterKey()" [openLabel]="'hq.route.open' | translate"
                                 [shared]="sharedStops()" (sharedPick)="goShared($event)" />
          </div>
        </div>
      }
    </section>

    <!-- A manual Einsatz is a fixed thing to do somewhere: what (kind + thing), where, how many - never a bare name. -->
    <ng-template #addTpl>
      @if (addOpen()) {
        <form class="ecard addform" ngNoForm (submit)="$event.preventDefault(); saveAdd()" [attr.aria-label]="'hq.einsatz.add.title' | translate">
          <h5 class="af-title">{{ 'hq.einsatz.add.title' | translate }}</h5>
          <span class="seg" role="group" [attr.aria-label]="'hq.einsatz.add.kindAria' | translate">
            @for (k of addKinds; track k) {
              <button type="button" [attr.aria-pressed]="addKind() === k" (click)="addKind.set(k)">{{ 'hq.step.kind.' + k | translate }}</button>
            }
          </span>
          <label class="af-field">
            <span>{{ ('hq.einsatz.add.what.' + addKind()) | translate }}</span>
            <input #addWhatInput type="text" class="af-input" [maxlength]="einsatzMax" [ngModel]="addWhat()" (ngModelChange)="addWhat.set($event)" name="what"
                   [placeholder]="('hq.einsatz.add.whatPh.' + addKind()) | translate" />
          </label>
          <div class="af-row">
            <span class="af-field af-where">
              <span>{{ (needsPlace() ? 'hq.einsatz.add.where' : 'hq.einsatz.add.whereOptional') | translate }}</span>
              <sc-select [options]="placeOptions" [value]="addPlace()" placeholderKey="hq.einsatz.add.wherePh"
                         [ariaLabel]="'hq.einsatz.add.where' | translate" (valueChange)="addPlace.set($event)" />
            </span>
            <span class="af-field af-qty">
              <span>{{ 'hq.einsatz.add.qty' | translate }}</span>
              <span class="stepper" role="group" [attr.aria-label]="'hq.einsatz.add.qty' | translate">
                <button type="button" class="step" [disabled]="addQty() <= 1" [attr.aria-label]="'hq.flow.less' | translate" [scTooltip]="'hq.flow.less' | translate" scTooltipTier="label" (click)="addQty.set(addQty() - 1)">−</button>
                <b class="mono">{{ addQty() }}</b>
                <button type="button" class="step" [disabled]="addQty() >= 999" [attr.aria-label]="'hq.flow.more' | translate" [scTooltip]="'hq.flow.more' | translate" scTooltipTier="label" (click)="addQty.set(addQty() + 1)">+</button>
              </span>
            </span>
          </div>
          @if (addError(); as k) { <p class="eerr" role="alert">{{ k | translate }}</p> }
          <div class="af-acts">
            <button type="button" scAction tier="secondary" (click)="closeAdd()">{{ 'common.dialog.cancel' | translate }}</button>
            <button type="submit" scAction tier="secondary" [busy]="adding()" [disabled]="adding() || !canAdd()">{{ 'hq.einsatz.add.confirm' | translate }}</button>
          </div>
        </form>
      } @else {
        <button #addBtn type="button" class="add-e" (click)="openAdd()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg><span>{{ 'hq.einsatz.add.action' | translate }}</span>
        </button>
      }
    </ng-template>
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; min-height: 0; flex: 1; }
      .panel { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); border: 1px solid var(--sc-border); border-radius: 14px; background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent); }
      .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); margin-bottom: var(--sc-space-2, 8px); flex: none; }
      .ic { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: color-mix(in srgb, var(--sc-accent) 14%, transparent); color: var(--sc-accent); flex: none; }
      .ic svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .name { display: flex; align-items: center; gap: 4px; margin: 0; font: 700 1.1rem var(--sc-font-display, inherit); letter-spacing: 0.02em; min-width: 0; overflow-wrap: anywhere; }
      .rename { min-height: 36px; width: min(28ch, 100%); padding: 0 10px; border: 1px solid var(--sc-accent); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg); font: 700 1.05rem var(--sc-font-display, inherit); }
      .rename:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .pen svg, .acts svg, .good svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .prog { display: inline-flex; align-items: center; gap: 8px; color: var(--sc-fg-2); font-size: 0.82rem; }
      .prog b { color: var(--sc-fg-0); font-family: var(--sc-font-display, inherit); }
      .track { width: 120px; height: 6px; border-radius: 6px; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); overflow: hidden; }
      .track i { display: block; height: 100%; background: var(--sc-accent); border-radius: inherit; transition: width 0.3s; }
      .acts { display: flex; align-items: center; gap: var(--sc-space-2, 8px); margin-left: auto; flex-wrap: wrap; }
      .acts button[scAction] svg { margin-right: 4px; }
      .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(300px, 420px) minmax(0, 1fr); gap: var(--sc-space-4, 16px); }
      .elist, .mapcol { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
      .h4 { margin: 0 0 6px; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); flex: none; }
      .h4 small { text-transform: none; letter-spacing: 0; margin-left: 6px; color: var(--sc-fg-2); }
      .cards { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); padding-right: 4px; }
      .ecard { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, var(--sc-border)); border-radius: 10px; background: color-mix(in srgb, var(--sc-bg-0) 70%, transparent); flex: none; transition: border-color 0.2s, background 0.2s; }
      .ecard.on { border-color: color-mix(in srgb, var(--sc-accent) 70%, var(--sc-border)); background: color-mix(in srgb, var(--sc-accent) 9%, var(--sc-bg-0)); box-shadow: inset 3px 0 0 var(--sc-accent); }
      .ecard.fin .pick { text-decoration: line-through; color: var(--sc-fg-2); }
      .ecard header { display: flex; align-items: center; gap: 8px; }
      .eid { padding: 0 6px; border-radius: 5px; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-accent); font: 700 0.72rem var(--sc-font-display, inherit); }
      .pick { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; color: var(--sc-fg); font: 600 0.9rem var(--sc-font-body, inherit); text-align: start; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .erename { flex: 1; min-width: 0; min-height: 36px; padding: 0 8px; border: 1px solid var(--sc-accent); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg); font: 600 0.9rem var(--sc-font-body, inherit); }
      .erename[aria-invalid='true'] { border-color: var(--sc-warning); }
      .erename:hover { border-color: var(--sc-accent-hover, var(--sc-accent)); }
      .erename:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .epen svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .eerr { margin: 2px 0 0; color: var(--sc-warning); font-size: max(0.78rem, var(--sc-fs-floor, 0.75rem)); }
      .pick:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
      .kinds { display: inline-flex; gap: 3px; }
      .kic { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-accent); }
      .kic svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .meta { margin: 2px 0 0; color: var(--sc-fg-2); font-size: 0.78rem; }
      .goods { margin: 4px 0 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
      .lbl { color: var(--sc-fg-2); font-size: 0.72rem; margin-right: 2px; }
      .good { display: inline-flex; align-items: center; gap: 3px; padding: 0 8px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: 0.76rem; color: var(--sc-fg-1); }
      .good svg { width: 12px; height: 12px; stroke-width: 2.4; }
      .good.done { border-color: color-mix(in srgb, var(--sc-success) 55%, var(--sc-border)); color: var(--sc-success); }
      .map { flex: 1; min-height: 0; }
      .none { flex: 1; display: grid; align-content: center; justify-items: center; gap: var(--sc-space-2, 8px); text-align: center; }
      .add-wrap { width: min(100%, 420px); text-align: start; }
      .add-e { flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 12px; border: 1px dashed color-mix(in srgb, var(--sc-accent) 40%, var(--sc-border)); border-radius: 10px; background: transparent; color: var(--sc-fg-1); font: inherit; font-size: 0.85rem; cursor: pointer; width: 100%; }
      .add-e:hover { border-color: var(--sc-accent); color: var(--sc-fg-0); background: color-mix(in srgb, var(--sc-accent) 6%, transparent); }
      .add-e:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .add-e svg { width: 16px; height: 16px; fill: none; stroke: var(--sc-accent); stroke-width: 2; stroke-linecap: round; }
      .addform { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); border-style: dashed; }
      .af-title { margin: 0; font-size: 0.85rem; font-weight: 600; }
      .af-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .af-field > span:first-child { color: var(--sc-fg-2); font-size: max(0.78rem, var(--sc-fs-floor, 0.75rem)); }
      .af-input { min-height: 36px; padding: 0 10px; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; }
      .af-input:hover { border-color: var(--sc-accent); }
      .af-input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; }
      .af-row { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); align-items: flex-end; }
      .af-where { flex: 1 1 12rem; }
      .af-acts { display: flex; justify-content: flex-end; gap: var(--sc-space-2, 8px); flex-wrap: wrap; }
      .seg { display: inline-flex; flex-wrap: wrap; align-self: flex-start; padding: 2px; border: 1px solid var(--sc-border); border-radius: 999px; }
      .seg button { min-height: 28px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; font-size: 0.78rem; cursor: pointer; }
      .seg button[aria-pressed='true'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 22%, transparent); box-shadow: 0 0 0 1px var(--sc-accent); }
      .seg button:focus-visible, .step:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .stepper { display: inline-flex; align-items: center; gap: 4px; min-height: 36px; }
      .step { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); color: var(--sc-fg); font: inherit; cursor: pointer; }
      .step:hover:not(:disabled) { border-color: var(--sc-accent); }
      .step:disabled { opacity: 0.4; cursor: default; }
      .stepper b { min-width: 3ch; text-align: center; }
      @media (pointer: coarse) { .step { width: 44px; height: 44px; } .seg button { min-height: 44px; } .add-e { min-height: 48px; } }
      .n-title { margin: 0; font-weight: 600; }
      .n-hint { margin: 0; color: var(--sc-fg-2); max-width: 52ch; }
      @media (max-width: 1023px) { .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(220px, 1fr); } }
      @media (prefers-reduced-motion: reduce) { .track i, .ecard { transition: none; } }
    `,
  ],
})
export class HqNachschubPanelComponent {
  readonly nachschub = input.required<Nachschub>();
  /** Open the flow (step 1 = edit the content, 2 = propose Einsätze). */
  readonly edit = output<1 | 2>();
  private readonly eventsSvc = inject(EventHqService);
  private readonly confirmSvc = inject(ScConfirmService);
  protected readonly isEvent = computed(() => isEventNachschub(this.nachschub()));

  /** Abort an event Nachschub: the slot frees, progress stays, nothing goes back to the wishlist; resumable from the Archiv. */
  protected async abortEvent(): Promise<void> {
    const n = this.nachschub();
    const ok = await this.confirmSvc.confirm({ titleKey: 'hq.events.abortDialog.title', messageKey: 'hq.events.abortDialog.message', params: { name: n.name }, confirmKey: 'hq.events.abort', tone: 'danger' });
    if (ok) await this.eventsSvc.abort(n);
  }
  readonly remove = output<void>();

  protected readonly svc = inject(NachschubService);
  private readonly einsatzSvc = inject(HqEinsatzService);
  protected readonly focus = inject(NachschubFocusService);

  protected readonly tray = NACHSCHUB_ICON_PATHS;
  protected readonly icons = STEP_ICON_PATHS;
  protected readonly wheels = TRANSPORT_WHEELS;
  protected readonly nameMax = NACHSCHUB_NAME_MAX;

  protected readonly renaming = signal(false);
  protected readonly draft = signal('');
  protected readonly selectedId = signal<string | null>(null);

  protected readonly einsaetze = computed(() => this.einsatzSvc.ofPackage(this.nachschub().id));
  protected readonly stepsTotal = computed(() => this.einsaetze().reduce((n, e) => n + e.steps.length, 0));
  protected readonly progress = computed(() => this.svc.evaluation(this.nachschub().id)?.progress ?? { done: 0, total: 0 });
  protected readonly progressPct = computed(() => (this.progress().total ? (100 * this.progress().done) / this.progress().total : 0));

  /** The Einsatz whose route is drawn: the chosen one, else the first with an open step, else the first. */
  protected readonly selected = computed(() => {
    const list = this.einsaetze();
    return list.find((e) => e.id === this.selectedId()) ?? list.find((e) => e.steps.some((s) => s.state === 'todo')) ?? list[0] ?? null;
  });
  protected readonly graphSteps = computed<RouteGraphStep[]>(() =>
    (this.selected()?.steps ?? []).map((s) => ({ ord: s.ord, kind: s.kind, label: s.label, location: s.location, system: s.system, state: s.state })),
  );
  protected readonly currentOrd = computed(() => this.selected()?.steps.find((s) => s.state === 'todo')?.ord ?? null);
  protected readonly placeCount = computed(() => new Set(this.graphSteps().map((s) => `${s.system}|${s.location}`)).size);
  protected readonly filterKey = computed(() => routeFilterKey(this.nachschub().id, this.selected()?.id ?? null));

  /** Places on this route that also serve another active Nachschub (a quiet hint, clickable). */
  protected readonly sharedStops = computed<RouteSharedStop[]>(() => {
    const here = new Set(this.graphSteps().filter((s) => s.state === 'todo' && s.location).map((s) => (s.location as string).toLowerCase()));
    if (!here.size) return [];
    const out: RouteSharedStop[] = [];
    for (const n of this.svc.active()) {
      if (n.id === this.nachschub().id) continue;
      for (const e of this.einsatzSvc.ofPackage(n.id)) {
        for (const s of e.steps) {
          const loc = (s.location ?? '').toLowerCase();
          if (s.state === 'todo' && loc && here.has(loc) && !out.some((o) => o.location.toLowerCase() === loc)) {
            out.push({ location: s.location as string, nachschubId: n.id, name: n.name });
          }
        }
      }
    }
    return out;
  });

  constructor() {
    // A different Nachschub starts on its own first Einsatz.
    effect(() => {
      const id = this.nachschub().id;
      untracked(() => (id ? this.selectedId.set(null) : undefined));
    });
  }

  protected kindsOf(e: Einsatz): StepKind[] {
    return [...new Set(e.steps.map((s) => s.kind))];
  }
  protected doneOf(e: Einsatz): number {
    return e.steps.filter((s) => s.state === 'done').length;
  }
  protected goods = goodsOf;
  protected systems = systemsOf;

  protected goShared(s: RouteSharedStop): void {
    this.focus.select(s.nachschubId);
  }

  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly penBtn = viewChild<ElementRef<HTMLElement>>('penBtn');
  private readonly eInput = viewChild<ElementRef<HTMLInputElement>>('eInput');

  protected readonly einsatzMax = EINSATZ_NAME_MAX;
  /** The Einsatz whose title is being edited in its card, its draft and the error key shown under it. */
  protected readonly renamingE = signal<string | null>(null);
  protected readonly eDraft = signal('');
  protected readonly eError = signal<string | null>(null);
  protected readonly adding = signal(false);

  /** Run after the next render, when the template has created (or removed) the element. */
  private afterRender(fn: () => void): void {
    afterNextRender(fn, { injector: this.injector });
  }

  protected startRename(): void {
    this.draft.set(this.nachschub().name);
    this.renaming.set(true);
    this.afterRender(() => {
      const el = this.nameInput()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  /** Enter / blur saves; only Enter hands the focus back to the pen (a blur means the reader went elsewhere). */
  protected commitRename(refocus: boolean): void {
    if (!this.renaming()) return;
    this.renaming.set(false);
    const next = clampName(this.draft(), NACHSCHUB_NAME_MAX);
    if (next && next !== this.nachschub().name) void this.svc.rename(this.nachschub().id, next);
    if (refocus) this.afterRender(() => this.penBtn()?.nativeElement.focus());
  }

  protected cancelRename(): void {
    if (!this.renaming()) return;
    this.renaming.set(false);
    this.afterRender(() => this.penBtn()?.nativeElement.focus());
  }

  protected startEinsatzRename(e: Einsatz): void {
    this.eDraft.set(e.title);
    this.eError.set(null);
    this.renamingE.set(e.id);
    this.afterRender(() => {
      const el = this.eInput()?.nativeElement;
      el?.focus();
      el?.select();
    });
  }

  protected commitEinsatzRename(id: string, refocus: boolean): void {
    if (this.renamingE() !== id) return;
    if (!this.eDraft().trim()) {
      // A blank name is not saved: Enter keeps the field open with the hint, leaving it just drops the edit.
      if (refocus) this.eError.set('hq.einsatz.rename.empty');
      else this.renamingE.set(null);
      return;
    }
    try {
      if (!this.einsatzSvc.rename(id, this.eDraft())) throw new Error('einsatz gone');
    } catch (err) {
      this.eError.set(toErrorKey('hq', 'renameEinsatz', err));
      return;
    }
    this.renamingE.set(null);
    this.eError.set(null);
    if (refocus) this.refocusEpen(id);
  }

  protected cancelEinsatzRename(id: string): void {
    if (this.renamingE() !== id) return;
    this.renamingE.set(null);
    this.eError.set(null);
    this.refocusEpen(id);
  }

  private refocusEpen(id: string): void {
    this.afterRender(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-epen="${CSS.escape(id)}"]`)?.focus());
  }

  // ------------------------------------------------------------------------------------------- guided "Einsatz hinzufügen"

  private readonly naming = inject(NachschubNamingService);
  protected readonly addKinds: readonly AddKind[] = ['buy', 'mission', 'mine', 'pickup'];
  protected readonly placeOptions: readonly ScSelectOption[] = pickablePlaces().map((p) => ({ value: p.id, labelKey: '', label: [p.location, p.system].join(' · ') }));
  private readonly places = new Map(pickablePlaces().map((p) => [p.id, p] as const));
  protected readonly addOpen = signal(false);
  protected readonly addKind = signal<AddKind>('buy');
  protected readonly addWhat = signal('');
  protected readonly addPlace = signal<string | null>(null);
  protected readonly addQty = signal(1);
  protected readonly addError = signal<string | null>(null);
  private readonly addWhatInput = viewChild<ElementRef<HTMLInputElement>>('addWhatInput');
  private readonly addBtn = viewChild<ElementRef<HTMLButtonElement>>('addBtn');
  /** Buying and picking up happen at a place; a mission or a mining run may leave it open. */
  protected readonly needsPlace = computed(() => this.addKind() === 'buy' || this.addKind() === 'pickup');
  protected readonly canAdd = computed(() => this.addWhat().trim().length > 0 && (!this.needsPlace() || this.addPlace() !== null));

  protected openAdd(): void {
    this.addKind.set('buy');
    this.addWhat.set('');
    this.addPlace.set(null);
    this.addQty.set(1);
    this.addError.set(null);
    this.addOpen.set(true);
    this.afterRender(() => this.addWhatInput()?.nativeElement.focus());
  }

  protected closeAdd(): void {
    this.addOpen.set(false);
    this.afterRender(() => this.addBtn()?.nativeElement.focus());
  }

  /** One Einsatz with one step: what is done (kind), to what, where and how often; its name is proposed from that. */
  protected async saveAdd(): Promise<void> {
    if (this.adding() || !this.canAdd()) return;
    this.adding.set(true);
    this.addError.set(null);
    try {
      const kind = this.addKind();
      const label = clampName(this.addWhat(), EINSATZ_NAME_MAX);
      const place = this.addPlace() ? (this.places.get(this.addPlace() as string) ?? null) : null;
      const title = clampName(await this.naming.einsatzName([{ kind, label }]), EINSATZ_NAME_MAX) || label;
      const made = this.einsatzSvc.create({
        title,
        packageId: this.nachschub().id,
        startLocation: place?.location ?? null,
        steps: [{ kind, label, location: place?.location ?? null, system: place?.system ?? null, className: null, qty: this.addQty(), supplyId: null, missionRef: null }],
      });
      if (!made) throw new Error('einsatz not created');
      this.selectedId.set(made.id);
      this.closeAdd();
    } catch (err) {
      this.addError.set(toErrorKey('hq', 'addEinsatz', err));
    } finally {
      this.adding.set(false);
    }
  }
}
