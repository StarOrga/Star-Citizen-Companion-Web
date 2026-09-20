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
  // ── wave 1.5 (redteam blocker 4 / should-fix G) — populated only by
  // adoptSharedLoadout()/refreshFollowedLoadout(), never by a plain row read
  // (mapHangarShipConfig defaults all four to null; `profiles` has no
  // general read path so these come back through the SECURITY DEFINER RPCs
  // instead). ──────────────────────────────────────────────────────────────
  /** Resolved display name of `ownerUserId`, from the adopt/refresh RPC. */
  ownerName: string | null;
  /** The OWNER config's `updated_at` at adopt/refresh time — loadoutVariantHint uses this, never the follower row's own updatedAt (every pull bumps that). */
  ownerUpdatedAt: string | null;
  /** The patch channel this row was shared/adopted at (fixed at adopt time). */
  sharedChannel: string | null;
  /** The patch version this row was shared/adopted at (fixed at adopt time). */
  sharedPatchVersion: string | null;
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
  /** wave 1.5 (user decision 1): revoke = stop new adoptions only, never a DELETE. */
  revokedAt: string | null;
  createdAt: string;
}

/**
 * Read-only preview of a shared loadout via its token, for an anonymous (not
 * signed-in) recipient — {@link HangarService.peekSharedLoadout}, wave 1.5
 * user decision 3. Adopting into the hangar still requires sign-in.
 */
export interface PeekedSharedLoadout {
  shipClassName: string;
  loadout: ConfigLoadoutEntry[];
  name: string;
  role: ShipConfigRole | null;
  channel: string;
  patchVersion: string;
  ownerName: string | null;
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
    // wave 1.5 (redteam note): every pull bumps the follower row's OWN
    // updatedAt, so that column can never drive "verwaltet von <owner>"'s
    // timestamp — use the owner config's updatedAt from the adopt/refresh
    // RPC. Falls back to the follower row's own updatedAt only when the RPC
    // has not populated it yet (e.g. between adopt and the first refresh).
    return {
      kind: 'managedByOwner',
      updatedAt: config.ownerUpdatedAt ?? config.updatedAt,
      ownerUserId: config.ownerUserId,
    };
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
    // A plain table row never carries these — only the adopt/refresh RPC
    // responses do. Callers that have a fresher value merge it on top.
    ownerName: null,
    ownerUpdatedAt: null,
    sharedChannel: (r['shared_channel'] as string | null) ?? null,
    sharedPatchVersion: (r['shared_patch_version'] as string | null) ?? null,
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
    revokedAt: (r['revoked_at'] as string | null) ?? null,
    createdAt: (r['created_at'] as string) ?? '',
  };
}

export function mapPeekedSharedLoadout(r: Record<string, unknown>): PeekedSharedLoadout {
  return {
    shipClassName: (r['ship_class_name'] as string) ?? '',
    loadout: Array.isArray(r['loadout']) ? (r['loadout'] as unknown as ConfigLoadoutEntry[]) : [],
    name: (r['name'] as string) ?? '',
    role: (r['role'] as ShipConfigRole | null) ?? null,
    channel: (r['channel'] as string) ?? '',
    patchVersion: (r['patch_version'] as string) ?? '',
    ownerName: (r['owner_name'] as string | null) ?? null,
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
