-- Events als Nachschub, wave 1a - the event data sheet (concept 20261108-1130-hq-events-nachschub, C1/C3).
--
--   sc_events.sheet / sheet_schema   the PUBLIC data sheet of an event (docs/contracts/event-sheet.md): every field
--                                    {value, confidence, source, review}. Fields under review (review pending /
--                                    rejected) are already blanked here, so the existing authenticated read policy
--                                    of sc_events stays correct: readers only ever see released values.
--   sc_event_sheet_drafts            the FULL sheet incl. pending fields; admin-only (the review page reads it).
--   sc_event_sheet_history           one row per extraction run / admin edit (snapshot of the full sheet), admin-only.
--   sc_event_sheet_apply()           the ONLY write path (service_role = extraction, or an admin = review page):
--                                    stores draft + public sheet + history row in one transaction.
--
-- Alpha data policy: purely additive, nothing dropped. ROLLBACK:
--   drop function if exists public.sc_event_sheet_apply(text, jsonb, text, text);
--   drop table if exists public.sc_event_sheet_history, public.sc_event_sheet_drafts;
--   alter table public.sc_events drop column if exists sheet, drop column if exists sheet_schema;

alter table public.sc_events add column if not exists sheet jsonb;
alter table public.sc_events add column if not exists sheet_schema integer;

alter table public.sc_events drop constraint if exists sc_events_sheet_shape;
alter table public.sc_events add constraint sc_events_sheet_shape
  check (sheet is null or (jsonb_typeof(sheet) = 'object' and pg_column_size(sheet) <= 131072));

comment on column public.sc_events.sheet is
  'Public event data sheet (docs/contracts/event-sheet.md). Fields with review pending/rejected are blanked; the full '
  'sheet lives in sc_event_sheet_drafts. Written only by sc_event_sheet_apply().';
comment on column public.sc_events.sheet_schema is 'Schema version of `sheet` (EVENT_SHEET_SCHEMA in supabase/functions/_shared/event-sheet.ts).';

create table if not exists public.sc_event_sheet_drafts (
  event_id     text primary key references public.sc_events (id) on delete cascade,
  sheet        jsonb       not null,
  sheet_schema integer     not null,
  updated_at   timestamptz not null default now(),
  constraint sc_event_sheet_drafts_shape check (jsonb_typeof(sheet) = 'object' and pg_column_size(sheet) <= 131072)
);
comment on table public.sc_event_sheet_drafts is
  'Full event sheet incl. fields under review (confidence < 0.8). Admin-only; the public part is sc_events.sheet.';

create table if not exists public.sc_event_sheet_history (
  id           bigint generated always as identity primary key,
  event_id     text        not null references public.sc_events (id) on delete cascade,
  sheet        jsonb       not null,
  sheet_schema integer     not null,
  actor_kind   text        not null,
  actor_id     text,
  note         text,
  created_at   timestamptz not null default now(),
  constraint sc_event_sheet_history_actor check (actor_kind in ('ai', 'admin')),
  constraint sc_event_sheet_history_shape check (jsonb_typeof(sheet) = 'object' and pg_column_size(sheet) <= 131072)
);
comment on table public.sc_event_sheet_history is
  'One row per extraction run (actor_kind ai) or admin edit (admin); sheet = snapshot of the full sheet after the change. Admin-only.';
create index if not exists sc_event_sheet_history_event_idx on public.sc_event_sheet_history (event_id, created_at desc);

alter table public.sc_event_sheet_drafts  enable row level security;
alter table public.sc_event_sheet_history enable row level security;
revoke all on public.sc_event_sheet_drafts, public.sc_event_sheet_history from anon, authenticated;
grant select on public.sc_event_sheet_drafts, public.sc_event_sheet_history to authenticated;

drop policy if exists sc_event_sheet_drafts_admin_read on public.sc_event_sheet_drafts;
create policy sc_event_sheet_drafts_admin_read on public.sc_event_sheet_drafts
  for select to authenticated using (public.is_admin());
drop policy if exists sc_event_sheet_history_admin_read on public.sc_event_sheet_history;
create policy sc_event_sheet_history_admin_read on public.sc_event_sheet_history
  for select to authenticated using (public.is_admin());

-- p_sheet = the FULL sheet {schema, fields:{<key>:{value,confidence,source,review}}}, already normalised by the caller
-- (normalizeSheet / gateSheet in _shared/event-sheet.ts). The public copy blanks pending/rejected fields.
create or replace function public.sc_event_sheet_apply(p_event_id text, p_sheet jsonb, p_actor_kind text, p_actor_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schema integer;
  v_public jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' and not public.is_admin() then
    raise exception 'sc_event_sheet_apply: admin or service role only' using errcode = 'insufficient_privilege';
  end if;
  if p_actor_kind not in ('ai', 'admin') then
    raise exception 'actor_kind must be ai or admin' using errcode = 'invalid_parameter_value';
  end if;
  if p_sheet is null or jsonb_typeof(p_sheet) <> 'object' or jsonb_typeof(p_sheet->'fields') is distinct from 'object' then
    raise exception 'p_sheet must be {schema, fields:{...}}' using errcode = 'invalid_parameter_value';
  end if;
  if not exists (select 1 from public.sc_events where id = p_event_id) then
    raise exception 'event not found' using errcode = 'no_data_found';
  end if;

  v_schema := coalesce((p_sheet->>'schema')::integer, 1);
  v_public := jsonb_build_object(
    'schema', v_schema,
    'fields', coalesce((
      select jsonb_object_agg(f.key,
        case when f.value->>'review' in ('pending', 'rejected')
             then '{"value":null,"confidence":0,"source":"unknown","review":"auto"}'::jsonb
             else f.value end)
        from jsonb_each(p_sheet->'fields') f), '{}'::jsonb));

  insert into public.sc_event_sheet_drafts (event_id, sheet, sheet_schema, updated_at)
  values (p_event_id, p_sheet, v_schema, now())
  on conflict (event_id) do update set sheet = excluded.sheet, sheet_schema = excluded.sheet_schema, updated_at = now();

  update public.sc_events set sheet = v_public, sheet_schema = v_schema where id = p_event_id;

  insert into public.sc_event_sheet_history (event_id, sheet, sheet_schema, actor_kind, actor_id)
  values (p_event_id, p_sheet, v_schema, p_actor_kind, left(p_actor_id, 200));

  return v_public;
end;
$$;
revoke all on function public.sc_event_sheet_apply(text, jsonb, text, text) from public, anon;
grant execute on function public.sc_event_sheet_apply(text, jsonb, text, text) to authenticated, service_role;

comment on function public.sc_event_sheet_apply(text, jsonb, text, text) is
  'Stores the full sheet (draft), the public sheet (pending/rejected fields blanked) and a history row. service_role or admin only.';

notify pgrst, 'reload schema';
