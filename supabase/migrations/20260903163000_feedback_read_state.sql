-- ============================================================
-- 20260903163000_feedback_read_state.sql
-- Per-user, per-topic read marker for the NON-ADMIN feedback panel.
--
-- WHY
--   A viewer or collaborator sends feedback and then hears nothing: the team
--   replies, the topic ships or is declined, and the only place that says so is
--   a panel behind a FAB nobody re-opens on spec. The FAB therefore needs the
--   thing every messenger has — a small unread count that appears when there is
--   news on YOUR topics and disappears once you have looked (admin feedback
--   e684c946).
--
--   "Looked" has to survive a new device and a cleared browser, otherwise the
--   badge lies on every second machine. So the marker lives on the account, not
--   in localStorage.
--
-- WHAT THIS CREATES (purely additive — nothing is dropped, renamed or updated):
--   public.feedback_read_state         — one row per (user, topic).
--   public.feedback_read_state_guard() — BEFORE INSERT/UPDATE guard: pins
--                                        last_read_at on API writes and refuses
--                                        a topic the caller does not own.
--
-- WHY TWO COLUMNS AND NOT JUST A TIMESTAMP
--   News is of two kinds and only one of them has a timestamp the author can
--   see. A new admin reply is a row in feedback_author_messages with a
--   created_at — comparable against last_read_at. A status change (shipped /
--   declined / a question opened) has no author-visible timestamp at all:
--   admin_feedback.updated_at moves for every internal edit the routine makes,
--   so using it would light the badge for churn the author is not even allowed
--   to see. Storing the coarse author status that was on screen at read time
--   makes the second kind exact: news iff the status differs from the one you
--   last saw. It is deliberately the CLIENT's value ("what I saw"), not a
--   re-derivation from the current row — a status that changes right after the
--   read must still count as news.
--
-- NOT A NOTIFICATION LOG
--   No history, no per-message rows, no delivery state: one row per topic that
--   is overwritten on every read. The badge is derived by the client from
--   (topics, author messages, this table), so nothing here has to be kept in
--   sync by a trigger on the board.
--
-- IDEMPOTENT: safe to re-run (if-not-exists / or-replace / drop-if-exists).
-- ============================================================

create table if not exists public.feedback_read_state (
  -- auth.users, not profiles: the marker belongs to the login, and deleting the
  -- account must take it along (the same cascade the delete-user function
  -- relies on for feedback_drafts).
  user_id          uuid not null references auth.users (id) on delete cascade,
  -- Delete the topic and its read markers go with it; a marker for a topic that
  -- no longer exists could never be reached by its owner again.
  feedback_id      uuid not null references public.admin_feedback (id) on delete cascade,
  last_read_at     timestamptz not null default now(),
  -- The coarse author-facing status (public.my_feedback.author_status) that was
  -- on screen when the author last looked. The vocabulary is pinned here for the
  -- same reason `area` is pinned on admin_feedback: the insert policy below says
  -- nothing about this column, so the CHECK is the only thing keeping free text
  -- out of a value the client compares against.
  last_seen_status text not null
    check (last_seen_status in ('in_progress', 'question', 'done', 'declined')),
  primary key (user_id, feedback_id)
);

-- Makes the ON DELETE CASCADE from admin_feedback an index scan instead of a
-- sequential one. The PK already covers every read the client does.
create index if not exists feedback_read_state_feedback_idx
  on public.feedback_read_state (feedback_id);

comment on table public.feedback_read_state is
  'When a feedback author last looked at one of their own topics, and which '
  'coarse status they saw. Drives the unread badge on the non-admin feedback FAB '
  '(admin feedback e684c946). PRIVATE to its owner — admins have no policy here: '
  'whether someone has read their reply is not board data.';

comment on column public.feedback_read_state.last_seen_status is
  'The public.my_feedback.author_status value the author had on screen at '
  'last_read_at — the client''s statement about what it showed, not a '
  're-derivation of the current row. A status that changes right after a read '
  'must still count as news.';

-- ============================================================
-- Guard: honest timestamp, own topics only
--
-- SECURITY DEFINER so `owns_feedback` can probe admin_feedback without the
-- caller holding any read grant on it. It touches nothing the caller does not
-- already own.
-- ============================================================

create or replace function public.feedback_read_state_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- PostgREST sets the JWT claims GUC; a migration or backfill running as
  -- postgres keeps full control.
  via_api boolean := nullif(current_setting('request.jwt.claims', true), '') is not null;
begin
  if via_api then
    -- The client sends a timestamp too, but a skewed device clock would either
    -- hide real news forever (clock ahead) or replay it (clock behind). The
    -- server clock is the one the message timestamps come from, so it decides.
    new.last_read_at := now();
  end if;

  -- Only the author of a user-submitted topic may mark it read. Without this the
  -- FK alone would answer "does this uuid exist on the board?" for anyone
  -- willing to read the error — the same existence oracle feedback_drafts closes.
  if not public.owns_feedback(new.feedback_id) then
    raise exception 'read state may only be set on your own feedback topic'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.feedback_read_state_guard() is
  'BEFORE INSERT/UPDATE guard for public.feedback_read_state: pins last_read_at '
  'to the server clock on API writes and refuses a topic the caller does not '
  'author (the FK would otherwise be an existence oracle for the admin board).';

drop trigger if exists feedback_read_state_guard on public.feedback_read_state;
create trigger feedback_read_state_guard
  before insert or update on public.feedback_read_state
  for each row execute function public.feedback_read_state_guard();

-- ============================================================
-- RLS — owner only, in every direction
-- ============================================================

alter table public.feedback_read_state enable row level security;

drop policy if exists feedback_read_state_read on public.feedback_read_state;
create policy feedback_read_state_read on public.feedback_read_state
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists feedback_read_state_insert on public.feedback_read_state;
create policy feedback_read_state_insert on public.feedback_read_state
  for insert to authenticated
  with check (user_id = auth.uid());

-- USING and WITH CHECK both, so a marker can never be moved onto another account.
drop policy if exists feedback_read_state_update on public.feedback_read_state;
create policy feedback_read_state_update on public.feedback_read_state
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists feedback_read_state_delete on public.feedback_read_state;
create policy feedback_read_state_delete on public.feedback_read_state
  for delete to authenticated
  using (user_id = auth.uid());

-- Supabase grants ALL on new objects in `public` to anon + authenticated by
-- default, and TRUNCATE is not subject to RLS at all — strip first, then hand
-- back exactly the four verbs the policies above are written for. anon keeps
-- nothing: a read marker belongs to an account.
revoke all on public.feedback_read_state from public, anon, authenticated;
grant select, insert, update, delete on public.feedback_read_state to authenticated;
