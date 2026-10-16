-- ============================================================
-- 20261016125100_codex_swap_candidates.sql
-- One-round-trip data source for the Codex swap picker (admin feedback #244).
--
-- WHY
--   Opening the swap picker on a ship page used to run a CHAIN of requests,
--   each waiting for the one before it:
--     1. the installed (+ factory) item's full payload   -> its attach type/size
--     2. codex_compatible_items(...)                       -> what fits the slot
--     3. the full payload of every candidate, 100 per batch
--     4. the ammunition payload of every candidate's round
--   = 4-6 sequential round trips plus every full payload, for a list that only
--   shows a handful of values. codex_swap_candidates() answers the same
--   question in ONE call: it resolves the slot's attach type/size from the
--   installed item itself, picks the candidates with the exact filter of
--   codex_compatible_items (no variants, same size rule, same 500 cap and
--   order) and returns each row with a LEAN payload and its round's ammo
--   payload already joined.
--
-- LEAN PAYLOAD
--   `payload - {description, manufacturer, name, source}`: the four top-level
--   keys the picker never reads (the row's name and maker come from the
--   promoted columns). Everything the stat columns read stays: `stats`,
--   `weaponParams`, `itemPorts` (rack capacity), `attachType`, `subType`, ...;
--   on the ammo payload `raw` stays (penetration, countermeasure params).
--   The client builds the rows with the same `buildSwapCandidate()` either way.
--
-- TOAST
--   Every payload is detoasted once: the seed/candidate CTEs are MATERIALIZED
--   with the trimmed payload, and the ammo class name is read off that
--   materialized copy (never `payload->...` per output column on the table).
--
-- INDEXES
--   Candidates: codex_weapons_attach_idx / codex_items_filter_idx
--   (build_id, attach_type, size) already exist; codex_components had none for
--   this shape (only (build_id, kind, size, grade)), so one is added here:
--   additive, ~2k rows per build, a few hundred kB. Seed and ammo lookups use
--   the (build_id, class_name) btrees from 20261008223000.
--
-- SECURITY
--   SECURITY INVOKER like codex_compatible_items / codex_armor_rating: the
--   caller's catalog read policies apply (anon + authenticated may read every
--   codex_* table since 20260710190000). STABLE, pinned search_path.
--
-- WHO CALLS IT
--   CodexSwapCandidatesService (src/app/codex/codex-swap-candidates.service.ts):
--   on picker open and for the throttled background preload of a ship's
--   swappable slots. While this migration is missing (PGRST202 / 404) the
--   client falls back to the old chain and stops preloading.
--
-- Additive only: no table, policy or existing function changes.
-- ============================================================

create index if not exists codex_components_attach_idx
  on public.codex_components using btree (build_id, attach_type, size);

create or replace function public.codex_swap_candidates(
  p_build_id uuid,
  p_installed text default null,
  p_types text[] default null,
  p_size int default null
)
returns table (
  role text,              -- candidate | seed (the installed item when it is not itself a candidate)
  kind text,
  class_name text,
  name_localized text,
  manufacturer_code text,
  size int,
  sub_type text,
  grade text,
  payload jsonb,
  ammo_class_name text,
  ammo_payload jsonb
)
language sql
stable
security invoker
set search_path = public
as $func$
  with seed_rows as materialized (
    select 1 as ord, 'weapon'::text as kind, w.class_name, w.name_localized, w.manufacturer_code,
           w.size, w.sub_type, w.grade, w.attach_type,
           w.payload - array['description', 'manufacturer', 'name', 'source'] as payload
      from public.codex_weapons w
     where p_installed is not null and w.build_id = p_build_id and w.class_name = p_installed
    union all
    select 2, 'component'::text, c.class_name, c.name_localized, c.manufacturer_code,
           c.size, c.sub_type, c.grade, c.attach_type,
           c.payload - array['description', 'manufacturer', 'name', 'source']
      from public.codex_components c
     where p_installed is not null and c.build_id = p_build_id and c.class_name = p_installed
    union all
    select 3, 'item'::text, i.class_name, i.name_localized, i.manufacturer_code,
           i.size, i.sub_type, null::text, i.attach_type,
           i.payload - array['description', 'manufacturer', 'name', 'source']
      from public.codex_items i
     where p_installed is not null and i.build_id = p_build_id and i.class_name = p_installed
  ),
  -- First table that owns the class name wins (mirrors getEntityPayloads).
  seed as materialized (
    select s.*,
           coalesce(nullif(s.payload ->> 'attachType', ''), s.attach_type) as seed_attach,
           coalesce(
             case when jsonb_typeof(s.payload -> 'size') = 'number'
                  then round((s.payload ->> 'size')::numeric)::int end,
             s.size
           ) as seed_size
      from seed_rows s
     order by s.ord
     limit 1
  ),
  -- The installed item's own attach type wins over what the host supplied,
  -- exactly like the picker's client-side resolution.
  q as (
    select coalesce(
             (select array[seed.seed_attach] from seed where seed.seed_attach is not null),
             coalesce(p_types, '{}'::text[])
           ) as types,
           coalesce(p_size, (select seed.seed_size from seed)) as sz
  ),
  cand as materialized (
    select * from (
      select 'weapon'::text as kind, w.class_name, w.name_localized, w.manufacturer_code,
             w.size, w.sub_type, w.grade,
             w.payload - array['description', 'manufacturer', 'name', 'source'] as payload
        from public.codex_weapons w, q
       where w.build_id = p_build_id
         and not w.is_variant
         and w.attach_type = any (q.types)
         and (q.sz is null or w.size is null or w.size = q.sz)
      union all
      select 'component'::text, c.class_name, c.name_localized, c.manufacturer_code,
             c.size, c.sub_type, c.grade,
             c.payload - array['description', 'manufacturer', 'name', 'source']
        from public.codex_components c, q
       where c.build_id = p_build_id
         and not c.is_variant
         and c.attach_type = any (q.types)
         and (q.sz is null or c.size is null or c.size = q.sz)
      union all
      select 'item'::text, i.class_name, i.name_localized, i.manufacturer_code,
             i.size, i.sub_type, null::text,
             i.payload - array['description', 'manufacturer', 'name', 'source']
        from public.codex_items i, q
       where i.build_id = p_build_id
         and not i.is_variant
         and i.attach_type = any (q.types)
         and (q.sz is null or i.size is null or i.size = q.sz)
    ) x
    order by 1, 5 nulls last, 3 nulls last, 2
    limit 500
  ),
  rows_out as materialized (
    select 'candidate'::text as role, c.kind, c.class_name, c.name_localized, c.manufacturer_code,
           c.size, c.sub_type, c.grade, c.payload
      from cand c
    union all
    select 'seed'::text, s.kind, s.class_name, s.name_localized, s.manufacturer_code,
           s.size, s.sub_type, s.grade, s.payload
      from seed s
     where not exists (select 1 from cand c where c.class_name = s.class_name)
  ),
  with_ammo as (
    select r.*,
           coalesce(nullif(btrim(r.payload -> 'weaponParams' ->> 'ammoClassName'), ''),
                    r.class_name || '_AMMO') as ammo_cn
      from rows_out r
  )
  select r.role, r.kind, r.class_name, r.name_localized, r.manufacturer_code,
         r.size, r.sub_type, r.grade, r.payload,
         case when a.class_name is not null then r.ammo_cn end,
         a.payload - array['description', 'manufacturer', 'name', 'source']
    from with_ammo r
    left join public.codex_ammunition a
      on a.build_id = p_build_id and a.class_name = r.ammo_cn
   order by (r.role = 'candidate'), r.kind, r.size nulls last, r.name_localized nulls last, r.class_name;
$func$;

comment on function public.codex_swap_candidates(uuid, text, text[], int) is
  'Swap picker data in one call (#244): candidates for a hardpoint (same filter as codex_compatible_items, resolved from the installed item when given) with a lean payload and the joined ammo payload. Security invoker.';

grant execute on function public.codex_swap_candidates(uuid, text, text[], int) to anon, authenticated;
