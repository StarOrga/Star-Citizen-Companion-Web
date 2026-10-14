-- Desktop settings snapshots — per-user backup of the SCC desktop app's
-- settings + keybinding profile XMLs. Replaces the former Google Drive backup.
--
-- Written by the desktop app only (PostgREST, signed-in user's JWT):
--   upsert   POST /rest/v1/desktop_settings_snapshots?on_conflict=user_id,snapshot_date
--            Prefer: resolution=merge-duplicates
--   list     GET  ...?select=id,snapshot_date,schema_version,app_version,checksum,size_bytes,updated_at
--   restore  GET  ...?id=eq.<uuid>&select=*
--   delete   DELETE ...?id=eq.<uuid>
--
-- Design:
--   * one row per user per UTC calendar day (unique(user_id, snapshot_date));
--     same-day backups overwrite the row
--   * retention is enforced SERVER-side: after every insert only the newest
--     3 snapshots (by snapshot_date) of that user are kept — a buggy or old
--     client cannot grow the table without bound
--   * the payload is client-sanitised (API keys / tokens are stripped before
--     upload) and capped at 2 MB (settings ~21 KB + a few keybinding XMLs)
--   * owner-only RLS; anon has no access; no admin read path on purpose —
--     the payload is personal configuration

create table if not exists public.desktop_settings_snapshots (
  id             uuid        primary key default gen_random_uuid(),
  user_id        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  snapshot_date  date        not null,
  schema_version int         not null check (schema_version between 1 and 1000),
  app_version    text        check (app_version is null or char_length(app_version) <= 64),
  checksum       text        not null check (checksum ~ '^[0-9a-f]{64}$'),
  size_bytes     int         not null check (size_bytes between 0 and 2097152),
  payload        jsonb       not null check (
                               jsonb_typeof(payload) = 'object'
                               and octet_length(payload::text) <= 2097152
                             ),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint desktop_settings_snapshots_user_day_key unique (user_id, snapshot_date)
);

create index if not exists desktop_settings_snapshots_user_date_idx
  on public.desktop_settings_snapshots (user_id, snapshot_date desc);

-- ============================================================
-- Guards: no far-future dates (would pin a row past retention), updated_at,
-- user_id immutable.
-- ============================================================
create or replace function public.desktop_settings_snapshots_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.snapshot_date > (now() at time zone 'utc')::date + 1 then
    raise exception 'snapshot_date must not be in the future';
  end if;
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'user_id is immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists desktop_settings_snapshots_guard on public.desktop_settings_snapshots;
create trigger desktop_settings_snapshots_guard
  before insert or update on public.desktop_settings_snapshots
  for each row execute function public.desktop_settings_snapshots_guard();

-- ============================================================
-- Retention: keep the newest 3 snapshots per user.
--
-- SECURITY INVOKER: it runs as the inserting user, so RLS limits the delete
-- to that user's own rows (the owner delete policy below allows it).
-- ============================================================
create or replace function public.desktop_settings_snapshots_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.desktop_settings_snapshots s
   where s.user_id = new.user_id
     and s.id in (
       select x.id
         from public.desktop_settings_snapshots x
        where x.user_id = new.user_id
        order by x.snapshot_date desc, x.updated_at desc
       offset 3
     );
  return null;
end;
$$;

drop trigger if exists desktop_settings_snapshots_retention on public.desktop_settings_snapshots;
create trigger desktop_settings_snapshots_retention
  after insert on public.desktop_settings_snapshots
  for each row execute function public.desktop_settings_snapshots_retention();

revoke execute on function public.desktop_settings_snapshots_guard() from public, anon;
revoke execute on function public.desktop_settings_snapshots_retention() from public, anon;

-- ============================================================
-- RLS — owner only
-- ============================================================
alter table public.desktop_settings_snapshots enable row level security;
revoke all on public.desktop_settings_snapshots from anon;
grant select, insert, update, delete on public.desktop_settings_snapshots to authenticated;

drop policy if exists desktop_settings_snapshots_select on public.desktop_settings_snapshots;
create policy desktop_settings_snapshots_select on public.desktop_settings_snapshots
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists desktop_settings_snapshots_insert on public.desktop_settings_snapshots;
create policy desktop_settings_snapshots_insert on public.desktop_settings_snapshots
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists desktop_settings_snapshots_update on public.desktop_settings_snapshots;
create policy desktop_settings_snapshots_update on public.desktop_settings_snapshots
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists desktop_settings_snapshots_delete on public.desktop_settings_snapshots;
create policy desktop_settings_snapshots_delete on public.desktop_settings_snapshots
  for delete to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.desktop_settings_snapshots is
  'SCC desktop app settings + keybinding backup; one row per user per UTC day, newest 3 kept (trigger). Payload is secret-stripped client-side.';
