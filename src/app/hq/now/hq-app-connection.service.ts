import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { HqLiveService } from './hq-live.service';
import { LIVE_PRESENCE_MAX_AGE_MS, isGameLive, presenceAt } from './hq-live.util';

const TICK_MS = 30_000;

/**
 * The ONE answer to "is the SCC Companion app connected?" for every HQ surface (Start, Jetzt pill,
 * Jetzt hint box, ticker). It reads what the SCC app itself reports (live state / events) - never
 * the Starscape wallpaper app's check-in, which says nothing about the companion.
 */
@Injectable({ providedIn: 'root' })
export class HqAppConnectionService {
  private readonly live = inject(HqLiveService);
  private readonly clock = signal(Date.now());

  constructor() {
    const t = setInterval(() => this.clock.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(t));
  }

  /** The SCC app has ever reported a state or an event for this account. */
  readonly everConnected = computed(() => this.live.state() !== null || this.live.events().length > 0);
  /** Connected right now: a fresh life sign (presence, else the newest event), or the game is live. */
  readonly connected = computed(() => {
    const now = this.clock();
    if (isGameLive(this.live.state(), this.live.events(), now)) return true;
    const sign = presenceAt(this.live.state()) ?? this.live.events()[0]?.at ?? '';
    const at = Date.parse(sign);
    return Number.isFinite(at) && now - at <= LIVE_PRESENCE_MAX_AGE_MS;
  });
}
