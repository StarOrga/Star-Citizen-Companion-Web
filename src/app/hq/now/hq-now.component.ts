import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';
import { RouterLink } from '@angular/router';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { ScStepComponent } from '../../shared/step/sc-step.component';
import { type Einsatz, type EinsatzStep, HqEinsatzService } from '../data/hq-einsatz.service';
import { hqPage } from '../hq-routes';
import { NachschubFocusService } from '../nachschub/nachschub-focus.service';
import { NachschubService } from '../nachschub/nachschub.service';
import { NACHSCHUB_ICON_PATHS } from '../nachschub/step-icons';
import { routeFilterKey } from '../plan/route/route-filter.store';
import { HqRouteGraphicComponent, type RouteSharedStop } from '../plan/route/route-graphic.component';
import type { RouteGraphStep } from '../plan/route/route-layout';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { HqAppLaunchComponent } from '../hq-app-launch.component';
import { HqLogDialogComponent } from './hq-log-dialog.component';
import { HqNowFriendsComponent } from './hq-now-friends.component';
import { HqLiveService } from './hq-live.service';
import { eventLabel, formatLocationName, isGameLive, presenceAt, readContracts, readLocation, readShip, readZones } from './hq-live.util';
import { HQ_NOW_PATH, currentEinsatz } from './hq-now-path';
import { EventHqService } from '../events/event-hq.service';
import { HqMissionsPopoverComponent } from './hq-missions-popover.component';

export const TOAST_MS = 6000;
const PREVIEW = 3;
const PRESENCE_TICK_MS = 30_000;
/** Steps shown after the next one. */
const UPCOMING = 4;

/**
 * HQ page "Jetzt": where you are (location anchor), what is next (main path), active missions
 * (icon top right), the last events (log preview) and a toast for an auto-applied event that
 * flies into the log when it closes.
 */
@Component({
  selector: 'sc-hq-now',
  standalone: true,
  imports: [
    TranslatePipe,
    DatePipe,
    RouterLink,
    ScActionDirective,
    ScStepComponent,
    HqMissionsPopoverComponent,
    HqLogDialogComponent,
    HqAppLaunchComponent,
    HqNowFriendsComponent,
    HqRouteGraphicComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="phead">
      <h2 class="page-title" id="hq-now-title">{{ 'hq.pages.jetzt' | translate }}</h2>
      @if (nachschub(); as n) {
        <div class="run" role="group" [attr.aria-label]="'hq.run.aria' | translate">
          <span class="run-ic"><svg viewBox="0 0 24 24" aria-hidden="true">@for (p of tray; track p) { <path [attr.d]="p" /> }</svg></span>
          <span class="run-t"><small>{{ 'hq.run.for' | translate }}</small><b>{{ n.name }}</b></span>
          @if (activeEinsatz(); as e) {
            <span class="run-e">E{{ activeIndex() + 1 }} · {{ e.title }} · {{ 'hq.run.stepOf' | translate: { n: shownStep(), total: total() } }}</span>
          }
          @if (switchable().length > 1) {
            <span class="sw">
              <button type="button" scAction tier="secondary" aria-haspopup="menu" [attr.aria-expanded]="menuOpen()" (click)="menuOpen.set(!menuOpen())">{{ 'hq.run.switch' | translate }}</button>
              @if (menuOpen()) {
                <ul class="menu" role="menu" (keydown.escape)="menuOpen.set(false)">
                  @for (m of switchable(); track m.id) {
                    <li role="none">
                      <button type="button" role="menuitemradio" [attr.aria-checked]="m.id === n.id" (click)="choose(m.id)">
                        <span class="mn">{{ m.name }}</span><small>{{ m.done }}/{{ m.total }}</small>
                      </button>
                    </li>
                  }
                </ul>
              }
            </span>
          }
        </div>
      }
      <span class="phead-r">
        <sc-hq-now-friends />
        @if (live.loaded() && live.state()) { <sc-hq-missions-popover [contracts]="contracts()" /> }
      </span>
    </header>

    @if (!live.loaded()) {
      <p class="muted" role="status">{{ 'hq.now.loading' | translate }}</p>
    } @else if (live.error() && !live.state()) {
      <p class="err" role="alert">{{ live.error()! | translate }}
        <button type="button" scAction tier="secondary" (click)="live.refresh()">{{ 'hq.now.retry' | translate }}</button>
      </p>
    }

    @if (offer(); as o) {
      <div class="offer" role="status" data-event-offer>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2 6.2 6.2 2.8-6.2 2.8L12 21l-2-6.2L3.8 12 10 9.2z" /></svg>
        <span class="o-t">{{ (o.arenaCommander ? 'hq.events.offer.ac' : 'hq.events.offer.area') | translate: { event: offerEventName(), name: offerName() } }}</span>
        <button type="button" scAction tier="secondary" (click)="takeOffer(o.nachschubId)">{{ 'hq.events.offer.switch' | translate }}</button>
        <button type="button" scAction tier="secondary" (click)="waveOff()">{{ 'hq.events.offer.notNow' | translate }}</button>
      </div>
    }
    <div class="now">
      <section class="panel mapcol" [attr.aria-label]="'hq.panel.route' | translate">
        @if (graphSteps().length) {
          <sc-hq-route-graphic class="map" [steps]="graphSteps()" [current]="nextStep()?.ord ?? null" [filterKey]="filterKey()"
                               [openLabel]="'hq.route.open' | translate" [shared]="sharedStops()" (sharedPick)="choose($event.nachschubId)" />
        } @else {
          <div class="empty">
            <p class="e-title">{{ 'hq.run.emptyTitle' | translate }}</p>
            <p class="muted">{{ 'hq.now.path.empty' | translate }}</p>
            <a scAction tier="secondary" [routerLink]="planen.commands" [fragment]="planen.fragment">{{ 'hq.run.toPlanen' | translate }}</a>
          </div>
        }
      </section>

      <section class="panel stepcol" [attr.aria-label]="'hq.now.path.title' | translate">
        @if (nextStep(); as st) {
          <p class="kicker">{{ 'hq.run.stepOf' | translate: { n: shownStep(), total: total() } }}@if (st.location) { · {{ st.location }} }</p>
          <h3 class="now-h">{{ 'hq.step.kind.' + st.kind | translate }}: {{ st.label }}@if (st.qty !== null) { <b class="mono"> ×{{ st.qty }}</b> }</h3>
          <div class="cta">
            <button type="button" scAction tier="primary" (click)="finish(st.ord)">{{ 'hq.run.finish' | translate }}</button>
            @if (lastDone(); as ld) {
              <button type="button" scAction tier="secondary" (click)="undoLast(ld.ord)">{{ 'hq.log.undo' | translate }}</button>
            }
          </div>
          @if (otherNachschubAt(st.location); as other) {
            <p class="shared">
              <svg viewBox="0 0 24 24" aria-hidden="true">@for (p of tray; track p) { <path [attr.d]="p" /> }</svg>
              {{ 'hq.run.sharedStop' | translate: { name: other } }}
            </p>
          }
          <div class="trail" role="list" [attr.aria-label]="'hq.now.path.title' | translate">
            @for (s of upcoming(); track s.ord) {
              <sc-step [kind]="s.kind" [label]="s.label" [qty]="s.qty" [location]="s.location" />
            }
          </div>
        } @else if (graphSteps().length) {
          <p class="kicker">{{ 'hq.run.doneKicker' | translate }}</p>
          <h3 class="now-h">{{ 'hq.run.allDone' | translate }}</h3>
          <p class="muted">{{ 'hq.run.allDoneHint' | translate }}</p>
          <a scAction tier="secondary" [routerLink]="planen.commands" [fragment]="planen.fragment">{{ 'hq.run.toPlanen' | translate }}</a>
        } @else {
          <p class="muted">{{ 'hq.now.path.empty' | translate }}</p>
        }

        @if (bundle().length > 1) {
          <div class="etabs" role="group" [attr.aria-label]="'hq.run.einsaetze' | translate">
            @for (e of bundle(); track e.id; let i = $index) {
              <button type="button" class="etab" [attr.aria-pressed]="e.id === activeEinsatz()?.id" [class.fin]="e.status === 'done'" (click)="pickEinsatz(e.id)">
                <b>E{{ i + 1 }}</b><span>{{ e.title }}</span>
              </button>
            }
          </div>
        }

        @if (live.loaded() && !live.state() && !live.error()) {
          <section class="connect">
            <span class="connect-title">{{ (appConnected() ? 'hq.now.connect.syncOffTitle' : 'hq.now.connect.title') | translate }}</span>
            <span class="muted">{{ (appConnected() ? 'hq.now.connect.syncOffHint' : 'hq.now.connect.hint') | translate }}</span>
            <div class="explain" role="group" [attr.aria-label]="'hq.now.connect.explain.aria' | translate">
              <p class="explain-what">{{ 'hq.now.connect.explain.what' | translate }}</p>
              <ul class="explain-list">
                <li>{{ 'hq.now.connect.explain.e1' | translate }}</li>
                <li>{{ 'hq.now.connect.explain.e2' | translate }}</li>
                <li>{{ 'hq.now.connect.explain.e3' | translate }}</li>
              </ul>
            </div>
            <sc-hq-app-launch class="connect-go" />
          </section>
        }

        @if (live.loaded() && live.state()) {
          <section class="anchor" aria-labelledby="hq-now-anchor">
            <span class="eyebrow" id="hq-now-anchor">{{ (gameLive() ? 'hq.now.anchor.label' : 'hq.now.anchor.lastSeen') | translate }}</span>
            @if (location(); as loc) {
              <p class="where">
                @if (loc.system) { <span class="sys">{{ loc.system }}</span><span class="sep" aria-hidden="true"> › </span> }
                <span class="place">{{ placeName(loc.name) }}</span>
              </p>
            } @else {
              <p class="where unknown">{{ 'hq.now.anchor.unknown' | translate }}</p>
            }
            @if (ship(); as s) {
              <p class="ship">{{ 'hq.now.anchor.ship' | translate }} <b class="ship-name">{{ s }}</b></p>
            }
            @if (gameLive()) {
              <p class="zones">
                <span class="zones-label">{{ 'hq.now.zone.label' | translate }}</span>
                @if (zones(); as list) {
                  @for (z of list; track z) {
                    <span class="zone" [class.warn]="z === 'restricted' || z === 'commDown'">{{ 'hq.now.zone.' + z | translate }}</span>
                  }
                } @else {
                  <span class="zone unknown">{{ 'hq.now.zone.unknown' | translate }}</span>
                }
              </p>
            }
            @if (lastSignal(); as at) {
              <p class="fresh">{{ (gameLive() ? 'hq.now.fresh.updated' : 'hq.now.fresh.ended') | translate: { at: (at | date: 'short') } }}</p>
            }
          </section>
        }

        @if (live.loaded() && live.state()) {
          <div class="log" aria-labelledby="hq-now-log">
            <div class="log-head">
              <h3 id="hq-now-log" class="h">{{ 'hq.now.log.title' | translate }}</h3>
              @if (live.events().length > PREVIEW) {
                <button type="button" scAction tier="secondary" (click)="logOpen.set(true)">{{ 'hq.log.showAll' | translate }}</button>
              }
            </div>
            @if (preview().length === 0) {
              <p class="muted">{{ 'hq.log.empty' | translate }}</p>
            } @else {
              <ul>
                @for (ev of preview(); track ev.id; let first = $first) {
                  <li [attr.data-log-first]="first ? '' : null" [class.undone]="ev.undone">
                    <time class="mono muted" [attr.datetime]="ev.at">{{ ev.at | date: 'shortTime' }}</time>
                    <span class="text">{{ label(ev).key | translate: label(ev).params }}</span>
                    @if (ev.undone) {
                      <span class="muted">{{ 'hq.log.undone' | translate }}</span>
                    } @else if (live.undoable(ev)) {
                      <button type="button" class="btn" (click)="live.undo(ev.id)">{{ 'hq.log.undo' | translate }}</button>
                    }
                  </li>
                }
              </ul>
            }
          </div>
        }
      </section>
    </div>

    @if (live.toast(); as t) {
      <div #toast class="toast" role="status">
        <span class="text">{{ label(t).key | translate: label(t).params }}</span>
        <button type="button" class="btn" (click)="live.undo(t.id)">{{ 'hq.log.undo' | translate }}</button>
      </div>
    }

    @if (logOpen()) {
      <sc-hq-log-dialog (closed)="logOpen.set(false)" />
    }
  `,
  styles: [
    `
      :host { display: flex; flex-direction: column; gap: var(--sc-space-3, 12px); height: var(--hq-page-h, auto); min-height: 0; }
      .offer { flex: none; display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px) var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-accent); border-radius: 12px; background: color-mix(in srgb, var(--sc-accent) 10%, var(--sc-bg-1)); }
      .offer svg { width: 20px; height: 20px; fill: none; stroke: var(--sc-accent); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
      .o-t { flex: 1; min-width: 12rem; }
      .phead { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-3, 12px); flex: none; }
      .page-title { margin: 0; font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .phead-r { display: inline-flex; align-items: center; gap: var(--sc-space-3, 12px); margin-left: auto; }
      .muted { color: var(--sc-fg-2); margin: 0; }
      .err { color: var(--sc-danger); margin: 0; display: flex; align-items: center; gap: var(--sc-space-3, 12px); }
      .run { position: relative; display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: 4px var(--sc-space-3, 12px) 4px 6px; border: 1px solid color-mix(in srgb, var(--sc-accent) 55%, var(--sc-border)); border-radius: 12px; background: color-mix(in srgb, var(--sc-accent) 7%, var(--sc-bg-0)); min-width: 0; }
      .run-ic { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: color-mix(in srgb, var(--sc-accent) 16%, transparent); color: var(--sc-accent); }
      .run-ic svg, .shared svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
      .run-t { display: grid; line-height: 1.15; min-width: 0; }
      .run-t small { color: var(--sc-fg-2); font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; }
      .run-t b { font: 700 0.95rem var(--sc-font-display, inherit); overflow-wrap: anywhere; }
      .run-e { color: var(--sc-fg-1); font-size: 0.82rem; }
      .sw { position: relative; }
      .menu { position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; min-width: 240px; margin: 0; padding: 6px; list-style: none; border: 1px solid var(--sc-border); border-radius: 10px; background: var(--sc-bg-1); box-shadow: 0 12px 32px rgb(0 0 0 / 0.5); }
      .menu li { display: block; padding: 0; border: 0; }
      .menu button { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--sc-fg); font: inherit; text-align: start; cursor: pointer; }
      .menu button:hover { background: color-mix(in srgb, var(--sc-accent) 12%, transparent); }
      .menu button[aria-checked='true'] { color: var(--sc-accent); }
      .menu button:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
      .now { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) minmax(320px, 420px); gap: var(--sc-space-3, 12px); }
      .panel { min-height: 0; min-width: 0; border: 1px solid var(--sc-border); border-radius: 14px; background: color-mix(in srgb, var(--sc-bg-1) 92%, transparent); }
      .mapcol { display: flex; flex-direction: column; padding: var(--sc-space-2, 8px); }
      .map { flex: 1; min-height: 0; }
      .empty { flex: 1; display: grid; align-content: center; justify-items: center; gap: var(--sc-space-2, 8px); text-align: center; padding: var(--sc-space-4, 16px); }
      .e-title { margin: 0; font-weight: 600; }
      .stepcol { display: flex; flex-direction: column; gap: var(--sc-space-2, 8px); padding: var(--sc-space-3, 12px) var(--sc-space-4, 16px); overflow-y: auto; }
      .kicker { margin: 0; font: 600 0.72rem var(--sc-font-display, inherit); letter-spacing: 0.14em; text-transform: uppercase; color: var(--sc-accent); }
      .now-h { margin: 0; font: 600 1.35rem / 1.25 var(--sc-font-display, inherit); overflow-wrap: anywhere; }
      .cta { display: flex; flex-wrap: wrap; gap: var(--sc-space-2, 8px); }
      .shared { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--sc-fg-2); font-size: 0.82rem; }
      .shared svg { width: 16px; height: 16px; color: var(--sc-accent); }
      .trail { opacity: 0.8; padding-left: var(--sc-space-3, 12px); border-left: 2px dashed var(--sc-border); }
      .etabs { display: flex; flex-wrap: wrap; gap: 6px; }
      .etab { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 32px; padding: 0 10px; border: 1px solid var(--sc-border); border-radius: 999px; background: transparent; color: var(--sc-fg-2); font: inherit; font-size: 0.8rem; cursor: pointer; }
      .etab b { color: var(--sc-accent); font-family: var(--sc-font-display, inherit); }
      .etab span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 14ch; }
      .etab[aria-pressed='true'] { color: var(--sc-fg); border-color: var(--sc-accent); background: color-mix(in srgb, var(--sc-accent) 16%, transparent); }
      .etab.fin { text-decoration: line-through; }
      .etab:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .anchor { margin-top: auto; padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid color-mix(in srgb, var(--sc-accent) 50%, var(--sc-border)); border-left-width: 3px; border-radius: var(--sc-radius, 10px); background: var(--sc-surface-2, var(--sc-bg-0)); }
      .eyebrow { font-size: max(0.7rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); }
      .where { margin: 2px 0 0; font: 600 1.1rem / 1.2 var(--sc-font-display); overflow-wrap: anywhere; }
      .where .sys, .where .sep { color: var(--sc-fg-2); font-weight: 400; }
      .where.unknown { color: var(--sc-fg-2); font-size: 0.95rem; }
      .ship { margin: 2px 0 0; color: var(--sc-fg-2); font-size: 0.85rem; }
      .zones { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 4px 0 0; color: var(--sc-fg-2); font-size: 0.8rem; }
      .zone { padding: 0 8px; border: 1px solid var(--sc-accent); border-radius: 999px; color: var(--sc-fg); font-size: max(0.75rem, var(--sc-fs-floor)); }
      .zone.warn { border-color: var(--sc-warning); color: var(--sc-warning); }
      .zone.unknown { border-color: var(--sc-border); color: var(--sc-fg-2); }
      .fresh { margin: 4px 0 0; color: var(--sc-fg-2); font-size: 0.78rem; }
      .connect { display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); margin-top: auto; padding: var(--sc-space-3, 12px); color: var(--sc-fg); border: 1px dashed var(--sc-accent); border-radius: var(--sc-radius, 10px); }
      .connect-title { font-weight: 600; font-size: 1rem; color: var(--sc-accent); }
      .explain { margin-top: var(--sc-space-2, 8px); color: var(--sc-fg-2); font-size: 0.85rem; }
      .explain-what { margin: 0 0 var(--sc-space-1, 4px); }
      .explain-list { list-style: disc; margin: 0; padding-left: var(--sc-space-5, 20px); }
      .explain-list li { display: list-item; padding: 0; border: 0; }
      .connect-go { margin-top: var(--sc-space-2, 8px); }
      .h { margin: 0; font-size: 0.72rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
      .log-head { display: flex; align-items: center; justify-content: space-between; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: 4px 0; border-bottom: 1px solid var(--sc-border); font-size: 0.85rem; }
      li.undone .text { text-decoration: line-through; color: var(--sc-fg-2); }
      .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .btn { min-height: 32px; padding: 0 var(--sc-space-3, 12px); border-radius: var(--sc-radius, 10px); border: 1px solid var(--sc-border); background: transparent; color: var(--sc-fg); cursor: pointer; font: inherit; font-size: 0.8rem; }
      .btn:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
      .toast {
        position: fixed; z-index: 50; left: 50%; transform: translateX(-50%); bottom: var(--sc-float-bottom, 16px);
        display: flex; align-items: center; gap: var(--sc-space-3, 12px); max-width: min(480px, calc(100vw - 2 * var(--sc-space-3, 12px)));
        padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 10px);
        background: var(--sc-surface, #111); box-shadow: 0 8px 28px rgb(0 0 0 / 0.45);
      }
      @media (max-width: 1023px) { .now { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(260px, 46svh) auto; } }
      @media (max-width: 760px) {
        .toast { left: var(--sc-fab-clear-inline, 12px); right: var(--sc-fab-clear-inline, 12px); transform: none; max-width: none; }
      }
    `,
  ],
})
export class HqNowComponent {
  readonly live = inject(HqLiveService);
  private readonly conn = inject(DesktopConnectionService);
  private readonly pathSig = inject(HQ_NOW_PATH);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly toastEl = viewChild<ElementRef<HTMLElement>>('toast');

  private readonly focus = inject(NachschubFocusService);
  private readonly ns = inject(NachschubService);
  private readonly einsatzSvc = inject(HqEinsatzService);

  readonly tray = NACHSCHUB_ICON_PATHS;
  readonly planen = hqPage('planen');
  readonly menuOpen = signal(false);
  private readonly pickedEinsatz = signal<string | null>(null);

  /** The Nachschub Jetzt serves (the one in focus in Planen). */
  readonly nachschub = computed(() => this.focus.selected());
  /** Its Einsatz bundle; without a Nachschub bundle the current loose Einsatz (planned the older way) still runs here. */
  readonly bundle = computed<Einsatz[]>(() => {
    const n = this.nachschub();
    const own = n ? this.einsatzSvc.ofPackage(n.id) : [];
    if (own.length) return own;
    const loose = currentEinsatz(this.einsatzSvc.upcoming().filter((e) => !e.packageId));
    return loose ? [loose] : [];
  });
  readonly activeEinsatz = computed<Einsatz | null>(() => {
    const list = this.bundle();
    return list.find((e) => e.id === this.pickedEinsatz()) ?? list.find((e) => e.steps.some((s) => s.state === 'todo')) ?? list[list.length - 1] ?? null;
  });
  readonly activeIndex = computed(() => this.bundle().findIndex((e) => e.id === this.activeEinsatz()?.id));
  private readonly steps = computed<readonly EinsatzStep[]>(() => [...(this.activeEinsatz()?.steps ?? [])].sort((a, b) => a.ord - b.ord));
  readonly total = computed(() => this.steps().length);
  readonly doneCount = computed(() => this.steps().filter((s) => s.state === 'done').length);
  readonly shownStep = computed(() => Math.min(this.doneCount() + 1, this.total()));
  readonly nextStep = computed(() => this.steps().find((s) => s.state === 'todo') ?? null);
  readonly upcoming = computed(() => {
    const next = this.nextStep();
    return this.steps().filter((s) => s.state === 'todo' && s.ord !== next?.ord).slice(0, UPCOMING);
  });
  /** The step finished last, so one tap takes it back (by hand or by the SCC-App). */
  readonly lastDone = computed(() =>
    this.steps()
      .filter((s) => s.state === 'done' && s.doneAt)
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))[0] ?? null,
  );
  readonly graphSteps = computed<RouteGraphStep[]>(() =>
    this.steps().map((s) => ({ ord: s.ord, kind: s.kind, label: s.label, location: s.location, system: s.system, state: s.state })),
  );
  readonly filterKey = computed(() => routeFilterKey(this.nachschub()?.id ?? null, this.activeEinsatz()?.id ?? null));
  readonly switchable = computed(() =>
    this.ns.active().map((n) => {
      const p = this.ns.evaluation(n.id)?.progress ?? { done: 0, total: 0 };
      return { id: n.id, name: n.name, done: p.done, total: p.total };
    }),
  );
  /** Places of this route that another active Nachschub also needs (a quiet clickable hint on the route). */
  readonly sharedStops = computed<RouteSharedStop[]>(() => {
    const mine = this.nachschub();
    const here = new Set(this.steps().filter((s) => s.state === 'todo' && s.location).map((s) => (s.location as string).toLowerCase()));
    if (!mine || !here.size) return [];
    const out: RouteSharedStop[] = [];
    for (const n of this.ns.active()) {
      if (n.id === mine.id) continue;
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

  otherNachschubAt(location: string | null): string | null {
    if (!location) return null;
    return this.sharedStops().find((s) => s.location.toLowerCase() === location.toLowerCase())?.name ?? null;
  }

  choose(id: string): void {
    this.focus.select(id);
    this.pickedEinsatz.set(null);
    this.menuOpen.set(false);
  }

  pickEinsatz(id: string): void {
    this.pickedEinsatz.set(id);
  }

  /** "Schritt erledigt": ticks the step (the SCC-App ticks the same steps by itself, both land in the same state). */
  finish(ord: number): void {
    const e = this.activeEinsatz();
    if (e) this.einsatzSvc.toggleStep(e.id, ord);
  }

  undoLast(ord: number): void {
    const e = this.activeEinsatz();
    if (e) this.einsatzSvc.unmarkStep(e.id, ord);
  }


  readonly PREVIEW = PREVIEW;
  readonly label = eventLabel;
  readonly logOpen = signal(false);
  readonly location = computed(() => readLocation(this.live.state()));
  readonly ship = computed(() => readShip(this.live.state()));
  readonly contracts = computed(() => readContracts(this.live.state()));
  readonly path = this.pathSig;
  readonly preview = computed(() => this.live.events().slice(0, PREVIEW));
  readonly placeName = formatLocationName;
  /** Re-evaluates the life sign's age while the page stays open without new data. */
  private readonly clock = signal(Date.now());
  readonly gameLive = computed(() => isGameLive(this.live.state(), this.live.events(), this.clock()));
  readonly zones = computed(() => readZones(this.live.events()));
  readonly lastSignal = computed(() => presenceAt(this.live.state()) ?? this.live.stateUpdatedAt());
  /** Signed-in app without any live state yet: the app is there, only the opt-in sync or the game is missing. */
  readonly appConnected = computed(() => this.conn.stateFor('starscape') === 'connected');

  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly eventHq = inject(EventHqService);
  /** The place the reader waved off with "Nicht jetzt"; the offer stays away until the position changes. */
  private readonly waved = signal<string | null>(null);
  readonly offer = computed(() => this.eventHq.offer(this.waved(), this.focus.selected()?.id ?? null, this.clock()));
  readonly offerName = computed(() => this.location() ? formatLocationName(this.location()!.name) : '');
  readonly offerEventName = computed(() => this.eventHq.eventById(this.offer()?.eventId)?.name ?? '');

  takeOffer(id: string): void {
    this.focus.select(id);
    this.pickedEinsatz.set(null);
  }

  waveOff(): void {
    this.waved.set(this.eventHq.placeKey());
  }

  constructor() {
    this.eventHq.ensure();
    const ticker = setInterval(() => this.clock.set(Date.now()), PRESENCE_TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(ticker));
    effect(() => {
      if (this.live.loaded() && !this.live.state()) untracked(() => void this.conn.refresh(true));
    });
    effect(() => {
      const t = this.live.toast();
      untracked(() => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = t ? setTimeout(() => this.flyIntoLog(), TOAST_MS) : null;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer) clearTimeout(this.timer);
    });
  }

  /** FLIP: the toast shrinks into the first log row; reduced motion fades instead. */
  private flyIntoLog(): void {
    const el = this.toastEl()?.nativeElement;
    const row = this.host.querySelector<HTMLElement>('[data-log-first]');
    const done = (): void => this.live.dismissToast();
    if (!el || typeof el.animate !== 'function') return done();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frames: Keyframe[];
    if (reduced || !row) {
      frames = [{ opacity: 1 }, { opacity: 0 }];
    } else {
      const a = el.getBoundingClientRect();
      const b = row.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const s = Math.min(1, b.height / Math.max(a.height, 1));
      const base = getComputedStyle(el).transform;
      const from = base === 'none' ? '' : base;
      frames = [
        { transform: from, opacity: 1 },
        { transform: `${from} translate(${dx}px, ${dy}px) scale(${s})`.trim(), opacity: 0.2 },
      ];
    }
    const anim = el.animate(frames, { duration: reduced ? 200 : 450, easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = done;
    anim.oncancel = done;
  }
}
