-- ============================================================
-- 20260707190000_admin_feedback.sql
-- Admin feedback board — an internal, admins-only channel where any
-- admin can post free-text suggestions ("what could be better"). The
-- nightly 19:00 cloud routine reads the open items, implements them,
-- ships on green (build+tests) and writes the status back here.
--
-- WHAT THIS CREATES
--   admin_feedback  — one row per message. Shared board: every admin
--                     sees every message. status drives the routine's
--                     work queue: open → in_progress → shipped | rejected.
--   admin_feedback_touch_updated_at — trigger fn keeping updated_at fresh.
--
-- RLS
--   Admins-only (public.is_admin(), from 00003). SELECT: all admins read
--   the whole board. INSERT: an admin posts as themselves. UPDATE: any
--   admin may edit text / change status (trusted internal tool). DELETE:
--   an admin may remove only their own message. The service_role (the
--   nightly routine) bypasses RLS to flip status + attach ship_ref.
--
-- IDEMPOTENT: safe to re-run (if-not-exists / or-replace / drop-if-exists
-- on policies). ADDITIVE: drops nothing pre-existing.
-- ============================================================

create table if not exists public.admin_feedback (
  id             uuid primary key default gen_random_uuid(),
  author_id      uuid references public.profiles (id) on delete set null,
  body           text not null check (length(btrim(body)) between 1 and 20000),
  status         text not null default 'open'
                   check (status in ('open', 'in_progress', 'shipped', 'rejected')),
  -- Link the routine attaches when it lands work (PR or commit URL).
  ship_ref       text,
  -- Free-text note from the routine (e.g. why rejected, or a build-failure hint).
  processing_note text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  shipped_at     timestamptz,
  -- When the routine last acted on this row (null = never picked up).
  processed_at   timestamptz
);

create index if not exists admin_feedback_created_idx
  on public.admin_feedback (created_at desc);
-- The routine's work-queue read: open items, oldest first.
create index if not exists admin_feedback_status_created_idx
  on public.admin_feedback (status, created_at);

comment on table public.admin_feedback is
  'Admins-only feedback board. Shared: all admins read all rows. The nightly '
  '19:00 routine consumes status=open items, implements them, ships on green '
  'and writes status/ship_ref back via service_role.';

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.admin_feedback_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists admin_feedback_set_updated_at on public.admin_feedback;
create trigger admin_feedback_set_updated_at
  before update on public.admin_feedback
  for each row execute function public.admin_feedback_touch_updated_at();

-- ============================================================
-- RLS
-- ============================================================
alter table public.admin_feedback enable row level security;

drop policy if exists admin_feedback_read on public.admin_feedback;
create policy admin_feedback_read on public.admin_feedback
  for select to authenticated
  using (public.is_admin());

drop policy if exists admin_feedback_insert on public.admin_feedback;
create policy admin_feedback_insert on public.admin_feedback
  for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid());

-- Any admin may edit text / move status (trusted internal board).
drop policy if exists admin_feedback_update on public.admin_feedback;
create policy admin_feedback_update on public.admin_feedback
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- An admin may delete only their own message.
drop policy if exists admin_feedback_delete_own on public.admin_feedback;
create policy admin_feedback_delete_own on public.admin_feedback
  for delete to authenticated
  using (public.is_admin() and author_id = auth.uid());

grant select, insert, update, delete on public.admin_feedback to authenticated;
