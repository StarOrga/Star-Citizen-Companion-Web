import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { ConsentService } from '../core/consent.service';

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

/**
 * What the user saw the last time the upcoming list was acknowledged:
 * ship id → production status. Statuses ride along so a favorited ship that
 * flips `in-concept` → `flight-ready` can be reported as an update, not just
 * as "still there".
 */
export type UpcomingBaseline = Record<string, string>;

/** New-since-last-look, split into "added" and "a favorite changed status". */
export interface UpcomingDiff {
  added: UpcomingShip[];
  favoriteUpdates: UpcomingShip[];
}

const FAVORITES_STORAGE_KEY = 'sc-companion.upcoming.favorites';
const BASELINE_STORAGE_KEY = 'sc-companion.upcoming.baseline';

/** Snapshot the feed for the "what did the user already see" baseline. */
export function snapshotOf(ships: readonly UpcomingShip[]): UpcomingBaseline {
  const out: UpcomingBaseline = {};
  for (const s of ships) out[s.id] = s.productionStatus ?? '';
  return out;
}

/**
 * Diff the current feed against the last acknowledged baseline.
 *
 * `added` = ships the baseline never contained. `favoriteUpdates` = favorited
 * ships that existed before but whose RSI production status moved. A ship can
 * only appear in one bucket (an added ship is reported as added even when the
 * user already favorited it — the star badge carries that nuance in the UI).
 * A `null` baseline means "no baseline yet" → nothing is new, which is what
 * seeds a first-time visitor instead of drowning them in ~60 notifications.
 */
export function diffUpcoming(
  ships: readonly UpcomingShip[],
  baseline: UpcomingBaseline | null,
  favorites: ReadonlySet<string>,
): UpcomingDiff {
  if (!baseline) return { added: [], favoriteUpdates: [] };
  const added: UpcomingShip[] = [];
  const favoriteUpdates: UpcomingShip[] = [];
  for (const ship of ships) {
    const known = Object.prototype.hasOwnProperty.call(baseline, ship.id);
    if (!known) {
      added.push(ship);
      continue;
    }
    if (favorites.has(ship.id) && baseline[ship.id] !== (ship.productionStatus ?? '')) {
      favoriteUpdates.push(ship);
    }
  }
  return { added, favoriteUpdates };
}

/**
 * Client-side search over the already-loaded card metadata. Every whitespace
 * separated token must match somewhere (AND), so "drake conc" narrows instead
 * of widening. Case- and diacritic-insensitive.
 */
export function matchesUpcomingQuery(ship: UpcomingShip, query: string): boolean {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalize(
    [ship.name, ship.manufacturer, ship.manufacturerCode, ship.type, ship.focus, ship.productionStatus]
      .filter(Boolean)
      .join(' '),
  );
  return tokens.every((t) => haystack.includes(t));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable({ providedIn: 'root' })
export class UpcomingShipsService {
  private readonly http = inject(HttpClient);
  private readonly consent = inject(ConsentService);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/rsi-upcoming-ships`;

  readonly feed = signal<UpcomingShipsFeed | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Free-text filter for the list view; empty string = show everything. */
  readonly query = signal('');
  /** When true the list shows only favorited ships. */
  readonly favoritesOnly = signal(false);

  /** Favorited ship ids, persisted in localStorage (preference category). */
  readonly favoriteIds = signal<ReadonlySet<string>>(this.loadFavoritesFromStorage());
  readonly favoriteCount = computed(() => {
    const f = this.feed();
    const favs = this.favoriteIds();
    return f ? f.ships.filter((s) => favs.has(s.id)).length : 0;
  });

  /** Last acknowledged snapshot; `null` until the first feed seeds it. */
  private readonly baseline = signal<UpcomingBaseline | null>(this.loadBaselineFromStorage());

  private readonly visible = computed(() => {
    const ships = this.feed()?.ships ?? [];
    const favs = this.favoriteIds();
    const q = this.query();
    const onlyFavs = this.favoritesOnly();
    return ships.filter((s) => (!onlyFavs || favs.has(s.id)) && matchesUpcomingQuery(s, q));
  });

  /** Concept ships (RSI still building them) first, then flight-ready-but-missing. */
  readonly concept = computed(() => this.visible().filter((s) => !s.flightReadyButMissing));
  readonly flightReadyMissing = computed(() => this.visible().filter((s) => s.flightReadyButMissing));

  /** How many ships the current search/favorites filter hides. */
  readonly filteredOut = computed(() => (this.feed()?.ships.length ?? 0) - this.visible().length);

  /** New ships + favorites whose status moved, since the last acknowledge. */
  readonly diff = computed<UpcomingDiff>(() =>
    diffUpcoming(this.feed()?.ships ?? [], this.baseline(), this.favoriteIds()),
  );
  readonly newIds = computed(() => new Set(this.diff().added.map((s) => s.id)));
  readonly notificationCount = computed(() => {
    const d = this.diff();
    return d.added.length + d.favoriteUpdates.length;
  });

  private refreshSeq = 0;

  async refresh(silent = false): Promise<void> {
    const seq = ++this.refreshSeq;
    if (!silent) this.loading.set(true);
    this.error.set(null);
    try {
      const data = await firstValueFrom(this.http.get<UpcomingShipsFeed>(this.endpoint));
      if (seq !== this.refreshSeq) return;
      this.feed.set(data);
      // First feed ever seen on this device: seed the baseline silently so the
      // very first visit doesn't announce the whole matrix as "new".
      if (this.baseline() === null) this.setBaseline(snapshotOf(data.ships));
    } catch (err) {
      if (seq !== this.refreshSeq) return;
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      if (seq === this.refreshSeq) this.loading.set(false);
    }
  }

  isFavorite(id: string): boolean {
    return this.favoriteIds().has(id);
  }

  /** Toggle a ship favorite; persisted across sessions. */
  toggleFavorite(id: string): void {
    const next = new Set(this.favoriteIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.favoriteIds.set(next);
    this.persistFavorites(next);
    // Never strand the user on an empty favorites-only list.
    if (this.favoritesOnly() && next.size === 0) this.favoritesOnly.set(false);
  }

  toggleFavoritesOnly(): void {
    this.favoritesOnly.update((v) => !v);
  }

  clearQuery(): void {
    this.query.set('');
  }

  /** Mark the current feed as seen — clears the "new ships" notification. */
  acknowledge(): void {
    const f = this.feed();
    if (!f) return;
    this.setBaseline(snapshotOf(f.ships));
  }

  private setBaseline(next: UpcomingBaseline): void {
    this.baseline.set(next);
    this.persistBaseline(next);
  }

  private loadFavoritesFromStorage(): ReadonlySet<string> {
    if (typeof localStorage === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? new Set(arr.filter((x): x is string => typeof x === 'string')) : new Set();
    } catch {
      return new Set();
    }
  }

  private persistFavorites(set: ReadonlySet<string>): void {
    // Preference-category storage is opt-in (#130) — skip until allowed.
    if (!this.consent.preferencesAllowed()) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(set)));
    } catch { /* quota / private mode */ }
  }

  private loadBaselineFromStorage(): UpcomingBaseline | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const out: UpcomingBaseline = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = typeof v === 'string' ? v : '';
      }
      return out;
    } catch {
      return null;
    }
  }

  private persistBaseline(baseline: UpcomingBaseline): void {
    if (!this.consent.preferencesAllowed()) return;
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(baseline));
    } catch { /* quota / private mode */ }
  }
}
