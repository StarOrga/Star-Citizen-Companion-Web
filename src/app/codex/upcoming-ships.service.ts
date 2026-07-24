import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * One "upcoming" ship: an entry from RSI's public ship-matrix that the diff in
 * the `rsi-upcoming-ships` edge function found is NOT present in our extracted
 * game data (`codex_ships`). See the edge function header for the matching
 * heuristic — the client just renders what the diff returned.
 */
export interface UpcomingShip {
  id: string;
  name: string;
  manufacturer: string | null;
  manufacturerCode: string | null;
  productionStatus: string | null;
  type: string | null;
  focus: string | null;
  rsiUrl: string | null;
  thumbnail: string | null;
  /** RSI marks it flight-ready yet the game-data diff still missed it (name gap or just-released). */
  flightReadyButMissing: boolean;
}

export interface UpcomingShipsCounts {
  total: number;
  concept: number;
  flightReadyMissing: number;
  rsiTotal: number;
  gameNames: number;
}

export interface UpcomingShipsFeed {
  ships: UpcomingShip[];
  counts: UpcomingShipsCounts | null;
  fetchedAt: string;
}

@Injectable({ providedIn: 'root' })
export class UpcomingShipsService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/rsi-upcoming-ships`;

  readonly feed = signal<UpcomingShipsFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Concept ships (RSI still building them) first, then flight-ready-but-missing. */
  readonly concept = computed(() => this.feed()?.ships.filter((s) => !s.flightReadyButMissing) ?? []);
  readonly flightReadyMissing = computed(
    () => this.feed()?.ships.filter((s) => s.flightReadyButMissing) ?? [],
  );

  private refreshSeq = 0;

  async refresh(silent = false): Promise<void> {
    const seq = ++this.refreshSeq;
    if (!silent) this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.http.get<UpcomingShipsFeed>(this.endpoint));
      if (seq !== this.refreshSeq) return;
      this.feed.set(data);
    } catch (err) {
      if (seq !== this.refreshSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      if (seq === this.refreshSeq) this.loading.set(false);
    }
  }
}
