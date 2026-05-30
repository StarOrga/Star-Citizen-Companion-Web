// Codex domain interfaces — the READ shape Wave 3 consumes.
// -----------------------------------------------------------------------------
// These mirror the extractor output contract (docs/concepts/codex-extraction-
// output.md) AS STORED in the codex_* tables (migration 00008). The promoted
// columns are typed here; the heterogeneous rest lives in `payload` (the full
// per-entity JSON the extractor wrote — typed loosely as the *Payload shapes).
//
// Row types (snake_case, generated) come from src/app/core/database.types.ts —
// import { Tables } from there if you want the exact DB row. The interfaces
// below are the ergonomic camelCase view a service/mapper should expose.
//
// See docs/concepts/codex-extraction-output.md "Wave-2 → Wave-3 read contract"
// for the exact supabase-js queries (search / list-by-kind / detail).

import type { Tables } from '../core/database.types';

// ── DB row aliases (snake_case, exactly as returned by supabase-js) ──────────
export type CodexBuildRow = Tables<'codex_builds'>;
export type CodexManufacturerRow = Tables<'codex_manufacturers'>;
export type CodexShipRow = Tables<'codex_ships'>;
export type CodexWeaponRow = Tables<'codex_weapons'>;
export type CodexComponentRow = Tables<'codex_components'>;
export type CodexItemRow = Tables<'codex_items'>;
export type CodexAmmunitionRow = Tables<'codex_ammunition'>;
export type CodexItemPortRow = Tables<'codex_item_ports'>;
export type CodexEntityStringRow = Tables<'codex_entity_strings'>;

// ── Shared shapes (from the extraction contract) ─────────────────────────────
export interface LocalizedText {
  de: string;
  en: string;
  key: string; // raw global.ini key for fallback/debug
}

export interface ManufacturerRef {
  code: string;
  name: LocalizedText;
  className: string;
}

export interface ExtractSource {
  channel: string;
  patch: string;
  build: string;
}

export interface ItemPort {
  portName: string | null;
  minSize: number | null;
  maxSize: number | null;
  types: string[];
  flags: string[];
}

export interface LoadoutEntry {
  itemPortName: string | null;
  entityClassName: string | null; // null = port stock-empty
}

export type EntityKind = 'ship' | 'weapon' | 'component' | 'item';
export type WeaponClass = 'Ship' | 'FPS';
export type ComponentKind =
  | 'PowerPlant' | 'Shield' | 'Cooler' | 'QuantumDrive' | 'Thruster'
  | 'FuelTank' | 'FuelIntake' | 'CargoGrid' | 'Other';
export type Lang = 'de' | 'en';

// ── payload JSON shapes (the full per-entity extractor output) ───────────────
export interface BaseEntityPayload {
  className: string;
  guid: string;
  type: string;
  recordTag: string | null;
  name: LocalizedText;
  description: LocalizedText;
  manufacturer: ManufacturerRef | null;
  tags: string[];
  iconPath: null;
  previewImage: string | null; // WebP filename in the codex-previews bucket
  source: ExtractSource;
  entityKind: EntityKind;
}

// Real-world bounding-box dimensions (metres) parsed from the .cga mesh.
export interface Dimensions {
  length: number;
  width: number;
  height: number;
  min: number[];
  max: number[];
}

export interface ShipPayload extends BaseEntityPayload {
  entityKind: 'ship';
  role: string | null; // localization key
  crew: { size: number | null };
  vehicleName: LocalizedText;
  dimensions: Dimensions | null; // L/W/H in metres from the .cga bounding box
  // NOTE: flight stats are ALL null in Wave 1 (research Q1 — live entity does
  // not carry SCM/pitch/yaw; lives in vehicleDefinition, not yet resolved).
  flight: {
    scmSpeed: number | null; maxSpeed: number | null; boostSpeed: number | null;
    pitch: number | null; yaw: number | null; roll: number | null;
  };
  itemPorts: ItemPort[];
  defaultLoadout: LoadoutEntry[];
}

export interface WeaponPayload extends BaseEntityPayload {
  entityKind: 'weapon';
  weaponClass: WeaponClass;
  attachType: string | null; // AttachDef.Type — matches hardpoint port `types`
  subType: string | null;
  size: number | null;
  grade: string | null;
  weaponParams: Record<string, string | number | boolean | null>;
  itemPorts: ItemPort[];
}

export interface ComponentPayload extends BaseEntityPayload {
  entityKind: 'component';
  kind: ComponentKind;
  attachType: string | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
  // Heterogeneous: keyed by the LIVE component-params struct name
  // (e.g. SCItemShieldGeneratorParams, SCItemQuantumDriveParams, ...).
  stats: Record<string, Record<string, string | number | boolean | null>>;
  itemPorts: ItemPort[];
}

export interface ItemPayload extends BaseEntityPayload {
  entityKind: 'item';
  attachType: string | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
}

export interface DamageSet {
  physical: number | null; energy: number | null; distortion: number | null;
  thermal: number | null; biochemical: number | null; stun: number | null;
}

export interface AmmunitionPayload {
  className: string;
  guid: string;
  speed: number | null;
  lifetime: number | null;
  size: number | null;
  impactDamage: DamageSet | null;
  raw: Record<string, unknown>; // full resolved AmmoParams — nothing lost
  source: ExtractSource;
}

export interface ManufacturerPayload {
  className: string;
  guid: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  source: ExtractSource;
}

// ── Ergonomic camelCase read models (promoted columns + typed payload) ───────
export interface CodexBuild {
  id: string;
  channel: string;
  patchVersion: string;
  buildNumber: string;
  schemaVersion: number;
  qualityScore: number | null;
  toolVersion: string | null;
  entityCounts: Record<string, number> & { seeded?: Record<string, number> };
  isCurrent: boolean;
  extractedAt: string | null;
}

export interface CodexShip {
  classNameSlug: string; // class_name (permalink key)
  guid: string | null;
  manufacturerCode: string | null;
  role: string | null;
  crewSize: number | null;
  isVariant: boolean;
  nameLocalized: string | null;
  payload: ShipPayload;
}

export interface CodexWeapon {
  classNameSlug: string;
  guid: string | null;
  weaponClass: WeaponClass | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  isVariant: boolean;
  nameLocalized: string | null;
  payload: WeaponPayload;
}

export interface CodexComponent {
  classNameSlug: string;
  guid: string | null;
  kind: ComponentKind | null;
  attachType: string | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  isVariant: boolean;
  nameLocalized: string | null;
  payload: ComponentPayload;
}

export interface CodexItem {
  classNameSlug: string;
  guid: string | null;
  attachType: string | null;
  subType: string | null;
  size: number | null;
  grade: string | null;
  manufacturerCode: string | null;
  isVariant: boolean;
  nameLocalized: string | null;
  payload: ItemPayload;
}

export interface CodexAmmunition {
  classNameSlug: string;
  guid: string | null;
  speed: number | null;
  lifetime: number | null;
  size: number | null;
  payload: AmmunitionPayload;
}

export interface CodexManufacturer {
  classNameSlug: string;
  guid: string | null;
  code: string | null;
  nameLocalized: string | null;
  payload: ManufacturerPayload;
}

export interface CodexItemPort {
  parentClassName: string;
  parentKind: string;
  portName: string | null;
  minSize: number | null;
  maxSize: number | null;
  types: string[];
  flags: string[];
  portIndex: number;
}

export interface CodexEntityString {
  entityClassName: string;
  entityKind: string;
  lang: Lang;
  field: string;
  value: string | null;
  locKey: string | null;
}

// A detail view = an entity row + its ports + its localized strings.
export interface CodexEntityDetail<TPayload> {
  classNameSlug: string;
  payload: TPayload;
  ports: CodexItemPort[];
  strings: CodexEntityString[];
}

// The table names exposed for SELECT (RLS: any authenticated user can read).
export const CODEX_ENTITY_TABLES = {
  ship: 'codex_ships',
  weapon: 'codex_weapons',
  component: 'codex_components',
  item: 'codex_items',
  ammunition: 'codex_ammunition',
  manufacturer: 'codex_manufacturers',
} as const;
export type CodexEntityTable =
  (typeof CODEX_ENTITY_TABLES)[keyof typeof CODEX_ENTITY_TABLES];
