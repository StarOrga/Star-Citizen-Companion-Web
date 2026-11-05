-- ============================================================
-- 20261105150000_codex_added_class_names.sql
-- One request for "what is new in this patch" (performance audit FAN-1..4).
--
-- WHAT
--   codex_added_class_names(p_kind, p_current, p_previous) -> setof text:
--   the class names the build p_current has and p_previous does not, for one
--   kind (ship | weapon | component | item), ordered by class_name.
--
-- WHY
--   The browser used to page every class name of both builds (page size 1000,
--   capped at 10 pages) and diff them locally: 2..20 requests per kind.
--
-- SEMANTICS (same as src/app/codex/codex-build-diff.service.ts before)
--   * ship: default browse filters - is_variant = false, name_localized null
--     or not starting with '!', no SalvageableDebris / Orbital_Sentry /
--     probe_ class names (ilike, like PostgREST's `ilike.prefix*`).
--   * weapon / component / item: every row of the build, no filters.
--   * No row cap: the old client loop silently stopped at 10,000 rows.
--
-- SAFETY
--   Reads only class_name / build_id / is_variant / name_localized, never
--   payload (TOASTed). Uses the (build_id, class_name) index per table.
--   SECURITY INVOKER, STABLE, pinned search_path; grants match the codex
--   tables (anon + authenticated). Unknown kind -> empty set.
--   Additive only. After a real push run: notify pgrst, 'reload schema';
-- ============================================================

create or replace function public.codex_added_class_names(
  p_kind     text,
  p_current  uuid,
  p_previous uuid
) returns setof text
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_kind = 'ship' then
    return query
      select distinct cur.class_name
        from public.codex_ships cur
       where cur.build_id = p_current
         and not cur.is_variant
         and (cur.name_localized is null or cur.name_localized not like '!%')
         and cur.class_name is not null
         and cur.class_name not ilike 'SalvageableDebris%'
         and cur.class_name not ilike 'Orbital_Sentry%'
         and cur.class_name not ilike 'probe_%'
         and not exists (
           select 1 from public.codex_ships prv
            where prv.build_id = p_previous
              and not prv.is_variant
              and (prv.name_localized is null or prv.name_localized not like '!%')
              and prv.class_name = cur.class_name
         )
       order by 1;
  elsif p_kind = 'weapon' then
    return query
      select distinct cur.class_name from public.codex_weapons cur
       where cur.build_id = p_current and cur.class_name is not null
         and not exists (select 1 from public.codex_weapons prv
                          where prv.build_id = p_previous and prv.class_name = cur.class_name)
       order by 1;
  elsif p_kind = 'component' then
    return query
      select distinct cur.class_name from public.codex_components cur
       where cur.build_id = p_current and cur.class_name is not null
         and not exists (select 1 from public.codex_components prv
                          where prv.build_id = p_previous and prv.class_name = cur.class_name)
       order by 1;
  elsif p_kind = 'item' then
    return query
      select distinct cur.class_name from public.codex_items cur
       where cur.build_id = p_current and cur.class_name is not null
         and not exists (select 1 from public.codex_items prv
                          where prv.build_id = p_previous and prv.class_name = cur.class_name)
       order by 1;
  end if;
end;
$$;

revoke all on function public.codex_added_class_names(text, uuid, uuid) from public;
grant execute on function public.codex_added_class_names(text, uuid, uuid) to anon, authenticated;
