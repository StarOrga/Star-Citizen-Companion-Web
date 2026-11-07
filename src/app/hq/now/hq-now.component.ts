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
import { ScStepComponent } from '../../shared/step/sc-step.component';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import { HqAppLaunchComponent } from '../hq-app-launch.component';
import { HqLogDialogComponent } from './hq-log-dialog.component';
import { HqNowFriendsComponent } from './hq-now-friends.component';
import { HqLiveService } from './hq-live.service';
import { eventLabel, formatLocationName, isGameLive, presenceAt, readContracts, readLocation, readShip, readZones } from './hq-live.util';
import { HQ_NOW_PATH } from './hq-now-path';
import { HqMissionsPopoverComponent } from './hq-missions-popover.component';

export const TOAST_MS = 6000;
const PREVIEW = 3;
const PRESENCE_TICK_MS = 30_000;

/**
 * HQ page "Jetzt": where you are (location anchor), what is next (main path), active missions
 * (icon top right), the last events (log preview) and a toast for an auto-applied event that
 * flies into the log when it closes.
 */
@Component({
  selector: 'sc-hq-now',
  standalone: true,
  imports: [TranslatePipe, DatePipe, ScStepComponent, HqMissionsPopoverComponent, HqLogDialogComponent, HqAppLaunchComponent, HqNowFriendsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="page-title" id="hq-now-title">{{ 'hq.pages.jetzt' | translate }}</h2>
    <sc-hq-now-friends />

    @if (!live.loaded()) {
      <p class="muted" role="status">{{ 'hq.now.loading' | translate }}</p>
    } @else if (live.error() && !live.state()) {
      <p class="err" role="alert">{{ live.error()! | translate }}</p>
      <button type="button" class="btn" (click)="live.refresh()">{{ 'hq.now.retry' | translate }}</button>
    } @else if (!live.state()) {
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
    } @else {
      <div class="top">
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
        <sc-hq-missions-popover [contracts]="contracts()" />
      </div>

      <section class="path" aria-labelledby="hq-now-path">
        <h3 id="hq-now-path" class="h">{{ 'hq.now.path.title' | translate }}</h3>
        @if (path().length === 0) {
          <p class="muted">{{ 'hq.now.path.empty' | translate }}</p>
        } @else {
          <div role="list">
            <sc-step
              class="next"
              [kind]="path()[0].kind"
              [label]="path()[0].label"
              [qty]="path()[0].qty"
              [location]="path()[0].location"
            />
            <div class="trail">
              @for (s of path().slice(1, 5); track $index) {
                <sc-step [kind]="s.kind" [label]="s.label" [qty]="s.qty" [location]="s.location" />
              }
            </div>
          </div>
        }
      </section>
    }

    @if (live.loaded() && live.state()) {
      <section class="log" aria-labelledby="hq-now-log">
        <div class="log-head">
          <h3 id="hq-now-log" class="h">{{ 'hq.now.log.title' | translate }}</h3>
          @if (live.events().length > PREVIEW) {
            <button type="button" class="btn" (click)="logOpen.set(true)">{{ 'hq.log.showAll' | translate }}</button>
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
      </section>
    }

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
      :host { display: block; }
      .page-title { margin: 0 0 var(--sc-space-4, 16px); font: 600 1.6rem / 1.2 var(--sc-font-display); }
      .muted { color: var(--sc-fg-2); }
      .err { color: var(--sc-danger); }
      .top { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sc-space-3, 12px); }
      .anchor {
        flex: 1; min-width: 0; padding: var(--sc-space-4, 16px) var(--sc-space-5, 20px); border: 1px solid var(--sc-accent);
        border-left-width: 4px; border-radius: var(--sc-radius, 10px); background: var(--sc-surface-2, var(--sc-surface));
      }
      .eyebrow { font-size: max(0.75rem, var(--sc-fs-floor)); letter-spacing: 0.1em; text-transform: uppercase; color: var(--sc-fg-2); }
      .where { margin: var(--sc-space-1, 4px) 0 0; font: 600 clamp(1.5rem, 4vw, 2.2rem) / 1.15 var(--sc-font-display); overflow-wrap: anywhere; }
      .where .sys, .where .sep { color: var(--sc-fg-2); font-weight: 400; }
      .where.unknown { color: var(--sc-fg-2); font-size: 1.2rem; }
      .ship { margin: var(--sc-space-2, 8px) 0 0; color: var(--sc-fg-2); }
      .zones { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sc-space-2, 8px); margin: var(--sc-space-2, 8px) 0 0; color: var(--sc-fg-2); }
      .zone { padding: 2px var(--sc-space-2, 8px); border: 1px solid var(--sc-accent); border-radius: 999px; color: var(--sc-fg); font-size: max(0.8125rem, var(--sc-fs-floor)); }
      .zone.warn { border-color: var(--sc-warning); color: var(--sc-warning); }
      .zone.unknown { border-color: var(--sc-border); color: var(--sc-fg-2); }
      .h { margin: var(--sc-space-5, 20px) 0 var(--sc-space-2, 8px); font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--sc-fg-2); }
      .next { font-size: 1.25rem; padding: var(--sc-space-3, 12px) 0; }
      .trail { opacity: 0.55; padding-left: var(--sc-space-4, 16px); border-left: 2px dashed var(--sc-border); }
      .log-head { display: flex; align-items: center; justify-content: space-between; }
      ul { list-style: none; margin: 0; padding: 0; }
      li { display: flex; align-items: center; gap: var(--sc-space-3, 12px); padding: var(--sc-space-2, 8px) 0; border-bottom: 1px solid var(--sc-border); }
      li.undone .text { text-decoration: line-through; color: var(--sc-fg-2); }
      .text { flex: 1; min-width: 0; overflow-wrap: anywhere; }
      .btn {
        min-height: 44px; padding: 0 var(--sc-space-3, 12px); border-radius: var(--sc-radius, 10px); border: 1px solid var(--sc-border);
        background: transparent; color: var(--sc-fg); cursor: pointer; font: inherit;
      }
      .btn:hover { border-color: var(--sc-accent); color: var(--sc-accent); }
      .connect {
        display: flex; flex-direction: column; gap: var(--sc-space-1, 4px); padding: var(--sc-space-5, 20px); color: var(--sc-fg);
        border: 1px dashed var(--sc-accent); border-radius: var(--sc-radius, 10px);
      }
      .connect-title { font-weight: 600; font-size: 1.15rem; color: var(--sc-accent); }
      .fresh { margin: var(--sc-space-1, 4px) 0 0; color: var(--sc-fg-2); font-size: 0.8125rem; }
      .explain { margin-top: var(--sc-space-3, 12px); color: var(--sc-fg-2); font-size: 0.9rem; }
      .explain-what { margin: 0 0 var(--sc-space-1, 4px); }
      .explain-list { list-style: disc; margin: 0; padding-left: var(--sc-space-5, 20px); }
      .explain-list li { display: list-item; padding: 0; border: 0; }
      .connect-go { margin-top: var(--sc-space-3, 12px); }
      .toast {
        position: fixed; z-index: 50; left: 50%; transform: translateX(-50%); bottom: var(--sc-float-bottom, 16px);
        display: flex; align-items: center; gap: var(--sc-space-3, 12px); max-width: min(480px, calc(100vw - 2 * var(--sc-space-3, 12px)));
        padding: var(--sc-space-2, 8px) var(--sc-space-3, 12px); border: 1px solid var(--sc-border); border-radius: var(--sc-radius, 10px);
        background: var(--sc-surface, #111); box-shadow: 0 8px 28px rgb(0 0 0 / 0.45);
      }
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

  constructor() {
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
