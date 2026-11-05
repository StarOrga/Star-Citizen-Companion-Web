import { logWarn } from '../core/log';
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * "Where to buy" (#254/#255): resolve a codex FPS armor piece or personal
 * weapon to real in-game purchase locations via the `uex-proxy` edge function
 * (server-side UEX Corp token, see supabase/functions/uex-proxy). UEX's item
 * `uuid` namespace does not line up with our codex classNames, so matching is
 * done by NAME within a category-scoped UEX item list (same normalization
 * heuristic as `rsi-upcoming-ships`: NFKD, strip diacritics + non-alphanumerics,
 * lowercase; exact match, else "contains" above a minimum length).
 *
 * Everything here is best-effort: any upstream failure yields an empty result
 * instead of throwing, so a flaky third-party API never breaks the detail page.
 */

export interface BuyOption {
  price: number;
  priceAvg: number | null;
  terminal: string;
  location: string;
  /** The parts of `location`, for callers that place the shop on a map. */
  system?: string | null;
  planet?: string | null;
  /** Station, city or (failing both) planet. */
  place?: string | null;
}

export interface WhereToBuyQuery {
  name: string;
  attachType?: string | null;
  weaponClass?: string | null;
  subType?: string | null;
}

interface UexEnvelope<T> {
  status?: string;
  http_code?: number;
  data?: T[];
}

interface UexItem {
  id: number;
  id_category: number;
  name: string;
}

/** A UEX ship (`vehicles`): `uuid` is the game's entity GUID. */
interface UexVehicle {
  id: number;
  name: string;
  name_full: string | null;
  uuid: string | null;
}

/** An in-game ship purchase price (`vehicles_purchases_prices`). */
interface UexVehiclePrice {
  id_vehicle: number;
  id_terminal: number;
  price_buy: number;
  price_buy_avg: number | null;
}

/**
 * The codex keeps a ship's GUID in CryEngine word order; UEX prints the same
 * 16 bytes as a standard UUID. Codex `4cb14f49-a874-6135-2b1f-99e58157299f`
 * = UEX `6135a874-4cb1-4f49-9f29-5781e5991f2b` (verified on the 100i): the
 * first three groups swap, the last 8 bytes are reversed. '' for a malformed GUID.
 */
export function codexGuidToUexUuid(guid: string | null | undefined): string {
  const m = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/.exec((guid ?? '').trim().toLowerCase());
  if (!m) return '';
  const tail = (m[4] + m[5]).match(/../g)!.reverse().join('');
  return `${m[3]}${m[2]}-${m[1].slice(0, 4)}-${m[1].slice(4)}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** The ship to look up: the game GUID (matches UEX `uuid`) and the English name as fallback. */
export interface WhereToBuyShipQuery {
  guid?: string | null;
  name: string;
}

interface UexItemPrice {
  id_item: number;
  id_terminal: number;
  id_star_system: number | null;
  id_planet: number | null;
  id_city: number | null;
  price_buy: number;
  price_buy_avg: number | null;
}

interface UexTerminal {
  id: number;
  name: string | null;
  fullname: string | null;
  nickname: string | null;
  id_star_system: number | null;
  id_planet: number | null;
  id_city: number | null;
  id_space_station: number | null;
}

interface UexNamed {
  id: number;
  name: string;
}

// Codex FPS armor `attach_type` / weapon `weapon_class`+`sub_type` → UEX item
// `id_category`. Anything not mapped here simply yields no results (empty
// panel), which is the correct "we don't know" state rather than a guess.
const ARMOR_CATEGORY_BY_ATTACH_TYPE: Record<string, number> = {
  Char_Armor_Helmet: 3,
  Char_Armor_Torso: 5,
  Char_Armor_Arms: 1,
  Char_Armor_Legs: 4,
  Char_Armor_Backpack: 2,
  Char_Armor_Undersuit: 24,
};

const FPS_GADGET_CATEGORY = 28; // Gadgets
const FPS_WEAPON_CATEGORY = 18; // Personal Weapons

// Where a codex kind can live in the UEX catalog (`categories`), for a lookup that only knows the
// kind and the name. Missiles (34) sit under every kind: the codex files them differently per build.
const CATEGORIES_BY_KIND: Readonly<Record<string, readonly number[]>> = {
  weapon: [18, 28, 17, 32, 33, 34, 35, 70, 79, 90],
  component: [19, 21, 22, 23, 26, 29, 30, 31, 33, 34, 67, 83, 86, 110],
  item: [1, 2, 3, 4, 5, 7, 16, 17, 24, 28, 34, 64, 65, 69],
  ammunition: [34, 70],
};

const MIN_CONTAINS_LEN = 4;
const MAX_RESULTS = 12;

function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Word tokens for subset matching: our localized names often carry an extra
// livery/paint word the bare UEX name lacks (our `Pyro RYT "Hurston" Multi-Tool`
// vs UEX `Pyro RYT Multi-Tool`), which defeats a plain substring compare. Tokens
// ≥2 chars drop noise like the "S" in "S-38".
function tokenize(raw: string): string[] {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

@Injectable({ providedIn: 'root' })
export class UexShopService {
  private readonly http = inject(HttpClient);
  private readonly endpoint = `${environment.supabase.url}/functions/v1/uex-proxy`;

  // In-memory, tab-lifetime caches — UEX category lists and reference tables
  // change rarely, and this feature can be opened repeatedly per session.
  private readonly categoryItemsCache = new Map<number, Promise<UexItem[]>>();
  private terminalsCache: Promise<Map<number, UexTerminal>> | null = null;
  private starSystemsCache: Promise<Map<number, string>> | null = null;
  private planetsCache: Promise<Map<number, string>> | null = null;
  private citiesCache: Promise<Map<number, string>> | null = null;
  private spaceStationsCache: Promise<Map<number, string>> | null = null;
  private vehiclesCache: Promise<UexVehicle[]> | null = null;

  /**
   * Bezugsquelle for a ship (#832): where it is sold in game (UEX
   * `vehicles_purchases_prices`). Matched by the game GUID first (UEX keeps
   * it as `uuid`), then by the English full name like items. Returns [] when
   * UEX does not know the ship or it is not sold anywhere — never throws.
   */
  async whereToBuyShip(query: WhereToBuyShipQuery, limit = MAX_RESULTS): Promise<BuyOption[]> {
    try {
      if (!this.vehiclesCache) this.vehiclesCache = this.fetchList<UexVehicle>('vehicles');
      const vehicles = await this.vehiclesCache;
      const guids = new Set([(query.guid ?? '').trim().toLowerCase(), codexGuidToUexUuid(query.guid)].filter(Boolean));
      const byGuid = guids.size ? vehicles.find((v) => guids.has((v.uuid ?? '').toLowerCase())) : undefined;
      const match =
        byGuid ??
        this.matchItem(vehicles.map((v) => ({ id: v.id, id_category: 0, name: v.name_full || v.name })), query.name);
      if (!match) return [];
      const prices = await this.fetchList<UexVehiclePrice>('vehicles_purchases_prices', { id_vehicle: String(match.id) });
      return await this.toOptions(prices, limit);
    } catch (error) {
      logWarn('uex-shop', 'where to buy ship failed', { query, error });
      return [];
    }
  }

  /**
   * Bezugsquelle for any codex entity known by kind and ENGLISH name: searches every UEX category
   * that kind can live in. [] when nothing matches or UEX fails, never throws.
   */
  async whereToBuyEntity(kind: string, name: string): Promise<BuyOption[]> {
    try {
      const categoryIds = CATEGORIES_BY_KIND[kind] ?? [];
      if (categoryIds.length === 0) return [];
      const lists = await Promise.all(categoryIds.map((id) => this.getCategoryItems(id)));
      const match = this.matchItem(lists.flat(), name);
      if (!match) return [];
      // Uncapped: the caller wants the nearest shop, and the cheapest 12 can all be in another system.
      return await this.toOptions(await this.getItemPrices(match.id), Infinity);
    } catch (error) {
      logWarn('uex-shop', 'where to buy entity failed', { kind, name, error });
      return [];
    }
  }

  /** Buyable prices → sorted, capped options with terminal + location names. */
  private async toOptions(
    prices: readonly { id_terminal: number; price_buy: number; price_buy_avg: number | null }[],
    limit = MAX_RESULTS,
  ): Promise<BuyOption[]> {
    const buyable = prices.filter((p) => p.price_buy > 0);
    if (buyable.length === 0) return [];
    const [terminals, systems, planets, cities, stations] = await Promise.all([
      this.getTerminals(),
      this.getStarSystems(),
      this.getPlanets(),
      this.getCities(),
      this.getSpaceStations(),
    ]);
    const options: BuyOption[] = buyable.map((p) => {
      const terminal = terminals.get(p.id_terminal);
      const planet = terminal?.id_planet != null ? (planets.get(terminal.id_planet) ?? null) : null;
      const local =
        (terminal?.id_space_station != null ? stations.get(terminal.id_space_station) : null) ||
        (terminal?.id_city != null ? cities.get(terminal.id_city) : null) ||
        planet;
      return {
        system: terminal?.id_star_system != null ? (systems.get(terminal.id_star_system) ?? null) : null,
        planet,
        place: local ?? null,
        price: p.price_buy,
        priceAvg: p.price_buy_avg ?? null,
        terminal: terminal?.fullname || terminal?.nickname || terminal?.name || '—',
        location: this.resolveLocationName(terminal ?? null, systems, planets, cities, stations),
      };
    });
    options.sort((a, b) => a.price - b.price);
    return options.slice(0, limit);
  }

  /**
   * Resolve purchase options for a codex FPS armor piece or personal weapon.
   * Returns [] when the entity has no mapped UEX category, no name match, or
   * any upstream call fails — never throws.
   */
  async whereToBuy(query: WhereToBuyQuery): Promise<BuyOption[]> {
    try {
      const categoryIds = this.resolveCategoryIds(query);
      if (categoryIds.length === 0) return [];

      // Search across every candidate UEX category (FPS weapons/tools are split
      // across "Personal Weapons" and "Gadgets" upstream) and match across the
      // union.
      const lists = await Promise.all(categoryIds.map((id) => this.getCategoryItems(id)));
      const match = this.matchItem(lists.flat(), query.name);
      if (!match) return [];

      return await this.toOptions(await this.getItemPrices(match.id));
    } catch (error) {
      logWarn('uex-shop', 'where to buy failed', { query, error });
      return [];
    }
  }

  private resolveCategoryIds(query: WhereToBuyQuery): number[] {
    if (query.attachType && ARMOR_CATEGORY_BY_ATTACH_TYPE[query.attachType] != null) {
      return [ARMOR_CATEGORY_BY_ATTACH_TYPE[query.attachType]];
    }
    if (query.weaponClass === 'FPS') {
      // Our `sub_type` split (weapon vs Gadget) does not line up with UEX's, so
      // search both "Personal Weapons" and "Gadgets" — e.g. multi-tools carry
      // sub_type 'Gadget' for us but live under Personal Weapons at UEX.
      return [FPS_WEAPON_CATEGORY, FPS_GADGET_CATEGORY];
    }
    return [];
  }

  private matchItem(items: UexItem[], name: string): UexItem | null {
    const target = normalizeName(name);
    if (!target) return null;

    // 1. Exact normalized-name match wins outright.
    for (const it of items) {
      if (normalizeName(it.name) === target) return it;
    }

    // 2. Token-subset: the UEX name's tokens are all present in ours (our name
    //    carries extra livery/paint words). Pick the MOST specific such item —
    //    the one sharing the most tokens — and require ≥2 shared tokens so a
    //    lone generic word ("pistol", "helmet") can't match everything.
    const queryTokens = new Set(tokenize(name));
    if (queryTokens.size) {
      let best: UexItem | null = null;
      let bestScore = 0;
      for (const it of items) {
        const itTokens = tokenize(it.name);
        if (itTokens.length < 2) continue;
        if (!itTokens.every((t) => queryTokens.has(t))) continue;
        if (itTokens.length > bestScore) {
          bestScore = itTokens.length;
          best = it;
        }
      }
      if (best && bestScore >= 2) return best;
    }

    // 3. Substring fallback (either direction) for names with no clean tokens.
    if (target.length < MIN_CONTAINS_LEN) return null;
    for (const it of items) {
      const norm = normalizeName(it.name);
      if (norm.length < MIN_CONTAINS_LEN) continue;
      if (norm.includes(target) || target.includes(norm)) return it;
    }
    return null;
  }

  private resolveLocationName(
    terminal: UexTerminal | null,
    systems: Map<number, string>,
    planets: Map<number, string>,
    cities: Map<number, string>,
    stations: Map<number, string>,
  ): string {
    if (!terminal) return '—';
    const parts: string[] = [];
    if (terminal.id_star_system != null) {
      const s = systems.get(terminal.id_star_system);
      if (s) parts.push(s);
    }
    const station = terminal.id_space_station != null ? stations.get(terminal.id_space_station) : null;
    const city = terminal.id_city != null ? cities.get(terminal.id_city) : null;
    const planet = terminal.id_planet != null ? planets.get(terminal.id_planet) : null;
    const local = station || city || planet;
    if (local) parts.push(local);
    return parts.length > 0 ? parts.join(' · ') : '—';
  }

  // ── UEX fetch helpers (each cached; each best-effort — a failure returns an
  //    empty collection rather than propagating, so one broken lookup table
  //    doesn't sink the whole result). ──────────────────────────────────────

  private getCategoryItems(categoryId: number): Promise<UexItem[]> {
    let pending = this.categoryItemsCache.get(categoryId);
    if (!pending) {
      pending = this.fetchList<UexItem>('items', { id_category: String(categoryId) });
      this.categoryItemsCache.set(categoryId, pending);
    }
    return pending;
  }

  private async getItemPrices(itemId: number): Promise<UexItemPrice[]> {
    return this.fetchList<UexItemPrice>('items_prices', { id_item: String(itemId) });
  }

  private getTerminals(): Promise<Map<number, UexTerminal>> {
    if (!this.terminalsCache) {
      this.terminalsCache = this.fetchList<UexTerminal>('terminals').then(
        (rows) => new Map(rows.map((r) => [r.id, r])),
      );
    }
    return this.terminalsCache;
  }

  private getStarSystems(): Promise<Map<number, string>> {
    if (!this.starSystemsCache) this.starSystemsCache = this.fetchNamedMap('star_systems');
    return this.starSystemsCache;
  }

  private getPlanets(): Promise<Map<number, string>> {
    if (!this.planetsCache) this.planetsCache = this.fetchNamedMap('planets');
    return this.planetsCache;
  }

  private getCities(): Promise<Map<number, string>> {
    if (!this.citiesCache) this.citiesCache = this.fetchNamedMap('cities');
    return this.citiesCache;
  }

  private getSpaceStations(): Promise<Map<number, string>> {
    if (!this.spaceStationsCache) this.spaceStationsCache = this.fetchNamedMap('space_stations');
    return this.spaceStationsCache;
  }

  private async fetchNamedMap(resource: string): Promise<Map<number, string>> {
    const rows = await this.fetchList<UexNamed>(resource);
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private async fetchList<T>(resource: string, params: Record<string, string> = {}): Promise<T[]> {
    try {
      let url = `${this.endpoint}?resource=${encodeURIComponent(resource)}`;
      for (const [k, v] of Object.entries(params)) {
        url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
      }
      const res = await firstValueFrom(this.http.get<UexEnvelope<T>>(url).pipe(timeout(15_000)));
      return Array.isArray(res?.data) ? res.data : [];
    } catch (error) {
      logWarn('uex-shop', 'fetch failed', { resource, error });
      return [];
    }
  }
}
