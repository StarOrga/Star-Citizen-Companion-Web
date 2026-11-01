-- HQ tables get the same restrictive approval gate as every other self-scoped
-- table (20260805120000_email_allowlist.sql): an authenticated but never
-- approved account must not read or write HQ rows through direct PostgREST,
-- bypassing the app's approval wall. The owner policies of each table stay as
-- they are; this RESTRICTIVE policy is ANDed on top. The SCC desktop app writes
-- hq_live_* / hq_inventory_* with the signed-in user's session, so an approved
-- user is unaffected. SECURITY DEFINER functions (median, purges, triggers) are
-- not subject to RLS and keep working.

do $$
declare
  t text;
begin
  foreach t in array array[
    'hq_supplies', 'hq_einsaetze', 'hq_einsatz_steps',
    'hq_live_events', 'hq_live_state',
    'hq_inventory_snapshots', 'hq_inventory_items', 'hq_ship_storage',
    'hq_community_reports'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_approved_gate', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_approved()) with check (public.is_approved());',
      t || '_approved_gate', t
    );
  end loop;
end $$;
