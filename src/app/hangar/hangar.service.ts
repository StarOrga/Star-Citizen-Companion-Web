import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { AnalyticsService } from '../core/analytics.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import { normalizeRsiPledgeShipUrl } from '../core/rsi-pledge-link.util';
// One normalizer for "is this the same ship name", shared with the RSI
// ship-matrix feed: the announced-ship page looks a concept-wishlist row up by
// name, and two slightly different spellings of that rule would silently show
// "not watched" for a ship the user just added.
import { normalizeShipName } from '../codex/upcoming-ships.service';
import {
  ConceptShip,
  ConfigLoadoutEntry,
  HangarRoleLoadout,
  HangarRoleLoadoutRow,
  HangarShareLink,
  HangarShip,
  HangarShipConfig,
  HangarShipConfigRow,
  HangarShipRow,
  HangarShipStatus,
  PeekedSharedLoadout,
  RoleLoadoutItem,
  RoleLoadoutRole,
  ShipConfigRole,
  mapConceptShip,
  mapHangarRoleLoadout,
  mapHangarShareLink,
  mapHangarShip,
  mapHangarShipConfig,
  mapPeekedSharedLoadout,
} from './hangar.types';

/** Mirrors the `hangar_concept_ships.name` length CHECK (migration 20260711001000). */
const CONCEPT_NAME_MAX = 80;

/**
 * "Recently chosen" facility (codex landing redesign, HangarPicker fly-out —
 * `implement-brief.md` §17): the top 3 ships/sets the user picked, most recent
 * first. Local-only preference data, same class of storage as `flagshipKey`
 * below (no `ConsentService` gate — this mirrors the existing flagship cache,
 * not the `preferencesAllowed()`-gated favorites in `upcoming-ships.service.ts`).
 */
const RECENT_MAX = 3;
const RECENT_SHIPS_KEY = 'sc-companion.hangar.recentShipClassNames';
const RECENT_SETS_KEY = 'sc-companion.hangar.recentSetIds';

/**
 * CRUD + signal store for the personal hangar (hangar_ships,
 * hangar_ship_configs, hangar_role_loadouts — all RLS self-only).
 * Catalog lookups stay in CodexService; this service never touches codex_*.
 */
@Injectable({ providedIn: 'root' })
export class HangarService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);

  readonly ships = signal<HangarShip[]>([]);
  readonly roleLoadouts = signal<HangarRoleLoadout[]>([]);
  // Concept-ship wishlist (#135) — separate table, no catalog linkage.
  readonly conceptShips = signal<ConceptShip[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Concept-wishlist load state, so the Codex can ask for it standalone
  // (`ensureConceptShipsLoaded`) without re-fetching what `loadAll` already
  // has. Keyed by user id, never a bare boolean: a session swap inside one
  // tab would otherwise leave the next user looking at the previous one's
  // watchlist and a cache flag that says "already loaded".
  private conceptsLoadedFor: string | null = null;
  private conceptsInFlight: Promise<void> | null = null;

  // Flagship = the user's single pinned "standard ship" (a ship class name),
  // driving the Codex Bridge hero. Source of truth is
  // profiles.flagship_ship_class (migration 20260705140500 — cross-device);
  // localStorage stays as the offline cache and as the one-time migration
  // source for pins made before the column existed.
  readonly flagshipClassName = signal<string | null>(null);

  // "Recently chosen" — ordered ids, most recent first, persisted below.
  private readonly recentShipClassNames = signal<string[]>(
    this.readRecentIds(RECENT_SHIPS_KEY),
  );
  private readonly recentSetIds = signal<string[]>(this.readRecentIds(RECENT_SETS_KEY));

  constructor() {
    this.flagshipClassName.set(this.readFlagship());
  }

  /**
   * Top 3 recently picked ships, most recent first. Falls back to the first 3
   * hangar ships (in `ships()` order) when nothing was picked yet, so the
   * HangarPicker fly-out is never empty for a first-time visitor with ships
   * already in the hangar.
   */
  readonly recentShips = computed<HangarShip[]>(() => {
    const byClass = new Map(this.ships().map((s) => [s.shipClassName, s]));
    const picked = this.recentShipClassNames()
      .map((className) => byClass.get(className))
      .filter((s): s is HangarShip => !!s)
      .slice(0, RECENT_MAX);
    return picked.length > 0 ? picked : this.ships().slice(0, RECENT_MAX);
  });

  /** Same as {@link recentShips}, for role loadouts ("sets"). */
  readonly recentSets = computed<HangarRoleLoadout[]>(() => {
    const byId = new Map(this.roleLoadouts().map((l) => [l.id, l]));
    const picked = this.recentSetIds()
      .map((id) => byId.get(id))
      .filter((l): l is HangarRoleLoadout => !!l)
      .slice(0, RECENT_MAX);
    return picked.length > 0 ? picked : this.roleLoadouts().slice(0, RECENT_MAX);
  });

  /** Record a ship pick, moving it to the front of the recent list (dedup). */
  markShipPicked(shipClassName: string): void {
    if (!shipClassName) return;
    const next = [shipClassName, ...this.recentShipClassNames().filter((c) => c !== shipClassName)].slice(
      0,
      RECENT_MAX,
    );
    this.recentShipClassNames.set(next);
    this.writeRecentIds(RECENT_SHIPS_KEY, next);
  }

  /** Record a set (role loadout) pick, moving it to the front of the recent list (dedup). */
  markSetPicked(setId: string): void {
    if (!setId) return;
    const next = [setId, ...this.recentSetIds().filter((id) => id !== setId)].slice(0, RECENT_MAX);
    this.recentSetIds.set(next);
    this.writeRecentIds(RECENT_SETS_KEY, next);
  }

  private readRecentIds(key: string): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
    } catch {
      return [];
    }
  }

  private writeRecentIds(key: string, ids: string[]): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, JSON.stringify(ids));
    } catch {
      // quota / private mode — the in-memory signal still drives this session.
    }
  }

  readonly pinnedShips = computed(() =>
    this.ships()
      .filter((s) => s.pinnedRank !== null)
      .sort((a, b) => (a.pinnedRank ?? 9) - (b.pinnedRank ?? 9)),
  );
  readonly ownedCount = computed(() => this.ships().filter((s) => s.status === 'owned').length);
  readonly wishlistCount = computed(
    () => this.ships().filter((s) => s.status === 'wishlist').length,
  );

  private get userId(): string | null {
    return this.auth.user()?.id ?? null;
  }

  private loadAllInFlight: Promise<void> | null = null;

  /** Loads ships + role loadouts in one go. Errors land in `error`. Concurrent
   * callers (a page's own load + a dependent lookup) share one round trip. */
  loadAll(): Promise<void> {
    if (!this.loadAllInFlight) {
      this.loadAllInFlight = this.loadAllOnce().finally(() => {
        this.loadAllInFlight = null;
      });
    }
    return this.loadAllInFlight;
  }

  private async loadAllOnce(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [shipsRes, loadoutsRes, conceptsRes] = await Promise.all([
        this.sb.client
          .from('hangar_ships')
          .select('*')
          .order('pinned_rank', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false }),
        this.sb.client
          .from('hangar_role_loadouts')
          .select('*')
          .order('updated_at', { ascending: false }),
        this.sb.client
          .from('hangar_concept_ships')
          .select('*')
          .order('created_at', { ascending: false }),
      ]);
      if (shipsRes.error) throw shipsRes.error;
      if (loadoutsRes.error) throw loadoutsRes.error;
      this.ships.set(((shipsRes.data ?? []) as HangarShipRow[]).map(mapHangarShip));
      this.roleLoadouts.set(
        ((loadoutsRes.data ?? []) as HangarRoleLoadoutRow[]).map(mapHangarRoleLoadout),
      );
      // Best-effort: the concept table ships later than the others (migration
      // 20260711001000) — a missing relation must not break the hangar.
      if (!conceptsRes.error) {
        this.conceptShips.set(
          ((conceptsRes.data ?? []) as Record<string, unknown>[]).map(mapConceptShip),
        );
        this.conceptsLoadedFor = this.userId;
      }
      // Sync the flagship now the user id is guaranteed available (the
      // constructor may have run before auth resolved). DB-first, see below.
      await this.syncFlagship();
    } catch (err) {
      this.error.set((err as Error).message ?? 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }

  // ── ships ──────────────────────────────────────────────────────────────────

  async addShip(
    shipClassName: string,
    status: HangarShipStatus = 'owned',
  ): Promise<HangarShip | null> {
    const userId = this.userId;
    if (!userId) return null;
    const { data, error } = await this.sb.client
      .from('hangar_ships')
      .insert({ user_id: userId, ship_class_name: shipClassName, status })
      .select('*')
      .single();
    if (error) {
      // 23505 = duplicate (user_id, ship_class_name) — the ship is already in
      // the hangar; surface it as a no-op rather than an error.
      if ((error as { code?: string }).code === '23505') return this.shipByClassName(shipClassName);
      this.error.set(error.message);
      return null;
    }
    const ship = mapHangarShip(data as HangarShipRow);
    this.ships.set([ship, ...this.ships()]);
    this.analytics.capture('hangar_ship_added', {
      ship_class: shipClassName,
      status,
      ship_count: this.ships().length,
    });
    return ship;
  }

  shipByClassName(shipClassName: string): HangarShip | null {
    return this.ships().find((s) => s.shipClassName === shipClassName) ?? null;
  }

  // ── concept-ship wishlist (#135) ────────────────────────────────────────────

  /**
   * Load JUST the concept-ship wishlist, once per session.
   *
   * The Codex's announced-ship page needs the watch state ("is this already on
   * my fleet list?") without dragging the whole hangar — ships, role loadouts
   * and the flagship sync — behind it. Idempotent and dedupes concurrent
   * callers; `loadAll` flips the same flag, so the two never fetch twice.
   */
  ensureConceptShipsLoaded(): Promise<void> {
    const userId = this.userId;
    if (userId && this.conceptsLoadedFor === userId) return Promise.resolve();
    if (!this.conceptsInFlight) {
      this.conceptsInFlight = this.loadConceptShips().finally(() => {
        this.conceptsInFlight = null;
      });
    }
    return this.conceptsInFlight;
  }

  private async loadConceptShips(): Promise<void> {
    if (!this.userId) return;
    const { data, error } = await this.sb.client
      .from('hangar_concept_ships')
      .select('*')
      .order('created_at', { ascending: false });
    // Best-effort like `loadAll`: this runs on a Codex page, and a missing
    // relation or an RLS miss must degrade to "not watched", never to an error
    // banner on a page that is really about the ship.
    if (error) return;
    this.conceptShips.set(((data ?? []) as Record<string, unknown>[]).map(mapConceptShip));
    this.conceptsLoadedFor = this.userId;
  }

  /**
   * The wishlist row for a ship NAME, compared the way the RSI feed normalizes
   * names. Backs the announced-ship page's watch toggle, where the only stable
   * handle between the matrix entry and the (catalog-less) wishlist row is the
   * name itself.
   */
  conceptShipByName(name: string | null | undefined): ConceptShip | null {
    const norm = normalizeShipName(name ?? '');
    if (!norm) return null;
    return this.conceptShips().find((c) => normalizeShipName(c.name) === norm) ?? null;
  }

  async addConceptShip(input: {
    name: string;
    manufacturer?: string;
    rsiUrl?: string;
    notes?: string;
  }): Promise<ConceptShip | null> {
    const userId = this.userId;
    // The column CHECKs `length(trim(name)) between 1 and 80`; clamp here so a
    // long matrix name comes back as a wishlist entry instead of a raw 23514.
    const name = input.name.trim().slice(0, CONCEPT_NAME_MAX);
    if (!userId || !name) return null;
    const { data, error } = await this.sb.client
      .from('hangar_concept_ships')
      .insert({
        user_id: userId,
        name,
        manufacturer: input.manufacturer?.trim() || null,
        // Defence in depth (feedback f7d3bd9a): a concept-ship link is
        // user-supplied and later rendered as an href, so only an official RSI
        // pledge-ship URL is ever persisted. The form rejects a bad paste with a
        // visible error first; anything that still gets here is stripped to
        // null, and the DB CHECK is the gate neither layer can bypass.
        rsi_url: normalizeRsiPledgeShipUrl(input.rsiUrl),
        notes: input.notes?.trim() || null,
      })
      .select('*')
      .single();
    if (error) {
      // 23505 = duplicate (user_id, name) — already wishlisted, no-op.
      if ((error as { code?: string }).code === '23505') {
        return this.conceptShips().find((c) => c.name === name) ?? this.conceptShipByName(name);
      }
      this.error.set(error.message);
      return null;
    }
    const concept = mapConceptShip(data as Record<string, unknown>);
    this.conceptShips.set([concept, ...this.conceptShips()]);
    this.analytics.capture('hangar_concept_ship_added', {
      has_rsi_url: !!normalizeRsiPledgeShipUrl(input.rsiUrl),
    });
    return concept;
  }

  async removeConceptShip(id: string): Promise<boolean> {
    const { error } = await this.sb.client.from('hangar_concept_ships').delete().eq('id', id);
    if (error) {
      this.error.set(error.message);
      return false;
    }
    this.conceptShips.set(this.conceptShips().filter((c) => c.id !== id));
    return true;
  }

  shipById(id: string): HangarShip | null {
    return this.ships().find((s) => s.id === id) ?? null;
  }

  async getShip(id: string): Promise<HangarShip | null> {
    const cached = this.shipById(id);
    if (cached) return cached;
    const { data, error } = await this.sb.client
      .from('hangar_ships')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapHangarShip(data as HangarShipRow);
  }

  async updateShip(
    id: string,
    patch: Partial<{
      customName: string | null;
      status: HangarShipStatus;
      selectedSkinId: string | null;
      notes: string | null;
    }>,
  ): Promise<boolean> {
    const update: Record<string, unknown> = {};
    if ('customName' in patch) update['custom_name'] = patch.customName;
    if ('status' in patch) update['status'] = patch.status;
    if ('selectedSkinId' in patch) update['selected_skin_id'] = patch.selectedSkinId;
    if ('notes' in patch) update['notes'] = patch.notes;
    const { data, error } = await this.sb.client
      .from('hangar_ships')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return false;
    }
    this.replaceShip(mapHangarShip(data as HangarShipRow));
    return true;
  }

  /**
   * Pin a ship to a top-3 slot (rank 1..3) or unpin (rank null).
   * The previous occupant of the slot is unpinned first — two sequential
   * updates instead of a transaction; acceptable for single-user data
   * (worst case on abort: one slot temporarily empty, never two occupants).
   */
  async pinShip(id: string, rank: 1 | 2 | 3 | null): Promise<boolean> {
    if (rank !== null) {
      const occupant = this.ships().find((s) => s.pinnedRank === rank && s.id !== id);
      if (occupant) {
        const { error: clearErr } = await this.sb.client
          .from('hangar_ships')
          .update({ pinned_rank: null })
          .eq('id', occupant.id);
        if (clearErr) {
          this.error.set(clearErr.message);
          return false;
        }
        this.replaceShip({ ...occupant, pinnedRank: null });
      }
    }
    const { data, error } = await this.sb.client
      .from('hangar_ships')
      .update({ pinned_rank: rank })
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return false;
    }
    this.replaceShip(mapHangarShip(data as HangarShipRow));
    return true;
  }

  async removeShip(id: string): Promise<boolean> {
    const removed = this.shipById(id);
    const { error } = await this.sb.client.from('hangar_ships').delete().eq('id', id);
    if (error) {
      this.error.set(error.message);
      return false;
    }
    this.ships.set(this.ships().filter((s) => s.id !== id));
    // Clear the flagship if the removed ship was it — never point at a gone ship.
    if (removed && this.flagshipClassName() === removed.shipClassName) {
      this.setFlagship(null);
    }
    if (removed) {
      this.analytics.capture('hangar_ship_removed', {
        ship_class: removed.shipClassName,
        status: removed.status,
        ship_count: this.ships().length,
      });
    }
    return true;
  }

  // ── flagship (pinned standard ship) ──────────────────────────────────────────

  /** Is this ship class the user's current flagship? */
  isFlagship(shipClassName: string): boolean {
    return this.flagshipClassName() === shipClassName;
  }

  /**
   * Designate exactly ONE ship class as the flagship (or clear with null).
   * Pinning a new flagship un-pins the previous — the signal holds a single
   * value, so writing it is inherently exclusive. Written through to
   * profiles.flagship_ship_class (cross-device) and mirrored to localStorage
   * (offline cache); the signal drives the UI synchronously either way.
   */
  setFlagship(shipClassName: string | null): void {
    this.flagshipClassName.set(shipClassName);
    this.writeFlagship(shipClassName);
    void this.persistFlagshipRemote(shipClassName);
    if (shipClassName) {
      this.analytics.capture('hangar_flagship_set', { ship_class: shipClassName });
    }
  }

  /** Toggle: pin if not the flagship, clear if it already is (single flagship). */
  toggleFlagship(shipClassName: string): void {
    this.setFlagship(this.isFlagship(shipClassName) ? null : shipClassName);
  }

  /**
   * Hydrate the flagship: the profile column is the source of truth. A
   * device-local pin from before the column existed is promoted to the DB
   * exactly once (per-device marker) — afterwards a remote NULL means
   * "cleared" and wins over any stale local cache.
   */
  private async syncFlagship(): Promise<void> {
    const userId = this.userId;
    if (!userId) {
      this.flagshipClassName.set(this.readFlagship());
      return;
    }
    try {
      // profiles.flagship_ship_class postdates the generated database.types —
      // untyped access, same pattern as the blueprint queries in CodexService.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = this.sb.client as any;
      const { data, error } = await sb
        .from('profiles')
        .select('flagship_ship_class')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      const remote = (data?.['flagship_ship_class'] as string | null) ?? null;
      const local = this.readFlagship();
      if (!remote && local && !this.flagshipMigrated()) {
        // One-time promotion of the pre-column local pin.
        this.flagshipClassName.set(local);
        void this.persistFlagshipRemote(local);
      } else {
        this.flagshipClassName.set(remote);
        this.writeFlagship(remote);
      }
      this.markFlagshipMigrated();
    } catch {
      // Offline / stubbed client — the local cache still drives this session.
      this.flagshipClassName.set(this.readFlagship());
    }
  }

  /** Write-through to profiles.flagship_ship_class. Failures degrade to local-only. */
  private async persistFlagshipRemote(shipClassName: string | null): Promise<void> {
    const userId = this.userId;
    if (!userId) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = this.sb.client as any;
      const { error } = await sb
        .from('profiles')
        .update({ flagship_ship_class: shipClassName })
        .eq('id', userId);
      if (error) this.error.set(error.message);
    } catch {
      // Offline / stubbed client — localStorage keeps the pin; the next
      // syncFlagship() with a live client reconciles.
    }
  }

  private flagshipKey(): string | null {
    const uid = this.userId;
    return uid ? `sc.hangar.flagship.${uid}` : null;
  }

  private migratedKey(): string | null {
    const uid = this.userId;
    return uid ? `sc.hangar.flagship.migrated.${uid}` : null;
  }

  private flagshipMigrated(): boolean {
    const key = this.migratedKey();
    if (!key || typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private markFlagshipMigrated(): void {
    const key = this.migratedKey();
    if (!key || typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(key, '1');
    } catch {
      // best-effort marker — a re-promotion attempt is harmless (idempotent write)
    }
  }

  private readFlagship(): string | null {
    const key = this.flagshipKey();
    if (!key || typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeFlagship(shipClassName: string | null): void {
    const key = this.flagshipKey();
    if (!key || typeof localStorage === 'undefined') return;
    try {
      if (shipClassName) localStorage.setItem(key, shipClassName);
      else localStorage.removeItem(key);
    } catch {
      // localStorage may be unavailable (private mode, quota) — degrade to
      // in-memory only; the signal still drives the current session.
    }
  }

  private replaceShip(ship: HangarShip): void {
    this.ships.set(this.ships().map((s) => (s.id === ship.id ? ship : s)));
  }

  // ── ship configs ───────────────────────────────────────────────────────────

  async listConfigs(hangarShipId: string): Promise<HangarShipConfig[]> {
    const { data, error } = await this.sb.client
      .from('hangar_ship_configs')
      .select('*')
      .eq('hangar_ship_id', hangarShipId)
      .order('updated_at', { ascending: false });
    if (error) {
      this.error.set(error.message);
      return [];
    }
    return ((data ?? []) as HangarShipConfigRow[]).map(mapHangarShipConfig);
  }

  async createConfig(
    hangarShipId: string,
    name: string,
    role: ShipConfigRole,
    loadout: ConfigLoadoutEntry[] = [],
  ): Promise<HangarShipConfig | null> {
    const userId = this.userId;
    if (!userId) return null;
    const { data, error } = await this.sb.client
      .from('hangar_ship_configs')
      .insert({
        user_id: userId,
        hangar_ship_id: hangarShipId,
        name,
        role,
        loadout: loadout as unknown as never[],
      })
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return null;
    }
    return mapHangarShipConfig(data as HangarShipConfigRow);
  }

  async updateConfig(
    id: string,
    patch: Partial<{ name: string; role: ShipConfigRole; loadout: ConfigLoadoutEntry[] }>,
  ): Promise<HangarShipConfig | null> {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update['name'] = patch.name;
    if (patch.role !== undefined) update['role'] = patch.role;
    if (patch.loadout !== undefined) update['loadout'] = patch.loadout;
    const { data, error } = await this.sb.client
      .from('hangar_ship_configs')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return null;
    }
    const config = mapHangarShipConfig(data as HangarShipConfigRow);
    this.analytics.capture('hangar_ship_config_saved', { role: config.role });
    return config;
  }

  /**
   * Activate one config of a ship (deactivates the previous active one first —
   * required by the one-active partial unique index).
   */
  async activateConfig(id: string, hangarShipId: string): Promise<boolean> {
    const { error: clearErr } = await this.sb.client
      .from('hangar_ship_configs')
      .update({ is_active: false })
      .eq('hangar_ship_id', hangarShipId)
      .eq('is_active', true);
    if (clearErr) {
      this.error.set(clearErr.message);
      return false;
    }
    const { error } = await this.sb.client
      .from('hangar_ship_configs')
      .update({ is_active: true })
      .eq('id', id);
    if (error) {
      this.error.set(error.message);
      return false;
    }
    return true;
  }

  async deleteConfig(id: string): Promise<boolean> {
    const { error } = await this.sb.client.from('hangar_ship_configs').delete().eq('id', id);
    if (error) {
      this.error.set(error.message);
      return false;
    }
    return true;
  }

  // ── role loadouts ──────────────────────────────────────────────────────────

  async createRoleLoadout(
    name: string,
    role: RoleLoadoutRole,
    items: RoleLoadoutItem[] = [],
  ): Promise<HangarRoleLoadout | null> {
    const userId = this.userId;
    if (!userId) return null;
    const { data, error } = await this.sb.client
      .from('hangar_role_loadouts')
      .insert({ user_id: userId, name, role, items: items as unknown as never[] })
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return null;
    }
    const loadout = mapHangarRoleLoadout(data as HangarRoleLoadoutRow);
    this.roleLoadouts.set([loadout, ...this.roleLoadouts()]);
    this.analytics.capture('hangar_loadout_created', { role });
    return loadout;
  }

  async getRoleLoadout(id: string): Promise<HangarRoleLoadout | null> {
    const cached = this.roleLoadouts().find((l) => l.id === id);
    if (cached) return cached;
    const { data, error } = await this.sb.client
      .from('hangar_role_loadouts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    return mapHangarRoleLoadout(data as HangarRoleLoadoutRow);
  }

  async updateRoleLoadout(
    id: string,
    patch: Partial<{ name: string; items: RoleLoadoutItem[] }>,
  ): Promise<HangarRoleLoadout | null> {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update['name'] = patch.name;
    if (patch.items !== undefined) update['items'] = patch.items;
    const { data, error } = await this.sb.client
      .from('hangar_role_loadouts')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return null;
    }
    const loadout = mapHangarRoleLoadout(data as HangarRoleLoadoutRow);
    this.roleLoadouts.set(this.roleLoadouts().map((l) => (l.id === loadout.id ? loadout : l)));
    return loadout;
  }

  async deleteRoleLoadout(id: string): Promise<boolean> {
    const { error } = await this.sb.client.from('hangar_role_loadouts').delete().eq('id', id);
    if (error) {
      this.error.set(error.message);
      return false;
    }
    this.roleLoadouts.set(this.roleLoadouts().filter((l) => l.id !== id));
    return true;
  }

  // ── loadout sharing (migration 20260920160000, concept it.2/it.3/it.6) ────
  // "Follow" copy model: a recipient's config starts out live-following the
  // owner's; the first edit forks it, irreversibly (s3-follow/s3-fork rules).

  /**
   * Share a config's CURRENT loadout as a token. `channel`/`patchVersion`
   * come from the caller (CodexService.build()) — this service never reads
   * codex_* directly (contract note in hangar.types.ts).
   */
  async createShareLink(
    config: HangarShipConfig,
    shipClassName: string,
    channel: string,
    patchVersion: string,
    expiresAt: string | null = null,
  ): Promise<HangarShareLink | null> {
    const userId = this.userId;
    if (!userId) return null;
    const { data, error } = await this.sb.client
      .from('hangar_share_links')
      .insert({
        created_by: userId,
        ship_class_name: shipClassName,
        channel,
        patch_version: patchVersion,
        loadout: config.loadout as unknown as never[],
        config_name: config.name,
        role: config.role,
        source_config_id: config.id,
        expires_at: expiresAt,
      })
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return null;
    }
    return mapHangarShareLink(data as Record<string, unknown>);
  }

  /**
   * Revoke a share link the caller owns (self-only RLS enforces ownership).
   * wave 1.5 (user decision 1): revoke = stop new adoptions only, never a
   * DELETE — existing followers keep following via `source_config_id` until
   * the owner deletes the source config. `hangar_share_links_revoke_guard`
   * (migration) only accepts a null->timestamp write to this one column.
   */
  async revokeShareLink(id: string): Promise<boolean> {
    const { error } = await this.sb.client
      .from('hangar_share_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) {
      this.error.set(error.message);
      return false;
    }
    return true;
  }

  /**
   * Turn a share token into a following config in the CALLER's hangar (adds
   * the ship to their hangar if it is not already there, or returns the
   * existing follow on a re-adopt). Runs through the `adopt_shared_loadout`
   * SECURITY DEFINER RPC — the recipient never reads `hangar_share_links` or
   * the owner's `hangar_ship_configs` row directly. The RPC also resolves
   * the owner's display name (`profiles` is self-read only) and the share's
   * channel/patch context, merged onto the returned config (wave 1.5
   * blocker 4 / should-fix E).
   */
  async adoptSharedLoadout(token: string): Promise<HangarShipConfig | null> {
    const { data, error } = await this.sb.client.rpc('adopt_shared_loadout', { p_token: token });
    if (error || !data) {
      this.error.set(error?.message ?? 'adopt_failed');
      return null;
    }
    const result = data as {
      configId: string | null;
      ownerName: string | null;
      ownerUserId: string | null;
      ownerUpdatedAt: string | null;
      channel: string | null;
      patchVersion: string | null;
    };
    if (!result.configId) {
      this.error.set('adopt_failed');
      return null;
    }
    const { data: row, error: readErr } = await this.sb.client
      .from('hangar_ship_configs')
      .select('*')
      .eq('id', result.configId)
      .maybeSingle();
    if (readErr || !row) {
      this.error.set(readErr?.message ?? 'adopt_failed');
      return null;
    }
    const config = mapHangarShipConfig(row as HangarShipConfigRow & Record<string, unknown>);
    return {
      ...config,
      ownerName: result.ownerName,
      ownerUpdatedAt: result.ownerUpdatedAt,
      sharedChannel: result.channel ?? config.sharedChannel,
      sharedPatchVersion: result.patchVersion ?? config.sharedPatchVersion,
    };
  }

  /**
   * Pull the owner's CURRENT loadout into a still-following config, via the
   * `hangar_follow_snapshot` RPC. The RPC performs the follower's own
   * sync-write itself (through the trusted internal-write path, so the
   * migration's share-guard trigger does not mistake this pull for the
   * recipient's own edit and auto-fork it — see the migration comment).
   * Returns `null` — and leaves the config untouched — once the copy has
   * forked, the owner's config is gone, or the owner is suspended; the
   * caller then simply keeps showing what it already has. The follow-up
   * read still carries `.eq('follows_owner', true)` as a belt-and-braces
   * guard against a concurrent fork racing this call.
   */
  async refreshFollowedLoadout(configId: string): Promise<HangarShipConfig | null> {
    const { data, error } = await this.sb.client.rpc('hangar_follow_snapshot', {
      p_config_id: configId,
    });
    if (error || !data) return null;
    const snapshot = data as {
      ownerName: string | null;
      ownerUserId: string | null;
      ownerUpdatedAt: string | null;
      channel: string | null;
      patchVersion: string | null;
    };
    const { data: row, error: readErr } = await this.sb.client
      .from('hangar_ship_configs')
      .select('*')
      .eq('id', configId)
      .eq('follows_owner', true)
      .maybeSingle();
    if (readErr || !row) return null;
    const config = mapHangarShipConfig(row as HangarShipConfigRow & Record<string, unknown>);
    return {
      ...config,
      ownerName: snapshot.ownerName,
      ownerUpdatedAt: snapshot.ownerUpdatedAt,
      sharedChannel: snapshot.channel ?? config.sharedChannel,
      sharedPatchVersion: snapshot.patchVersion ?? config.sharedPatchVersion,
    };
  }

  /**
   * Read-only preview of a shared loadout via its token, for a recipient who
   * is not signed in — wave 1.5 user decision 3. Adopting into the hangar
   * (persisting a following config) still requires {@link adoptSharedLoadout}
   * and therefore a session.
   */
  async peekSharedLoadout(token: string): Promise<PeekedSharedLoadout | null> {
    const { data, error } = await this.sb.client
      .rpc('peek_shared_loadout', { p_token: token })
      .maybeSingle();
    if (error || !data) return null;
    return mapPeekedSharedLoadout(data as Record<string, unknown>);
  }

  /**
   * The recipient's first own edit to a followed config: flips
   * `follows_owner` off (irreversibly — s3-fork) and stamps `forked_at`.
   * `patch` carries the actual edit (name/role/loadout) in the SAME write so
   * the fork and the edit that triggered it land in one row version.
   */
  async forkFollowedLoadout(
    id: string,
    patch: Partial<{ name: string; role: ShipConfigRole; loadout: ConfigLoadoutEntry[] }>,
  ): Promise<HangarShipConfig | null> {
    const update: Record<string, unknown> = { follows_owner: false, forked_at: new Date().toISOString() };
    if (patch.name !== undefined) update['name'] = patch.name;
    if (patch.role !== undefined) update['role'] = patch.role;
    if (patch.loadout !== undefined) update['loadout'] = patch.loadout;
    const { data, error } = await this.sb.client
      .from('hangar_ship_configs')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) {
      this.error.set(error.message);
      return null;
    }
    return mapHangarShipConfig(data as HangarShipConfigRow & Record<string, unknown>);
  }
}
