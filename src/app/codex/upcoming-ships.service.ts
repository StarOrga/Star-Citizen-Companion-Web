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
  /** Best candidate; always `thumbnails[0] ?? null`. Kept for older payloads. */
  thumbnail: string | null;
  /**
   * Ordered artwork candidates. RSI advertises a fixed derivative family per
   * media entry regardless of what was actually rendered, so a listed url can
   * 404 — the UI walks this list on `<img>` error instead of collapsing to the
   * placeholder glyph after the first miss. Older payloads omit it; readers
   * must fall back to `[thumbnail]`.
   */
  thumbnails?: string[];
  /** RSI marks it flight-ready yet the game-data diff still missed it (name gap or just-released). */
  flightReadyButMissing: boolean;
}

/** RSI artwork for a ship we DO hold game data for. */
export interface RsiShipArt {
  name: string;
  rsiUrl: string | null;
  thumbnails: string[];
}

/**
 * Normalize a ship name the same way the edge function does, so a game-data
 * name resolves into the `gameShipArt` map. Lowercase, diacritics stripped,
 * everything non-alphanumeric dropped.
 */
export function normalizeShipName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Ordered artwork candidates for one upcoming ship, tolerating payloads that
 * predate `thumbnails`.
 */
export function thumbnailCandidates(ship: Pick<UpcomingShip, 'thumbnail' | 'thumbnails'>): string[] {
  if (ship.thumbnails && ship.thumbnails.length > 0) return ship.thumbnails;
  return ship.thumbnail ? [ship.thumbnail] : [];
}

/**
 * Rank of an RSI derivative for a LARGE frame (detail hero), low = better.
 *
 * RSI publishes every render under a fixed set of derivative names and the feed
 * lists them thumbnail-first, which is right for a card and wrong for a hero:
 * `store_small` is a card-sized crop and goes soft when it is blown up to the
 * full hero frame. Unknown derivatives sort in the middle so a future name is
 * still preferred over the explicitly small ones.
 */
function heroArtRank(url: string): number {
  const file = url.slice(url.lastIndexOf('/') + 1).toLowerCase();
  if (file.startsWith('store_large')) return 0;
  if (file.startsWith('post')) return 1;
  if (file.startsWith('slideshow')) return 2;
  if (file.startsWith('store_small')) return 4;
  if (file.startsWith('subscribers_vault')) return 5;
  return 3;
}

/**
 * The same candidates as `thumbnails`, reordered biggest-first for a hero
 * frame. Stable within a rank, so the feed's own order still decides between
 * two equally suitable derivatives, and nothing is ever dropped — a rejected
 * large render still falls through to the small one.
 */
export function heroArtOrder(urls: readonly string[]): string[] {
  return urls
    .map((url, index) => ({ url, index, rank: heroArtRank(url) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((e) => e.url);
}

export interface UpcomingShipsCounts {
  total: number;
  concept: number;
  flightReadyMissing: number;
  rsiTotal: number;
  gameNames: number;
  /** How many ingested game ships the RSI matrix could supply artwork for. */
  gameShipArt?: number;
}

export interface UpcomingShipsFeed {
  ships: UpcomingShip[];
  /**
   * Normalized game-ship name → RSI artwork, for the ships that ARE in our
   * game data. Present since the artwork rework; older payloads omit it.
   */
  gameShipArt?: Record<string, RsiShipArt>;
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

/**
 * How well a ship's NAME answers the query: 3 exact, 2 prefix, 1 substring,
 * 0 when only the manufacturer/role/status matched. Name matches must outrank
 * "some Drake ship" so a limited result set keeps the ship actually asked for.
 */
function nameScore(name: string, query: string): number {
  const n = normalize(name);
  if (n === query) return 3;
  if (n.startsWith(query)) return 2;
  if (n.includes(query)) return 1;
  return 0;
}

/**
 * Best `limit` announced ships for a free-text query, name matches first.
 *
 * Pure so the Codex's cross-entity search can be unit-tested without the feed:
 * it reuses `matchesUpcomingQuery` for the AND-token filter and only adds a
 * deterministic ranking on top. An empty query matches nothing here (unlike the
 * list filter, where empty means "show everything") — a search box with no
 * input must not dump the whole matrix into the Archive Terminal.
 */
export function searchUpcoming(
  ships: readonly UpcomingShip[],
  query: string,
  limit = 6,
): UpcomingShip[] {
  const q = normalize(query);
  if (!q || limit <= 0) return [];
  return ships
    .filter((s) => matchesUpcomingQuery(s, query))
    .map((s) => ({ ship: s, score: nameScore(s.name, q) }))
    .sort((a, b) => b.score - a.score || a.ship.name.localeCompare(b.ship.name))
    .slice(0, limit)
    .map((e) => e.ship);
}

/**
 * Owns the whole `rsi-upcoming-ships` feed, which carries two products of the
 * same RSI ship-matrix scrape:
 *
 *  1. the "upcoming" diff (ships RSI lists that our game data has no match for),
 *  2. `gameShipArt` — RSI artwork keyed by normalized game-ship name, used by
 *     the Codex ship cards whenever the datamined preview render is missing.
 *
 * Both consumers share this one signal so the Codex never triggers a second
 * fetch of the same (CDN-cached) payload.
 */
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
  private inFlight: Promise<void> | null = null;

  /**
   * Load the feed once per session (idempotent, dedupes concurrent callers).
   * The Codex ship grids call this purely for `gameShipArt`, so it must never
   * flip the visible `loading` flag of the upcoming list.
   */
  ensureLoaded(): Promise<void> {
    if (this.feed()) return Promise.resolve();
    if (!this.inFlight) {
      this.inFlight = this.refresh(true).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /**
   * Announced ships matching a query, loading the feed first if needed.
   *
   * Deliberately total: a feed that is empty, still loading or outright failed
   * yields an empty list, never a rejection. It backs the Codex's cross-entity
   * search, and a dead RSI proxy must degrade to "no announced ships found"
   * rather than taking the whole Archive Terminal down with it.
   */
  async searchShips(query: string, limit = 6): Promise<UpcomingShip[]> {
    if (!query.trim()) return [];
    try {
      await this.ensureLoaded();
    } catch {
      return [];
    }
    return searchUpcoming(this.feed()?.ships ?? [], query, limit);
  }

  /** Synchronous variant over the already-loaded feed; never triggers a fetch. */
  searchLoadedShips(query: string, limit = 6): UpcomingShip[] {
    return searchUpcoming(this.feed()?.ships ?? [], query, limit);
  }

  /**
   * The announced ship carrying this feed id, or `null`.
   *
   * Ids come straight from RSI's ship-matrix and fall back to the normalized
   * NAME when the matrix omits one, so a bookmarked `/codex/upcoming/:id` url
   * can outlive the id it was minted from. The normalized-name second chance
   * keeps those links resolving; `null` therefore means "genuinely gone from
   * the matrix", which the detail page renders as an honest empty state rather
   * than an error.
   */
  shipById(id: string): UpcomingShip | null {
    if (!id) return null;
    const ships = this.feed()?.ships ?? [];
    return ships.find((s) => s.id === id) ?? this.shipByName(id);
  }

  /** The announced ship whose name matches `name` (normalized), or `null`. */
  shipByName(name: string | null | undefined): UpcomingShip | null {
    const norm = normalizeShipName(name ?? '');
    if (!norm) return null;
    return (this.feed()?.ships ?? []).find((s) => normalizeShipName(s.name) === norm) ?? null;
  }

  /**
   * Ordered RSI artwork candidates for an ingested game ship, matched on its
   * localized name. Empty when the feed is not loaded yet or the matrix has no
   * counterpart — the caller keeps its own placeholder in that case.
   */
  artFor(gameName: string | null | undefined): string[] {
    if (!gameName) return [];
    const map = this.feed()?.gameShipArt;
    if (!map) return [];
    return map[normalizeShipName(gameName)]?.thumbnails ?? [];
  }

  /**
   * `artFor` for a large frame — the detail hero. Same candidates, ordered so
   * the wide store render paints first instead of the card thumbnail.
   */
  heroArtFor(gameName: string | null | undefined): string[] {
    return heroArtOrder(this.artFor(gameName));
  }

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
