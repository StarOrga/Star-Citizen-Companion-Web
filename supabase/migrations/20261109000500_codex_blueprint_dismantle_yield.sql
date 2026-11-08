-- Dismantle (scrap) yield on codex blueprints (HQ Bestand D7, R2 q-scrap=extract).
--
-- Two promoted columns on the base table codex_blueprints_rows:
--   dismantle_yield jsonb    [{ "material": className, "amount": number }, ...]
--   dismantlable    boolean  true / false as stated by the game record
-- NULL on both means UNKNOWN (the extractor found no record field) -- the UI
-- shows "unbekannt", never a guessed yes/no. Columns default to NULL, so every
-- existing row stays unknown until the next uploader run fills it.
--
-- codex_blueprints is a view over codex_blueprints_rows (20261102100000), so
-- the view is re-created with the two columns appended. Its INSTEAD OF INSERT
-- trigger and grants survive CREATE OR REPLACE VIEW. The ingest path needs no
-- change: codex_upsert_rows builds its column list from the keys present in the
-- rows and codex_carry_over copies every base column.
--
-- No data is dropped.

alter table public.codex_blueprints_rows
  add column if not exists dismantle_yield jsonb,
  add column if not exists dismantlable boolean;

comment on column public.codex_blueprints_rows.dismantle_yield is
  'Materials handed back when the crafted item is dismantled: [{material, amount}]. NULL = unknown.';
comment on column public.codex_blueprints_rows.dismantlable is
  'Whether the item can be dismantled per the game record. NULL = unknown (not false).';

do $m$
declare
  sel text;
begin
  -- Keep the view's current columns (payload comes from the shared blob store),
  -- append the new ones at the end as CREATE OR REPLACE VIEW requires.
  select string_agg(case when column_name = 'payload' then 'p.body as payload'
                         else format('r.%I', column_name) end,
                    ', ' order by ordinal_position)
    into sel
    from information_schema.columns
   where table_schema = 'public' and table_name = 'codex_blueprints'
     and column_name not in ('dismantle_yield', 'dismantlable');

  execute format(
    'create or replace view public.codex_blueprints with (security_invoker = true) as '
    'select %s, r.dismantle_yield, r.dismantlable '
    'from public.codex_blueprints_rows r left join public.codex_payloads p on p.sha = r.payload_sha',
    sel);
end
$m$;
