-- Hardpoint POSITIONS on the hull — where each item port physically sits (#137 part 3).
--
-- ADDITIVE ONLY: no table is created or dropped, nothing is renamed, no row is
-- rewritten. Three nullable columns are added to public.codex_item_ports. Every
-- existing row keeps NULL, which the reader treats exactly like "no position
-- known" — the pre-existing, category-grouped hardpoint UI. The values only
-- appear once the admin re-runs the desktop uploader against Data.p4k, because
-- the coordinates are parsed out of the ship's .cga mesh (helper nodes) and exist
-- nowhere else — not in the DataCore, not in any external API.
--
-- Coordinate contract (identical from extractor to UI, see
-- data-uploader/python/sc_extract/hardpoints.py):
--   * position: [x, y, z] metres in the MESH MODEL SPACE of the ship's hull
--     .cga — CryEngine axes, +X = starboard/right, +Y = forward/nose, +Z = up.
--     Not re-centred, not rescaled.
--   * rotation: [x, y, z, w] unit quaternion in that same space (mount facing).
--   * helper_name: the mesh helper node the port resolved to. Kept because it is
--     the audit trail for the join — a port only gets a position when its
--     DataCore helper name (or its own port name) matches a node name verbatim.
--
-- Stored as jsonb rather than three float columns: the payload is a fixed-length
-- vector consumed as a whole by the client, and jsonb keeps the shape
-- forward-compatible (a later patch may add a local/parent-relative offset)
-- without another schema change.
--
-- The ship-level map of ALL resolved ports (including the weapon/shield mounts
-- that only appear in the default loadout, never as item ports) rides along in
-- codex_ships.payload.hardpointTransforms + .hardpointFrame — payload is jsonb
-- and needs no DDL.

alter table public.codex_item_ports
  add column if not exists helper_name text,
  add column if not exists position jsonb,
  add column if not exists rotation jsonb;

comment on column public.codex_item_ports.helper_name is
  'Mesh helper node (from the hull .cga) this port attaches to; NULL when unresolved.';
comment on column public.codex_item_ports.position is
  '[x,y,z] metres in hull model space (CryEngine axes: +X right, +Y nose, +Z up). NULL = unknown.';
comment on column public.codex_item_ports.rotation is
  '[x,y,z,w] unit quaternion of the mount facing, same space as position. NULL = unknown.';
