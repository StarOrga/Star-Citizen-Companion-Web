// Hangar domain interfaces — the personal layer on top of the read-only
// codex catalog (concept: docs/concepts/2026-06-13-web-hangar-redesign.md).
//
// All references into the catalog are SOFT (class_name slugs / skin_id),
// matching the DB design: catalog rows are build-scoped and replaced
// wholesale per extractor run, while hangar rows live forever.

import type { Tables } from '../core/database.types';

export type HangarShipRow = Tables<'hangar_ships'>;
export type HangarShipConfigRow = Tables<'hangar_ship_configs'>;
export type HangarRoleLoadoutRow = Tables<'hangar_role_loadouts'>;

export type HangarShipStatus = 'owned' | 'wishlist';

export const SHIP_CONFIG_ROLES = [
  'combat',
  'mining',
  'salvage',
  'cargo',
  'exploration',
  'racing',
  'medical',
  'multipurpose',
] as const;
export type ShipConfigRole = (typeof SHIP_CONFIG_ROLES)[number];

export const ROLE_LOADOUT_ROLES = ['fps', 'mining', 'salvage', 'medical', 'engineering'] as const;
export type RoleLoadoutRole = (typeof ROLE_LOADOUT_ROLES)[number];

/** One port→item assignment inside a ship config's loadout JSONB. */
export interface ConfigLoadoutEntry {
  portName: string;
  className: string;
  /** codex kind of the assigned entity (weapon/component/item) — display hint. */
  kind: string;
}

/** One slot→item assignment inside a role loadout's items JSONB. */
export interface RoleLoadoutItem {
  slot: string;
  className: string | null; // null = slot intentionally empty
  kind: string | null;
}

/** Suggested slot labels per role — the editor seeds these, users may add more. */
export const ROLE_SLOT_SUGGESTIONS: Record<RoleLoadoutRole, string[]> = {
  fps: ['primary', 'secondary', 'sidearm', 'helmet', 'core', 'arms', 'legs', 'undersuit', 'backpack'],
  mining: ['multitool', 'mining-attachment', 'gadget', 'helmet', 'core', 'backpack'],
  salvage: ['multitool', 'salvage-attachment', 'tractor', 'helmet', 'core', 'backpack'],
  medical: ['medgun', 'multitool', 'medpen', 'helmet', 'core', 'backpack'],
  engineering: ['multitool', 'repair-attachment', 'tractor', 'helmet', 'core', 'backpack'],
};

export interface HangarShip {
  id: string;
  shipClassName: string;
  customName: string | null;
  status: HangarShipStatus;
  pinnedRank: number | null;
  selectedSkinId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HangarShipConfig {
  id: string;
  hangarShipId: string;
  name: string;
  role: ShipConfigRole;
  loadout: ConfigLoadoutEntry[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HangarRoleLoadout {
  id: string;
  name: string;
  role: RoleLoadoutRole;
  items: RoleLoadoutItem[];
  createdAt: string;
  updatedAt: string;
}

// ── row → domain mappers ──────────────────────────────────────────────────────

export function mapHangarShip(r: HangarShipRow): HangarShip {
  return {
    id: r.id,
    shipClassName: r.ship_class_name,
    customName: r.custom_name,
    status: (r.status as HangarShipStatus) ?? 'owned',
    pinnedRank: r.pinned_rank,
    selectedSkinId: r.selected_skin_id,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapHangarShipConfig(r: HangarShipConfigRow): HangarShipConfig {
  return {
    id: r.id,
    hangarShipId: r.hangar_ship_id,
    name: r.name,
    role: (r.role as ShipConfigRole) ?? 'multipurpose',
    loadout: Array.isArray(r.loadout) ? (r.loadout as unknown as ConfigLoadoutEntry[]) : [],
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function mapHangarRoleLoadout(r: HangarRoleLoadoutRow): HangarRoleLoadout {
  return {
    id: r.id,
    name: r.name,
    role: (r.role as RoleLoadoutRole) ?? 'fps',
    items: Array.isArray(r.items) ? (r.items as unknown as RoleLoadoutItem[]) : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
