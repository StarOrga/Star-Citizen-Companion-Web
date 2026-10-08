import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { toErrorKey } from '../core/describe-error';
import { HangarService } from '../hangar/hangar.service';
import { HangarShip, HangarShipConfig } from '../hangar/hangar.types';

/** One saved variant (config) of a hangar ship, as the ownership index lists it. */
export interface HqConfigRef {
  id: string;
  name: string;
  active: boolean;
}

/** One place a piece is fitted: a port of a saved ship variant. */
export interface HqEquippedRef {
  hangarShipId: string;
  shipClassName: string;
  /** The user's own name for the ship (`customName`); null = use the catalog name. */
  shipName: string | null;
  configId: string;
  configName: string;
  portName: string;
}

/** One personal FPS/role set a piece is part of. */
export interface HqSetRef {
  setId: string;
  setName: string;
}

/**
 * Everything personal the user has for one codex class name. `ship` is set
 * when the class is a ship in the hangar (any status — owned and wishlist,
 * the same rule the codex "in hangar" checks use today).
 */
export interface HqOwnership {
  ship: HangarShip | null;
  configs: HqConfigRef[];
  equippedOn: HqEquippedRef[];
  inSets: HqSetRef[];
}

interface ConfigCache {
  userId: string;
  configs: HangarShipConfig[];
}

const key = (className: string): string => className.trim().toLowerCase();

/**
 * Read-only ownership index for HQ: "what of this codex entity do I have, and
 * where?". Built on top of HangarService — ships and sets come from its live
 * signals, configs (all ships at once) are read here, once per user.
 *
 * Keys are lower-cased class names, so a codex slug and a stored class name
 * match regardless of case.
 */
@Injectable({ providedIn: 'root' })
export class HqOwnershipService {
  private readonly hangar = inject(HangarService);
  private readonly auth = inject(AuthService);

  private readonly configCache = signal<ConfigCache | null>(null);
  private inFlight: Promise<void> | null = null;
  private loadedFor: string | null = null;

  /** i18n key of the last failed load, never raw text. */
  readonly error = signal<string | null>(null);
  /** True once ships, sets and configs are loaded for the current user. */
  readonly loaded = signal(false);

  /** Configs of the CURRENT user only — a session swap never leaks the previous user's. */
  readonly configs = computed<HangarShipConfig[]>(() => {
    const cache = this.configCache();
    const uid = this.auth.user()?.id ?? null;
    return cache && cache.userId === uid ? cache.configs : [];
  });

  /** Map<classNameLower, HqOwnership>. */
  readonly index = computed<Map<string, HqOwnership>>(() => {
    const map = new Map<string, HqOwnership>();
    const entry = (className: string): HqOwnership => {
      const k = key(className);
      let e = map.get(k);
      if (!e) {
        e = { ship: null, configs: [], equippedOn: [], inSets: [] };
        map.set(k, e);
      }
      return e;
    };

    const shipsById = new Map<string, HangarShip>();
    for (const ship of this.hangar.ships()) {
      shipsById.set(ship.id, ship);
      entry(ship.shipClassName).ship = ship;
    }

    for (const config of this.configs()) {
      const ship = shipsById.get(config.hangarShipId);
      if (!ship) continue; // config of a ship that left the hangar
      entry(ship.shipClassName).configs.push({ id: config.id, name: config.name, active: config.isActive });
      for (const fit of config.loadout ?? []) {
        if (!fit?.className) continue;
        entry(fit.className).equippedOn.push({
          hangarShipId: ship.id,
          shipClassName: ship.shipClassName,
          shipName: ship.customName,
          configId: config.id,
          configName: config.name,
          portName: fit.portName,
        });
      }
    }

    for (const set of this.hangar.roleLoadouts()) {
      const seen = new Set<string>();
      for (const item of set.items ?? []) {
        if (!item?.className) continue;
        const k = key(item.className);
        if (seen.has(k)) continue;
        seen.add(k);
        entry(item.className).inSets.push({ setId: set.id, setName: set.name });
      }
    }

    // The active variant first, then the hangar's own order (newest edit first).
    for (const e of map.values()) e.configs.sort((a, b) => Number(b.active) - Number(a.active));
    return map;
  });

  /** Set of lower-cased class names of every hangar ship (list/search badges). */
  readonly shipClassNames = computed<Set<string>>(() => {
    const out = new Set<string>();
    for (const [k, e] of this.index()) if (e.ship) out.add(k);
    return out;
  });

  /**
   * Load ships, sets and all configs for the signed-in user. Idempotent:
   * a second call for the same user resolves without a query; concurrent
   * callers share one round trip. Signed out = resolves empty. Failures land
   * in `error` (the index then shows what is there) and never throw.
   */
  ensureLoaded(): Promise<void> {
    const uid = this.auth.user()?.id ?? null;
    if (!uid) return Promise.resolve();
    if (this.loadedFor === uid) return Promise.resolve();
    if (!this.inFlight) {
      this.inFlight = this.load(uid).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /**
   * Mark the index stale after a save elsewhere (new variant, changed fit,
   * set edit). Ships and sets are live HangarService signals; the configs are
   * re-read here — at once if the index was loaded before, else on the next
   * `ensureLoaded()`.
   */
  invalidate(): void {
    const wasLoaded = this.loadedFor !== null;
    this.loadedFor = null;
    this.loaded.set(false);
    if (wasLoaded) void this.ensureLoaded();
  }

  /** Ownership of one class name, or null when the user has nothing of it. */
  lookup(className: string | null | undefined): HqOwnership | null {
    if (!className) return null;
    return this.index().get(key(className)) ?? null;
  }

  /** Reactive variant of {@link lookup} for templates / computeds. */
  ownership(className: string | null | undefined): Signal<HqOwnership | null> {
    return computed(() => this.lookup(className));
  }

  /** Is this ship class in the hangar (any status)? */
  ownsShip(className: string | null | undefined): boolean {
    return !!this.lookup(className)?.ship;
  }

  /** The hangar ship for a class name, or null. */
  shipFor(className: string | null | undefined): HangarShip | null {
    return this.lookup(className)?.ship ?? null;
  }

  /** One config of the current user by id (from the loaded set), or null. */
  configById(id: string | null | undefined): HangarShipConfig | null {
    if (!id) return null;
    return this.configs().find((c) => c.id === id) ?? null;
  }

  /** All configs of one hangar ship, active first. */
  configsForShip(hangarShipId: string): HangarShipConfig[] {
    return this.configs()
      .filter((c) => c.hangarShipId === hangarShipId)
      .sort((a, b) => Number(b.isActive) - Number(a.isActive));
  }

  private async load(uid: string): Promise<void> {
    this.error.set(null);
    try {
      // HangarService has no "loaded" flag; an empty store means not loaded
      // (or truly empty — then this one extra round trip happens once per user).
      if (this.hangar.ships().length === 0 && this.hangar.roleLoadouts().length === 0) {
        await this.hangar.loadAll();
      }
      const configs = await this.hangar.listAllConfigs();
      if ((this.auth.user()?.id ?? null) !== uid) return; // session swapped mid-load
      this.configCache.set({ userId: uid, configs });
      this.loadedFor = uid;
      this.loaded.set(true);
    } catch (err) {
      this.error.set(toErrorKey('hq', 'ensureLoaded', err));
    }
  }
}
