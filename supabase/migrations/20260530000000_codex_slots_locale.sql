-- ============================================================================
-- Codex: slot compatibility + full localization
-- ----------------------------------------------------------------------------
-- Three additions, all read-only for clients (RLS authenticated-read, service-
-- role writes — mirrors 00008):
--
--  1. codex_weapons.attach_type — the weapon's AttachDef.Type (WeaponGun /
--     Turret / MissileLauncher / …). Until now only components/items carried it;
--     without it weapons could not be matched against a hardpoint's accepted
--     port `types`. Backfilled by the next full seed (extractor now promotes it).
--
--  2. codex_locale_strings — the COMPLETE global.ini tables (key→value) per
--     language. codex_entity_strings only holds the handful of name/description
--     keys each entity references; this table lets the catalog resolve ANY
--     @-key (ship roles, port labels, loadout item names, …) — the full
--     "show translations" guarantee (~112k keys × {en,de}).
--
--  3. codex_compatible_items(build_id, types[], min, max) — given a hardpoint's
--     accepted types + size range, return every buyable weapon/component/item
--     whose attach_type matches and whose size fits. Powers the detail-view
--     "what fits in this slot" resolver (erkul-style).
-- ============================================================================

-- 1. weapon attach_type ------------------------------------------------------
alter table public.codex_weapons add column if not exists attach_type text;
create index if not exists codex_weapons_attach_idx
  on public.codex_weapons (build_id, attach_type, size);

-- 2. full localization table -------------------------------------------------
create table if not exists public.codex_locale_strings (
  build_id uuid not null references public.codex_builds (id) on delete cascade,
  lang text not null,                 -- short code: 'en' | 'de'
  key text not null,                  -- raw global.ini key (no leading @)
  value text not null,
  primary key (build_id, lang, key)
);
comment on table public.codex_locale_strings is
  'Complete global.ini translation tables per build+language. Lookup by (build_id, lang, key) — leading @ stripped to match the file''s own key form.';

-- 3. compatible-items resolver ----------------------------------------------
-- SECURITY INVOKER (default): runs as the caller, so the authenticated-read RLS
-- on the codex_* tables applies. STABLE: pure read. Size nulls are treated as
-- "unconstrained" on both sides so a sizeless port or sizeless item still
-- surfaces rather than silently vanishing.
create or replace function public.codex_compatible_items(
  p_build_id uuid,
  p_types text[],
  p_min int default null,
  p_max int default null
)
returns table (
  kind text,
  class_name text,
  name_localized text,
  manufacturer_code text,
  size int,
  sub_type text,
  grade text
)
language sql stable as $func$
  select 'weapon'::text, w.class_name, w.name_localized, w.manufacturer_code,
         w.size, w.sub_type, w.grade
    from public.codex_weapons w
   where w.build_id = p_build_id
     and not w.is_variant
     and w.attach_type = any (p_types)
     and (p_min is null or w.size is null or w.size >= p_min)
     and (p_max is null or w.size is null or w.size <= p_max)
  union all
  select 'component'::text, c.class_name, c.name_localized, c.manufacturer_code,
         c.size, c.sub_type, c.grade
    from public.codex_components c
   where c.build_id = p_build_id
     and not c.is_variant
     and c.attach_type = any (p_types)
     and (p_min is null or c.size is null or c.size >= p_min)
     and (p_max is null or c.size is null or c.size <= p_max)
  union all
  select 'item'::text, i.class_name, i.name_localized, i.manufacturer_code,
         i.size, i.sub_type, null::text
    from public.codex_items i
   where i.build_id = p_build_id
     and not i.is_variant
     and i.attach_type = any (p_types)
     and (p_min is null or i.size is null or i.size >= p_min)
     and (p_max is null or i.size is null or i.size <= p_max)
  order by 1, 5 nulls last, 3 nulls last, 2
  limit 500;
$func$;

grant execute on function public.codex_compatible_items(uuid, text[], int, int)
  to authenticated;

-- RLS for the new table (authenticated-read, service-role-write) -------------
alter table public.codex_locale_strings enable row level security;
create policy codex_locale_strings_authenticated_read on public.codex_locale_strings
  for select to authenticated using (true);
revoke insert, update, delete, truncate on public.codex_locale_strings
  from authenticated, anon;
