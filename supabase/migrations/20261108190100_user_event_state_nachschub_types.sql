-- Events als Nachschub, wave 1b - per-user event state, Nachschub types, event Einsaetze, inventory origin
-- (concept 20261108-1130-hq-events-nachschub, C7/C8/C10).
--
--   user_event_state             one row per (user, event): status open|done|dismissed|aborted, progress per track
--                                ({value, source manual|live, updated_at}), claimed rewards. Owner-only RLS. Written
--                                by the web and by the SCC-App (user session) through user_event_state_report().
--   hq_supply_packages.type      normal | event | sightseeing; event_id = sc_events.id (soft reference). An event or
--                                sightseeing Nachschub names its event, a normal one does not.
--   hq_einsaetze.event_id/.area  an event Einsatz carries the event and its area (jsonb: kind/systems/places) instead
--                                of a fixed location. hq_einsatz_steps: kind 'event' + the same two columns.
--   hq_inventory_items.origin    pledge | ingame | loan (null = unknown), the same vocabulary as hangar_ships.origin.
--                                A claimed pledge reward lands here (ships go to hangar_ships with origin pledge).
--                                Caveat: the PK stays (user, location, name), so a pledge and an ingame copy of the
--                                same name at one location share a row (qty adds up, origin = the latest claim); a
--                                wholesale snapshot replace by the SCC-App drops the origin of replaced rows.
--
-- Alpha data policy: purely additive; the step-kind check is widened, nothing dropped. ROLLBACK:
--   drop function if exists public.user_event_state_report(text, jsonb, jsonb, text);
--   drop table if exists public.user_event_state;
--   alter table public.hq_supply_packages drop column if exists type, drop column if exists event_id;
--   alter table public.hq_einsaetze drop column if exists event_id, drop column if exists area;
--   alter table public.hq_einsatz_steps drop column if exists event_id, drop column if exists area;
--   alter table public.hq_inventory_items drop column if exists origin;

create table if not exists public.user_event_state (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  event_id   text        not null,
  status     text        not null default 'open',
  -- { "<track id>": { "value": number, "source": "manual"|"live", "updated_at": iso } }
  progress   jsonb       not null default '{}'::jsonb,
  -- { "<reward id>": { "channel": "pledge"|"ingame"|"both", "at": iso, "stored": bool, "by": "user"|"live" } }
  claimed    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, event_id),

  constraint user_event_state_status   check (status in ('open', 'done', 'dismissed', 'aborted')),
  constraint user_event_state_event_id check (char_length(event_id) between 1 and 64),
  constraint user_event_state_progress check (jsonb_typeof(progress) = 'object' and pg_column_size(progress) <= 16384),
  constraint user_event_state_claimed  check (jsonb_typeof(claimed) = 'object' and pg_column_size(claimed) <= 16384)
);
comment on table public.user_event_state is
  'Per-user state of an event (sc_events.id, soft reference): status, progress per track, claimed rewards. Owner-only. '
  'done rows feed Statistik. Written via user_event_state_report() by web and SCC-App.';

drop trigger if exists user_event_state_updated_at on public.user_event_state;
create trigger user_event_state_updated_at before update on public.user_event_state
  for each row execute function public.set_updated_at();

alter table public.user_event_state enable row level security;
revoke all on public.user_event_state from anon;
grant select, insert, update, delete on public.user_event_state to authenticated;
drop policy if exists user_event_state_own on public.user_event_state;
create policy user_event_state_own on public.user_event_state
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Merge write: progress per track and claims per reward are merged by timestamp (newest wins; a stale live report
-- never overwrites a newer manual value and vice versa), status only changes when p_status is given. SECURITY INVOKER:
-- RLS limits it to the caller's own row. p_progress = { "<track>": {value, source, updated_at} }, p_claimed likewise.
create or replace function public.user_event_state_report(p_event_id text, p_progress jsonb default '{}'::jsonb,
                                                          p_claimed jsonb default '{}'::jsonb, p_status text default null)
returns public.user_event_state
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.user_event_state;
  v_merged_progress jsonb;
  v_merged_claimed jsonb;
begin
  if p_status is not null and p_status not in ('open', 'done', 'dismissed', 'aborted') then
    raise exception 'invalid status' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_typeof(coalesce(p_progress, '{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_claimed, '{}'::jsonb)) <> 'object' then
    raise exception 'p_progress and p_claimed must be objects' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.user_event_state (user_id, event_id) values ((select auth.uid()), p_event_id)
  on conflict (user_id, event_id) do nothing;

  select * into v_row from public.user_event_state
   where user_id = (select auth.uid()) and event_id = p_event_id for update;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_merged_progress from (
    select coalesce(n.key, o.key) as k,
           case when n.key is null then o.value
                when o.key is null then n.value
                when coalesce(n.value->>'updated_at', '') >= coalesce(o.value->>'updated_at', '') then n.value
                else o.value end as v
      from jsonb_each(v_row.progress) o
      full join jsonb_each(coalesce(p_progress, '{}'::jsonb)) n on n.key = o.key) m;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_merged_claimed from (
    select coalesce(n.key, o.key) as k,
           case when n.key is null then o.value
                when o.key is null then n.value
                when coalesce(n.value->>'at', '') >= coalesce(o.value->>'at', '') then n.value
                else o.value end as v
      from jsonb_each(v_row.claimed) o
      full join jsonb_each(coalesce(p_claimed, '{}'::jsonb)) n on n.key = o.key) m;

  update public.user_event_state
     set progress = v_merged_progress, claimed = v_merged_claimed, status = coalesce(p_status, status)
   where user_id = (select auth.uid()) and event_id = p_event_id
   returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.user_event_state_report(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.user_event_state_report(text, jsonb, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Nachschub type + event reference (C8)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.hq_supply_packages add column if not exists type text not null default 'normal';
alter table public.hq_supply_packages add column if not exists event_id text;
alter table public.hq_supply_packages drop constraint if exists hq_supply_packages_type;
alter table public.hq_supply_packages add constraint hq_supply_packages_type
  check (type in ('normal', 'event', 'sightseeing') and ((type = 'normal') = (event_id is null)) and (event_id is null or char_length(event_id) <= 64));
comment on column public.hq_supply_packages.type is 'normal | event (event rewards) | sightseeing (event without reward, e.g. Free Fly).';
comment on column public.hq_supply_packages.event_id is 'sc_events.id (soft reference) for type event / sightseeing; null for a normal Nachschub.';

-- ---------------------------------------------------------------------------------------------------------------
-- Event Einsaetze and steps: the event and its area instead of a fixed location (C8)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.hq_einsaetze add column if not exists event_id text;
alter table public.hq_einsaetze add column if not exists area jsonb;
alter table public.hq_einsaetze drop constraint if exists hq_einsaetze_event_area;
alter table public.hq_einsaetze add constraint hq_einsaetze_event_area
  check ((event_id is null or char_length(event_id) <= 64) and (area is null or (jsonb_typeof(area) = 'object' and pg_column_size(area) <= 4096)));
comment on column public.hq_einsaetze.event_id is 'sc_events.id for an event Einsatz (role event); null otherwise.';
comment on column public.hq_einsaetze.area is 'Event area {kind, systems[], places[], venues[]} of an event Einsatz (same shape as the sheet area); replaces a fixed start_location.';

alter table public.hq_einsatz_steps add column if not exists event_id text;
alter table public.hq_einsatz_steps add column if not exists area jsonb;
alter table public.hq_einsatz_steps drop constraint if exists hq_einsatz_steps_kind;
alter table public.hq_einsatz_steps add constraint hq_einsatz_steps_kind check (kind in
  ('buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup', 'event'));
alter table public.hq_einsatz_steps drop constraint if exists hq_einsatz_steps_event_area;
alter table public.hq_einsatz_steps add constraint hq_einsatz_steps_event_area
  check ((event_id is null or char_length(event_id) <= 64) and (area is null or (jsonb_typeof(area) = 'object' and pg_column_size(area) <= 4096)));

-- Same atomic replace as 20261101010000, now also carrying event_id + area.
create or replace function public.hq_replace_einsatz_steps(p_einsatz_id uuid, p_steps jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'p_steps must be a jsonb array' using errcode = 'invalid_parameter_value';
  end if;
  n := jsonb_array_length(p_steps);
  if n > 40 then
    raise exception 'hq_einsatz_steps: at most 40 steps per Einsatz' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.hq_einsaetze
                  where id = p_einsatz_id and user_id = (select auth.uid()) and deleted_at is null) then
    raise exception 'Einsatz not found' using errcode = 'no_data_found';
  end if;

  delete from public.hq_einsatz_steps where einsatz_id = p_einsatz_id;

  insert into public.hq_einsatz_steps
    (einsatz_id, user_id, ord, kind, label, location, system, class_name, qty,
     supply_id, mission_ref, state, done_at, done_by, event_id, area)
  select p_einsatz_id, (select auth.uid()), (t.ord - 1)::integer, s.kind, s.label, s.location, s.system,
         s.class_name, s.qty, s.supply_id, s.mission_ref, coalesce(s.state, 'todo'), s.done_at, s.done_by,
         s.event_id, s.area
    from jsonb_array_elements(p_steps) with ordinality as t(el, ord)
    cross join lateral jsonb_to_record(t.el) as s(
      kind text, label text, location text, system text, class_name text, qty integer,
      supply_id text, mission_ref text, state text, done_at timestamptz, done_by text, event_id text, area jsonb);
  return n;
end;
$$;
revoke all on function public.hq_replace_einsatz_steps(uuid, jsonb) from public, anon;
grant execute on function public.hq_replace_einsatz_steps(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Inventory origin (C10)
-- ---------------------------------------------------------------------------------------------------------------
alter table public.hq_inventory_items add column if not exists origin text;
alter table public.hq_inventory_items drop constraint if exists hq_inv_item_origin;
alter table public.hq_inventory_items add constraint hq_inv_item_origin
  check (origin is null or origin in ('pledge', 'ingame', 'loan'));
comment on column public.hq_inventory_items.origin is 'pledge | ingame | loan; null = not stated (same vocabulary as hangar_ships.origin).';

notify pgrst, 'reload schema';
