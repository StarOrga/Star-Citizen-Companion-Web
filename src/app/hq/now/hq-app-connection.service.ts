import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { SccAppLauncherService } from '../../desktop/scc-app-launcher.service';
import { HqLiveService } from './hq-live.service';
import { HqAppStatus, hqAppStatus } from './hq-app-status.util';
import { LIVE_PRESENCE_MAX_AGE_MS, isGameLive, presenceAt } from './hq-live.util';

const TICK_MS = 30_000;

/**
 * The ONE answer to "what is the desktop app doing?" for every HQ surface (status chip, Start tile, Jetzt connect
 * block). It reads what the app itself reports (live state / events) — never the Starscape wallpaper app's check-in,
 * which says nothing about it — plus this browser's memory that the app answered here once.
 */
@Injectable({ providedIn: 'root' })
export class HqAppConnectionService {
  private readonly live = inject(HqLiveService);
  private readonly launcher = inject(SccAppLauncherService);
  private readonly clock = signal(Date.now());

  constructor() {
    const t = setInterval(() => this.clock.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** The app has ever reported a state or an event for this account. */
  readonly everConnected = computed(() => this.live.state() !== null || this.live.events().length > 0);
  /** Connected right now: a fresh life sign (presence, else the newest event), or the game is live. */
  readonly connected = computed(() => {
    const now = this.clock();
    if (this.gameLive()) return true;
    const sign = presenceAt(this.live.state()) ?? this.live.events()[0]?.at ?? '';
    const at = Date.parse(sign);
    return Number.isFinite(at) && now - at <= LIVE_PRESENCE_MAX_AGE_MS;
  });
  /** The game runs right now, seen through the app's life sign. */
  readonly gameLive = computed(() => isGameLive(this.live.state(), this.live.events(), this.clock()));
  /** ISO time the app was last heard of (presence, else the state's write, else the newest event), or null. */
  readonly lastSignAt = computed<string | null>(
    () => presenceAt(this.live.state()) ?? this.live.stateUpdatedAt() ?? this.live.events()[0]?.at ?? null,
  );
  /** The four states, see {@link hqAppStatus}. */
  readonly status = computed<HqAppStatus>(() =>
    hqAppStatus({
      everConnected: this.everConnected(),
      remembered: this.launcher.remembered(),
      connected: this.connected(),
      gameLive: this.gameLive(),
    }),
  );
  /** The live data has loaded (or at least a state is there), so the status is not a guess. */
  readonly settled = computed(() => this.live.state() !== null || (this.live.loaded() && !this.live.error()));
}
