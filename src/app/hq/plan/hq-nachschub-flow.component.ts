import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { humanizeClassName } from '../../codex/codex-format';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import type { StepKind } from '../../shared/step/sc-step.component';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { HqEinsatzService } from '../data/hq-einsatz.service';
import { NachschubNamingService } from '../nachschub/nachschub-naming';
import {
  EINSATZ_NAME_MAX,
  NACHSCHUB_MAX_SLOTS,
  NACHSCHUB_NAME_MAX,
  type WishPick,
  type WishPosition,
  clampName,
  freeSlot,
  positionKey,
  takeFromWishlist,
} from '../nachschub/nachschub.model';
import { NachschubService, type NachschubResult } from '../nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS, STEP_ICON_PATHS, TRANSPORT_WHEELS } from '../nachschub/step-icons';
import { HqNeedSourcesService, bestSource } from './hq-need-sources.service';
import {
  type DraftEinsatz,
  type LineSplit,
  type ProposalLine,
  defaultSplit,
  isBlueprintLine,
  isMaterialLine,
  normalizeSplit,
  proposalCounts,
  proposeEinsaetze,
  purposesOf,
  setBuyPart,
  toggleMethod,
} from './einsatz-proposal';
import { HQ_DIALOG_STYLES } from './hq-dialog.styles';
import {
  type FlowGroup,
  type FlowRow,
  groupWish,
  pickedPieces,
  pickedShare,
  setPicked,
  toggleGroup,
} from './hq-nachschub-flow.util';

type Step = 1 | 2 | 3;

/**
 * "Neuer Nachschub" and "Bearbeiten" (round 4, s4a-s4c): three steps in one dialog.
 *  1 Auswählen      the wishlist, grouped; tick what goes into the Nachschub (or "Alles"), split a quantity
 *  2 Zusammenfassung everything in this Nachschub summed up, what stays on the wishlist, the name
 *  3 Einsätze       the proposed Einsätze with their count; each material is switchable and splittable
 *                   (buy / mine), crafting is always the last Einsatz
 * In edit mode the Nachschub's lines are shown and removable in step 2 and wishlist positions picked in step 1 are
 * added; Einsätze are proposed for the added lines only. Everything is written when the last step is confirmed.
 */
@Component({
  selector: 'sc-hq-nachschub-flow',
  standalone: true,
  imports: [TranslatePipe, FormsModule, ScActionDirective, ScDialogDirective, ScTooltipDirective, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="scrim" (click)="closed.emit()">
      <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit()" aria-labelledby="flow-title" (click)="$event.stopPropagation()">
        <header class="dlg-head">
          <span class="dlg-ic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of tray; track p) { <path [attr.d]="p" /> }</svg></span>
          <h2 id="flow-title" class="dlg-title">
            {{ (mode() === 'new' ? 'hq.flow.titleNew' : 'hq.flow.titleEdit') | translate }}
            @if (mode() === 'new') { <small>{{ 'hq.flow.slotOf' | translate: { n: nextSlot() ?? maxSlots, max: maxSlots } }}</small> }
          </h2>
          <ol class="steps" [attr.aria-label]="'hq.flow.stepsAria' | translate">
            @for (s of stepList; track s) {
              <li [class.on]="step() === s" [class.past]="step() > s" [attr.aria-current]="step() === s ? 'step' : null">
                <b>{{ s }}</b><span>{{ 'hq.flow.step.' + s | translate }}</span>
              </li>
            }
          </ol>
        </header>

        <div class="dlg-body">
          @if (error(); as e) { <p class="dlg-err" role="alert">{{ e | translate }}</p> }

          @if (step() === 1) {
            @if (groups().length === 0) {
              <div class="empty">
                <p class="e-title">{{ 'hq.flow.emptyWish' | translate }}</p>
                <p class="dlg-msg">{{ 'hq.flow.emptyHint' | translate }}</p>
                <button type="button" scAction tier="secondary" (click)="searchWish()">{{ 'hq.flow.fillWish' | translate }}</button>
              </div>
            } @else {
              <div class="pick-bar">
                <button type="button" scAction tier="secondary" (click)="pickAll()">
                  {{ (allPicked() ? 'hq.flow.none' : 'hq.flow.all') | translate }}
                </button>
                <span class="tally" role="status">{{ 'hq.flow.picked' | translate: { n: picks().size, p: pieces() } }}</span>
              </div>
              <div class="groups">
                @for (g of groups(); track g.id) {
                  <section class="grp" [attr.aria-label]="groupTitle(g)">
                    <header>
                      <sc-tristate variant="checkbox" [label]="groupTitle(g)" [value]="share(g)" (toggled)="onGroup(g)" />
                      <h3>{{ groupTitle(g) }}</h3>
                      @if (g.type === 'blueprint') { <span class="tag">{{ 'hq.flow.group.blueprint' | translate }}</span> }
                    </header>
                    <ul>
                      @for (r of g.rows; track r.key) {
                        @let q = picks().get(r.key) ?? 0;
                        <li [class.on]="q > 0">
                          <sc-tristate variant="checkbox" [label]="r.name || r.className" [value]="q >= r.qty ? 1 : q > 0 ? 0.5 : 0" (toggled)="onRow(g, r, q)" />
                          <span class="nm">{{ rowName(r) }}</span>
                          @if (q > 0) {
                            <span class="stepper" role="group" [attr.aria-label]="'hq.flow.qtyOf' | translate: { name: rowName(r) }">
                              <button type="button" class="step" [disabled]="q <= 1" [attr.aria-label]="'hq.flow.less' | translate" [scTooltip]="'hq.flow.less' | translate" scTooltipTier="label" (click)="onQty(g, r, q - 1)">−</button>
                              <b class="n mono">{{ q }}<small> / {{ r.qty }}</small></b>
                              <button type="button" class="step" [disabled]="q >= r.qty" [attr.aria-label]="'hq.flow.more' | translate" [scTooltip]="'hq.flow.more' | translate" scTooltipTier="label" (click)="onQty(g, r, q + 1)">+</button>
                            </span>
                            <span class="share" aria-hidden="true"><i [style.width.%]="(100 * q) / r.qty"></i></span>
                          } @else {
                            <b class="n mono">×{{ r.qty }}</b>
                          }
                        </li>
                      }
                    </ul>
                  </section>
                }
              </div>
            }
          }

          @if (step() === 2) {
            <label class="name-field">
              <span>{{ 'hq.flow.nameLabel' | translate }}</span>
              <input type="text" class="input" [maxlength]="nameMax" [ngModel]="name()" (ngModelChange)="onName($event)" />
              <small>{{ name().length }}/{{ nameMax }}</small>
            </label>
            <div class="sum-grid">
              <section class="sum">
                <h3>{{ 'hq.flow.sumTitle' | translate }} <small>{{ 'hq.flow.picked' | translate: { n: sumCount(), p: sumPieces() } }}</small></h3>
                @if (existing().length) {
                  <h4>{{ 'hq.flow.alreadyIn' | translate }}</h4>
                  <ul class="lines">
                    @for (l of existing(); track l.id) {
                      <li>
                        <span class="nm">{{ l.name }}</span>
                        @if (l.forClassName) { <span class="for">{{ 'hq.flow.forBp' | translate: { name: bpName(l.forClassName) } }}</span> }
                        <b class="n mono">×{{ l.qty }}</b>
                        @if (mode() === 'edit') {
                          <button type="button" scAction tier="tertiary" tone="danger" [attr.aria-label]="'hq.flow.removeLine' | translate: { name: l.name }"
                                  [scTooltip]="'hq.flow.removeLine' | translate: { name: l.name }" scTooltipTier="label" (click)="removeExisting(l.id)">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
                          </button>
                        }
                      </li>
                    }
                  </ul>
                }
                @for (g of pickedGroups(); track g.id) {
                  <h4>{{ groupTitle(g) }}</h4>
                  <ul class="lines">
                    @for (r of g.rows; track r.key) {
                      <li><span class="nm">{{ rowName(r) }}</span><b class="n mono">×{{ r.qty }}</b></li>
                    }
                  </ul>
                }
                @if (!existing().length && !pickedGroups().length) { <p class="dlg-msg">{{ 'hq.flow.sumEmpty' | translate }}</p> }
              </section>
              <section class="sum rest">
                <h3>{{ 'hq.flow.stays' | translate }}</h3>
                @if (remaining().length) {
                  <ul class="chips">
                    @for (r of remaining(); track r.key) { <li>{{ rowName(r) }} <b class="mono">×{{ r.qty }}</b></li> }
                  </ul>
                } @else {
                  <p class="dlg-msg">{{ 'hq.flow.staysNothing' | translate }}</p>
                }
              </section>
            </div>
          }

          @if (step() === 3) {
            <div class="einsatz-head">
              <h3>{{ 'hq.flow.einsaetze' | translate }} <small role="status">{{ 'hq.flow.einsatzCount' | translate: { n: counts().einsaetze, s: counts().steps } }}</small></h3>
            </div>
            @if (proposalLines().length === 0) {
              <p class="dlg-msg">{{ (mode() === 'edit' ? 'hq.flow.noNewLines' : 'hq.flow.noLines') | translate }}</p>
            }
            <div class="e-grid">
              @if (materialLines().length) {
                <section class="mats" [attr.aria-label]="'hq.flow.matsTitle' | translate">
                  <h4>{{ 'hq.flow.matsTitle' | translate }}</h4>
                  <ul>
                    @for (l of materialLines(); track l.key) {
                      @let sp = splitOf(l);
                      <li>
                        <span class="nm">{{ l.name }} <b class="mono">×{{ l.qty }}</b></span>
                        <span class="seg" role="group" [attr.aria-label]="'hq.flow.methodOf' | translate: { name: l.name }">
                          <button type="button" [attr.aria-pressed]="sp.buy === l.qty" (click)="toggle(l)">{{ 'hq.step.kind.buy' | translate }}</button>
                          <button type="button" [attr.aria-pressed]="sp.mine === l.qty" (click)="toggle(l)">{{ 'hq.step.kind.mine' | translate }}</button>
                        </span>
                        <span class="stepper" role="group" [attr.aria-label]="'hq.flow.splitOf' | translate: { name: l.name }">
                          <button type="button" class="step" [disabled]="sp.buy <= 0" [attr.aria-label]="'hq.flow.lessBuy' | translate" [scTooltip]="'hq.flow.lessBuy' | translate" scTooltipTier="label" (click)="split(l, sp.buy - 1)">−</button>
                          <b class="n mono">{{ sp.buy }}<small> / {{ sp.mine }}</small></b>
                          <button type="button" class="step" [disabled]="sp.buy >= l.qty" [attr.aria-label]="'hq.flow.moreBuy' | translate" [scTooltip]="'hq.flow.moreBuy' | translate" scTooltipTier="label" (click)="split(l, sp.buy + 1)">+</button>
                        </span>
                      </li>
                    }
                  </ul>
                  <p class="hint">{{ 'hq.flow.splitHint' | translate }}</p>
                </section>
              }
              <div class="cards">
                @for (d of drafts(); track d.role; let i = $index) {
                  <article class="ecard" [class.last]="d.role === 'craft'">
                    <header>
                      <span class="eid">E{{ i + 1 }}</span>
                      <h4>{{ draftName(d) }}</h4>
                      <span class="kinds">
                        @for (k of draftKinds(d); track k) {
                          <span class="kic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of icons[k]; track p) { <path [attr.d]="p" /> }@if (k === 'transport') { @for (w of wheels; track w.cx) { <circle [attr.cx]="w.cx" [attr.cy]="w.cy" [attr.r]="w.r" /> } }</svg></span>
                        }
                      </span>
                    </header>
                    <p class="meta">
                      {{ 'hq.flow.stepsCount' | translate: { n: d.steps.length } }}
                      @if (draftPlaces(d); as pl) { · {{ pl }} }
                      @if (d.role === 'craft') { · {{ 'hq.flow.craftLast' | translate }} }
                    </p>
                    <p class="goods">
                      <span class="lbl">{{ 'hq.flow.gets' | translate }}</span>
                      @for (g of d.goods; track $index) { <span class="good">{{ g.qty }}× {{ g.name }}</span> }
                    </p>
                    @if (purposesText(d); as pt) { <p class="note">{{ 'hq.flow.purpose' | translate: { names: pt } }}</p> }
                  </article>
                }
                @if (mode() === 'edit' && existingEinsaetze().length) {
                  <h4 class="have">{{ 'hq.flow.haveEinsaetze' | translate }}</h4>
                  @for (e of existingEinsaetze(); track e.id) {
                    <article class="ecard have-card"><header><span class="eid">·</span><h4>{{ e.title }}</h4></header><p class="meta">{{ 'hq.flow.stepsCount' | translate: { n: e.steps.length } }}</p></article>
                  }
                }
              </div>
            </div>
          }
        </div>

        <footer class="dlg-foot">
          <button type="button" scAction tier="secondary" (click)="closed.emit()">{{ 'common.dialog.cancel' | translate }}</button>
          <span class="sp"></span>
          @if (step() > 1) {
            <button type="button" scAction tier="secondary" (click)="back()">{{ 'hq.flow.back' | translate }}</button>
          }
          @if (step() < 3) {
            <button type="button" scAction tier="primary" [disabled]="!canNext()" (click)="next()">{{ 'hq.flow.next' | translate }}</button>
          } @else {
            <button type="button" scAction tier="primary" [busy]="busy()" [disabled]="busy() || !canSave()" (click)="save()">
              {{ (mode() === 'new' ? 'hq.flow.create' : 'hq.flow.saveEdit') | translate }}
            </button>
          }
        </footer>
      </div>
    </div>
  `,
  styles: [
    HQ_DIALOG_STYLES,
    `
      .sheet { --dlg-w: 1040px; --dlg-h: 760px; height: min(100%, var(--dlg-h)); }
      .steps { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--sc-space-2, 8px); flex: none; }
      .steps li { display: inline-flex; align-items: center; gap: 6px; color: var(--sc-fg-2); font-size: 0.82rem; }
      .steps li b { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--sc-border); font: 600 0.75rem var(--sc-font-display, inherit); }
      .steps li.on { color: var(--sc-fg-0); }
      .steps li.on b { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 20%, transparent); box-shadow: 0 0 10px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .steps li.past b { background: var(--sc-accent); color: var(--sc-bg-0); border-color: var(--sc-accent); }
      .steps li + li::before { content: ''; width: 18px; height: 1px; background: var(--sc-border); margin-right: 2px; }
      @media (max-width: 760px) { .steps li span { display: none; } }
      .empty { display: grid; gap: var(--sc-space-2, 8px); justify-items: start; padding: var(--sc-space-4, 16px); border: 1px dashed var(--sc-border); border-radius: 12px; }
      .e-title { margin: 0; font-weight: 600; }
      .pick-bar { display: flex; align-items: center; gap: var(--sc-space-3, 12px); flex: none; }
      .tally { color: var(--sc-fg-2); font-size: 0.85rem; }
      .groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: var(--sc-space-3, 12px); align-items: start; }
      .grp { border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px) var(--sc-space-3, 12px); min-width: 0; }
      .grp header { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: 4px 0 6px; }
      .grp h3 { margin: 0; font: 600 0.92rem var(--sc-font-display, inherit); flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .tag { padding: 0 8px; border: 1px solid var(--sc-border); border-radius: 999px; color: var(--sc-fg-2); font-size: 0.72rem; }
      .grp ul, .lines, .mats ul, .chips { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
      .grp li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: 4px 8px; border-radius: 8px; border: 1px solid transparent; position: relative; }
      .grp li.on { border-color: color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); background: color-mix(in srgb, var(--sc-accent) 7%, transparent); }
      .nm { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .n { color: var(--sc-fg-1); white-space: nowrap; }
      .n small { color: var(--sc-fg-2); font-size: 0.75rem; }
      .stepper { display: inline-flex; align-items: center; gap: 4px; }
      .step { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--sc-border); border-radius: 8px; background: var(--sc-bg-1); color: var(--sc-fg); font: inherit; cursor: pointer; }
      .step:hover:not(:disabled) { border-color: var(--sc-accent); }
      .step:disabled { opacity: 0.4; cursor: default; }
      .step:focus-visible, .seg button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .share { position: absolute; left: 8px; right: 8px; bottom: 1px; height: 2px; border-radius: 2px; background: color-mix(in srgb, var(--sc-accent) 18%, transparent); }
      .share i { display: block; height: 100%; border-radius: inherit; background: var(--sc-accent); }
      .name-field { display: grid; gap: 4px; max-width: 460px; }
      .name-field span { color: var(--sc-fg-2); font-size: 0.82rem; }
      .name-field small { color: var(--sc-fg-2); justify-self: end; }
      .input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; }
      .input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; border-color: var(--sc-accent); }
      .sum-grid { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: var(--sc-space-3, 12px); align-items: start; }
      @media (max-width: 860px) { .sum-grid { grid-template-columns: minmax(0, 1fr); } }
      .sum { border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); padding: var(--sc-space-3, 12px); min-width: 0; }
      .sum h3 { margin: 0 0 6px; font: 600 0.95rem var(--sc-font-display, inherit); }
      .sum h3 small { font: 400 0.78rem var(--sc-font-body, inherit); color: var(--sc-fg-2); margin-left: 6px; }
      .sum h4 { margin: 8px 0 4px; color: var(--sc-fg-2); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
      .lines li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: 3px 4px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
      .for { color: var(--sc-fg-2); font-size: 0.78rem; }
      .chips { flex-direction: row; flex-wrap: wrap; }
      .chips li { padding: 2px 10px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: 0.82rem; }
      .rest { border-style: dashed; }
      .einsatz-head h3 { margin: 0; font: 600 1rem var(--sc-font-display, inherit); }
      .einsatz-head small { font: 400 0.8rem var(--sc-font-body, inherit); color: var(--sc-fg-2); margin-left: 8px; }
      .e-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--sc-space-3, 12px); align-items: start; }
      .e-grid:not(:has(.mats)) { grid-template-columns: minmax(0, 1fr); }
      @media (max-width: 860px) { .e-grid { grid-template-columns: minmax(0, 1fr); } }
      .mats { border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); padding: var(--sc-space-3, 12px); }
      .mats h4, .have { margin: 0 0 6px; color: var(--sc-fg-2); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
      .mats li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 6px 0; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
      .seg { display: inline-flex; padding: 2px; border: 1px solid var(--sc-border); border-radius: 999px; }
      .seg button { min-height: 26px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; font-size: 0.78rem; cursor: pointer; }
      .seg button[aria-pressed='true'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 22%, transparent); box-shadow: 0 0 0 1px var(--sc-accent); }
      .hint { margin: 6px 0 0; color: var(--sc-fg-2); font-size: 0.78rem; }
      .cards { display: grid; gap: var(--sc-space-2, 8px); }
      .ecard { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--sc-accent) 22%, var(--sc-border)); border-radius: 10px; background: var(--sc-bg-0); }
      .ecard.last { border-color: color-mix(in srgb, var(--sc-accent) 60%, var(--sc-border)); box-shadow: inset 3px 0 0 var(--sc-accent); }
      .ecard header { display: flex; align-items: center; gap: 8px; }
      .ecard h4 { margin: 0; flex: 1; min-width: 0; font-size: 0.92rem; overflow-wrap: anywhere; }
      .eid { padding: 0 6px; border-radius: 5px; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-accent); font: 700 0.72rem var(--sc-font-display, inherit); }
      .kinds { display: inline-flex; gap: 3px; }
      .kic { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-accent); }
      .kic svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .meta, .note { margin: 2px 0 0; color: var(--sc-fg-2); font-size: 0.78rem; }
      .goods { margin: 4px 0 0; display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
      .lbl { color: var(--sc-fg-2); font-size: 0.74rem; margin-right: 2px; }
      .good { padding: 0 8px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: 0.78rem; }
      .have-card { opacity: 0.8; }
      button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      @media (pointer: coarse) { .step { width: 44px; height: 44px; } .seg button { min-height: 44px; } }
    `,
  ],
})
export class HqNachschubFlowComponent {
  readonly mode = input<'new' | 'edit'>('new');
  /** Edit mode: the Nachschub being edited. */
  readonly nachschubId = input<string | null>(null);
  /** Jump straight to a step when opened (edit from the panel opens on step 3 when asked). */
  readonly startStep = input<Step>(1);
  readonly closed = output<void>();
  readonly done = output<NachschubResult>();

  private readonly svc = inject(NachschubService);
  private readonly einsatz = inject(HqEinsatzService);
  private readonly naming = inject(NachschubNamingService);
  private readonly sourcesSvc = inject(HqNeedSourcesService);
  private readonly chrome = inject(ShellChromeService);
  private readonly i18n = inject(TranslateService);

  protected readonly stepList: readonly Step[] = [1, 2, 3];
  protected readonly nameMax = NACHSCHUB_NAME_MAX;
  protected readonly tray = NACHSCHUB_ICON_PATHS;
  protected readonly icons = STEP_ICON_PATHS;
  protected readonly wheels = TRANSPORT_WHEELS;

  protected readonly step = signal<Step>(1);
  protected readonly picks = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly name = signal('');
  private nameTouched = false;
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly splits = signal<ReadonlyMap<string, LineSplit>>(new Map());
  private readonly names = signal<ReadonlyMap<string, string>>(new Map());
  /** Lines removed from the Nachschub while editing (their rows leave the list at once, the write already happened). */
  private readonly removed = signal<ReadonlySet<string>>(new Set());

  private readonly wish = computed(() => this.svc.wishPositions());
  protected readonly groups = computed(() => groupWish(this.wish()));
  protected readonly pieces = computed(() => pickedPieces(this.picks()));
  protected readonly allPicked = computed(() => this.groups().length > 0 && this.groups().every((g) => pickedShare(g.rows, this.picks()) === 1));

  protected readonly existing = computed(() => {
    const id = this.nachschubId();
    if (this.mode() !== 'edit' || !id) return [];
    const gone = this.removed();
    return this.svc.linesOf(id).filter((l) => !gone.has(l.id));
  });
  protected readonly existingEinsaetze = computed(() => {
    const id = this.nachschubId();
    return id ? this.einsatz.ofPackage(id) : [];
  });

  /** The picked rows (with the picked quantity), grouped like step 1. */
  protected readonly pickedGroups = computed<FlowGroup[]>(() => {
    const p = this.picks();
    return this.groups()
      .map((g) => ({ ...g, rows: g.rows.filter((r) => (p.get(r.key) ?? 0) > 0).map((r) => ({ ...r, qty: p.get(r.key) ?? 0 })) }))
      .filter((g) => g.rows.length > 0);
  });
  protected readonly remaining = computed<FlowRow[]>(() => {
    const picks: WishPick[] = [...this.picks()].map(([key, qty]) => ({ key, qty }));
    return takeFromWishlist(this.wish(), picks).remaining.map((r) => ({ ...r, key: positionKey(r) }));
  });
  protected readonly sumCount = computed(() => this.existing().length + this.picks().size);
  protected readonly sumPieces = computed(() => this.existing().reduce((n, l) => n + l.qty, 0) + this.pieces());

  /** What the proposal reads: the picked rows as lines (edit mode: only the newly added ones). */
  protected readonly proposalLines = computed<ProposalLine[]>(() =>
    this.pickedGroups().flatMap((g) =>
      g.rows.map((r) => ({
        key: r.key,
        name: this.rowName(r),
        className: r.className,
        kind: r.kind,
        qty: r.qty,
        forClassName: (r.forClassName ?? '').trim() || null,
        forName: g.type === 'blueprint' ? g.title : null,
      })),
    ),
  );
  protected readonly materialLines = computed(() => this.proposalLines().filter((l) => isMaterialLine(l) && !isBlueprintLine(l)));
  private readonly placeOf = (l: ProposalLine) => {
    const opts = l.className ? (this.sourcesSvc.sources().get(l.className)?.options ?? []) : [];
    return bestSource(opts, null)?.place ?? null;
  };
  protected readonly drafts = computed<DraftEinsatz[]>(() => proposeEinsaetze(this.proposalLines(), { placeOf: this.placeOf, split: this.splits() }));
  protected readonly counts = computed(() => proposalCounts(this.drafts()));
  protected readonly nextSlot = computed(() => freeSlot(this.svc.packages()));
  protected readonly maxSlots = NACHSCHUB_MAX_SLOTS;

  protected readonly canNext = computed(() => (this.step() === 1 ? this.picks().size > 0 || (this.mode() === 'edit' && this.existing().length > 0) : this.name().trim().length > 0));
  protected readonly canSave = computed(() => this.name().trim().length > 0 && (this.picks().size > 0 || this.mode() === 'edit'));

  private namesVersion = 0;

  constructor() {
    effect(() => {
      const s = this.startStep();
      untracked(() => this.step.set(s));
    });
    // Where the picked lines can be bought (the shop lookup is shared with the old Planen).
    effect(() => {
      const wanted = this.proposalLines().filter((l) => l.className && !isBlueprintLine(l)).map((l) => l.className as string);
      untracked(() => this.sourcesSvc.ensure(wanted));
    });
    // Name proposals for the Einsaetze (what you do), asked when the proposal changes.
    effect(() => {
      const drafts = this.drafts();
      const version = ++this.namesVersion;
      untracked(() => {
        for (const d of drafts) {
          void this.naming.einsatzName(d.steps.map((s) => ({ kind: s.kind, label: s.label }))).then((n) => {
            if (version === this.namesVersion) this.names.update((m) => new Map(m).set(d.role, n));
          });
        }
      });
    });
    // Edit mode starts with the Nachschub's own name.
    effect(() => {
      const id = this.nachschubId();
      if (this.mode() !== 'edit' || !id) return;
      const n = this.svc.packages().find((p) => p.id === id);
      untracked(() => {
        if (n && !this.nameTouched && !this.name()) this.name.set(n.name);
      });
    });
  }

  protected rowName(r: Pick<WishPosition, 'name' | 'className'>): string {
    return r.name?.trim() || humanizeClassName(r.className);
  }

  protected groupTitle(g: FlowGroup): string {
    return g.title ?? (g.titleKey ? this.i18n.instant(g.titleKey) : '');
  }

  protected bpName(forClassName: string): string {
    const g = this.groups().find((x) => x.id === `bp:${forClassName.toLowerCase()}`);
    return g?.title ?? humanizeClassName(forClassName);
  }

  protected share(g: FlowGroup): number {
    return pickedShare(g.rows, this.picks());
  }

  protected onGroup(g: FlowGroup): void {
    this.picks.set(toggleGroup(g, this.picks()));
  }

  protected onRow(g: FlowGroup, r: FlowRow, q: number): void {
    this.picks.set(setPicked(g, this.picks(), r.key, q > 0 ? 0 : r.qty));
  }

  protected onQty(g: FlowGroup, r: FlowRow, q: number): void {
    this.picks.set(setPicked(g, this.picks(), r.key, q));
  }

  protected pickAll(): void {
    if (this.allPicked()) {
      this.picks.set(new Map());
      return;
    }
    const next = new Map<string, number>();
    for (const g of this.groups()) for (const r of g.rows) next.set(r.key, r.qty);
    this.picks.set(next);
  }

  protected searchWish(): void {
    this.closed.emit();
    this.chrome.startSupplySearch();
  }

  protected onName(v: string): void {
    this.nameTouched = true;
    this.name.set(v);
  }

  protected async removeExisting(lineId: string): Promise<void> {
    const r = await this.svc.removeLine(lineId, true);
    if (r.ok) this.removed.update((s) => new Set([...s, lineId]));
    else this.error.set(r.key);
  }

  protected splitOf(l: ProposalLine): LineSplit {
    return normalizeSplit(l, this.splits().get(l.key) ?? defaultSplit(l, this.placeOf(l) !== null));
  }

  protected toggle(l: ProposalLine): void {
    this.splits.update((m) => new Map(m).set(l.key, toggleMethod(l, this.splitOf(l))));
  }

  protected split(l: ProposalLine, buy: number): void {
    this.splits.update((m) => new Map(m).set(l.key, setBuyPart(l, buy)));
  }

  protected draftName(d: DraftEinsatz): string {
    return this.names().get(d.role) ?? '…';
  }

  protected draftKinds(d: DraftEinsatz): StepKind[] {
    return [...new Set(d.steps.map((s) => s.kind))];
  }

  protected draftPlaces(d: DraftEinsatz): string {
    return [...new Set(d.steps.map((s) => s.location).filter((x): x is string => !!x))].slice(0, 3).join(', ');
  }

  protected purposesText(d: DraftEinsatz): string {
    return purposesOf(d).join(', ');
  }

  protected back(): void {
    this.error.set(null);
    this.step.update((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  protected async next(): Promise<void> {
    if (!this.canNext()) return;
    this.error.set(null);
    if (this.step() === 1 && !this.nameTouched && this.mode() === 'new' && !this.name()) {
      const items = this.pickedGroups().flatMap((g) => g.rows.map((r) => ({ name: this.rowName(r), qty: r.qty })));
      this.name.set(await this.naming.nachschubName(items));
    }
    this.step.update((s) => (s < 3 ? ((s + 1) as Step) : s));
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const picks: WishPick[] = [...this.picks()].map(([key, qty]) => ({ key, qty }));
      const name = clampName(this.name(), NACHSCHUB_NAME_MAX);
      let result: NachschubResult;
      let id: string | undefined;
      if (this.mode() === 'new') {
        result = await this.svc.createFromWishlist({ picks, name });
        id = result.id;
      } else {
        id = this.nachschubId() ?? undefined;
        if (!id) return;
        const current = this.svc.packages().find((p) => p.id === id);
        if (current && current.name !== name) await this.svc.rename(id, name);
        result = picks.length ? await this.svc.addFromWishlist(id, picks) : { ok: true, key: 'hq.nachschub.done.edited', id };
      }
      if (!result.ok || !id) {
        this.error.set(result.key);
        return;
      }
      await this.writeEinsaetze(id);
      this.done.emit(result);
    } finally {
      this.busy.set(false);
    }
  }

  /** Create the proposed Einsaetze for the lines just added, with the supply line each step serves. */
  private async writeEinsaetze(packageId: string): Promise<void> {
    const lines = this.svc.linesOf(packageId);
    const lineId = (key: string): string | null => {
      const src = this.proposalLines().find((l) => l.key === key);
      if (!src) return null;
      const f = (src.forClassName ?? '').toLowerCase();
      return lines.find((l) => (l.className ?? '').toLowerCase() === (src.className ?? '').toLowerCase() && (l.forClassName ?? '').toLowerCase() === f)?.id ?? null;
    };
    for (const d of this.drafts()) {
      const title = clampName(this.names().get(d.role) ?? (await this.naming.einsatzName(d.steps.map((s) => ({ kind: s.kind, label: s.label })))), EINSATZ_NAME_MAX);
      this.einsatz.create({
        title,
        packageId,
        startLocation: d.steps.find((s) => s.location)?.location ?? null,
        steps: d.steps.map((s) => ({
          kind: s.kind,
          label: s.label,
          location: s.location,
          system: s.system,
          className: s.className,
          qty: s.qty,
          supplyId: s.lineKey ? lineId(s.lineKey) : null,
          missionRef: s.missionRef,
        })),
      });
    }
  }
}
