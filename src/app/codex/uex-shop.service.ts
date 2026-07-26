import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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

const MIN_CONTAINS_LEN = 4;
const MAX_RESULTS = 12;

function normalizeName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
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

  /**
   * Resolve purchase options for a codex FPS armor piece or personal weapon.
   * Returns [] when the entity has no mapped UEX category, no name match, or
   * any upstream call fails — never throws.
   */
  async whereToBuy(query: WhereToBuyQuery): Promise<BuyOption[]> {
    try {
      const categoryId = this.resolveCategoryId(query);
      if (categoryId == null) return [];

      const items = await this.getCategoryItems(categoryId);
      const match = this.matchItem(items, query.name);
      if (!match) return [];

      const prices = await this.getItemPrices(match.id);
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
        const terminalName = terminal?.fullname || terminal?.nickname || terminal?.name || '—';
        const location = this.resolveLocationName(
          terminal ?? null,
          systems,
          planets,
          cities,
          stations,
        );
        return {
          price: p.price_buy,
          priceAvg: p.price_buy_avg ?? null,
          terminal: terminalName,
          location,
        };
      });

      options.sort((a, b) => a.price - b.price);
      return options.slice(0, MAX_RESULTS);
    } catch {
      return [];
    }
  }

  private resolveCategoryId(query: WhereToBuyQuery): number | null {
    if (query.attachType && ARMOR_CATEGORY_BY_ATTACH_TYPE[query.attachType] != null) {
      return ARMOR_CATEGORY_BY_ATTACH_TYPE[query.attachType];
    }
    if (query.weaponClass === 'FPS') {
      return query.subType === 'Gadget' ? FPS_GADGET_CATEGORY : FPS_WEAPON_CATEGORY;
    }
    return null;
  }

  private matchItem(items: UexItem[], name: string): UexItem | null {
    const target = normalizeName(name);
    if (!target) return null;
    for (const it of items) {
      if (normalizeName(it.name) === target) return it;
    }
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
      const res = await firstValueFrom(this.http.get<UexEnvelope<T>>(url));
      return Array.isArray(res?.data) ? res.data : [];
    } catch {
      return [];
    }
  }
}
