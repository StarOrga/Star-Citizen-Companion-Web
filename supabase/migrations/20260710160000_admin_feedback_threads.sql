-- ============================================================
-- 20260710160000_admin_feedback_threads.sql
-- Per-topic chat for the admin feedback board + a 'needs_input' status.
--
-- WHY: a 'rejected' item ended the conversation — an admin had no way to
-- reply and steer the routine. Now every topic (an admin_feedback row)
-- carries a thread of follow-up messages (admin_feedback_messages), and the
-- routine parks an item it can't auto-ship as status='needs_input' with a
-- SYSTEM reply asking for a decision, instead of a terminal 'rejected'. The
-- admin answers in the thread; the next routine run resumes from that answer.
--
-- WHAT THIS CREATES / CHANGES
--   admin_feedback.status           — adds 'needs_input' to the CHECK vocab.
--   admin_feedback_messages         — one row per reply on a topic.
--
-- RLS: admins-only (public.is_admin(), from 00003), mirroring admin_feedback.
--   Human replies go through RLS (is_system=false, author_id=self). The
--   routine posts SYSTEM replies via service_role (is_system=true), which
--   bypasses RLS.
--
-- IDEMPOTENT / ADDITIVE.
-- ============================================================

-- 1) Extend the status vocabulary with 'needs_input'.
alter table public.admin_feedback drop constraint if exists admin_feedback_status_check;
alter table public.admin_feedback
  add constraint admin_feedback_status_check
  check (status in ('open', 'in_progress', 'shipped', 'rejected', 'needs_input'));

-- 2) Thread messages.
create table if not exists public.admin_feedback_messages (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references public.admin_feedback (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  -- true = written by the automated routine (service_role), not a human admin.
  is_system    boolean not null default false,
  body         text not null check (length(btrim(body)) between 1 and 20000),
  created_at   timestamptz not null default now()
);

create index if not exists admin_feedback_messages_thread_idx
  on public.admin_feedback_messages (feedback_id, created_at);

comment on table public.admin_feedback_messages is
  'Per-topic replies on the admin feedback board. Human admins post via RLS '
  '(is_system=false, author_id=self); the routine posts system replies via '
  'service_role (is_system=true, author_id=null).';

alter table public.admin_feedback_messages enable row level security;

drop policy if exists admin_feedback_messages_read on public.admin_feedback_messages;
create policy admin_feedback_messages_read on public.admin_feedback_messages
  for select to authenticated
  using (public.is_admin());

-- A human admin posts as themselves; system rows are service_role-only.
drop policy if exists admin_feedback_messages_insert on public.admin_feedback_messages;
create policy admin_feedback_messages_insert on public.admin_feedback_messages
  for insert to authenticated
  with check (public.is_admin() and author_id = auth.uid() and is_system = false);

-- Any admin may delete a reply (trusted internal board; topic delete cascades).
drop policy if exists admin_feedback_messages_delete on public.admin_feedback_messages;
create policy admin_feedback_messages_delete on public.admin_feedback_messages
  for delete to authenticated
  using (public.is_admin());

grant select, insert, delete on public.admin_feedback_messages to authenticated;
