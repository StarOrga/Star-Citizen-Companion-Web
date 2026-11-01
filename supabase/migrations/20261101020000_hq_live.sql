-- HQ (beta) - live game data from the SCC desktop app (plan section 3.3, D41).
--
-- Opt-in sync (desktop setting hq.liveSync.enabled, default off). The desktop app
-- (modules/desktop/src/hq-live-sync-service.js) batches Game.log events into
-- hq_live_events and keeps one snapshot row in hq_live_state; the web Jetzt page
-- subscribes via Realtime (RLS applies to Realtime, so a user only receives own rows).
--
-- Alpha-phase data policy: purely additive, nothing dropped.
--
-- Idempotency / client contract
--   * hq_live_events.id = desktop event id (sha1 of type|at|stable data), so a
--     re-sent batch is a no-op. The desktop MUST upsert with
--     `on_conflict=user_id,id` + `ignore-duplicates` (Prefer: resolution=ignore-duplicates):
--     a merge-duplicates upsert would overwrite `applied` / `undone`, which the WEB owns.
--   * The web writes `applied` (what it auto-applied, for exact undo) and `undone`.
--   * PII: the desktop drops party member names before upload; payload size is capped
--     below (2 KiB) so chat or other free text cannot be bulk-stored.
--
-- Budget (500 MB DB, storage.md): 90-day retention via pg_cron, hard cap 20 000 events
-- per user. At the cap the OLDEST events are pruned instead of rejecting the insert,
-- so a long-running sync never wedges. pg_cron is already enabled
-- (20260906130000_patch_stability_cron.sql); NEVER repeat `create extension pg_cron`
-- here - on this project it raises 2BP01 once cron grants exist.

create table if not exists public.hq_live_events (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null,
  type       text        not null,
  data       jsonb       not null default '{}'::jsonb,
  at         timestamptz not null,
  applied    jsonb,
  undone     boolean     not null default false,
  synced_at  timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),

  constraint hq_live_events_id_len   check (char_length(id) between 1 and 200),
  constraint hq_live_events_type     check (char_length(type) between 1 and 64 and type ~ '^[a-z0-9_.-]+$'),
  constraint hq_live_events_data_sz  check (pg_column_size(data) < 2048),
  -- `applied` may hold a replaced inventory snapshot (undo), so it gets a bigger but still bounded budget.
  constraint hq_live_events_applied_sz check (applied is null or pg_column_size(applied) < 65536),
  -- An event time more than a day in the future is a skewed clock or abuse, not data.
  constraint hq_live_events_at_sane  check (at < now() + interval '1 day')
);

comment on table public.hq_live_events is
  'Game.log events (type = GAMELOG_EVENT_TYPES value) uploaded by the SCC app, opt-in. Private per user (owner-only RLS). '
  'id = desktop event id (idempotent); applied/undone are owned by the web (auto-apply + undo). '
  'Retention 90 days (pg_cron hq-live-events-retention), cap 20000 rows per user (oldest pruned).';

create index if not exists hq_live_events_user_at_idx   on public.hq_live_events (user_id, at desc);
create index if not exists hq_live_events_user_type_idx on public.hq_live_events (user_id, type, at desc);
create index if not exists hq_live_events_at_idx        on public.hq_live_events (at);

drop trigger if exists hq_live_events_updated_at on public.hq_live_events;
create trigger hq_live_events_updated_at before update on public.hq_live_events
  for each row execute function public.set_updated_at();

create or replace function public.hq_live_events_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('hq_live_events:' || new.user_id::text, 0));
  select count(*) into n from public.hq_live_events where user_id = new.user_id;
  if n >= 20000 then
    -- Free ~2.5 % so the prune does not run on every single insert.
    delete from public.hq_live_events e
     where (e.user_id, e.id) in (
       select user_id, id from public.hq_live_events
        where user_id = new.user_id order by at asc limit 500);
  end if;
  return new;
end;
$$;
revoke all on function public.hq_live_events_enforce_cap() from public, anon, authenticated;

drop trigger if exists hq_live_events_cap on public.hq_live_events;
create trigger hq_live_events_cap
  before insert on public.hq_live_events
  for each row execute function public.hq_live_events_enforce_cap();

-- One snapshot row per user: location, currentShip, contracts, crimestat ...
create table if not exists public.hq_live_state (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  state      jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id),
  constraint hq_live_state_sz check (pg_column_size(state) < 16384)
);

comment on table public.hq_live_state is
  'Last live snapshot from the SCC app (location, currentShip, active contracts, crimestat ...). One row per user, Realtime-published. '
  'Private per user (owner-only RLS).';

drop trigger if exists hq_live_state_updated_at on public.hq_live_state;
create trigger hq_live_state_updated_at before update on public.hq_live_state
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner only
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['hq_live_events', 'hq_live_state']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime: Jetzt updates live. Guarded so a re-run (or a plain Postgres without
-- the publication, e.g. a bare test DB) does not fail.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['hq_live_state', 'hq_live_events']
    loop
      if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Retention: 90 days, nightly 03:20 UTC. cron.schedule with an existing job name
-- replaces the job, so re-running this file is safe.
-- ROLLBACK: select cron.unschedule('hq-live-events-retention');
-- ---------------------------------------------------------------------------
select cron.schedule(
  'hq-live-events-retention',
  '20 3 * * *',
  $job$ delete from public.hq_live_events where at < now() - interval '90 days' $job$
);
