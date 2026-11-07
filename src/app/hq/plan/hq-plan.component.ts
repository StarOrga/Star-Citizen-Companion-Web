import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ItemPathComponent } from '../../shared/item-path/item-path.component';
import { HQ_LIST_PARAM, hqListTabOf, type HqListTab } from '../hq-routes';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { STEP_KINDS, STEP_SHAPES, ScStepComponent, StepKind } from '../../shared/step/sc-step.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScTristateComponent } from '../../shared/tristate/sc-tristate.component';
import { HqEinsatzService, einsatzBadge } from '../data/hq-einsatz.service';
import { HqOwnershipService } from '../hq-ownership.service';
import { HqPageNavService } from '../hq-page-nav.service';
import { PAGE_GLIDE_MS } from '../hq-page-scroll';
import { ShellChromeService } from '../../shell/fusion-bar/shell-chrome.service';
import { HqLiveService } from '../now/hq-live.service';
import { readLocation } from '../now/hq-live.util';
import { HqSuppliesPopupComponent } from '../hq-supplies-popup.component';
import { NachschubFocusService } from '../nachschub/nachschub-focus.service';
import { NachschubService, type NachschubResult } from '../nachschub/nachschub.service';
import { HqNachschubBoardComponent } from './hq-nachschub-board.component';
import { HqNachschubArchiveDialogComponent, HqNachschubRemoveDialogComponent } from './hq-nachschub-dialogs.component';
import { HqNachschubFlowComponent } from './hq-nachschub-flow.component';
import { HqNachschubPanelComponent } from './hq-nachschub-panel.component';
import { HqSuppliesService, supplyQtyText } from '../hq-supplies.service';
import { HqEinsatzCrewComponent } from '../social/hq-einsatz-crew.component';
import { HqFriendShareComponent } from '../social/hq-friend-share.component';
import { HqSharedEinsaetzeComponent } from '../social/hq-shared-einsaetze.component';
import { HqMoodTogglesComponent } from './hq-mood-toggles.component';
import { MoodPair, MoodSide, activeMoodKeys } from './hq-moods';
import { HqNeedSourcesService, NeedSource, NeedSources, bestSource, sourcesByDistance } from './hq-need-sources.service';
import { buildPlanNeeds, buildPlanSets, placesFromEinsaetze } from './hq-plan-needs';
import { placeOfName } from './map/hq-places';
import {
  PlanSelection,
  applyMood,
  clearSelection,
  initialSelection,
  passesFilters,
  saveSelection,
  setPlaces,
  soonSetKeys,
  toMapNeed,
  toggleNeed,
  toggleSet,
  toggleStepKind,
  top3Selection,
  visibleNeeds,
  type PlanNeed,
} from './hq-plan-selection';
import { HqPlaceTreeComponent } from './hq-place-tree.component';
import { HqSetRingsComponent } from './hq-set-rings.component';
import { HqCommunityOptinComponent } from './hq-community-optin.component';
import { HqBlueprintProgressComponent } from './hq-blueprint-progress.component';
import { HqCommodityPricesComponent } from './hq-commodity-prices.component';
import { HqPlanMapComponent } from './map/hq-plan-map.component';
import { buildRoute } from './map/hq-route';
import type { MapPlace, PlanView } from './map/hq-map.types';

/**
 * HQ page "Planen" (concept D23-D31): what do I need (Was) and how do I get there (Wie).
 *
 * - "Auswahl" (only in Was): sets as rings, mood pairs, step-kind chips, the Ort tree. There is
 *   no mode toggle - Top 3 is the default, a mood click is "Nach Lust", any other change "Gezielt".
 *   The selection is remembered per tab session (sessionStorage).
 * - Unselected needs are gone from the list AND the map. Wie shows the route as unified `sc-step`
 *   rows, without filters, and saves it as an Einsatz.
 * - Nachschub (the supplies list) opens from here.
 * The section frame (`<section id="planen">`) belongs to `HqPagesComponent`.
 */
@Component({
  selector: 'sc-hq-plan',
  standalone: true,
  imports: [
    TranslatePipe,
    RouterLink,
    ScActionDirective,
    ItemPathComponent,
    ScStepComponent,
    ScTristateComponent,
    ScTooltipDirective,
    HqMoodTogglesComponent,
    HqPlaceTreeComponent,
    HqSetRingsComponent,
    HqSuppliesPopupComponent,
    HqPlanMapComponent,
    HqCommunityOptinComponent,
    HqBlueprintProgressComponent,
    HqCommodityPricesComponent,
    HqFriendShareComponent,
    HqEinsatzCrewComponent,
    HqSharedEinsaetzeComponent,
    HqNachschubBoardComponent,
    HqNachschubPanelComponent,
    HqNachschubFlowComponent,
    HqNachschubRemoveDialogComponent,
    HqNachschubArchiveDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2 class="page-title" id="hq-plan-title">{{ 'hq.pages.planen' | translate }}</h2>
      @if (mode() === 'nachschub' && ns.newBlock(); as block) {
        <span class="hint" role="status">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.4" /></svg>{{ block | translate }}
        </span>
      }
      <div class="switch" role="group" [attr.aria-label]="'hq.plan.mode.label' | translate">
        <button type="button" class="seg" [attr.aria-pressed]="mode() === 'nachschub'" (click)="mode.set('nachschub')">{{ 'hq.plan.mode.nachschub' | translate }}</button>
        <button type="button" class="seg" [attr.aria-pressed]="mode() === 'classic'" (click)="mode.set('classic')">{{ 'hq.plan.mode.classic' | translate }}</button>
      </div>
      @if (mode() === 'classic' && !fresh()) {
        <div class="switch" role="group" [attr.aria-label]="'hq.plan.switch.label' | translate">
          <button type="button" class="seg" [attr.aria-pressed]="view() === 'what'" (click)="view.set('what')">
            {{ 'hq.plan.switch.what' | translate }}
          </button>
          <button type="button" class="seg" [attr.aria-pressed]="view() === 'how'" (click)="view.set('how')">
            {{ 'hq.plan.switch.how' | translate }}
          </button>
        </div>
      }
    </header>

    @if (mode() === 'nachschub') {
      <div class="ns-page">
        @if (ns.error() && !ns.loaded()) {
          <p class="err" role="alert">
            {{ ns.error()! | translate }}
            <button type="button" scAction tier="secondary" (click)="retryNachschub()">{{ 'hq.plan.retry' | translate }}</button>
          </p>
        }
        <sc-hq-nachschub-board
          [selectedId]="focus.selected()?.id ?? null"
          (selectNachschub)="focus.select($event)"
          (create)="flow.set({ mode: 'new', id: null, step: 1 })"
          (remove)="askRemove($event, 'remove')"
          (openArchive)="archiveOpen.set(true)" />
        @if (focus.selected(); as sel) {
          <sc-hq-nachschub-panel
            [nachschub]="sel"
            (edit)="flow.set({ mode: 'edit', id: sel.id, step: $event })"
            (emptyIt)="askRemove(sel.id, 'empty')"
            (remove)="askRemove(sel.id, 'remove')" />
        } @else if (ns.loaded() || !ns.error()) {
          <section class="intro">
            <p class="intro-title">{{ 'hq.slots.introTitle' | translate }}</p>
            <p class="intro-text">{{ 'hq.slots.introText' | translate }}</p>
          </section>
        }
      </div>
    } @else {
    <div class="classic">
    @if (syncError(); as key) {
      <p class="err" role="alert">
        {{ key | translate }}
        <button type="button" class="sc-btn small ghost" (click)="retry()">{{ 'hq.plan.retry' | translate }}</button>
      </p>
    }

    @if (fresh()) {
      <section class="fresh" aria-labelledby="hq-plan-fresh">
        <h3 id="hq-plan-fresh" class="fresh-title">{{ 'hq.plan.fresh.title' | translate }}</h3>
        <p class="fresh-text">{{ 'hq.plan.fresh.text' | translate }}</p>
        <ol class="fresh-steps">
          <li>{{ 'hq.plan.fresh.step1' | translate }}</li>
          <li>{{ 'hq.plan.fresh.step2' | translate }}</li>
          <li>{{ 'hq.plan.fresh.step3' | translate }}</li>
        </ol>
        <div class="fresh-actions">
          <button type="button" scAction tier="secondary" (click)="chrome.startSupplySearch()">
            {{ 'hq.plan.fresh.addSupply' | translate }}
          </button>
        </div>
      </section>
    } @else {
      @if (view() === 'what') {
        <section class="select" aria-labelledby="hq-plan-sel">
          <div class="sel-head">
            <h3 id="hq-plan-sel">{{ 'hq.plan.selection' | translate }}</h3>
            <span class="state" role="status">{{ stateLabel() }}</span>
          </div>
          <sc-hq-set-rings [sets]="sets()" [needs]="needs()" [selection]="selection()" (setToggled)="onSet($event)" />
          <sc-hq-mood-toggles [moods]="selection().moods" (moodChange)="onMood($event.pair, $event.side)" />
          <ul class="kinds" [attr.aria-label]="'hq.plan.stepsAria' | translate">
            @for (k of kinds; track k) {
              <li>
                <button type="button" class="kind" [attr.aria-pressed]="selection().steps.has(k)" (click)="commit(toggleStep(k))">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    @if (shapes[k] === 'circle') { <circle cx="12" cy="12" r="9.5" /> } @else { <polygon [attr.points]="shapes[k]" /> }
                  </svg>
                  {{ 'hq.step.kind.' + k | translate }}
                </button>
              </li>
            }
          </ul>
          <sc-hq-place-tree [places]="allPlaces()" [selected]="selection().places" (selectedChange)="commit(placesSel($event))" />
        </section>
      }

      <sc-hq-plan-map [needs]="mapNeeds()" [route]="route()" [view]="view()" />
      <sc-hq-community-optin />
      <sc-hq-blueprint-progress />
      <sc-hq-commodity-prices />

      @if (view() === 'what') {
        @if (listNeeds().length === 0) {
          <p class="empty" role="status">{{ 'hq.plan.empty' | translate }}</p>
        } @else {
          <ul class="needs" [attr.aria-label]="'hq.supplies.title' | translate">
            @for (n of listNeeds(); track n.id) {
              <li class="need" [class.sel]="selection().supplyIds.has(n.id)" [class.ready]="n.status === 'done'">
                <sc-tristate variant="checkbox" [label]="n.label" [value]="selection().supplyIds.has(n.id) ? 1 : 0" (toggled)="commit(toggleOne(n.id))" />
                <span class="n-body">
                  <span class="n-name">
                    @if (codexLink(n.className); as link) {
                      <a class="n-link" [routerLink]="link">{{ n.label }}</a>
                    } @else {
                      {{ n.label }}
                    }
                    <b class="mono qty"> {{ needQty(n) }}</b>
                  </span>
                  @if (n.setName) {
                    <span class="n-meta">{{ 'hq.supply.forSet' | translate: { name: n.setName } }}</span>
                  }
                  @if (n.status !== 'done') {
                    @let src = needSources(n.className);
                    @if (!n.className) {
                      <span class="n-where none">{{ 'hq.plan.source.freeText' | translate }}</span>
                    } @else if (src.state === 'loading') {
                      <span class="n-where" role="status">{{ 'hq.plan.source.loading' | translate }}</span>
                    } @else if (src.options.length === 0) {
                      <span class="n-where none">{{ 'hq.plan.source.none' | translate }}</span>
                    } @else {
                      @let cur = chosenSource(n.id, src.options);
                      <button type="button" class="n-where pick" [attr.aria-expanded]="openWhere() === n.id" (click)="toggleWhere(n.id)">
                        <span class="pin" aria-hidden="true"></span>
                        <span>{{ placeLine(cur) }}</span>
                        @if (cur.price !== undefined) { <span class="price mono">{{ auec(cur.price) }}</span> }
                        @if (src.options.length > 1) { <span class="others">{{ 'hq.plan.source.more' | translate: { n: src.options.length - 1 } }}</span> }
                      </button>
                      @if (openWhere() === n.id) {
                        <ul class="where-list">
                          @for (o of byDistance(src.options); track o.place.id) {
                            <li>
                              <button type="button" class="where-opt" [attr.aria-pressed]="o.place.id === cur.place.id" (click)="pickSource(n.id, o)">
                                <span class="w-place">{{ placeLine(o) }}</span>
                                @if (o.terminal) { <span class="w-term">{{ o.terminal }}</span> }
                                @if (o.price !== undefined) { <span class="price mono">{{ auec(o.price) }}</span> }
                              </button>
                            </li>
                          }
                        </ul>
                        <p class="where-note">{{ 'codex.detail.whereToBuyAttribution' | translate }}</p>
                      }
                    }
                  }
                </span>
                <span class="kind-tag">{{ 'hq.step.kind.' + n.kind | translate }}</span>
                @if (n.className && needSources(n.className).kind; as kind) {
                  <!-- D4: tertiary path on the need line, a sibling of the Codex anchor (never inside it); the line itself has no click handler. -->
                  <span class="need-path">
                    <sc-item-path [kind]="kind" [className]="n.className" [name]="n.label" />
                  </span>
                }
                @if (n.status === 'done') { <span class="ready-tag">{{ 'hq.supply.ready' | translate }}</span> }
              </li>
            }
          </ul>
        }
      } @else {
        <section class="route" aria-labelledby="hq-plan-route">
          <h3 id="hq-plan-route">{{ 'hq.plan.route' | translate }}</h3>
          @if (route().length === 0) {
            <p class="empty" role="status">{{ 'hq.plan.routeEmpty' | translate }}</p>
          } @else {
            <div class="steps" role="list">
              @for (s of route(); track s.ord) {
                <sc-step [kind]="s.kind" [label]="s.label" [location]="s.place.location" />
              }
            </div>
          }
          <button type="button" class="sc-btn sc-btn-primary save" [disabled]="route().length === 0" (click)="saveEinsatz()">
            {{ 'hq.plan.saveEinsatz' | translate }}
          </button>
        </section>

        <section class="einsaetze" aria-labelledby="hq-plan-ein">
          <h3 id="hq-plan-ein">{{ 'hq.einsatz.title' | translate }}</h3>
          @if (einsatz.items().length === 0) {
            <p class="empty">{{ 'hq.einsatz.empty' | translate }}</p>
          } @else {
            <ul class="ein-list">
              @for (e of einsatz.items(); track e.id) {
                <li class="ein" [class.focus]="focusedRoute() === e.id" [attr.data-einsatz]="e.id">
                  <div class="ein-head">
                    <strong class="ein-title">{{ e.title }}</strong>
                    <span class="badge" [scTooltip]="badge(e).multi ? ('hq.einsatz.stepsTooltip' | translate: { n: badge(e).n }) : null">
                      {{ badge(e).multi ? ('hq.einsatz.multi' | translate: { n: badge(e).n }) : ('hq.einsatz.single' | translate) }}
                    </span>
                    <button type="button" class="sc-btn tiny ghost rm" [attr.aria-label]="'hq.einsatz.remove' | translate: { name: e.title }"
                            [scTooltip]="'hq.einsatz.remove' | translate: { name: e.title }" scTooltipTier="label" (click)="removeEinsatz(e.id, e.title)">✕</button>
                  </div>
                  <div class="steps" role="list">
                    @for (s of e.steps; track s.ord) {
                      <div class="ein-step">
                        <sc-tristate variant="checkbox" [label]="s.label" [value]="s.state === 'done' ? 1 : 0" (toggled)="einsatz.toggleStep(e.id, s.ord)" />
                        <sc-step [kind]="s.kind" [state]="s.state" [label]="s.label" [qty]="s.qty" [location]="s.location"
                                 [undoable]="s.doneBy === 'live'" (undo)="einsatz.unmarkStep(e.id, s.ord)" />
                      </div>
                    }
                  </div>
                  <sc-hq-friend-share kind="einsatz" [subjectId]="e.id" />
                  <sc-hq-einsatz-crew [einsatzId]="e.id" />
                </li>
              }
            </ul>
          }
        </section>

        <sc-hq-shared-einsaetze />
      }
    }

    </div>
    }

    @if (flow(); as f) {
      <sc-hq-nachschub-flow [mode]="f.mode" [nachschubId]="f.id" [startStep]="f.step" (closed)="flow.set(null)" (done)="onFlowDone($event)" />
    }
    @if (removing(); as r) {
      <sc-hq-nachschub-remove-dialog [name]="nameOf(r.id)" [mode]="r.kind" [open]="openCountOf(r.id)" (cancelled)="removing.set(null)" (confirmed)="doRemove($event)" />
    }
    @if (archiveOpen()) {
      <sc-hq-nachschub-archive-dialog (closed)="archiveOpen.set(false)" (reactivate)="reactivate($event)" />
    }
    @if (notice(); as n) {
      <div class="notice" role="status">
        <span>{{ n.key | translate: n.params }}</span>
        @if (n.undo) { <button type="button" scAction tier="secondary" (click)="undoNotice()">{{ 'hq.log.undo' | translate }}</button> }
      </div>
    }

    @if (suppliesOpen()) {
      <sc-hq-supplies-popup [startTab]="suppliesTab()" (closed)="suppliesOpen.set(false)" />
    }
  `,
  styles: [
    `
      /* One page without scrolling the page: on desktop the host is as tall as the page area, the panels scroll inside. */
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); height: var(--hq-page-h, auto); min-height: 0; }
      .ns-page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .classic { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--sc-space-4, 16px); overflow-y: auto; padding-right: 4px; }
      .hint { display: inline-flex; align-items: center; gap: 6px; color: var(--sc-fg-2); font-size: 0.85rem; max-width: 60ch; }
      .hint svg { width: 18px; height: 18px; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linecap: round; flex: none; }
      .intro { flex: 1; display: grid; align-content: center; justify-items: center; gap: var(--sc-space-2, 8px); text-align: center; border: 1px dashed var(--sc-border); border-radius: 14px; padding: var(--sc-space-5, 24px); }
      .intro-title { margin: 0; font: 600 1.1rem var(--sc-font-display, inherit); }
      .intro-text { margin: 0; max-width: var(--sc-measure, 62ch); color: var(--sc-fg-2); }
      .notice { position: fixed; z-index: 60; left: 50%; transform: translateX(-50%); bottom: var(--sc-float-bottom, 16px); display: flex; align-items: center; gap: var(--sc-space-3, 12px); max-width: min(520px, calc(100vw - 2 * var(--sc-space-3, 12px))); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 10px); background: var(--sc-surface, var(--sc-bg-1)); box-shadow: 0 8px 28px rgb(0 0 0 / 0.45); }
      @media (max-width: 760px) { .notice { left: var(--sc-fab-clear-inline, 12px); right: var(--sc-fab-clear-inline, 12px); transform: none; max-width: none; } }
      .head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); }
      .page-title { margin: 0; margin-right: auto; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .switch { display: inline-flex; padding: 3px; border: 1px solid var(--sc-border); border-radius: 999px; background: var(--sc-bg-0); }
      .seg { min-height: 40px; padding: 0 var(--sc-space-4, 16px); border: 0; border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .seg:hover { color: var(--sc-fg); }
      .seg[aria-pressed='true'] { color: var(--sc-fg); background: color-mix(in srgb, var(--sc-accent) 22%, transparent); box-shadow: 0 0 0 1px var(--sc-accent), 0 0 12px color-mix(in srgb, var(--sc-accent) 40%, transparent); }
      .seg:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .nach { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 40px; }
      .select { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); padding: var(--sc-space-4, 16px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); }
      .sel-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sc-space-3, 12px); }
      .sel-head h3, .route h3, .einsaetze h3 { margin: 0; font-size: 1rem; }
      .state { color: var(--sc-fg-2); font-size: max(0.85rem, var(--sc-fs-floor)); }
      .kinds { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .kind { display: inline-flex; align-items: center; gap: var(--sc-space-2, 8px); min-height: 36px; padding: 0 var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; cursor: pointer; }
      .kind svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linejoin: round; }
      .kind:hover { color: var(--sc-fg); border-color: var(--sc-fg-2); }
      .kind[aria-pressed='true'] { color: var(--sc-fg); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .kind[aria-pressed='true'] svg { stroke: var(--sc-accent); }
      .kind:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .empty { margin: 0; color: var(--sc-fg-2); }
      .fresh { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); padding: var(--sc-space-5, 24px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); }
      .fresh-title { margin: 0; font: 600 1.15rem / 1.3 var(--sc-font-display); }
      .fresh-text { margin: 0; max-width: var(--sc-measure, 70ch); color: var(--sc-fg-1); }
      .fresh-steps { margin: 0; padding-inline-start: 1.4em; display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); color: var(--sc-fg-2); }
      .fresh-actions { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .fresh-actions .sc-btn { min-height: var(--sc-tap-min, 44px); }
      .err { margin: 0; display: flex; align-items: center; gap: var(--sc-space-3, 12px); color: var(--sc-warning); }
      .needs, .ein-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); }
      .need { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 10px; }
      .need.sel { border-color: color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); background: color-mix(in srgb, var(--sc-accent) 7%, transparent); }
      .n-body { display: flex; flex-direction: column; flex: 1; min-width: 0; }
      .n-name { overflow-wrap: anywhere; }
      .need-path { display: inline-flex; flex: none; }
      .qty { color: var(--sc-fg-2); }
      .n-meta { font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .n-link { color: inherit; text-decoration: none; }
      .n-link:hover { color: var(--sc-accent); text-decoration: underline; }
      .n-link:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 3px; }
      .n-where { display: inline-flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); margin-top: 2px; font-size: max(0.85rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }
      .n-where.none { color: var(--sc-fg-2); }
      .n-where.pick { align-self: flex-start; min-height: 32px; padding: 2px 10px; border: 1px solid var(--sc-border); border-radius: 8px; background: transparent; font-family: inherit; text-align: start; cursor: pointer; }
      .n-where.pick:hover { border-color: var(--sc-accent); }
      .n-where.pick:focus-visible, .where-opt:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .pin { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--sc-accent); }
      .price { color: var(--sc-fg-0); }
      .others { color: var(--sc-fg-2); }
      .where-list { list-style: none; max-height: 16rem; overflow-y: auto; margin: var(--sc-space-2, 8px) 0 0; padding: 2px; display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); }
      .where-opt { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--sc-space-1, 4px) var(--sc-space-3, 12px); width: 100%; min-height: 36px; padding: 4px 10px; border: 1px solid var(--sc-border); border-radius: 8px; background: transparent; color: var(--sc-fg-1); font: inherit; text-align: start; cursor: pointer; }
      .where-opt:hover { border-color: var(--sc-accent); }
      .where-opt[aria-pressed='true'] { border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 12%, transparent); color: var(--sc-fg-0); }
      .w-place { flex: 1 1 12rem; min-width: 0; }
      .w-term { color: var(--sc-fg-2); font-size: max(0.8rem, var(--sc-fs-floor)); }
      .where-note { margin: var(--sc-space-1, 4px) 0 0; color: var(--sc-fg-2); font-size: max(0.75rem, var(--sc-fs-floor)); }
      .kind-tag, .ready-tag, .badge { flex: none; padding: 1px 10px; border: 1px solid var(--sc-border); border-radius: 999px; font-size: max(0.78rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
      .ready-tag { color: var(--sc-accent); border-color: var(--sc-accent); }
      .badge { color: var(--sc-accent); border-color: color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); }
      .route, .einsaetze { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); }
      .steps { display: flex; flex-direction: column; border-top: 1px solid var(--sc-border); }
      .steps > * + * { border-top: 1px solid var(--sc-border); }
      .save { align-self: flex-start; min-height: var(--sc-tap-min, 44px); }
      .ein sc-hq-friend-share, .ein sc-hq-einsatz-crew { margin-top: var(--sc-space-2, 8px); }
      .ein { padding: var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: 12px; background: var(--sc-bg-0); }
      .ein-head { display: flex; align-items: center; gap: var(--sc-space-3, 12px); margin-bottom: var(--sc-space-2, 8px); }
      .ein-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .ein.focus { outline: 1px solid var(--sc-accent); outline-offset: var(--sc-space-1, 4px); border-radius: var(--sc-radius, 10px); animation: hq-route-focus 6s ease-in forwards; }
      /* It says "this one" on arrival, it does not stay marked for the rest of the session. */
      @keyframes hq-route-focus { 60% { outline-color: var(--sc-accent); } 100% { outline-color: transparent; } }
      .ein-step { display: flex; align-items: center; gap: var(--sc-space-2, 8px); }
      .ein-step sc-step { flex: 1; min-width: 0; }
      @media (pointer: coarse) { .seg, .kind, .nach, .n-where.pick, .where-opt { min-height: 48px; } .rm { min-width: 48px; min-height: 48px; } }
      @media (max-width: 640px) { .page-title { flex-basis: 100%; } }
    `,
  ],
})
export class HqPlanComponent {
  /** "×2", or the exact amount of a material line ("0,36 SCU"). */
  protected needQty(n: PlanNeed): string {
    return n.amount != null ? supplyQtyText({ qty: n.qty, amount: n.amount }) : `×${n.qty}`;
  }

  protected readonly supplies = inject(HqSuppliesService);
  protected readonly einsatz = inject(HqEinsatzService);
  protected readonly ns = inject(NachschubService);
  protected readonly focus = inject(NachschubFocusService);
  private readonly hangar = inject(HangarService);
  private readonly ownership = inject(HqOwnershipService);
  private readonly nav = inject(HqPageNavService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly confirm = inject(ScConfirmService);
  private readonly i18n = inject(TranslateService);
  private readonly live = inject(HqLiveService);
  private readonly sourcesSvc = inject(HqNeedSourcesService);
  protected readonly chrome = inject(ShellChromeService);

  protected readonly kinds = STEP_KINDS;
  protected readonly shapes = STEP_SHAPES;
  protected readonly view = signal<PlanView>('what');
  /** The page's two faces: the Nachschub slots (default), or the older Auswahl / Route builder (Was / Wie). */
  protected readonly mode = signal<'nachschub' | 'classic'>('nachschub');
  protected readonly flow = signal<{ mode: 'new' | 'edit'; id: string | null; step: 1 | 3 } | null>(null);
  protected readonly removing = signal<{ id: string; kind: 'remove' | 'empty' } | null>(null);
  protected readonly archiveOpen = signal(false);
  protected readonly notice = signal<{ key: string; params?: Record<string, string | number>; undo?: () => Promise<NachschubResult> } | null>(null);
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly suppliesOpen = signal(false);
  protected readonly suppliesTab = signal<HqListTab>('nachschub');
  private readonly listRoute = inject(ActivatedRoute);

  /** `/hq?list=wish#planen` (the item path's anchors): open the popup on that tab. */
  private readonly listParam = this.listRoute.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
    const tab = hqListTabOf(q.get(HQ_LIST_PARAM));
    // Nachschub lives on this page now (the slots); only the wishlist still opens the popup (the cart replaces it later).
    if (tab === 'wish') this.openSupplies('wish');
    else if (tab === 'nachschub') this.mode.set('nachschub');
  });

  protected openSupplies(tab: HqListTab): void {
    this.suppliesTab.set(tab);
    this.suppliesOpen.set(true);
  }
  /** The saved route "Route öffnen" asked for: marked in the list. */
  protected readonly focusedRoute = signal<string | null>(null);
  private handledRoute: { id: string } | null = null;

  protected readonly sets = computed(() =>
    buildPlanSets(this.hangar.ships(), this.ownership.configs(), this.hangar.roleLoadouts(), this.supplies.items()),
  );
  /**
   * A fresh account: nothing to plan from (no Nachschub lines, no saved Einsatz) once both lists
   * are in. The filters and the map would all be empty, so the page explains itself and opens
   * Nachschub - the one place needs come from - instead (feedback 2026-11-02).
   */
  protected readonly fresh = computed(
    () => this.supplies.ready() && this.einsatz.ready() && this.needs().length === 0 && this.einsatz.items().length === 0,
  );
  /** Where the reader is, for "the nearest shop first". */
  private readonly here = computed(() => {
    const at = readLocation(this.live.state());
    return at ? placeOfName(at.name, at.system) : null;
  });
  /** The shop the reader chose per supply line (this tab session). */
  private readonly picks = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly openWhere = signal<string | null>(null);
  /**
   * The stop of each line: the shop the reader chose, else the place of a saved Einsatz step, else
   * the shop nearest to them (cheapest when their position is unknown). Without this no line has a
   * place, and the map and the route stay empty.
   */
  private readonly placeMap = computed(() => {
    const out = new Map(placesFromEinsaetze(this.einsatz.items()));
    const known = this.sourcesSvc.sources();
    for (const s of this.supplies.items()) {
      const options = s.className ? (known.get(s.className)?.options ?? []) : [];
      const picked = options.find((o) => o.place.id === this.picks().get(s.id));
      if (picked) out.set(s.id, picked.place);
      else if (!out.has(s.id)) {
        const best = bestSource(options, this.here());
        if (best) out.set(s.id, best.place);
      }
    }
    return out;
  });
  protected readonly needs = computed(() => buildPlanNeeds(this.supplies.items(), this.sets(), this.placeMap()));
  private readonly ctx = computed(() => ({
    needs: this.needs(),
    sets: this.sets(),
    soonSets: soonSetKeys(this.einsatz.items(), this.needs()),
  }));

  /** What the user changed in this tab session; null = the live Top 3 default. */
  private readonly userSel = signal<PlanSelection | null>(this.restore());
  protected readonly selection = computed<PlanSelection>(() => this.userSel() ?? top3Selection(this.ctx()));

  protected readonly allPlaces = computed<MapPlace[]>(() => this.needs().flatMap((n) => (n.place ? [n.place] : [])));
  /** The list in Was: everything inside the filters; the checkbox shows what is selected. */
  protected readonly listNeeds = computed(() => this.needs().filter((n) => n.wanted && passesFilters(this.selection(), n)));
  protected readonly mapNeeds = computed(() => visibleNeeds(this.selection(), this.needs()).map(toMapNeed));
  protected readonly route = computed(() => (this.view() === 'how' ? buildRoute(this.mapNeeds(), null) : []));

  protected readonly stateLabel = computed(() => {
    const s = this.selection();
    if (s.origin === 'top3') return this.i18n.instant('hq.plan.state.top3');
    if (s.origin === 'mood') {
      const moods = activeMoodKeys(s.moods).map((k) => this.i18n.instant(k)).join(' + ');
      return this.i18n.instant('hq.plan.state.mood', { moods });
    }
    return this.i18n.instant('hq.plan.state.custom');
  });

  constructor() {
    void this.ownership.ensureLoaded();
    void this.ns.ensureLoaded();
    const destroyRef = inject(DestroyRef);
    // Only what is still to get, and only what is bought: a mining line has no shop.
    effect(() => {
      const wanted = this.supplies
        .open()
        .filter((s) => s.className && (!s.stepKind || s.stepKind === 'buy'))
        .map((s) => s.className as string);
      untracked(() => this.sourcesSvc.ensure(wanted));
    });
    // "Route öffnen" (Start tile, Jetzt button, a shared URL): Wie, on exactly this saved route.
    let scroll: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const focus = this.nav.routeFocus();
      if (!focus || !this.einsatz.items().some((e) => e.id === focus.id)) return;
      untracked(() => {
        if (this.handledRoute === focus) return;
        this.handledRoute = focus;
        this.focusedRoute.set(focus.id);
        const pkg = this.einsatz.items().find((e) => e.id === focus.id)?.packageId;
        if (pkg) {
          this.focus.select(pkg);
          this.mode.set('nachschub');
          return;
        }
        this.mode.set('classic');
        this.view.set('how');
        clearTimeout(scroll);
        // After the glide to this page: a second scroll would cancel it.
        scroll = setTimeout(
          () => this.host.querySelector(`[data-einsatz="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
          PAGE_GLIDE_MS,
        );
      });
    });
    destroyRef.onDestroy(() => {
      clearTimeout(scroll);
      clearTimeout(this.noticeTimer);
    });
  }

  protected needSources(className: string | null) {
    return (className ? this.sourcesSvc.sources().get(className) : null) ?? NO_SOURCES;
  }

  /** The Codex page of a line, once its kind is known. */
  protected codexLink(className: string | null): string[] | null {
    const kind = this.needSources(className).kind;
    return kind && className ? ['/codex', kind, className] : null;
  }

  /** The option a line stands on right now. */
  protected chosenSource(id: string, options: readonly NeedSource[]): NeedSource {
    const place = this.placeMap().get(id);
    return options.find((o) => o.place.id === place?.id) ?? options[0];
  }

  protected byDistance(options: readonly NeedSource[]): readonly NeedSource[] {
    return sourcesByDistance(options, this.here());
  }

  protected auec(n: number): string {
    return `${n.toLocaleString(this.i18n.getCurrentLang() || undefined)} aUEC`;
  }

  protected placeLine(o: NeedSource): string {
    return [o.place.location, o.place.planet, o.place.system].filter((p, i, all) => !!p && all.indexOf(p) === i).join(' · ');
  }

  protected toggleWhere(id: string): void {
    this.openWhere.update((cur) => (cur === id ? null : id));
  }

  protected pickSource(id: string, o: NeedSource): void {
    this.picks.update((m) => new Map(m).set(id, o.place.id));
    this.openWhere.set(null);
  }

  protected badge = einsatzBadge;

  protected retryNachschub(): void {
    void this.ns.ensureLoaded();
  }

  protected nameOf(id: string): string {
    return this.ns.packages().find((p) => p.id === id)?.name ?? '';
  }

  /** Lines of a Nachschub that would leave it (open ones), for the delete / empty dialog. */
  protected openCountOf(id: string): number {
    const ev = this.ns.evaluation(id);
    return this.ns.linesOf(id).filter((l) => !l.done && !(ev?.statuses.get(l.id)?.closed ?? false)).length;
  }

  protected askRemove(id: string, kind: 'remove' | 'empty'): void {
    this.removing.set({ id, kind });
  }

  protected async doRemove(back: boolean): Promise<void> {
    const r = this.removing();
    this.removing.set(null);
    if (!r) return;
    const res = r.kind === 'remove' ? await this.ns.remove(r.id, back) : await this.ns.empty(r.id, back);
    this.announce(res);
  }

  protected async reactivate(id: string): Promise<void> {
    const res = await this.ns.reactivate(id);
    if (res.ok) {
      this.archiveOpen.set(false);
      this.focus.select(id);
    }
    this.announce(res);
  }

  protected onFlowDone(res: NachschubResult): void {
    this.flow.set(null);
    if (res.id) this.focus.select(res.id);
    this.announce(res);
  }

  /** A result with its undo as a notice at the bottom (8 s). */
  private announce(res: NachschubResult): void {
    clearTimeout(this.noticeTimer);
    this.notice.set({ key: res.key, params: res.params, undo: res.undo });
    this.noticeTimer = setTimeout(() => this.notice.set(null), NOTICE_MS);
  }

  protected async undoNotice(): Promise<void> {
    const n = this.notice();
    clearTimeout(this.noticeTimer);
    this.notice.set(null);
    if (n?.undo) this.announce(await n.undo());
  }

  protected readonly syncError = computed(() => this.supplies.syncError() ?? this.einsatz.syncError());

  protected retry(): void {
    void this.supplies.sync();
    void this.einsatz.sync();
  }

  protected onMood(pair: MoodPair, side: MoodSide): void {
    this.commit(applyMood(this.selection(), pair, side, this.ctx()));
  }

  protected onSet(key: string): void {
    this.commit(toggleSet(this.selection(), key, this.needs()));
  }

  protected toggleStep(k: StepKind): PlanSelection {
    return toggleStepKind(this.selection(), k);
  }

  protected toggleOne(id: string): PlanSelection {
    return toggleNeed(this.selection(), id);
  }

  protected placesSel(ids: ReadonlySet<string>): PlanSelection {
    return setPlaces(this.selection(), ids);
  }

  /** A user change: remember it for this tab session (back on Top 3 = forget it). */
  protected commit(next: PlanSelection): void {
    const session = sessionOrNull();
    if (next.origin === 'top3') {
      this.userSel.set(null);
      clearSelection(session);
    } else {
      this.userSel.set(next);
      saveSelection(session, next);
    }
  }

  protected async saveEinsatz(): Promise<void> {
    const steps = this.route();
    if (steps.length === 0) return;
    const first = this.needs().find((n) => steps[0].needIds.includes(n.id));
    const suggestion = first?.setName ?? steps[0].label;
    const name = await this.confirm.prompt({
      titleKey: 'hq.plan.saveEinsatz',
      inputLabelKey: 'hq.einsatz.nameLabel',
      inputMaxLength: 120,
    });
    if (name === null) return;
    const byId = new Map(this.needs().map((n) => [n.id, n] as const));
    const saved = this.einsatz.create({
      title: name.trim() || suggestion,
      startLocation: steps[0].place.location,
      steps: steps.map((s) => {
        const need = byId.get(s.needIds[0]);
        return {
          kind: s.kind,
          label: s.label,
          location: s.place.location,
          system: s.place.system,
          className: need?.className ?? null,
          qty: need?.qty ?? null,
          supplyId: need?.id ?? null,
          missionRef: null,
        };
      }),
    });
    if (saved) this.view.set('how');
  }

  protected async removeEinsatz(id: string, title: string): Promise<void> {
    const ok = await this.confirm.confirm({
      titleKey: 'hq.einsatz.removeTitle',
      messageKey: 'hq.einsatz.removeMessage',
      params: { name: title },
      tone: 'danger',
    });
    if (ok) this.einsatz.remove(id);
  }

  private restore(): PlanSelection | null {
    const session = sessionOrNull();
    if (!session) return null;
    const sel = initialSelection(session, { needs: [], sets: [] });
    // Nothing stored (or unchanged) yields the empty Top 3 snapshot: use the live default instead.
    return sel.origin === 'top3' ? null : sel;
  }
}

/** How long the result notice (with its undo) stays. */
const NOTICE_MS = 8000;
const NO_SOURCES = { state: 'ready', kind: null, options: [] } as const satisfies NeedSources;

function sessionOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
