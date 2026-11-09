-- HQ Bestand (concept 20261108-2135-hq-bestand, lines D4 / D5 / D6).
--
--   D6  Nachschub type 'verkauf' ("Geld verdienen"): hq_supply_packages.goal_auec (the aUEC target, required for the
--       type, forbidden otherwise), progress_auec (earned so far, never above 10x the goal's cap), sale_refs (the
--       last 100 idempotency refs of reported sales). Lines come from the Bestand; progress comes from sales the
--       SCC app reports through hq_nachschub_report_sale() (atomic, idempotent by ref).
--       The type check used to tie `normal` to `event_id is null`; it now ties only event/sightseeing to an event.
--   D4  hq_supplies.gather (jsonb array, <= 12 stops): one pick-up line that collects ONE item from SEVERAL places.
--       Stop = { location, system?, amount, quality?, done }. The array order IS the route (the client orders by
--       amount, descending, and the user can reorder); a ticked stop carries done = true, Jetzt ticks them one by one.
--       A gather line has step_kind 'pickup'. A line without gather behaves exactly as before.
--   D5  needs no schema: adding lines to an existing Nachschub is hq_supplies.package_id on new rows.
--
-- Alpha data policy: purely additive, one constraint rewritten, nothing dropped. RLS, the sync trigger and the caps
-- are column-agnostic. ROLLBACK:
--   alter table public.hq_supplies drop column if exists gather;
--   drop function if exists public.hq_nachschub_report_sale(uuid, numeric, text);
--   alter table public.hq_supply_packages drop column if exists goal_auec, drop column if exists progress_auec, drop column if exists sale_refs;
--   (and set type back to 'normal' for verkauf rows before restoring the old hq_supply_packages_type check)

alter table public.hq_supply_packages add column if not exists goal_auec numeric;
alter table public.hq_supply_packages add column if not exists progress_auec numeric not null default 0;
alter table public.hq_supply_packages add column if not exists sale_refs jsonb not null default '[]'::jsonb;

alter table public.hq_supply_packages drop constraint if exists hq_supply_packages_type;
alter table public.hq_supply_packages add constraint hq_supply_packages_type
  check (type in ('normal', 'event', 'sightseeing', 'verkauf')
         and ((type in ('event', 'sightseeing')) = (event_id is not null))
         and (event_id is null or char_length(event_id) <= 64));

alter table public.hq_supply_packages drop constraint if exists hq_supply_packages_sell;
alter table public.hq_supply_packages add constraint hq_supply_packages_sell
  check (((type = 'verkauf') = (goal_auec is not null))
         and (goal_auec is null or (goal_auec > 0 and goal_auec <= 1000000000000))
         and progress_auec >= 0 and progress_auec <= 100000000000000
         and jsonb_typeof(sale_refs) = 'array' and jsonb_array_length(sale_refs) <= 100);

comment on column public.hq_supply_packages.type is 'normal | event (event rewards) | sightseeing (event without reward) | verkauf (aUEC goal, lines from the Bestand).';
comment on column public.hq_supply_packages.goal_auec is 'Verkauf only: the aUEC goal; null for every other type.';
comment on column public.hq_supply_packages.progress_auec is 'Verkauf only: aUEC earned so far, raised by hq_nachschub_report_sale() and editable by hand.';
comment on column public.hq_supply_packages.sale_refs is 'Last 100 refs of reported sales (idempotency of hq_nachschub_report_sale).';

-- Gather line (D4).
alter table public.hq_supplies add column if not exists gather jsonb;
alter table public.hq_supplies drop constraint if exists hq_supplies_gather;
alter table public.hq_supplies add constraint hq_supplies_gather
  check (gather is null or (jsonb_typeof(gather) = 'array' and jsonb_array_length(gather) between 1 and 12
                            and pg_column_size(gather) <= 8192));
comment on column public.hq_supplies.gather is
  'Pick-up line over several places: [{location, system?, amount, quality?, done}], array order = route order. Null = an ordinary line.';

-- Sale report from the app (D6). SECURITY INVOKER: RLS limits it to the caller's own Nachschub. p_ref makes a
-- re-sent report a no-op (the app uses the sale's log event id). Returns the new progress, null when nothing matched.
create or replace function public.hq_nachschub_report_sale(p_package_id uuid, p_auec numeric, p_ref text default null)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.hq_supply_packages;
begin
  if p_auec is null or p_auec <= 0 or p_auec > 1000000000000 then
    raise exception 'p_auec must be a positive aUEC amount' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_row from public.hq_supply_packages
   where user_id = (select auth.uid()) and id = p_package_id and type = 'verkauf' and deleted_at is null for update;
  if not found then
    return null;
  end if;
  if p_ref is not null and v_row.sale_refs ? p_ref then
    return v_row.progress_auec;
  end if;
  update public.hq_supply_packages
     set progress_auec = v_row.progress_auec + p_auec,
         sale_refs = case when p_ref is null then sale_refs
                          else (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
                                  select x from jsonb_array_elements(sale_refs || to_jsonb(p_ref)) with ordinality t(x, o)
                                   order by o desc limit 100) q) end,
         updated_at = now()
   where user_id = v_row.user_id and id = v_row.id
   returning progress_auec into v_row.progress_auec;
  return v_row.progress_auec;
end;
$$;
revoke all on function public.hq_nachschub_report_sale(uuid, numeric, text) from public, anon;
grant execute on function public.hq_nachschub_report_sale(uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';
