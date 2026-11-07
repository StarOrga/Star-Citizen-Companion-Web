import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DesktopConnectionService } from '../../desktop/desktop-connection.service';
import type { HqPageId } from '../hq-routes';
import { HqLiveService } from './hq-live.service';
import { eventLabel, isGameLive } from './hq-live.util';
import { lastRelevantEvent, tickerAge, tickerVisible } from './hq-live-ticker.util';

const TICK_MS = 30_000;

/**
 * The SCC-App live ticker (round 4 pattern): bottom left on every HQ page except Start, green while the app is connected
 * and grey while it is off, always showing the last event that is relevant for the page and when it came in. It stays
 * away until the app was ever connected (a first-time visitor sees no empty box).
 */
@Component({
  selector: 'sc-hq-live-ticker',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <p class="ticker" [class.off]="!online()" role="status">
        <i aria-hidden="true"></i>
        <b>{{ 'hq.ticker.app' | translate }}</b>
        <span class="state">{{ (online() ? 'hq.ticker.on' : 'hq.ticker.off') | translate }}</span>
        @if (event(); as ev) {
          <em>{{ label(ev).key | translate: label(ev).params }}</em>
          <small>{{ 'hq.ticker.ago.' + age(ev.at).unit | translate: { n: age(ev.at).n } }}</small>
        } @else {
          <em>{{ 'hq.ticker.none' | translate }}</em>
        }
      </p>
    }
  `,
  styles: [
    `
      :host { display: contents; }
      .ticker { position: fixed; z-index: 4; left: max(var(--sc-space-3, 12px), calc((100vw - var(--sc-page-max, 1280px)) / 2 + var(--sc-page-gutter, 28px))); bottom: max(8px, 0.8vw);
        margin: 0; display: inline-flex; align-items: center; gap: 8px; height: 30px; max-width: min(560px, calc(100vw - 2 * var(--sc-space-3, 12px))); padding: 0 12px 0 10px;
        border: 1px solid color-mix(in srgb, var(--sc-success) 38%, transparent); border-radius: 999px; background: color-mix(in srgb, var(--sc-bg-0) 88%, transparent);
        -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); font-size: 0.8rem; color: var(--sc-fg-1); white-space: nowrap; }
      i { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--sc-success); box-shadow: 0 0 8px var(--sc-success); }
      b { font-weight: 600; color: var(--sc-fg-0); }
      .state { color: var(--sc-success); }
      em { font-style: normal; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      small { flex: none; color: var(--sc-fg-2); }
      .off { border-color: color-mix(in srgb, var(--sc-fg-2) 35%, transparent); }
      .off i { background: var(--sc-fg-2); box-shadow: none; }
      .off .state { color: var(--sc-fg-2); }
      /* Phones: the feedback launcher owns the lane at the bottom right; the ticker keeps to the left of it. */
      @media (max-width: 1023px) { .ticker { left: var(--sc-space-3, 12px); bottom: var(--sc-float-bottom, 16px); max-width: calc(100vw - var(--sc-fab-clear-inline, 72px) - var(--sc-space-3, 12px)); } }
    `,
  ],
})
export class HqLiveTickerComponent {
  readonly page = input<HqPageId | null>(null);

  private readonly live = inject(HqLiveService);
  private readonly conn = inject(DesktopConnectionService);
  private readonly clock = signal(Date.now());

  /** The app ever reported something or checked in. */
  private readonly everConnected = computed(
    () => this.live.state() !== null || this.live.events().length > 0 || this.conn.stateFor('starscape') !== 'never',
  );
  protected readonly visible = computed(() => tickerVisible(this.page(), this.everConnected()));
  /** Green: the app checked in recently or the game is live right now. */
  protected readonly online = computed(
    () => this.conn.stateFor('starscape', this.clock()) === 'connected' || isGameLive(this.live.state(), this.live.events(), this.clock()),
  );
  protected readonly event = computed(() => lastRelevantEvent(this.live.events(), this.page()));
  protected readonly label = eventLabel;

  constructor() {
    const t = setInterval(() => this.clock.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
    // The first check-in may not be loaded yet when the page opens.
    effect(() => {
      if (this.page() && this.page() !== 'start') untracked(() => void this.conn.refresh());
    });
  }

  protected age(iso: string) {
    return tickerAge(iso, this.clock());
  }
}
