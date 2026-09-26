-- ============================================================
-- 20260926120000_codex_facet_values.sql
-- Codex facet values RPC (AUD-063).
--
-- WHAT / WHY
--   /codex/index (codex-list.component.ts) built its manufacturer/size/grade/
--   component-kind dropdown options from ONLY the rows loaded so far
--   (`this.rows()`, 60-row pages) — a build with more than one page of a kind
--   showed a dropdown missing most of its values. This RPC scans the WHOLE
--   table for the requested kind + build instead, so the dropdown is complete
--   from the first page.
--
--   Applies the SAME default browse filters the list itself applies
--   (`applyDefaultBrowseFilters` in codex.service.ts): buyable-only
--   (`is_variant = false`), no placeholder/untranslated names (leading '!'),
--   and — for ships — the non-ship-vehicle class_name prefixes
--   (SalvageableDebris*/Orbital_Sentry*/probe_*) dropped. A facet value that
--   the default browse filters would hide must not appear in the dropdown
--   either, or picking it would silently return zero rows.
--
--   Only `ship`/`weapon`/`component`/`item` carry any of these facets
--   (`ammunition`/`manufacturer`/`blueprint` return all-empty arrays — the
--   list's row-derived fallback already handles those kinds fine, and none of
--   them show these dropdowns).
--
-- SECURITY INVOKER (not DEFINER)
--   The codex_* tables are RLS-protected read tables (anon + authenticated
--   SELECT, see 20260710190000_public_codex_read.sql); this function must run
--   as the calling role so that RLS keeps applying to it exactly as it does
--   to a plain `select`. There is no privileged path here to hide behind
--   DEFINER, and DEFINER would only be a foot-gun (RLS bypass) for a function
--   that has no reason to need one.
--
-- WHO CALLS IT
--   codex.service.ts `facetValues()`, from codex-list.component.ts — the
--   manufacturer/size/grade/component-kind `<sc-select>` options on
--   /codex/index. Falls back to the current row-derived options when this RPC
--   errors (e.g. before this migration is deployed).
-- ============================================================

create or replace function public.codex_facet_values(p_build_id uuid, p_kind text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $func$
declare
  v_table text;
  v_where text;
  v_has_manufacturer boolean := false;
  v_has_size boolean := false;
  v_has_grade boolean := false;
  v_has_component_kind boolean := false;
  v_manufacturers jsonb := '[]'::jsonb;
  v_sizes jsonb := '[]'::jsonb;
  v_grades jsonb := '[]'::jsonb;
  v_component_kinds jsonb := '[]'::jsonb;
begin
  case p_kind
    when 'ship' then
      v_table := 'codex_ships';
      v_has_manufacturer := true;
    when 'weapon' then
      v_table := 'codex_weapons';
      v_has_manufacturer := true;
      v_has_size := true;
      v_has_grade := true;
    when 'component' then
      v_table := 'codex_components';
      v_has_manufacturer := true;
      v_has_size := true;
      v_has_grade := true;
      v_has_component_kind := true;
    when 'item' then
      v_table := 'codex_items';
      v_has_manufacturer := true;
      v_has_size := true;
      v_has_grade := true;
    else
      -- ammunition/manufacturer/blueprint: no such facets in the list UI.
      return jsonb_build_object(
        'manufacturers', '[]'::jsonb,
        'sizes', '[]'::jsonb,
        'grades', '[]'::jsonb,
        'componentKinds', '[]'::jsonb
      );
  end case;

  -- Mirrors applyDefaultBrowseFilters (codex.service.ts): buyable-only, no
  -- placeholder/untranslated names, ships additionally drop the non-ship
  -- vehicle prefixes.
  v_where := format('build_id = %L and is_variant = false and (name_localized is null or name_localized not like %L)',
    p_build_id, '!%');
  if p_kind = 'ship' then
    v_where := v_where || format(
      ' and class_name not ilike %L and class_name not ilike %L and class_name not ilike %L',
      'SalvageableDebris%', 'Orbital_Sentry%', 'probe_%'
    );
  end if;

  if v_has_manufacturer then
    -- One row per manufacturer_code: prefer a row whose payload actually
    -- resolves a name (not an unresolved '@key') over a code-only one, same
    -- as manufacturerFacetOptions' "first resolved name wins" client rule.
    -- 'UNKN' is the catalog's own "no known maker" code (UNKNOWN_MANUFACTURER_CODE
    -- in codex.service.ts) — never offered as a filter value. Paint items carry
    -- their livery token in manufacturer_code ("Paint_400i_Black_Orange_Logo",
    -- 940 one-off codes in the items table of build 4.9), each named after the
    -- real maker — only real code shapes become options (MANUFACTURER_CODE_SHAPE).
    execute format(
      $q$select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code), '[]'::jsonb)
         from (
           select distinct on (manufacturer_code) manufacturer_code as code, payload->'manufacturer'->'name' as name
           from public.%I
           where %s and manufacturer_code is not null and manufacturer_code <> 'UNKN'
             and manufacturer_code ~ '^[A-Z0-9]{2,6}$'
           order by manufacturer_code,
             (case when coalesce(payload->'manufacturer'->'name'->>'en', '') = ''
                     or (payload->'manufacturer'->'name'->>'en') like '@%%'
                   then 1 else 0 end),
             class_name
         ) s$q$,
      v_table, v_where
    ) into v_manufacturers;
  end if;

  if v_has_size then
    execute format(
      $q$select coalesce(jsonb_agg(size order by size), '[]'::jsonb)
         from (select distinct size from public.%I where %s and size is not null) s$q$,
      v_table, v_where
    ) into v_sizes;
  end if;

  if v_has_grade then
    execute format(
      $q$select coalesce(jsonb_agg(grade order by grade), '[]'::jsonb)
         from (select distinct grade from public.%I where %s and grade is not null) s$q$,
      v_table, v_where
    ) into v_grades;
  end if;

  if v_has_component_kind then
    execute format(
      $q$select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb)
         from (select distinct kind from public.%I where %s and kind is not null) s$q$,
      v_table, v_where
    ) into v_component_kinds;
  end if;

  return jsonb_build_object(
    'manufacturers', v_manufacturers,
    'sizes', v_sizes,
    'grades', v_grades,
    'componentKinds', v_component_kinds
  );
end;
$func$;

grant execute on function public.codex_facet_values(uuid, text) to anon, authenticated;
