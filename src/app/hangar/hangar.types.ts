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

/**
 * Wishlist entry for an unreleased/concept ship (#135). No catalog linkage —
 * the codex only knows flyable ships from the live Data.p4k — so these are
 * user-authored metadata rows, always shown with a "preliminary" badge.
 * Typed manually: the generated DB types are refreshed on db push, and this
 * table may not be in them yet.
 */
export interface ConceptShip {
  id: string;
  name: string;
  manufacturer: string | null;
  rsiUrl: string | null;
  notes: string | null;
  createdAt: string;
}

export function mapConceptShip(r: Record<string, unknown>): ConceptShip {
  return {
    id: (r['id'] as string) ?? '',
    name: (r['name'] as string) ?? '',
    manufacturer: (r['manufacturer'] as string | null) ?? null,
    rsiUrl: (r['rsi_url'] as string | null) ?? null,
    notes: (r['notes'] as string | null) ?? null,
    createdAt: (r['created_at'] as string) ?? '',
  };
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
  // ── sharing (migration 20260920160000, concept it.2/it.3/it.6) ────────────
  /** The OWNER's config this row follows/forked from. Null = never shared. */
  sourceConfigId: string | null;
  /** True while this row still live-follows sourceConfigId's owner. */
  followsOwner: boolean;
  /** auth.users.id of the sharer — frontend resolves the display name. */
  ownerUserId: string | null;
  /** When the follow link broke (recipient's first edit). Null while following. */
  forkedAt: string | null;
}

/**
 * A share token that turns into a following {@link HangarShipConfig} copy via
 * {@link HangarService.adoptSharedLoadout}. The `loadout`/`configName`/`role`
 * fields are the SNAPSHOT at share time (the recipient's starting values) —
 * the live follow afterwards reads through `sourceConfigId`, not this row.
 */
export interface HangarShareLink {
  id: string;
  token: string;
  shipClassName: string;
  channel: string;
  patchVersion: string;
  loadout: ConfigLoadoutEntry[];
  configName: string;
  role: ShipConfigRole | null;
  sourceConfigId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * The display hint for a loadout-variant row (concept it.2/it.6 hv-s4):
 * either a relative/absolute save time, or "managed by <owner>" while a
 * following copy is still live. Carries only the raw fact — the frontend
 * resolves `ownerUserId` to a display name via the existing profile lookup
 * and formats `updatedAt` itself (today/yesterday/date, per hv-s4).
 */
export interface LoadoutVariantHint {
  kind: 'savedAt' | 'managedByOwner';
  updatedAt: string;
  ownerUserId: string | null;
}

export function loadoutVariantHint(config: HangarShipConfig): LoadoutVariantHint {
  if (config.followsOwner && config.ownerUserId) {
    return { kind: 'managedByOwner', updatedAt: config.updatedAt, ownerUserId: config.ownerUserId };
  }
  return { kind: 'savedAt', updatedAt: config.updatedAt, ownerUserId: null };
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

// `HangarShipConfigRow` comes from the generated DB types, which are not
// regenerated by this migration (alpha-phase norm — see mapConceptShip
// above); the sharing columns are read via an index signature instead of a
// typed field, same pattern.
export function mapHangarShipConfig(r: HangarShipConfigRow & Record<string, unknown>): HangarShipConfig {
  return {
    id: r.id,
    hangarShipId: r.hangar_ship_id,
    name: r.name,
    role: (r.role as ShipConfigRole) ?? 'multipurpose',
    loadout: Array.isArray(r.loadout) ? (r.loadout as unknown as ConfigLoadoutEntry[]) : [],
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sourceConfigId: (r['source_config_id'] as string | null) ?? null,
    followsOwner: (r['follows_owner'] as boolean) ?? false,
    ownerUserId: (r['owner_user_id'] as string | null) ?? null,
    forkedAt: (r['forked_at'] as string | null) ?? null,
  };
}

export function mapHangarShareLink(r: Record<string, unknown>): HangarShareLink {
  return {
    id: (r['id'] as string) ?? '',
    token: (r['token'] as string) ?? '',
    shipClassName: (r['ship_class_name'] as string) ?? '',
    channel: (r['channel'] as string) ?? '',
    patchVersion: (r['patch_version'] as string) ?? '',
    loadout: Array.isArray(r['loadout']) ? (r['loadout'] as unknown as ConfigLoadoutEntry[]) : [],
    configName: (r['config_name'] as string | null) ?? '',
    role: (r['role'] as ShipConfigRole | null) ?? null,
    sourceConfigId: (r['source_config_id'] as string | null) ?? null,
    expiresAt: (r['expires_at'] as string | null) ?? null,
    createdAt: (r['created_at'] as string) ?? '',
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
