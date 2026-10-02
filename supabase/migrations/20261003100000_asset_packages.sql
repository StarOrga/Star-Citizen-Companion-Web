-- Pre-built 3D asset packages (ships, FPS weapons): one small row per entity.
-- The manifest itself (~100 kB, places every part) and the GLBs live in R2 under
-- ship-skins/_manifests|_parts|_interiors|_hulls/<sha256>.<ext>, served by
-- cloudflare/assets-worker — the 500 MB DB budget only ever holds this pointer.
--
-- Web read path: asset_packages row -> manifest_sha256 -> /ship-skins/_manifests/<sha>.json
-- -> parts by sha. Written only by the ingest-skins edge function (service role).
--
-- Orphan GC (not built): a replaced manifest leaves its old manifest and any
-- now-unreferenced _parts/_interiors objects in R2. To collect: list those
-- prefixes, fetch every manifest still named by a row here, delete the rest.

create table if not exists public.asset_packages (
  kind            text   not null check (kind in ('ship', 'fps_weapon')),
  entity_class    text   not null,            -- manifest entity.className (codex_items.class_name)
  ship_id         text,                       -- ships only: ship_skins.ship_id this belongs to
  manifest_sha256 text   not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_bytes  integer not null check (manifest_bytes > 0),
  root_sha256     text   check (root_sha256 ~ '^[0-9a-f]{64}$'),      -- ship: _hulls/, fps_weapon: _parts/
  interior_sha256 text   check (interior_sha256 ~ '^[0-9a-f]{64}$'),  -- _interiors/
  part_count      integer not null default 0,
  total_bytes     bigint  not null default 0, -- root + interior + parts, before cross-entity dedup
  schema_version  integer not null,
  uploader_version text,
  updated_at      timestamptz not null default now(),
  primary key (kind, entity_class)
);

create index if not exists asset_packages_ship_idx on public.asset_packages (ship_id) where ship_id is not null;

comment on table public.asset_packages is
  'Pointer to the 3D asset package of a ship / FPS weapon in R2 (manifest by sha256). '
  'Written by ingest-skins (service role) only. See data-uploader/docs/asset-package.md.';

alter table public.asset_packages enable row level security;

drop policy if exists "asset_packages_public_read" on public.asset_packages;
create policy "asset_packages_public_read" on public.asset_packages
  for select to anon, authenticated using (true);

-- No write policy => denied for clients; service_role bypasses RLS.
revoke insert, update, delete, truncate on public.asset_packages from anon, authenticated;
grant select on public.asset_packages to anon, authenticated;
