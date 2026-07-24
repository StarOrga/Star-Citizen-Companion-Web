-- ============================================================
-- 20260724220000_admin_feedback_issue_created_status.sql
-- Adds the terminal status 'issue_created' to the admin feedback board.
--
-- WHY: a topic can end in two different "done" ways — it was implemented and
-- shipped (status='shipped', ship_ref = PR url), or it was handed off to a
-- GitHub issue for later/manual work (status='issue_created', ship_ref = issue
-- url). Until now only 'shipped' existed, so an issue hand-off had to stay in
-- an active status and kept cluttering the board. Both statuses are terminal
-- and are shown together in the panel's new Archive tab.
--
-- WHAT THIS CHANGES
--   admin_feedback.status — widens the CHECK vocabulary by 'issue_created'.
--                           Nothing else: no column is dropped or renamed and
--                           no row is touched. 'rejected' stays in the vocab
--                           as a legacy value on old rows.
--
-- Vocabulary after this migration:
--   open | in_progress | needs_input   → active
--   shipped | issue_created | rejected → archived (terminal)
--
-- IDEMPOTENT / ADDITIVE — safe to re-run, drops no data.
--
-- Verified against the live constraint before writing this file (2026-07-24):
--   CHECK (status = ANY (ARRAY['open','in_progress','shipped','rejected','needs_input']))
-- so the statement below re-adds exactly that vocabulary plus 'issue_created'.
-- ============================================================

alter table public.admin_feedback drop constraint if exists admin_feedback_status_check;
alter table public.admin_feedback
  add constraint admin_feedback_status_check
  check (status in ('open', 'in_progress', 'shipped', 'rejected', 'needs_input', 'issue_created'));

comment on column public.admin_feedback.ship_ref is
  'Link to what closed the topic: the PR/commit url for status=shipped, the '
  'GitHub issue url for status=issue_created. Also set on a review-hold '
  'in_progress row (its open PR).';
