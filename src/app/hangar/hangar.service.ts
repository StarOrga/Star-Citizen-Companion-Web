import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientProvider } from '../core/supabase.client';
import {
  ConfigLoadoutEntry,
  HangarRoleLoadout,
  HangarRoleLoadoutRow,
  HangarShip,
  HangarShipConfig,
  HangarShipConfigRow,
  HangarShipRow,
  HangarShipStatus,
  RoleLoadoutItem,
  RoleLoadoutRole,
  ShipConfigRole,
  mapHangarRoleLoadout,
  mapHangarShip,
  mapHangarShipConfig,
} from './hangar.types';

/**
 * CRUD + signal store for the personal hangar (hangar_ships,
 * hangar_ship_configs, hangar_role_loadouts — all RLS self-only).
 * Catalog lookups stay in CodexService; this service never touches codex_*.
 */
@Injectable({ providedIn: 'root' })
export class HangarService {
  private readonly sb = inject(SupabaseClientProvider);
  private readonly auth = inject(AuthService);

  readonly ships = signal<HangarShip[]>([]);
  readonly roleLoadouts = signal<HangarRoleLoadout[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Flagship = the user's single pinned "standard ship" (a ship class name),
  // driving the Codex Bridge hero. Persisted per-user in localStorage.
  //
  // TODO(flagship-persistence): promote this to a server-side column (e.g. a
  // jsonb `preferences` on `profiles`, or a `hangar_ships.is_flagship` flag)
  // once a schema migration is scheduled — that also unlocks cross-device sync.
  // Until then localStorage keeps Slice 2 frontend-only (no DB migration).
  readonly flagshipClassName = signal<string | null>(null);

  constructor() {
    this.flagshipClassName.set(this.readFlagship());
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

  /** Loads ships + role loadouts in one go. Errors land in `error`. */
  async loadAll(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [shipsRes, loadoutsRes] = await Promise.all([
        this.sb.client
          .from('hangar_ships')
          .select('*')
          .order('pinned_rank', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false }),
        this.sb.client
          .from('hangar_role_loadouts')
          .select('*')
          .order('updated_at', { ascending: false }),
      ]);
      if (shipsRes.error) throw shipsRes.error;
      if (loadoutsRes.error) throw loadoutsRes.error;
      this.ships.set(((shipsRes.data ?? []) as HangarShipRow[]).map(mapHangarShip));
      this.roleLoadouts.set(
        ((loadoutsRes.data ?? []) as HangarRoleLoadoutRow[]).map(mapHangarRoleLoadout),
      );
      // Re-hydrate the flagship now the user id is guaranteed available (the
      // constructor may have run before auth resolved). localStorage-keyed.
      this.flagshipClassName.set(this.readFlagship());
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
    return ship;
  }

  shipByClassName(shipClassName: string): HangarShip | null {
    return this.ships().find((s) => s.shipClassName === shipClassName) ?? null;
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
   * value, so writing it is inherently exclusive. Persisted per-user in
   * localStorage; survives reload (see the flagshipClassName field's TODO).
   */
  setFlagship(shipClassName: string | null): void {
    this.flagshipClassName.set(shipClassName);
    this.writeFlagship(shipClassName);
  }

  /** Toggle: pin if not the flagship, clear if it already is (single flagship). */
  toggleFlagship(shipClassName: string): void {
    this.setFlagship(this.isFlagship(shipClassName) ? null : shipClassName);
  }

  private flagshipKey(): string | null {
    const uid = this.userId;
    return uid ? `sc.hangar.flagship.${uid}` : null;
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
    return mapHangarShipConfig(data as HangarShipConfigRow);
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
}
