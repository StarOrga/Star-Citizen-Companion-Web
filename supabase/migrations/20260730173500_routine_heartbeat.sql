-- ============================================================
-- 20260730173500_routine_heartbeat.sql
-- Liveness heartbeat for background routines — first consumer: the local
-- admin-feedback routine.
--
-- WHY
--   The admin-feedback routine is a LOCAL Claude scheduled task on the dev
--   machine (`nightly-admin-feedback`, cron */20). It is not a cloud agent:
--   if the PC is off, Claude is closed, or the usage limit is reached, the
--   routine simply stops — silently. From the board an admin cannot tell
--   "nothing is open" apart from "nothing is running", so a topic filed into
--   a dead routine looks exactly like a topic that is being worked on.
--
--   The routine already polls this board every ~20 minutes. That poll is a
--   free liveness signal; it only needed somewhere to leave a mark. This
--   table is that mark, and the admin feedback panel renders it as a small
--   green / red dot next to its own name (feedback a7573f0e).
--
-- WHAT WRITES IT
--   The scheduled task itself, as STEP 0.5 of EVERY cycle — deliberately
--   ahead of the stale-claim reaper and ahead of the queue read, so even a
--   cycle that finds an empty queue and exits immediately still stamps:
--
--     insert into public.routine_heartbeat (id, last_seen_at, note, updated_at)
--     values ('admin-feedback-routine', now(), '<short note>', now())
--     on conflict (id) do update
--       set last_seen_at = now(), note = excluded.note, updated_at = now();
--
--   It runs that through the Supabase MCP / service role, which bypasses RLS.
--   That is the whole write path — see the RLS block below.
--
-- WHAT READS IT
--   `RoutineHeartbeatService` in the web app (admins only), polled while the
--   admin feedback panel is open. Fresh (< 45 min, i.e. ~2 missed cycles at a
--   20-minute cadence) = green, older = red, row missing / query error =
--   grey "unknown". The 45-minute window is what keeps a single skipped cycle
--   from crying wolf.
--
-- WHAT IT IS NOT
--   Not a log, not a metrics table, not a secret store: exactly one row per
--   routine, overwritten in place, holding a timestamp and a short human note.
--   Nothing here is sensitive — and nothing sensitive may be added, because
--   the note is rendered verbatim to admins.
--
-- PURELY ADDITIVE — nothing is dropped, renamed, or rewritten.
-- IDEMPOTENT: safe to re-run (if-not-exists / on-conflict / drop-if-exists).
-- ============================================================

create table if not exists public.routine_heartbeat (
  -- Stable, human-readable routine key (not a uuid): the writer is a prompt,
  -- and it must be able to name the row it stamps without a lookup.
  id           text primary key,
  -- The signal. "This routine was alive at this instant."
  last_seen_at timestamptz not null default now(),
  -- Optional one-liner for the tooltip, e.g. which cycle / what it found.
  -- Rendered to admins as-is: keep it short and free of anything private.
  note         text,
  updated_at   timestamptz not null default now()
);

comment on table public.routine_heartbeat is
  'One row per background routine, overwritten in place: last_seen_at is the '
  'proof-of-life the admin feedback panel turns into a green/red dot. Written '
  'ONLY by the routines themselves via the service role (no write policy '
  'exists); readable by admins only.';

comment on column public.routine_heartbeat.id is
  'Routine key, e.g. admin-feedback-routine (the local */20 scheduled task).';

comment on column public.routine_heartbeat.last_seen_at is
  'Start of the routine''s most recent cycle. Stamped BEFORE the reaper and '
  'the queue read, so an empty-queue cycle counts as alive too.';

comment on column public.routine_heartbeat.note is
  'Short human note shown in the admin tooltip. Never put secrets here.';

-- Seed the routine this migration ships for. `now()` is the honest value: the
-- routine is what applies this migration, so it demonstrably ran just now. The
-- first real STEP 0.5 stamp follows within one cadence.
insert into public.routine_heartbeat (id, last_seen_at, note, updated_at)
values (
  'admin-feedback-routine',
  now(),
  'seeded by migration 20260730173500',
  now()
)
on conflict (id) do nothing;

-- ============================================================
-- RLS — admins read, nobody writes through the API
--
-- SELECT is gated on public.is_admin() (defined in 00003_roles_releases_bundles,
-- the same helper every admin-only policy in this schema uses). There is
-- deliberately NO insert/update/delete policy: with RLS enabled and no policy,
-- every API write is refused outright, while the service role — which bypasses
-- RLS entirely — keeps stamping. That asymmetry IS the security model, so do
-- not "fix" it by adding a write policy, and do not widen the read to anon or
-- plain authenticated: liveness of the dev machine is admin business.
-- ============================================================

alter table public.routine_heartbeat enable row level security;

drop policy if exists routine_heartbeat_read on public.routine_heartbeat;
create policy routine_heartbeat_read on public.routine_heartbeat
  for select to authenticated
  using (public.is_admin());

-- Supabase grants ALL on new objects in `public` to anon + authenticated by
-- default, and TRUNCATE is not subject to RLS at all — strip everything first,
-- then hand back the single verb the one policy above is written for.
revoke all on public.routine_heartbeat from public, anon, authenticated;
grant select on public.routine_heartbeat to authenticated;
