/**
 * Row and RPC types for the HQ (beta) tables. Hand-written mirror of
 * supabase/migrations/20261101000000 .. 20261101070000 (the repo keeps no
 * generated DB types). Column names are the wire names (snake_case).
 * Timestamps are ISO strings, numeric columns arrive as numbers.
 */

export type HqStepKind = 'buy' | 'mission' | 'mine' | 'refine' | 'craft' | 'transport' | 'pickup';
export type HqActivity =
  | 'kopfgeld' | 'bunker' | 'medizin' | 'rennen' | 'bergbau' | 'fracht' | 'bergung' | 'erkunden' | 'piraterie';
export type HqSetKind = 'ship' | 'fps';
export type HqInventorySource = 'log' | 'search' | 'community' | 'ocr' | 'manual';

/** hq_supplies - sync table (LWW on updated_at, tombstone deleted_at, pull watermark synced_at). */
export interface HqSupplyRow {
  user_id: string;
  id: string;
  name: string;
  qty: number;
  done: boolean;
  entity_kind: string | null;
  class_name: string | null;
  set_kind: HqSetKind | null;
  /** hangar_ship_configs.id (ship) or hangar_role_loadouts.id (fps); null iff set_kind is null. */
  set_id: string | null;
  step_kind: HqStepKind | null;
  wanted: boolean;
  source: 'manual' | 'set' | 'search' | 'live';
  /** Exact quantity in `unit` (0.36 SCU); null = whole pieces in `qty`. Column from migration 20261106170000. */
  amount?: number | null;
  unit?: 'pcs' | 'scu' | null;
  /** Class name of the blueprint this material line was added for. */
  for_class_name?: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

/** hq_einsaetze - sync table like hq_supplies. */
export interface HqEinsatzRow {
  user_id: string;
  id: string;
  title: string;
  activity: HqActivity | null;
  status: 'planned' | 'active' | 'done' | 'archived';
  planned_at: string | null;
  start_location: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string;
}

/** hq_einsatz_steps - PK (einsatz_id, ord). "Einsatz xN" = number of steps. */
export interface HqEinsatzStepRow {
  einsatz_id: string;
  user_id: string;
  ord: number;
  kind: HqStepKind;
  label: string;
  location: string | null;
  system: string | null;
  class_name: string | null;
  qty: number | null;
  supply_id: string | null;
  mission_ref: string | null;
  state: 'todo' | 'done';
  done_at: string | null;
  done_by: 'user' | 'live' | null;
  created_at: string;
  updated_at: string;
}

/**
 * rpc hq_replace_einsatz_steps(p_einsatz_id uuid, p_steps jsonb) -> integer (step count).
 * SECURITY INVOKER, one transaction: deletes all steps of the caller's Einsatz and inserts
 * `p_steps` (jsonb array, max 40; `ord` = array index). Errors: 23514 over 40 steps,
 * P0002 Einsatz missing/tombstoned. Use this instead of upserting steps one by one.
 * Tombstoning an Einsatz (deleted_at set) deletes its steps server-side.
 */
export interface HqReplaceEinsatzStepsArgs {
  p_einsatz_id: string;
  p_steps: HqEinsatzStepInput[];
}
export type HqEinsatzStepInput = Pick<HqEinsatzStepRow, 'kind' | 'label'> &
  Partial<
    Pick<
      HqEinsatzStepRow,
      'location' | 'system' | 'class_name' | 'qty' | 'supply_id' | 'mission_ref' | 'state' | 'done_at' | 'done_by'
    >
  >;

/** hq_live_events - desktop-written, idempotent by id; `applied` / `undone` are owned by the web. */
export interface HqLiveEventRow {
  user_id: string;
  id: string;
  /** GAMELOG_EVENT_TYPES value, e.g. 'shop.purchase'. */
  type: string;
  data: Record<string, unknown>;
  at: string;
  applied: Record<string, unknown> | null;
  undone: boolean;
  synced_at: string;
  updated_at: string;
}

/** hq_live_state - one row per user, Realtime-published. */
export interface HqLiveStateRow {
  user_id: string;
  state: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HqInventorySnapshotRow {
  user_id: string;
  location: string;
  system: string | null;
  source: HqInventorySource;
  taken_at: string;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface HqInventoryItemRow {
  user_id: string;
  location: string;
  name: string;
  class_name: string | null;
  qty: number;
  unit: 'pcs' | 'scu';
  /** Reservations on this row (migration 20261107210000); absent on rows read before it. */
  reservations?: HqStockReservation[] | null;
  updated_at: string;
}

/** Part of a row earmarked for someone or something ("Spieler X", "Verkauf"). */
export interface HqStockReservation {
  amount: number;
  note: string;
  at: string;
}

export interface HqShipStorageRow {
  user_id: string;
  ship_ref: string;
  location: string;
  source: HqInventorySource;
  taken_at: string;
  updated_at: string;
}

/** hq_community_reports - insert-only for clients (no select grant). */
export interface HqCommunityReportInsert {
  kind: 'price' | 'stock' | 'location';
  class_name: string;
  location: string;
  value: number;
}

/** rpc hq_community_median(p_kind, p_class_name) -> rows; only locations with >= 5 distinct reporters (accounts > 7 days old) AFTER outlier removal. */
export interface HqCommunityMedianRow {
  location: string;
  median: number;
  /** Reports kept after IQR outlier removal. */
  n: number;
  /** Day precision (midnight of the newest report's day). */
  newest: string;
}

/** rpc hq_fleet_patch() */
export interface HqFleetPatchLine {
  class_name: string;
  entity_kind: 'ship' | 'part';
  /** First path segment of the changed stat, e.g. 'flight'. */
  category: string;
  /** Dotted path of the changed numeric field. */
  path: string;
  old: number;
  new: number;
  /** Relative change in percent, one decimal (negative = nerf). */
  pct: number;
  set_kind: HqSetKind | null;
  set_id: string | null;
  set_name: string | null;
}
export interface HqFleetPatch {
  build: string | null;
  previous: string | null;
  /** At most 2 lines; empty = hide the patch lines. */
  lines: HqFleetPatchLine[];
}

/** rpc hq_stats(p_range). Series are sparse (date buckets with data only); zero-fill client-side. */
export type HqStatsRange = '7d' | '30d' | '90d';
export interface HqStatsPoint { bucket: string; value: number }
export interface HqStats {
  range: HqStatsRange;
  bucket: 'day' | 'week';
  auec: { earned: number; spent: number; net: number; series: HqStatsPoint[] };
  missions: { total: number; series: HqStatsPoint[] };
  contracts: { failed: number; abandoned: number; series: HqStatsPoint[] };
  deaths_claims: {
    deaths: number;
    claims: number;
    series: { bucket: string; deaths: number; claims: number }[];
  };
  crimestat: { total: number; series: HqStatsPoint[] };
  refinery: { total: number; series: HqStatsPoint[] };
  blueprints: { total: number; series: HqStatsPoint[] };
}
