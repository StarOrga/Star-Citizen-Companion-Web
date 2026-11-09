import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { humanizeClassName } from '../../codex/codex-format';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import type { StepKind } from '../../shared/step/sc-step.component';
import { ScDialogDirective } from '../../shared/dialog/sc-dialog.directive';
import { ScSelectComponent, type ScSelectOption } from '../../shared/sc-select.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { EventHqService } from '../events/event-hq.service';
import { HqEventEndComponent } from '../events/hq-event-end.component';
import { eventBinding, eventDrafts, eventSteps, eventsRewarding, rewardsOf } from '../events/event-hq.util';
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
} from '../nachschub/nachschub.model';
import { NachschubService, type NachschubResult } from '../nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS, STEP_ICON_PATHS, TRANSPORT_WHEELS } from '../nachschub/step-icons';
import { HqNeedSourcesService, bestSource } from './hq-need-sources.service';
import type { MapPlace } from './map/hq-map.types';
import { pickablePlaces } from './map/hq-places';
import { HqInventoryService } from '../data/hq-inventory.service';
import { ItemPathService, PLACE_BLUEPRINTS } from '../data/item-path.service';
import { parseStockRef } from '../stock/hq-stock-ref';
import { HqWishSearchComponent, type WishAdded } from './hq-wish-search.component';
import {
  type CraftCheck,
  type DraftEinsatz,
  type LineMode,
  type LineSplit,
  type ProposalLine,
  availableModes,
  craftCheck,
  craftDerivedLines,
  defaultSplit,
  isBlueprintLine,
  isMaterialLine,
  modeOf,
  normalizeSplit,
  proposalCounts,
  proposeEinsaetze,
  purposesOf,
  setBuyPart,
  unplacedLines,
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

type Step = 1 | 2;

/**
 * "Neuer Nachschub" and "Bearbeiten": two steps in one dialog, the name on top of both (proposed when left empty).
 *  1 Auswählen  running events, then the Wunschliste, grouped, with its own search to put more on it in place; tick
 *               what goes into the Nachschub (or "Alles"), split a quantity. In edit mode the Nachschub's lines are
 *               listed above it and removable.
 *  2 Einsätze   the proposed Einsätze with their count; each material is switchable and splittable (buy / mine), an
 *               item is bought or crafted - crafting checks the blueprint (Sammlung) and the ingredients (Inventar) and
 *               plans a mission for a missing blueprint and the missing material; crafting is always the last Einsatz.
 * The cart's "In einen Nachschub" opens on step 2 (its selection is made already). Everything is written when the last
 * step is confirmed. Only the X, Abbrechen or Escape close it - a click beside it would lose the picks.
 */
@Component({
  selector: 'sc-hq-nachschub-flow',
  standalone: true,
  imports: [NgTemplateOutlet, TranslatePipe, FormsModule, RouterLink, ScActionDirective, ScDialogDirective, HqEventEndComponent, HqWishSearchComponent, ScSelectComponent, ScTooltipDirective, ScTristateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- A click beside the sheet does not close it (the picks would be lost): the X, Abbrechen or Escape do. -->
    <div class="scrim">
      <div class="sheet" role="dialog" aria-modal="true" scDialog (scDialogEscape)="closed.emit()" aria-labelledby="flow-title">
        <header class="dlg-head">
          <span class="dlg-ic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of tray; track p) { <path [attr.d]="p" /> }</svg></span>
          <h2 id="flow-title" class="dlg-title">
            {{ (mode() === 'new' ? 'hq.flow.titleNew' : 'hq.flow.titleEdit') | translate }}
            @if (mode() === 'new' && nextSlot() !== null) { <small>{{ 'hq.flow.slotOf' | translate: { n: nextSlot(), max: maxSlots } }}</small> }
          </h2>
          <ol class="steps" [attr.aria-label]="'hq.flow.stepsAria' | translate">
            @for (s of stepList; track s) {
              <li [class.on]="step() === s" [class.past]="step() > s" [attr.aria-current]="step() === s ? 'step' : null">
                <b>{{ s }}</b><span>{{ 'hq.flow.step.' + s | translate }}</span>
              </li>
            }
          </ol>
          <button type="button" scAction tier="tertiary" [attr.aria-label]="'hq.flow.close' | translate" [scTooltip]="'hq.flow.close' | translate" scTooltipTier="label" (click)="closed.emit()">
            <svg class="sc-action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>

        <div class="dlg-body">
          @if (error(); as e) { <p class="dlg-err" role="alert">{{ e | translate }}</p> }

          <label class="name-field">
            <span>{{ 'hq.flow.nameLabel' | translate }}</span>
            <input type="text" class="input" [maxlength]="nameMax" [ngModel]="name()" (ngModelChange)="onName($event)"
                   [placeholder]="'hq.flow.namePlaceholder' | translate" />
            <small>{{ name().length }}/{{ nameMax }}</small>
          </label>

          @if (step() === 1) {
            @if (events.open().length) {
              <section class="evsec" [attr.aria-label]="'hq.events.pick.title' | translate">
                <h3>{{ 'hq.events.pick.title' | translate }}</h3>
                <p class="dlg-msg">{{ 'hq.events.pick.hint' | translate }}</p>
                @for (o of events.open(); track o.event.id) {
                  @let rs = rewardsOf(o);
                  <article class="evcard" [class.on]="eventPicks().has(o.event.id)">
                    <header>
                      <sc-tristate variant="checkbox" [label]="o.event.name" [value]="eventShare(o)" (toggled)="toggleEvent(o)" />
                      <h4>{{ o.event.name }}</h4>
                      <small><sc-hq-event-end [end]="o.end" /></small>
                    </header>
                    @if (rs.length) {
                      <ul>
                        @for (r of rs; track r.id) {
                          <li>
                            <sc-tristate variant="checkbox" [label]="r.name" [value]="eventPicks().get(o.event.id)?.has(r.id) ? 1 : 0" (toggled)="toggleReward(o.event.id, r.id)" />
                            <span class="nm">{{ r.name }}</span>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="dlg-msg">{{ 'hq.events.pick.sightseeing' | translate }}</p>
                    }
                  </article>
                }
              </section>
            }
            @if (mode() === 'edit' && existing().length) {
              <section class="sum">
                <h3>{{ 'hq.flow.alreadyIn' | translate }} <small>{{ 'hq.flow.picked' | translate: { n: existing().length, p: existingPieces() } }}</small></h3>
                <ul class="lines">
                  @for (l of existing(); track l.id) {
                    <li>
                      <span class="nm">{{ l.name }}</span>
                      @if (l.forClassName) { <span class="for">{{ 'hq.flow.forBp' | translate: { name: bpName(l.forClassName) } }}</span> }
                      <b class="n mono">×{{ l.qty }}</b>
                      <button type="button" scAction tier="tertiary" tone="danger" [attr.aria-label]="'hq.flow.removeLine' | translate: { name: l.name }"
                              [scTooltip]="'hq.flow.removeLine' | translate: { name: l.name }" scTooltipTier="label" (click)="removeExisting(l.id)">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></svg>
                      </button>
                    </li>
                  }
                </ul>
              </section>
            }
            <section class="wishsec" [attr.aria-labelledby]="'flow-wish-title'">
              <h3 id="flow-wish-title">{{ 'hq.flow.wishTitle' | translate }}</h3>
              <sc-hq-wish-search (added)="onWishAdded($event)" />
              @if (groups().length === 0) {
                <p class="dlg-msg">{{ 'hq.flow.emptyWish' | translate }} {{ 'hq.flow.emptyHintSearch' | translate }}</p>
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
            </section>
          }

          @if (step() === 2) {
            <div class="einsatz-head">
              <h3>{{ 'hq.flow.einsaetze' | translate }} <small role="status">{{ 'hq.flow.einsatzCount' | translate: { n: counts().einsaetze, s: counts().steps } }}</small></h3>
            </div>
            @for (d of eventDraftList(); track d.eventId) {
              <article class="ecard evdraft">
                <header>
                  <span class="eid">✦</span>
                  <h4>{{ d.label }}</h4>
                  <span class="kinds"><span class="kic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of icons.event; track p) { <path [attr.d]="p" /> }</svg></span></span>
                </header>
                <p class="meta">{{ 'hq.events.draft.area' | translate }}</p>
                @if (d.goods.length) { <p class="goods">@for (g of d.goods; track $index) { <span class="good">{{ g.qty }}× {{ g.name }}</span> }</p> }
              </article>
            }
            @if (proposalLines().length === 0 && eventDraftList().length === 0) {
              <p class="dlg-msg">{{ (mode() === 'edit' ? 'hq.flow.noNewLines' : 'hq.flow.noLines') | translate }}</p>
            }
            <div class="e-grid">
              @if (materialLines().length || itemLines().length) {
                <div class="lcol">
                  @if (materialLines().length) {
                    <section class="mats" [attr.aria-label]="'hq.flow.matsTitle' | translate">
                      <h4>{{ 'hq.flow.matsTitle' | translate }}</h4>
                      <ul>
                        @for (l of materialLines(); track l.key) {
                          @let sp = splitOf(l);
                          <li [class.out]="isExcluded(l)">
                            <span class="nm">{{ l.name }} <b class="mono">×{{ l.qty }}</b>@if (l.derivedFor && l.forName) { <small class="for">{{ 'hq.flow.craft.forItem' | translate: { name: l.forName } }}</small> }</span>
                            @if (isExcluded(l)) {
                              <ng-container *ngTemplateOutlet="restore; context: { $implicit: l }" />
                            } @else {
                              <span class="seg" role="group" [attr.aria-label]="'hq.flow.methodOf' | translate: { name: l.name }">
                                <button type="button" [attr.aria-pressed]="sp.buy === l.qty" (click)="split(l, l.qty)">{{ 'hq.step.kind.buy' | translate }}</button>
                                <button type="button" [attr.aria-pressed]="sp.mine === l.qty" (click)="split(l, 0)">{{ 'hq.step.kind.mine' | translate }}</button>
                              </span>
                              <span class="stepper" role="group" [attr.aria-label]="'hq.flow.splitOf' | translate: { name: l.name }">
                                <button type="button" class="step" [disabled]="sp.buy <= 0" [attr.aria-label]="'hq.flow.lessBuy' | translate" [scTooltip]="'hq.flow.lessBuy' | translate" scTooltipTier="label" (click)="split(l, sp.buy - 1)">−</button>
                                <b class="n mono">{{ sp.buy }}<small> / {{ sp.mine }}</small></b>
                                <button type="button" class="step" [disabled]="sp.buy >= l.qty" [attr.aria-label]="'hq.flow.moreBuy' | translate" [scTooltip]="'hq.flow.moreBuy' | translate" scTooltipTier="label" (click)="split(l, sp.buy + 1)">+</button>
                              </span>
                              <ng-container *ngTemplateOutlet="wayOut; context: { $implicit: l }" />
                              <ng-container *ngTemplateOutlet="leave; context: { $implicit: l }" />
                            }
                          </li>
                        }
                      </ul>
                      <p class="hint">{{ 'hq.flow.splitHint' | translate }}</p>
                    </section>
                  }
                  @if (itemLines().length) {
                    <section class="mats" [attr.aria-label]="'hq.flow.itemsTitle' | translate">
                      <h4>{{ 'hq.flow.itemsTitle' | translate }}</h4>
                      <ul>
                        @for (l of itemLines(); track l.key) {
                          <li [class.out]="isExcluded(l)">
                            <span class="nm">{{ l.name }} <b class="mono">×{{ l.qty }}</b></span>
                            @if (isExcluded(l)) {
                              <ng-container *ngTemplateOutlet="restore; context: { $implicit: l }" />
                            } @else {
                              @let modes = modesOf(l);
                              @if (modes.length) {
                                <span class="seg" role="group" [attr.aria-label]="'hq.flow.modeOf' | translate: { name: l.name }">
                                  @for (m of modes; track m) {
                                    <button type="button" [attr.aria-pressed]="modeNow(l) === m" (click)="setMode(l, m)">{{ 'hq.step.kind.' + m | translate }}</button>
                                  }
                                </span>
                              }
                              <ng-container *ngTemplateOutlet="wayOut; context: { $implicit: l }" />
                              <ng-container *ngTemplateOutlet="leave; context: { $implicit: l }" />
                              @if (modeNow(l) === 'craft') {
                                <ng-container *ngTemplateOutlet="craftBox; context: { $implicit: l }" />
                              }
                            }
                          </li>
                        }
                      </ul>
                      <p class="hint">{{ 'hq.flow.modeHint' | translate }}</p>
                    </section>
                  }
                </div>
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
          @if (step() < 2) {
            <button type="button" scAction tier="primary" [disabled]="!canNext()" (click)="next()">{{ 'hq.flow.next' | translate }}</button>
          } @else {
            <button type="button" scAction tier="primary" [busy]="busy()" [disabled]="busy() || !canSave()" (click)="save()">
              {{ (mode() === 'new' ? 'hq.flow.create' : 'hq.flow.saveEdit') | translate }}
            </button>
          }
        </footer>
      </div>
    </div>

    <ng-template #leave let-l>
      <button type="button" scAction tier="tertiary" tone="danger" class="leave" [attr.aria-label]="'hq.flow.leaveOut' | translate: { name: l.name }"
              [scTooltip]="'hq.flow.leaveOut' | translate: { name: l.name }" scTooltipTier="label" (click)="exclude(l)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </ng-template>
    <ng-template #restore let-l>
      <span class="why">{{ 'hq.flow.leftOut' | translate }}</span>
      <button type="button" scAction tier="secondary" (click)="include(l)">{{ 'hq.flow.putBack' | translate }}</button>
    </ng-template>
    <ng-template #craftBox let-l>
      @if (craftOf(l); as c) {
        <div class="craft" [attr.aria-label]="'hq.flow.craft.aria' | translate: { name: l.name }" role="group">
          <p class="crow" [class.ok]="c.blueprintOwned" [class.miss]="!c.blueprintOwned">
            <span class="cmark" aria-hidden="true">{{ c.blueprintOwned ? '✓' : '!' }}</span>
            <span>{{ (c.blueprintOwned ? 'hq.flow.craft.bpOwned' : 'hq.flow.craft.bpMissing') | translate: { name: c.blueprintName } }}</span>
          </p>
          @for (i of c.ingredients; track i.className) {
            <p class="crow" [class.ok]="i.missing === 0" [class.miss]="i.missing > 0">
              <span class="cmark" aria-hidden="true">{{ i.missing === 0 ? '✓' : '!' }}</span>
              <span>{{ (i.missing === 0 ? 'hq.flow.craft.matOwned' : 'hq.flow.craft.matMissing') | translate: { name: i.name, need: i.need, have: i.have, missing: i.missing } }}</span>
            </p>
          } @empty {
            <p class="crow">{{ 'hq.flow.craft.noRecipe' | translate }}</p>
          }
          <p class="hint">{{ 'hq.flow.craft.source' | translate }}</p>
        </div>
      } @else {
        <span class="why">{{ 'hq.flow.craft.loading' | translate }}</span>
      }
    </ng-template>
    <ng-template #wayOut let-l>
      @if (placeNameOf(l); as pn) {
        <span class="why">{{ 'hq.flow.placeIs' | translate: { place: pn } }}</span>
      }
      @if (isUnplaced(l)) {
        <span class="why warn">{{ 'hq.flow.noMerchant' | translate }}</span>
      }
      @if (isUnplaced(l) || hasOwnPlace(l)) {
        <span class="way">
          @if (codexLink(l); as link) {
            <a scAction tier="secondary" [routerLink]="link" target="_blank" rel="noopener noreferrer">{{ 'hq.flow.openCodex' | translate }}</a>
          }
          <sc-select class="placepick" [options]="placeOptions" [value]="ownPlaceId(l)" placeholderKey="hq.flow.setPlace"
                     [ariaLabel]="'hq.flow.setPlaceOf' | translate: { name: l.name }" (valueChange)="setPlace(l, $event)" />
        </span>
      }
    </ng-template>
  `,
  styles: [
    `.evsec { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); margin-bottom: var(--sc-space-3, 12px); } .evsec h3 { margin: 0; font: 600 1rem var(--sc-font-display, inherit); } .evcard { border: 1px solid var(--sc-border); border-radius: 10px; padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); background: var(--sc-bg-0); } .evcard.on { border-color: var(--sc-accent); } .evcard header { display: flex; align-items: center; gap: var(--sc-space-2, 8px); } .evcard h4 { margin: 0; flex: 1; min-width: 0; overflow-wrap: anywhere; } .evcard ul { list-style: none; margin: 6px 0 0; padding: 0 0 0 28px; display: flex; flex-direction: column; gap: 4px; } .evcard li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); }`,
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
      .grp ul, .lines, .mats ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
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
      .name-field { display: grid; gap: 4px; max-width: 460px; flex: none; }
      .name-field span { color: var(--sc-fg-2); font-size: 0.82rem; }
      .name-field small { color: var(--sc-fg-2); justify-self: end; }
      .input { min-height: 40px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-0); color: var(--sc-fg); font: inherit; }
      .input:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 1px; border-color: var(--sc-accent); }
      .sum { border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); padding: var(--sc-space-3, 12px); min-width: 0; }
      .sum h3 { margin: 0 0 6px; font: 600 0.95rem var(--sc-font-display, inherit); }
      .sum h3 small { font: 400 0.78rem var(--sc-font-body, inherit); color: var(--sc-fg-2); margin-left: 6px; }
      .sum h4 { margin: 8px 0 4px; color: var(--sc-fg-2); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; }
      .lines li { display: flex; align-items: center; gap: var(--sc-space-2, 8px); padding: 3px 4px; border-bottom: 1px solid color-mix(in srgb, var(--sc-border) 60%, transparent); }
      .for { color: var(--sc-fg-2); font-size: 0.78rem; }
      .einsatz-head h3 { margin: 0; font: 600 1rem var(--sc-font-display, inherit); }
      .einsatz-head small { font: 400 0.8rem var(--sc-font-body, inherit); color: var(--sc-fg-2); margin-left: 8px; }
      .e-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--sc-space-3, 12px); align-items: start; }
      .e-grid:not(:has(.lcol)) { grid-template-columns: minmax(0, 1fr); }
      @media (max-width: 860px) { .e-grid { grid-template-columns: minmax(0, 1fr); } }
      .lcol { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); min-width: 0; }
      /* A material line wraps its controls below the name instead of squeezing the name to a few letters. */
      .mats li .nm { flex: 1 0 8.5rem; min-width: 8.5rem; overflow-wrap: break-word; }
      .mats li.out .nm { color: var(--sc-fg-2); text-decoration: line-through; }
      .why { color: var(--sc-fg-2); font-size: 0.78rem; }
      .why.warn { color: var(--sc-warning); }
      .way { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .placepick { min-width: 11rem; }
      .leave { margin-left: auto; }
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
      .wishsec { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .wishsec > h3 { margin: 0; font: 600 1rem var(--sc-font-display, inherit); }
      .craft { flex: 1 0 100%; display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border-left: 2px solid color-mix(in srgb, var(--sc-accent) 45%, var(--sc-border)); background: color-mix(in srgb, var(--sc-accent) 5%, transparent); border-radius: 0 8px 8px 0; }
      .crow { margin: 0; display: flex; align-items: baseline; gap: 6px; font-size: 0.8rem; color: var(--sc-fg-1); }
      .crow.ok .cmark { color: var(--sc-success); }
      .crow.miss .cmark { color: var(--sc-warning); }
      .cmark { flex: none; width: 1em; text-align: center; font-weight: 700; }
      .mats .for { margin-left: 6px; color: var(--sc-fg-2); font-size: 0.75rem; }
      button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      @media (pointer: coarse) { .step { width: 44px; height: 44px; } .seg button { min-height: 44px; } }
    `,
  ],
})
export class HqNachschubFlowComponent {
  readonly mode = input<'new' | 'edit'>('new');
  /** Edit mode: the Nachschub being edited. */
  readonly nachschubId = input<string | null>(null);
  /** Jump straight to a step when opened (the cart's selection and "Einsätze vorschlagen" open on step 2). */
  readonly startStep = input<Step>(1);
  /** Wishlist positions that start out picked (the cart's "In einen Nachschub"): `key` and the quantity to take. */
  readonly preselect = input<readonly { key: string; qty: number }[]>([]);
  readonly closed = output<void>();
  readonly done = output<NachschubResult>();

  private readonly svc = inject(NachschubService);
  private readonly einsatz = inject(HqEinsatzService);
  private readonly naming = inject(NachschubNamingService);
  private readonly sourcesSvc = inject(HqNeedSourcesService);
  private readonly i18n = inject(TranslateService);
  private readonly itemPath = inject(ItemPathService);
  private readonly inventory = inject(HqInventoryService);
  protected readonly events = inject(EventHqService);
  protected readonly rewardsOf = rewardsOf;
  /** Events picked next to the wishlist: event id -> the reward ids chosen (an empty set = sightseeing / nothing chosen). */
  protected readonly eventPicks = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());

  protected readonly stepList: readonly Step[] = [1, 2];
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
  private readonly modes = signal<ReadonlyMap<string, LineMode>>(new Map());
  private readonly leftOut = signal<ReadonlySet<string>>(new Set());
  /** The place the reader named for a line that has no merchant (W5.5); it becomes the location of its buy step. */
  private readonly ownPlaces = signal<ReadonlyMap<string, MapPlace>>(new Map());
  protected readonly placeOptions: readonly ScSelectOption[] = pickablePlaces().map((p) => ({ value: p.id, labelKey: '', label: [p.location, p.system].join(' · ') }));
  private readonly pickable = new Map(pickablePlaces().map((p) => [p.id, p] as const));
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
  protected readonly existingPieces = computed(() => this.existing().reduce((n, l) => n + l.qty, 0));

  /** The picked rows as lines (edit mode: only the newly added ones), before crafting adds what it needs. */
  private readonly baseLines = computed<ProposalLine[]>(() => {
    const picked: ProposalLine[] = this.pickedGroups().flatMap((g) =>
      g.rows.map((r) => ({
        key: r.key,
        name: this.rowName(r),
        className: r.className,
        kind: r.kind,
        qty: r.qty,
        forClassName: (r.forClassName ?? '').trim() || null,
        forName: g.type === 'blueprint' ? g.title : null,
        craftable: !!(r.className && this.sourcesSvc.sources().get(r.className)?.craftable),
        eventIds: r.className ? eventsRewarding(this.events.open(), r.className).map((o) => o.event.id) : [],
      })),
    );
    const open = this.openLines();
    if (!open.length) return picked;
    // A newly picked position that is already on the Nachschub joins its line instead of doubling it.
    const byKey = new Map(open.map((l) => [l.key, l] as const));
    const merged = picked.map((l) => {
      const o = byKey.get(l.key);
      if (!o) return l;
      byKey.delete(l.key);
      return { ...l, qty: l.qty + o.qty };
    });
    return [...byKey.values(), ...merged];
  });
  /**
   * Edit mode, Nachschub without any Einsatz yet: its open lines are proposed Einsaetze like new picks
   * (otherwise "Einsaetze vorschlagen" could never produce any for lines added earlier).
   */
  private readonly openLines = computed<ProposalLine[]>(() => {
    if (this.mode() !== 'edit' || this.existingEinsaetze().length > 0) return [];
    return this.existing()
      .filter((l) => !l.done && !!l.className)
      .map((l) => {
        const kind = l.entityKind ?? 'item';
        const forClassName = (l.forClassName ?? '').trim() || null;
        return {
          key: positionKey({ kind, className: l.className as string, forClassName }),
          name: l.name?.trim() || humanizeClassName(l.className as string),
          className: l.className,
          kind,
          qty: l.qty,
          forClassName,
          forName: forClassName ? this.bpName(forClassName) : null,
          craftable: !!(l.className && this.sourcesSvc.sources().get(l.className)?.craftable),
        };
      });
  });
  /** Blueprints in the Sammlung (lower-cased class names) and the Inventar per class: what crafting is checked against. */
  private readonly ownedBlueprints = computed(() => new Set([...this.itemPath.ownedBlueprints()].map((c) => c.toLowerCase())));
  private readonly stockByClass = computed(() => {
    const out = new Map<string, number>();
    for (const i of this.inventory.items()) {
      if (i.location === PLACE_BLUEPRINTS) continue;
      const cls = parseStockRef(i.class_name)?.className.toLowerCase();
      if (cls) out.set(cls, (out.get(cls) ?? 0) + Math.max(0, Number(i.qty) || 0));
    }
    return out;
  });
  /** The craft check per line the reader crafts, once its recipe is known. */
  private readonly craftChecks = computed(() => {
    const out = new Map<string, CraftCheck>();
    const owned = this.ownedBlueprints();
    const stock = this.stockByClass();
    for (const l of this.baseLines()) {
      if (this.modeNow(l) !== 'craft' || !l.className) continue;
      const recipe = this.sourcesSvc.sources().get(l.className)?.recipe;
      if (!recipe) continue;
      out.set(l.key, craftCheck(l, recipe, { blueprint: (c) => owned.has(c.toLowerCase()), stock: (c) => stock.get(c.toLowerCase()) ?? 0 }));
    }
    return out;
  });
  /** What the proposal reads: the base lines plus, per crafted line, its missing blueprint and missing ingredients. */
  protected readonly proposalLines = computed<ProposalLine[]>(() => {
    const base = this.baseLines();
    const checks = this.craftChecks();
    if (!checks.size) return base;
    return [...base, ...base.flatMap((l) => (checks.has(l.key) ? craftDerivedLines(l, checks.get(l.key)!) : []))];
  });
  protected readonly materialLines = computed(() => this.proposalLines().filter((l) => isMaterialLine(l) && !isBlueprintLine(l)));
  /** Non-material, non-blueprint lines: bought or crafted per line (W5.4). */
  protected readonly itemLines = computed(() => this.proposalLines().filter((l) => !isMaterialLine(l) && !isBlueprintLine(l)));
  private readonly placeOf = (l: ProposalLine) => {
    const own = this.ownPlaces().get(l.key);
    if (own) return own;
    const opts = l.className ? (this.sourcesSvc.sources().get(l.className)?.options ?? []) : [];
    return bestSource(opts, null)?.place ?? null;
  };
  protected readonly drafts = computed<DraftEinsatz[]>(() => proposeEinsaetze(this.proposalLines(), { placeOf: this.placeOf, ...this.pctx() }));
  private readonly pctx = computed(() => ({ split: this.splits(), mode: this.modes(), excluded: this.leftOut() }));
  private readonly unplaced = computed(() => new Set(unplacedLines(this.proposalLines(), { placeOf: this.placeOf, ...this.pctx() }).map((l) => l.key)));
  protected readonly counts = computed(() => proposalCounts(this.drafts()));
  /** The number the board tile showed: the board lists the active Nachschübe compacted, the new one takes the next place (not the DB slot). */
  protected readonly nextSlot = computed(() => {
    if (freeSlot(this.svc.packages()) === null) return null;
    return this.svc.packages().filter((n) => n.status === 'active').length + 1;
  });
  protected readonly maxSlots = NACHSCHUB_MAX_SLOTS;

  protected readonly canNext = computed(() => this.picks().size > 0 || this.eventPicks().size > 0 || (this.mode() === 'edit' && this.existing().length > 0));
  protected readonly canSave = computed(() => this.name().trim().length > 0 && (this.picks().size > 0 || this.eventPicks().size > 0 || this.mode() === 'edit'));

  private preselected = false;

  /** The steps each Einsatz name was asked for, so an unchanged Einsatz is not asked again. */
  private readonly nameSig = new Map<string, string>();

  constructor() {
    // The cart hands over its selection: pick it once, as far as the wishlist still holds those positions.
    effect(() => {
      const pre = this.preselect();
      const rows = this.wish();
      if (!pre.length || !rows.length) return;
      untracked(() => {
        if (this.preselected) return;
        this.preselected = true;
        const have = new Map(rows.map((r) => [positionKey(r), r.qty] as const));
        const next = new Map<string, number>();
        for (const p of pre) {
          const max = have.get(p.key);
          if (max) next.set(p.key, Math.min(max, p.qty));
        }
        if (next.size) this.picks.set(next);
      });
    });
    effect(() => {
      const s = this.startStep();
      untracked(() => this.step.set(s));
    });
    // Where the picked lines can be bought (the shop lookup is shared with the old Planen).
    effect(() => {
      const wanted = this.proposalLines().filter((l) => l.className && !isBlueprintLine(l)).map((l) => l.className as string);
      untracked(() => this.sourcesSvc.ensure(wanted));
    });
    // A new Nachschub reached its Einsätze without a name (the cart opens there): propose one, once.
    effect(() => {
      if (this.step() !== 2 || this.mode() !== 'new' || this.pickedGroups().length === 0) return;
      untracked(() => void this.proposeName());
    });
    // Name proposals for the Einsaetze (what you do): asked on step 2 only, and only when an Einsatz' steps really changed.
    effect(() => {
      const drafts = this.drafts();
      if (this.step() !== 2) return;
      untracked(() => {
        for (const d of drafts) {
          const steps = d.steps.map((s) => ({ kind: s.kind, label: s.label }));
          const sig = steps.map((s) => `${s.kind}:${s.label}`).join('|');
          if (this.nameSig.get(d.role) === sig) continue;
          this.nameSig.set(d.role, sig);
          void this.naming.einsatzName(steps).then((n) => {
            if (this.nameSig.get(d.role) === sig) this.names.update((m) => new Map(m).set(d.role, n));
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

  protected split(l: ProposalLine, buy: number): void {
    this.splits.update((m) => new Map(m).set(l.key, setBuyPart(l, buy)));
  }

  protected modesOf(l: ProposalLine): LineMode[] {
    return availableModes(l, this.placeOf(l) !== null);
  }

  protected modeNow(l: ProposalLine): LineMode | null {
    return modeOf(l, { placeOf: this.placeOf, ...this.pctx() });
  }

  protected setMode(l: ProposalLine, m: LineMode): void {
    this.modes.update((x) => new Map(x).set(l.key, m));
  }

  protected isExcluded(l: ProposalLine): boolean {
    return this.leftOut().has(l.key);
  }

  protected exclude(l: ProposalLine): void {
    this.leftOut.update((x) => new Set([...x, l.key]));
  }

  protected include(l: ProposalLine): void {
    this.leftOut.update((x) => new Set([...x].filter((k) => k !== l.key)));
  }

  /** A line that would be bought but has no merchant and no place of the reader's own. */
  protected isUnplaced(l: ProposalLine): boolean {
    return this.unplaced().has(l.key);
  }

  protected hasOwnPlace(l: ProposalLine): boolean {
    return this.ownPlaces().has(l.key);
  }

  protected ownPlaceId(l: ProposalLine): string | null {
    return this.ownPlaces().get(l.key)?.id ?? null;
  }

  protected placeNameOf(l: ProposalLine): string | null {
    return this.ownPlaces().get(l.key)?.location ?? null;
  }

  protected setPlace(l: ProposalLine, id: string | null): void {
    const place = id ? this.pickable.get(id) : undefined;
    this.ownPlaces.update((m) => {
      const next = new Map(m);
      if (place) next.set(l.key, place);
      else next.delete(l.key);
      return next;
    });
  }

  /** The Codex page of a line, once its kind is known. */
  protected codexLink(l: ProposalLine): string[] | null {
    const kind = l.className ? this.sourcesSvc.sources().get(l.className)?.kind : null;
    return kind && l.className ? ['/codex', kind, l.className] : null;
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

  /** Parent tristate of an event card: share of its rewards picked; an event without rewards is 0 / 1. */
  protected eventShare(o: Parameters<typeof rewardsOf>[0]): number {
    const picked = this.eventPicks().get(o.event.id);
    const rs = rewardsOf(o);
    if (!rs.length) return picked ? 1 : 0;
    if (!picked) return 0;
    const n = rs.filter((r) => picked.has(r.id)).length;
    return n / rs.length;
  }

  /** Ticking the event selects all its rewards, unticking clears them (same as the wishlist groups). */
  protected toggleEvent(o: Parameters<typeof rewardsOf>[0]): void {
    const id = o.event.id;
    const all = this.eventShare(o) === 1;
    this.eventPicks.update((m) => {
      const next = new Map(m);
      if (all) next.delete(id);
      else next.set(id, new Set(rewardsOf(o).map((r) => r.id)));
      return next;
    });
  }

  protected toggleReward(eventId: string, rewardId: string): void {
    this.eventPicks.update((m) => {
      const next = new Map(m);
      const set = new Set(next.get(eventId) ?? []);
      if (set.has(rewardId)) set.delete(rewardId);
      else set.add(rewardId);
      // Choosing a reward selects the event; an event with no reward left stays selected (the reader unticks it itself).
      next.set(eventId, set);
      return next;
    });
  }

  /** Events this Nachschub covers: the picked ones plus every event a line was sent to (the fourth way). */
  private readonly eventsInUse = computed(() => {
    const out = new Map<string, { name: string; qty: number; className: string | null }[]>();
    for (const o of this.events.open()) {
      const picked = this.eventPicks().get(o.event.id);
      if (picked) out.set(o.event.id, rewardsOf(o).filter((r) => picked.has(r.id)).map((r) => ({ name: r.name, qty: 1, className: r.className })));
    }
    for (const l of this.proposalLines()) {
      if (this.modeNow(l) !== 'event' || !l.eventIds?.length) continue;
      const id = l.eventIds[0];
      out.set(id, [...(out.get(id) ?? []), { name: l.name, qty: l.qty, className: l.className }]);
    }
    return out;
  });

  /** Binding of the picked events (creation and edit use the same plan). */
  private pickedEventBinding() {
    return eventBinding(
      this.events
        .open()
        .filter((o) => this.eventPicks().has(o.event.id))
        .map((o) => ({ event: o, rewards: rewardsOf(o).filter((r) => this.eventPicks().get(o.event.id)?.has(r.id)) })),
    );
  }

  protected readonly eventDraftList = computed(() =>
    eventDrafts(
      this.events
        .open()
        .filter((o) => this.eventsInUse().has(o.event.id))
        .map((o) => ({ event: o, rewards: this.eventsInUse().get(o.event.id)! })),
    ),
  );

  protected back(): void {
    this.error.set(null);
    this.step.update((s) => (s > 1 ? ((s - 1) as Step) : s));
  }

  protected async next(): Promise<void> {
    if (!this.canNext()) return;
    this.error.set(null);
    await this.proposeName();
    this.step.set(2);
  }

  private namingNow: Promise<void> | null = null;

  /** A new Nachschub whose name the reader left empty gets one from what it holds (asked once at a time). */
  private proposeName(): Promise<void> {
    if (this.nameTouched || this.mode() !== 'new' || this.name()) return Promise.resolve();
    const items = this.pickedGroups().flatMap((g) => g.rows.map((r) => ({ name: this.rowName(r), qty: r.qty })));
    if (!items.length) return Promise.resolve();
    this.namingNow ??= this.naming.nachschubName(items).then((n) => {
      this.namingNow = null;
      if (!this.nameTouched && !this.name()) this.name.set(n);
    });
    return this.namingNow;
  }

  /** A hit the reader put on the wishlist from the flow's search is ticked at once. */
  protected onWishAdded(a: WishAdded): void {
    const key = positionKey({ kind: a.kind, className: a.className, forClassName: null });
    const qty = this.wish().find((r) => positionKey(r) === key)?.qty ?? 1;
    this.picks.update((m) => new Map(m).set(key, Math.max(m.get(key) ?? 0, qty)));
  }

  protected craftOf(l: ProposalLine): CraftCheck | null {
    return this.craftChecks().get(l.key) ?? null;
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const picks: WishPick[] = [...this.picks()].map(([key, qty]) => ({ key, qty }));
      const name = clampName(this.name(), NACHSCHUB_NAME_MAX);
      // The proposal reads the wishlist: taking the picks empties it. Hold the Einsaetze and their lines BEFORE the write.
      const plan: EinsatzPlan = { drafts: this.drafts(), lines: this.proposalLines(), names: this.names() };
      let result: NachschubResult;
      let id: string | undefined;
      if (this.mode() === 'new') {
        const binding = this.pickedEventBinding();
        result = await this.svc.createFromWishlist({ picks, name, event: binding ?? undefined });
        id = result.id;
      } else {
        id = this.nachschubId() ?? undefined;
        if (!id) return;
        const current = this.svc.packages().find((p) => p.id === id);
        if (current && name && current.name !== name && !(await this.svc.rename(id, name))) {
          this.error.set(this.svc.error() ?? 'errors.generic');
          return;
        }
        const binding = this.pickedEventBinding();
        result = picks.length || binding?.rewards.length ? await this.svc.addFromWishlist(id, picks, binding?.rewards) : { ok: true, key: 'hq.nachschub.done.edited', id };
        // An event chosen while editing binds a plain Nachschub to it, exactly like on creation (end archive, C11).
        const now = result.ok && binding ? this.svc.packages().find((p) => p.id === id) : undefined;
        if (now && binding && (now.type ?? 'normal') === 'normal' && !(await this.svc.update({ ...now, type: binding.type, eventId: binding.eventId }))) {
          this.error.set(this.svc.error() ?? 'errors.generic');
          return;
        }
      }
      if (!result.ok || !id) {
        this.error.set(result.key);
        return;
      }
      await this.writeEinsaetze(id, plan);
      this.writeEventEinsaetze(id);
      this.done.emit(result);
    } finally {
      this.busy.set(false);
    }
  }

  /** One Einsatz per chosen event: a single event step carrying the area instead of a place. */
  private writeEventEinsaetze(id: string): void {
    const lines = this.svc.linesOf(id);
    for (const d of this.eventDraftList()) {
      this.einsatz.create({
        title: clampName(d.label, EINSATZ_NAME_MAX),
        packageId: id,
        startLocation: null,
        steps: eventSteps(d, (cls) => lines.find((l) => (l.className ?? '').toLowerCase() === cls.toLowerCase())?.id ?? null).map((s) => ({
          kind: 'event' as const, label: s.label, location: null, system: null, className: s.className, qty: null, supplyId: s.supplyId, missionRef: null, eventId: s.eventId, area: s.area,
        })),
      });
    }
  }

  /** Create the proposed Einsaetze for the lines just added, with the supply line each step serves. */
  private async writeEinsaetze(packageId: string, plan: EinsatzPlan): Promise<void> {
    const lines = this.svc.linesOf(packageId);
    const lineId = (key: string): string | null => {
      const src = plan.lines.find((l) => l.key === key);
      if (!src) return null;
      const f = (src.forClassName ?? '').toLowerCase();
      return lines.find((l) => (l.className ?? '').toLowerCase() === (src.className ?? '').toLowerCase() && (l.forClassName ?? '').toLowerCase() === f)?.id ?? null;
    };
    for (const d of plan.drafts) {
      const title = clampName(plan.names.get(d.role) ?? (await this.naming.einsatzName(d.steps.map((s) => ({ kind: s.kind, label: s.label })))), EINSATZ_NAME_MAX);
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

/** What the proposal looked like when "Speichern" was pressed (the wishlist it reads shrinks with the write). */
interface EinsatzPlan {
  readonly drafts: readonly DraftEinsatz[];
  readonly lines: readonly ProposalLine[];
  readonly names: ReadonlyMap<string, string>;
}
