-- ============================================================
-- 20260926150000_codex_armor_rating_single_detoast.sql
-- codex_armor_rating (20260926140000): the same result in a fraction of the time.
--
-- WHY
--   The first version took 1.6 s per call on a warm cache as `authenticated`,
--   and ran past anon's 3 s statement_timeout on a cold one. authenticated
--   allows 8 s, so a cold set page could lose its rating card. Two causes:
--   - It read ten fields per armour row straight off codex_items.payload.
--     That column is TOASTed (about 6 kB compressed per armour row), and
--     PostgreSQL decompresses a TOASTed value again for every expression that
--     reads it: about ten times per row, over ~2,400 armour rows per build.
--   - The planner inlined the first CTE into the next one. carry_match and
--     damage_reduction were copied into every CASE and sort key that uses
--     them, so their regexes ran several times per row, and the first sort
--     spilled to disk.
--
-- WHAT
--   One jsonb_to_record() per row pulls out stats and description once, and
--   every later `->` reads those in-memory pieces. The armour CTE is
--   MATERIALIZED, so each regex runs once per row.
--   Measured on the live build as authenticated, warm: 1.6 s -> 0.24 s. The
--   output is identical for all 2,441 armour rows of the build (rolled-back
--   side-by-side run). Cohort, axes, parsing, output shape, security invoker
--   and grants are unchanged.
-- ============================================================

create or replace function public.codex_armor_rating(p_build_id uuid, p_class_names text[])
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $func$
begin
  return coalesce((
    -- MATERIALIZED: computed once per row. Inlined, the planner copies
    -- carry_match / damage_reduction into every CASE and sort key that uses
    -- them, re-running the regexes several times per row.
    with armor as materialized (
      select
        i.class_name,
        case i.attach_type
          when 'Char_Armor_Helmet' then 'helmet'
          when 'Char_Armor_Torso' then 'core'
          when 'Char_Armor_Arms' then 'arms'
          when 'Char_Armor_Legs' then 'legs'
          when 'Char_Armor_Undersuit' then 'undersuit'
          when 'Char_Armor_Backpack' then 'backpack'
        end as slot,
        (s."SCItemClothingParams" ->> 'Flight.gForceResistance')::numeric as g_force,
        (s."SCItemClothingParams" ->> 'TemperatureResistance.MinResistance')::numeric as temp_min,
        (s."SCItemClothingParams" ->> 'TemperatureResistance.MaxResistance')::numeric as temp_max,
        (s."SCItemClothingParams" ->> 'RadiationResistance.MaximumRadiationCapacity')::numeric as rad_capacity,
        (s."SCItemClothingParams" ->> 'RadiationResistance.RadiationDissipationRate')::numeric as rad_rate,
        (s."SEntityPhysicsControllerParams" ->> 'PhysType.Mass')::numeric as mass,
        nullif(trim((regexp_match(p.description ->> 'en', 'Item Type:\s*([^\\]+?)\\n'))[1]), '') as item_type,
        (regexp_match(p.description ->> 'en', 'Damage Reduction:\s*([0-9.]+)\s*%'))[1]::numeric as damage_reduction,
        regexp_match(p.description ->> 'en', 'Carrying Capacity:\s*([0-9.]+)\s*([Kk]?)\s*.SCU') as carry_match
      from public.codex_items i
      -- ONE detoast of the (TOASTed, ~6 kB compressed) payload per row: every
      -- later `->` works on these in-memory pieces instead of decompressing
      -- the whole payload again per expression (about ten times per row).
      cross join lateral jsonb_to_record(i.payload) as p(stats jsonb, description jsonb)
      cross join lateral jsonb_to_record(p.stats) as s("SCItemClothingParams" jsonb, "SEntityPhysicsControllerParams" jsonb)
      where i.build_id = p_build_id
        and i.is_variant = false
        and i.attach_type like 'Char_Armor_%'
    ),
    armor2 as (
      select
        class_name,
        slot,
        g_force,
        temp_min,
        temp_max,
        rad_capacity,
        rad_rate,
        mass,
        item_type,
        damage_reduction,
        case when carry_match is null then null
          when upper(carry_match[2]) = 'K' then carry_match[1]::numeric * 1000
          else carry_match[1]::numeric
        end as carry_uscu
      from armor
    ),
    ranked as (
      select
        class_name,
        slot,
        item_type,
        damage_reduction,
        temp_min,
        temp_max,
        rad_capacity,
        rad_rate,
        g_force,
        mass,
        carry_uscu,
        case when damage_reduction is not null
          then percent_rank() over (partition by slot, (damage_reduction is not null) order by damage_reduction) * 100
        end as pct_protection,
        case when mass is not null
          then percent_rank() over (partition by slot, (mass is not null) order by mass desc) * 100
        end as pct_mobility,
        case when g_force is not null
          then percent_rank() over (partition by slot, (g_force is not null) order by g_force) * 100
        end as pct_g_force,
        case when temp_max is not null
          then percent_rank() over (partition by slot, (temp_max is not null) order by temp_max) * 100
        end as pct_heat,
        case when temp_min is not null
          then percent_rank() over (partition by slot, (temp_min is not null) order by temp_min desc) * 100
        end as pct_cold,
        case when rad_capacity is not null
          then percent_rank() over (partition by slot, (rad_capacity is not null) order by rad_capacity) * 100
        end as pct_radiation,
        case when rad_rate is not null
          then percent_rank() over (partition by slot, (rad_rate is not null) order by rad_rate) * 100
        end as pct_scrub,
        case when carry_uscu is not null
          then percent_rank() over (partition by slot, (carry_uscu is not null) order by carry_uscu) * 100
        end as pct_carry
      from armor2
    )
    select jsonb_agg(jsonb_build_object(
      'className', class_name,
      'slot', slot,
      'itemType', item_type,
      'values', jsonb_build_object(
        'damageReduction', damage_reduction,
        'tempMin', temp_min,
        'tempMax', temp_max,
        'radCapacity', rad_capacity,
        'radRate', rad_rate,
        'gForce', g_force,
        'mass', mass,
        'carryMicroScu', carry_uscu
      ),
      'pct', jsonb_build_object(
        'protection', round(pct_protection::numeric, 1),
        'mobility', round(pct_mobility::numeric, 1),
        'gForce', round(pct_g_force::numeric, 1),
        'heat', round(pct_heat::numeric, 1),
        'cold', round(pct_cold::numeric, 1),
        'radiation', round(pct_radiation::numeric, 1),
        'scrub', round(pct_scrub::numeric, 1),
        'carry', round(pct_carry::numeric, 1)
      )
    ))
    from ranked
    where class_name = any(p_class_names)
  ), '[]'::jsonb);
end;
$func$;

grant execute on function public.codex_armor_rating(uuid, text[]) to anon, authenticated;
