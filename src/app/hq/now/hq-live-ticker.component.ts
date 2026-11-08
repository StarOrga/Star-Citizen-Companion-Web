import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopCapabilityService } from '../../core/desktop-capability.service';
import { ScPopoverDismissDirective } from '../../shared/popover/sc-popover-dismiss.directive';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { ScActionDirective } from '../../shared/action/sc-action.directive';
import { HqAppLaunchComponent } from '../hq-app-launch.component';
import type { HqPageId } from '../hq-routes';
import { HqAppConnectionService } from './hq-app-connection.service';
import { AUSSICHT_SEEN_KEY, appStatusVisible, aussichtAutoOpen, hqAppAction, readAussichtSeen } from './hq-app-status.util';
import { HqLiveService } from './hq-live.service';
import { eventLabel } from './hq-live.util';
import { lastRelevantEvent, tickerAge } from './hq-live-ticker.util';

const TICK_MS = 30_000;

/**
 * The desktop app's status chip ("App-Status", concept 20261108-2135-hq-bestand round 1, "Klare Reiter"): bottom left
 * on every HQ page including Start, right of the hand-off launcher on its centre line, also before the app was ever
 * connected. Four states with their own mark (dashed ring / grey ring / green ring / glowing dot), the action the
 * state needs (download, start, none) and, on the chip itself, the page's "Aussicht": what the app does on this page.
 * While the app is missing the Aussicht opens by itself once per page; closing it is remembered.
 */
@Component({
  selector: 'sc-hq-live-ticker',
  standalone: true,
  imports: [TranslatePipe, ScPopoverDismissDirective, ScTooltipDirective, ScActionDirective, HqAppLaunchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      @let st = status();
      @let pg = page()!;
      <div class="dock" [class.above-footer]="pg === 'statistik'" [attr.data-state]="st" [scPopoverDismiss]="open()" (dismissed)="close()">
        @if (open()) {
          <div class="aussicht" id="hq-app-aussicht" role="region" [attr.aria-label]="'hq.appStatus.aussicht.aria' | translate">
            <div class="a-head">
              <span class="a-k">{{ 'hq.appStatus.aussicht.title' | translate }}</span>
              <button type="button" scAction tier="tertiary" class="a-x" [attr.aria-label]="'hq.appStatus.close' | translate" [scTooltip]="'hq.appStatus.close' | translate" (click)="close()">
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <p class="a-text">{{ 'hq.appStatus.aussicht.' + pg | translate }}</p>
            @if (pg === 'jetzt') {
              <ul class="a-list">
                <li>{{ 'hq.appStatus.aussicht.jetztList.e1' | translate }}</li>
                <li>{{ 'hq.appStatus.aussicht.jetztList.e2' | translate }}</li>
                <li>{{ 'hq.appStatus.aussicht.jetztList.e3' | translate }}</li>
              </ul>
            }
          </div>
        }
        <div class="chip">
          <button type="button" class="face" aria-controls="hq-app-aussicht" [attr.aria-expanded]="open()" [scTooltip]="'hq.appStatus.aussicht.toggle' | translate" (click)="toggle()">
            <i class="mark" aria-hidden="true"></i>
            <b class="state">{{ 'hq.appStatus.state.' + st | translate }}</b>
            @switch (st) {
              @case ('tracking') {
                @if (event(); as ev) {
                  <em>{{ label(ev).key | translate: label(ev).params }}</em>
                  <small>{{ 'hq.ticker.ago.' + age(ev.at).unit | translate: { n: age(ev.at).n } }}</small>
                } @else {
                  <em>{{ 'hq.ticker.none' | translate }}</em>
                }
              }
              @case ('ready') {
                <em>{{ 'hq.appStatus.waiting' | translate }}</em>
              }
              @case ('off') {
                @if (lastSign(); as at) {
                  <small>{{ 'hq.appStatus.last' | translate }} {{ 'hq.ticker.ago.' + age(at).unit | translate: { n: age(at).n } }}</small>
                }
              }
            }
          </button>
          @if (action(); as a) {
            <sc-hq-app-launch class="go" look="chip" [mode]="a" [tipped]="true" />
          }
        </div>
        <span class="sc-sr-only" role="status">{{ 'hq.appStatus.state.' + st | translate }}</span>
      </div>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      /* Right of the hand-off launcher (the feedback launcher's twin, bottom left) and centred on its line; where the
         page frame starts further in, on the page content's left edge. Nothing of it ever lies under a launcher. */
      .dock {
        --_h: 32px;
        --_lane: calc(max(var(--sc-fab-inset, 24px), env(safe-area-inset-left, 0px)) + var(--sc-fab-size, 56px) + var(--sc-fab-gutter, 12px));
        --_left: max(var(--_lane), calc((100vw - var(--sc-page-max, 1280px)) / 2 + var(--sc-page-gutter, 28px)));
        position: fixed; z-index: 4; left: var(--_left);
        bottom: calc(var(--sc-float-bottom, 24px) + (var(--sc-fab-size, 56px) - var(--_h)) / 2);
        max-width: min(36rem, calc(100vw - var(--_left) - var(--sc-fab-clear-inline, 92px)));
      }
      /* The last page ends in the shell footer (badge and hand-off launcher in its row): the chip stands above it. */
      @media (min-width: 1024px) {
        .dock.above-footer { bottom: calc(var(--sc-float-bottom, 24px) + var(--sc-fab-size, 56px) + var(--sc-space-6, 32px)); }
        /* The way-on cue stands centred on the same line: the chip ends before the middle. */
        .dock:not(.above-footer) { max-width: min(36rem, calc(50vw - var(--_left) - 5rem)); }
      }
      /* Tablet width: the HQ page bar owns the bottom row (12px + one 58px bar); the chip stands one row above it,
         and on the last page above the footer that ends on that bar. */
      @media (max-width: 1023px) {
        .dock { bottom: calc(12px + var(--sc-safe-bottom, 0px) + 58px + var(--sc-space-2, 8px)); }
        .dock.above-footer { bottom: calc(12px + var(--sc-safe-bottom, 0px) + 58px + var(--sc-footer-h, 80px) + var(--sc-space-2, 8px)); }
      }
      /* Phone width (a narrow desktop window): the page bar rides above the fusion bar, the chip above both. */
      @media (max-width: 720px) {
        .dock { --_left: var(--sc-space-3, 12px); bottom: calc(var(--sc-float-bottom, 16px) + var(--sc-bar-h, 56px) + var(--sc-space-2, 8px) + 58px + var(--sc-space-2, 8px)); }
      }

      .chip {
        display: inline-flex; align-items: center; gap: 2px; box-sizing: border-box; height: var(--_h); max-width: 100%; padding: 0 3px 0 0;
        border: 1px solid var(--_ring); border-radius: 999px; background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent);
        -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
      }
      .face {
        display: inline-flex; align-items: center; gap: 8px; min-width: 0; height: 100%; padding: 0 10px; margin: 0;
        border: 0; border-radius: 999px; background: none; cursor: pointer;
        font: inherit; font-size: max(0.8rem, var(--sc-fs-floor)); color: var(--sc-fg-1); white-space: nowrap;
      }
      .face:hover .state { text-decoration: underline; text-underline-offset: 3px; }
      .face:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; }
      .mark { flex: none; box-sizing: border-box; width: 12px; height: 12px; border-radius: 50%; }
      .state { flex: none; font-weight: 600; color: var(--_tone); }
      em { font-style: normal; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      small { flex: none; color: var(--sc-fg-2); font-size: inherit; }
      .go { flex: none; }

      /* The four shapes: a dashed ring (missing), a grey ring (off), a green ring (ready), a filled dot that glows. */
      [data-state='missing'] { --_tone: var(--sc-accent); --_ring: color-mix(in srgb, var(--sc-accent) 55%, transparent); }
      [data-state='missing'] .chip { border-style: dashed; }
      [data-state='missing'] .mark { border: 2px dashed var(--sc-accent); }
      [data-state='off'] { --_tone: var(--sc-fg-2); --_ring: color-mix(in srgb, var(--sc-fg-2) 35%, transparent); }
      [data-state='off'] .mark { border: 2px solid var(--sc-fg-2); }
      [data-state='ready'] { --_tone: var(--sc-success); --_ring: color-mix(in srgb, var(--sc-success) 38%, transparent); }
      [data-state='ready'] .mark { border: 2px solid var(--sc-success); }
      [data-state='tracking'] { --_tone: var(--sc-success); --_ring: color-mix(in srgb, var(--sc-success) 38%, transparent); }
      [data-state='tracking'] .mark { width: 10px; height: 10px; margin: 1px; background: var(--sc-success); box-shadow: 0 0 8px var(--sc-success); }

      .aussicht {
        position: absolute; left: 0; bottom: calc(100% + var(--sc-space-2, 8px)); box-sizing: border-box;
        width: min(var(--sc-ov-menu, 20rem), calc(100vw - var(--_left) - var(--sc-space-3, 12px)));
        padding: var(--sc-space-3, 12px) var(--sc-space-3, 12px) var(--sc-space-3, 12px) var(--sc-space-4, 16px);
        color: var(--sc-fg-1); font-size: max(0.84rem, var(--sc-fs-floor)); line-height: 1.45;
        background: color-mix(in srgb, var(--sc-bg-1) 96%, transparent); border: 1px solid var(--_ring); border-radius: 12px;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
        transform-origin: bottom left; animation: grow 0.16s ease-out;
      }
      @keyframes grow { from { opacity: 0; transform: scale(0.92); } }
      .a-head { display: flex; align-items: center; justify-content: space-between; gap: var(--sc-space-2, 8px); margin-bottom: var(--sc-space-1, 4px); }
      .a-k { font-family: var(--sc-font-display); font-size: max(0.72rem, var(--sc-fs-floor)); letter-spacing: 0.08em; text-transform: uppercase; color: var(--_tone); }
      .a-x svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
      .a-text { margin: 0; }
      .a-list { margin: var(--sc-space-2, 8px) 0 0; padding-left: 1.1em; color: var(--sc-fg-2); }
      .a-list li + li { margin-top: 2px; }

      /* Touch: every target gets the 48px the touch audit measures. */
      @media (pointer: coarse) { .dock { --_h: 48px; } }
      @media (prefers-reduced-motion: reduce) { .aussicht { animation: none; } }
    `,
  ],
})
export class HqLiveTickerComponent {
  readonly page = input<HqPageId | null>(null);

  private readonly live = inject(HqLiveService);
  private readonly conn = inject(HqAppConnectionService);
  private readonly canInstall = inject(DesktopCapabilityService).canInstall;
  private readonly clock = signal(Date.now());

  protected readonly status = this.conn.status;
  protected readonly visible = computed(() => appStatusVisible(this.page(), this.canInstall(), this.conn.settled()));
  protected readonly action = computed(() => hqAppAction(this.status()));
  protected readonly lastSign = this.conn.lastSignAt;
  protected readonly event = computed(() => lastRelevantEvent(this.live.events(), this.page()));
  protected readonly label = eventLabel;

  /** The page's Aussicht is open (by the reader, or by itself while the app is missing). */
  protected readonly open = signal(false);
  /** Pages on which the reader closed the Aussicht while the app was missing. */
  private readonly seen = signal(readAussichtSeen(this.readStorage()));

  constructor() {
    const t = setInterval(() => this.clock.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
    // A new page or a new state decides afresh: open by itself only while the app is missing and only once per page.
    effect(() => {
      const page = this.page();
      const status = this.status();
      const ready = this.visible();
      untracked(() => this.open.set(ready && aussichtAutoOpen(status, page, this.seen())));
    });
  }

  protected toggle(): void {
    if (this.open()) this.close();
    else this.open.set(true);
  }

  protected close(): void {
    if (!this.open()) return;
    this.open.set(false);
    const page = this.page();
    if (this.status() !== 'missing' || !page || this.seen().has(page)) return;
    const next = new Set(this.seen()).add(page);
    this.seen.set(next);
    try {
      localStorage.setItem(AUSSICHT_SEEN_KEY, JSON.stringify([...next]));
    } catch {
      /* Private window or blocked storage: the Aussicht just opens once more next time. */
    }
  }

  protected age(iso: string) {
    return tickerAge(iso, this.clock());
  }

  private readStorage(): string | null {
    try {
      return localStorage.getItem(AUSSICHT_SEEN_KEY);
    } catch {
      return null;
    }
  }
}
