-- ============================================================
-- 20260926140000_codex_armor_rating.sql
-- On-foot armour set "Einordnung" (percentile rating) RPC.
--
-- WHAT / WHY
--   /codex/set/:id (the set page) mirrors the ship page's rank card
--   (codex-rank.ts, codex-rank-card.component.ts) for an on-foot armour SET:
--   for every armour part the player has worn, how does it sit against every
--   other part of the SAME slot in the current build? This function computes
--   that cohort percentile server-side (the client never has the whole
--   catalog loaded), for exactly the class_names the caller passes in.
--
-- SOURCES (verified against codex_items, build hcnqhvzlavdycidqyaai/4.9-ish)
--   Slot            <- attach_type (Char_Armor_Helmet/Torso/Arms/Legs/
--                      Undersuit/Backpack), armour rows are
--                      attach_type like 'Char_Armor_%' and not is_variant.
--   g_force         <- payload->stats->SCItemClothingParams
--                      ->>'Flight.gForceResistance' (a per-part MODIFIER,
--                      summed over the worn set client-side — patch 4.8
--                      model, e.g. Morozov-SH Core -0.5, Legs -0.25).
--   temp_min/max    <- ..->'TemperatureResistance.MinResistance' /
--                      '...MaxResistance' (°C).
--   rad_capacity    <- ..->'RadiationResistance.MaximumRadiationCapacity' (REM).
--   rad_rate        <- ..->'RadiationResistance.RadiationDissipationRate' (REM/s).
--   mass            <- payload->stats->SEntityPhysicsControllerParams
--                      ->>'PhysType.Mass' (kg).
--   item_type,
--   damage_reduction,
--   carry_uscu      <- ONLY in payload->description->>'en', whose first block
--                      is lines joined by a LITERAL two-character `\n`
--                      (backslash-n, not a real newline), e.g.:
--                        "Item Type: Heavy Armor\nDamage Reduction: 40%\n
--                         Temp. Rating: -90 / 115 °C\nRadiation Protection:
--                         26800 REM\nRadiation Scrub Rate: 145.8 REM/s\n
--                         Carrying Capacity: 12K µSCU\nBackpacks: All\n\n<flavour>"
--                      parsed here with regexp_match on the literal `\n`
--                      (matched as the two characters `\` `n`, i.e. E'\\\\n'
--                      in a plain string / `\\n` in a regex literal).
--                      Carrying Capacity strings look like "12K µSCU",
--                      "7.5K µSCU", "8.0 µSCU", "10k µSCU" — K/k means ×1000;
--                      a bare number (no K/k) is left as-is. NOTE: we cannot
--                      tell "8.0 µSCU" (a genuinely tiny capacity, e.g. some
--                      helmets) apart from a formatting slip, so this stays a
--                      documented ambiguity, not a bug — the raw text always
--                      wins over any guess.
--
-- COHORT
--   Per slot, ALL non-variant armour items of the given build (not just the
--   caller's set) — same "cohort = everything of this kind" idiom as
--   codex_facet_values. `percent_rank() over (partition by slot order by …)`
--   already ignores excluded (null-axis) rows because they are filtered out
--   of the window's input set entirely (a WHERE on the raw column before the
--   window, not a CASE inside it) — a part missing an axis is a GAP, not a 0,
--   and never drags its cohort's ranking down.
--
-- SECURITY INVOKER, same rationale as codex_facet_values: codex_items is an
-- RLS-protected read table (anon + authenticated SELECT); this function must
-- not bypass that.
--
-- WHO CALLS IT
--   codex.service.ts `armorRating()`, from the set page's rating card
--   (set-rating.ts `rankSet`/`lensValueFor`). Falls back to null (card shows
--   nothing extra) when this RPC errors, e.g. before this migration deploys.
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
    with armor as (
      select
        class_name,
        case attach_type
          when 'Char_Armor_Helmet' then 'helmet'
          when 'Char_Armor_Torso' then 'core'
          when 'Char_Armor_Arms' then 'arms'
          when 'Char_Armor_Legs' then 'legs'
          when 'Char_Armor_Undersuit' then 'undersuit'
          when 'Char_Armor_Backpack' then 'backpack'
        end as slot,
        (payload -> 'stats' -> 'SCItemClothingParams' ->> 'Flight.gForceResistance')::numeric as g_force,
        (payload -> 'stats' -> 'SCItemClothingParams' ->> 'TemperatureResistance.MinResistance')::numeric as temp_min,
        (payload -> 'stats' -> 'SCItemClothingParams' ->> 'TemperatureResistance.MaxResistance')::numeric as temp_max,
        (payload -> 'stats' -> 'SCItemClothingParams' ->> 'RadiationResistance.MaximumRadiationCapacity')::numeric as rad_capacity,
        (payload -> 'stats' -> 'SCItemClothingParams' ->> 'RadiationResistance.RadiationDissipationRate')::numeric as rad_rate,
        (payload -> 'stats' -> 'SEntityPhysicsControllerParams' ->> 'PhysType.Mass')::numeric as mass,
        -- The description's first "Key: value" block, lines joined by the
        -- LITERAL two-char sequence `\n` (backslash, n) — not a real newline.
        nullif(trim((regexp_match(payload -> 'description' ->> 'en', 'Item Type:\s*([^\\]+?)\\n'))[1]), '') as item_type,
        (regexp_match(payload -> 'description' ->> 'en', 'Damage Reduction:\s*([0-9.]+)\s*%'))[1]::numeric as damage_reduction,
        regexp_match(payload -> 'description' ->> 'en', 'Carrying Capacity:\s*([0-9.]+)\s*([Kk]?)\s*.SCU') as carry_match
      from public.codex_items
      where build_id = p_build_id
        and is_variant = false
        and attach_type like 'Char_Armor_%'
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
