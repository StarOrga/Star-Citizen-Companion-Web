-- ============================================================
-- 20260913121500_routine_heartbeat_run_state.sql
-- The heartbeat row learns three things it could not say before: WHEN the
-- next cycle is due, WHETHER a run is currently in progress, and WHY the
-- routine is quiet (idle / running / paused).
--
-- WHY
--   The admin panel derived "reachable" from a fixed 45-minute window that
--   was calibrated for a 20-minute cadence (migration 20260730173500). The
--   scheduler has since moved to an hourly cron, and nothing told the panel:
--   with a stamp at :09 and a window of 45 minutes the title was red from
--   ~:54 to :09 of every healthy hour — a status light that lied a quarter
--   of the time (concept 2026-09-13-feedback-routine-takt-anweisung, D5).
--
--   The cadence is now a table inside `scripts/routine-gate.mjs` (dense in
--   the evening, hourly by day, every two hours at night), so no constant in
--   the app can mirror it. Instead the gate stamps `next_run_at` — the
--   instant the scheduler will fire next — and the panel asks one question:
--   "is that instant plus a small grace already in the past?".
--
--   `state` + `run_started_at` / `run_finished_at` are the run lock. A cycle
--   that finds a live `running` lock younger than three hours does nothing
--   but stamp the heartbeat (D2/E4 of the same concept: "läuft noch ein
--   anderer Durchlauf?" is answered before anything is claimed). The panel
--   renders `running` as its own tint, and `paused` (usage-limit brake, 6b)
--   as another — neither is "offline", and neither was expressible before.
--
-- WHAT WRITES IT
--   `scripts/routine-gate.mjs` (Management API, service role → bypasses RLS):
--     check      → last_seen_at, next_run_at, note, state (unless a foreign
--                  run holds the lock, which is preserved)
--     start-run  → state='running', run_started_at=now(), run_finished_at=null
--     end-run    → run_finished_at=now(), state='idle'|'paused', note
--
-- WHAT READS IT
--   `RoutineHeartbeatService` (admins only, unchanged policy): the SELECT
--   policy from 20260730173500 covers the new columns as well.
--
-- PURELY ADDITIVE — nothing is dropped, renamed, or rewritten.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

alter table public.routine_heartbeat
  add column if not exists next_run_at      timestamptz,
  add column if not exists run_started_at   timestamptz,
  add column if not exists run_finished_at  timestamptz,
  add column if not exists state            text not null default 'idle';

alter table public.routine_heartbeat
  drop constraint if exists routine_heartbeat_state_check;
alter table public.routine_heartbeat
  add constraint routine_heartbeat_state_check
  check (state in ('idle', 'running', 'paused'));

comment on column public.routine_heartbeat.next_run_at is
  'When the scheduler is expected to fire the next cycle, computed by the gate '
  'from its cadence table (+ the scheduler jitter). The panel reads "online" '
  'while now < next_run_at + grace; the cadence itself lives nowhere else.';

comment on column public.routine_heartbeat.run_started_at is
  'Start of the run that currently holds (or last held) the run lock. A '
  'running state older than 3 h is a dead run and may be taken over.';

comment on column public.routine_heartbeat.run_finished_at is
  'When that run released the lock (null while it is still working).';

comment on column public.routine_heartbeat.state is
  'idle = polled, nothing in flight · running = a run holds the lock · '
  'paused = the run brake (usage limit) is engaged; the routine keeps '
  'stamping but claims nothing.';

comment on column public.routine_heartbeat.note is
  'Machine-readable key rendered through i18n by the panel (queue-empty, '
  'work:<n>, shipped:<n>, paused-usage-limit, skip-cadence, gate-error, '
  'running). Anything else is shown verbatim — keep it short, never secrets.';
