-- HQ Bestand D8: Codex type / slot / role for the Bestand sub-filters (I9, H1) in ONE call.
--
-- hq_codex_kinds(p_class_names text[]) -> one row per class name found in the LIVE (is_current) builds, from the
-- columns the ingest already promotes (no extractor work):
--   entity       'item' | 'weapon' | 'ship'
--   attach_type  items: Char_Armor_Helmet|Torso|Arms|Legs|Undersuit|Backpack, ...; weapons: WeaponGun, ...; ships: null
--   sub_type     weapons FPS: Small|Medium|Large|Knife|Grenade|Gadget (CIG carry class); items: weight class
--   weapon_class 'FPS' | 'Ship' (weapons only)
--   role         ships: codex_ships.role (localization key)
--   career       ships: payload.career (e.g. '@vehicle_focus_Combat'); the client maps it with shipRoleOf() (codex-ship-filters.ts)
-- Order of precedence when a class exists in two tables: ship > weapon > item. At most 400 class names per call.
-- SECURITY INVOKER over the public codex views (anon + authenticated may read them), stable.
-- ROLLBACK: drop function if exists public.hq_codex_kinds(text[]);

create or replace function public.hq_codex_kinds(p_class_names text[])
returns table (class_name text, entity text, attach_type text, sub_type text, weapon_class text, role text, career text)
language sql
stable
set search_path = ''
as $$
  with names as (select distinct n from unnest(coalesce(p_class_names, '{}'::text[])) with ordinality t(n, o) where o <= 400),
  cur as (select id from public.codex_builds where is_current),
  s as (
    select x.class_name, 'ship'::text as entity, null::text as attach_type, null::text as sub_type, null::text as weapon_class, x.role, x.payload ->> 'career' as career, 1 as pri
      from public.codex_ships x where x.build_id in (select id from cur) and x.class_name in (select n from names)
  ), w as (
    select x.class_name, 'weapon'::text, x.attach_type, x.sub_type, x.weapon_class, null::text, null::text, 2
      from public.codex_weapons x where x.build_id in (select id from cur) and x.class_name in (select n from names)
  ), i as (
    select x.class_name, 'item'::text, x.attach_type, x.sub_type, null::text, null::text, null::text, 3
      from public.codex_items x where x.build_id in (select id from cur) and x.class_name in (select n from names)
  ), u as (select * from s union all select * from w union all select * from i)
  select distinct on (u.class_name) u.class_name, u.entity, u.attach_type, u.sub_type, u.weapon_class, u.role, u.career
    from u order by u.class_name, u.pri;
$$;
revoke all on function public.hq_codex_kinds(text[]) from public;
grant execute on function public.hq_codex_kinds(text[]) to anon, authenticated;

notify pgrst, 'reload schema';
