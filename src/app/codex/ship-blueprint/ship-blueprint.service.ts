import { Injectable, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../../core/supabase.client';
import { logWarn } from '../../core/log';
import { environment } from '../../../environments/environment';
import { shipSkinsBase } from '../ship-skins.service';
import { type BlueprintLod, type ShipBlueprint, parseShipBlueprint } from './ship-blueprint.model';

/**
 * Dev-only fixture override: set `localStorage['sc.shipBlueprints.devBase']` to
 * a folder URL holding `ship_blueprints.json` (rows of `ship_id`,
 * `blueprint_path`, `blueprint_icon_path`) and the SVG files those paths name.
 * Ignored in production builds.
 */
export const BLUEPRINT_DEV_BASE_KEY = 'sc.shipBlueprints.devBase';

/** Where one ship's two drawings live (absolute URLs). */
export interface BlueprintUrls {
  full: string | null;
  icon: string | null;
}

/** The slice of the supabase query builder this service uses (the columns are newer than database.types). */
interface IndexQuery {
  select(cols: string): IndexQuery;
  not(col: string, op: string, v: null): PromiseLike<{ data: unknown[] | null; error: unknown }>;
}

const PATH = /^_blueprints\/[0-9a-f]{64}\.svg$/;

/**
 * Which ships have a blueprint, and the parsed drawings.
 *
 * One small read of `ship_skins_index` per session answers "has a drawing?"
 * for every search row and tile at once, so a ship without one never costs a
 * request. Drawings are content-addressed (immutable), so each URL is fetched
 * and parsed once per session. Every failure degrades to "no drawing": the
 * callers then keep the look they had before blueprints existed.
 */
@Injectable({ providedIn: 'root' })
export class ShipBlueprintService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly base: string = this.devBase() ?? shipSkinsBase(environment.assets?.r2BaseUrl);
  private readonly isDev = this.base !== shipSkinsBase(environment.assets?.r2BaseUrl);

  /** Lower-cased ship id -> URLs; null until the index has loaded. */
  private readonly index = signal<ReadonlyMap<string, BlueprintUrls> | null>(null);
  private loading: Promise<void> | null = null;
  private readonly drawings = new Map<string, Promise<ShipBlueprint | null>>();

  private devBase(): string | null {
    if (environment.production) return null;
    try {
      const v = localStorage.getItem(BLUEPRINT_DEV_BASE_KEY)?.trim();
      return v ? (v.endsWith('/') ? v : `${v}/`) : null;
    } catch {
      return null;
    }
  }

  /**
   * Loads the index once per session; concurrent callers share the request.
   * A failure counts as "no drawings" for the session: dozens of tiles mount at
   * once, and each retrying would hammer a backend that just said no (or a
   * database the migration has not reached yet).
   */
  load(): Promise<void> {
    if (this.index()) return Promise.resolve();
    this.loading ??= this.readIndex()
      .catch((err: unknown) => {
        logWarn('ship-blueprint', 'index read failed', err);
        return new Map<string, BlueprintUrls>();
      })
      .then((rows) => this.index.set(rows));
    return this.loading;
  }

  private async readIndex(): Promise<Map<string, BlueprintUrls>> {
    let raw: unknown[];
    if (this.isDev) {
      const res = await fetch(`${this.base}ship_blueprints.json`);
      if (!res.ok) throw new Error(`fixture index ${res.status}`);
      raw = (await res.json()) as unknown[];
    } else {
      const q = (this.sb.client as unknown as { from(t: string): IndexQuery })
        .from('ship_skins_index')
        .select('ship_id, blueprint_path, blueprint_icon_path');
      const { data, error } = await q.not('blueprint_icon_path', 'is', null);
      if (error) throw error;
      raw = data ?? [];
    }
    const map = new Map<string, BlueprintUrls>();
    for (const r of raw) {
      const row = r as { ship_id?: unknown; blueprint_path?: unknown; blueprint_icon_path?: unknown };
      if (typeof row.ship_id !== 'string' || !row.ship_id) continue;
      const url = (p: unknown): string | null => (typeof p === 'string' && PATH.test(p) ? this.base + p : null);
      const urls = { full: url(row.blueprint_path), icon: url(row.blueprint_icon_path) };
      if (urls.full || urls.icon) map.set(row.ship_id.toLowerCase(), urls);
    }
    return map;
  }

  /** The ship's drawing URLs; null when it has none or the index is not loaded yet. Reactive. */
  urls(shipId: string | null | undefined): BlueprintUrls | null {
    if (!shipId) return null;
    return this.index()?.get(shipId.toLowerCase()) ?? null;
  }

  /** True once the index answered (with or without this ship). Reactive. */
  readonly ready = (): boolean => this.index() !== null;

  /** One parsed drawing of a ship; null = none / unreadable. */
  drawing(shipId: string | null | undefined, lod: BlueprintLod): Promise<ShipBlueprint | null> {
    const url = this.urls(shipId)?.[lod] ?? null;
    return url ? this.fetchDrawing(url, lod) : Promise.resolve(null);
  }

  private fetchDrawing(url: string, lod: BlueprintLod): Promise<ShipBlueprint | null> {
    let hit = this.drawings.get(url);
    if (!hit) {
      hit = fetch(url)
        .then(async (res) => {
          if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
          const bp = parseShipBlueprint(await res.text());
          if (bp?.lod !== lod) logWarn('ship-blueprint', 'unreadable drawing', { url });
          return bp?.lod === lod ? bp : null;
        })
        .catch((err: unknown) => {
          // A transient failure may be retried by the next view that asks.
          this.drawings.delete(url);
          logWarn('ship-blueprint', 'drawing failed', { url, err });
          return null;
        });
      this.drawings.set(url, hit);
    }
    return hit;
  }
}
