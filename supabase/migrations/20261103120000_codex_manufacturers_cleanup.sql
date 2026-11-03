-- Codex manufacturers cleanup (alpha data policy: this migration DROPS rows).
--
-- The SCItemManufacturer ingest over-collected: every per-paint `Paint_*_Logo`
-- and per-shop `Shop_*` record became a codex_manufacturers row whose
-- class_name equals manufacturer_code and whose display name is borrowed from
-- a real maker ("Aegis Dynamics", "Ace Astrogation"). Measured 2026-11-03 on
-- both retained builds: 1200 rows each, 1019 of them Paint_*/Shop_* strays;
-- ~993 codex_items rows carried such a stray code in manufacturer_code. There
-- is no FK on manufacturer_code, only that plain text column.
--
-- Fixed at the source in data-uploader (`_is_real_manufacturer`); this clears
-- what is already stored. Steps, all idempotent:
--   1. re-point manufacturer_code of ships/components/items/weapons from a
--      stray to the real maker that carries the same localized name key
--      (NULL when no real maker shares it), so no row keeps a dangling code;
--   2. delete the stray manufacturer rows (nothing references them any more).
-- The row payloads (content-addressed in codex_payloads) are left alone; the
-- next uploader run replaces them. Orphaned bodies are swept by
-- codex_gc_payloads().

create temp table _cm_stray on commit drop as
select id, build_id, class_name, payload_sha
from public.codex_manufacturers_rows
where class_name = manufacturer_code
  and class_name ~* '^(paint|shop)_';

create temp table _cm_map on commit drop as
select s.build_id, s.class_name as stray_code,
       (select r.manufacturer_code
          from public.codex_manufacturers_rows r
          join public.codex_payloads rp on rp.sha = r.payload_sha
         where r.build_id = s.build_id
           and r.class_name !~* '^(paint|shop)_'
           and r.manufacturer_code is not null
           and rp.body #>> '{name,key}' = sp.body #>> '{name,key}'
         order by r.class_name
         limit 1) as real_code
from _cm_stray s
join public.codex_payloads sp on sp.sha = s.payload_sha;

update public.codex_items_rows t set manufacturer_code = m.real_code
  from _cm_map m where t.build_id = m.build_id and t.manufacturer_code = m.stray_code;
update public.codex_components_rows t set manufacturer_code = m.real_code
  from _cm_map m where t.build_id = m.build_id and t.manufacturer_code = m.stray_code;
update public.codex_ships_rows t set manufacturer_code = m.real_code
  from _cm_map m where t.build_id = m.build_id and t.manufacturer_code = m.stray_code;
update public.codex_weapons_rows t set manufacturer_code = m.real_code
  from _cm_map m where t.build_id = m.build_id and t.manufacturer_code = m.stray_code;

delete from public.codex_manufacturers_rows r
 using _cm_stray s
 where r.id = s.id;
