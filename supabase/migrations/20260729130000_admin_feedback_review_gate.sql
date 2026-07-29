-- ============================================================
-- 20260729130000_admin_feedback_review_gate.sql
-- The review gate: work is not finished when it ships, it is finished when a
-- human said so.
--
-- WHY
--   Until now `shipped` and `issue_created` dropped a topic straight into the
--   archive. Nobody ever looked at the result on the live app, and if the change
--   was wrong the only way back was to notice it by accident and reply into a
--   thread that had already left the board. The routine's own post-ship
--   continuation loop (docs/feedback-routine, query (d)) needs a human reply to
--   trigger — which needs a human who is still being shown the topic.
--
--   So the terminal statuses now hand the topic to the admin instead of to the
--   archive: it stays on the ACTIVE board in an "Abnahme" state until the admin
--   either accepts it (→ Erledigt) or picks the conversation back up (→ the
--   routine's queue).
--
-- WHAT THIS CHANGES
--   admin_feedback.reviewed_at — null while the outcome still needs an admin's
--                                sign-off, a timestamp once it has it. NOT a new
--                                status value: the routine's whole contract is
--                                written against `status`, and adding a state to
--                                that machine would have meant auditing every
--                                query in the routine. This column is invisible
--                                to it.
--
-- BACKFILL (deliberate)
--   Every topic that already reached a terminal status is stamped as reviewed.
--   The gate is about work that lands from now on; dumping the whole shipped
--   history into a fresh "needs your sign-off" pile would bury the two or three
--   topics that actually do.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   `declined` (and legacy `rejected`) never enter the gate — those ARE the
--   admin's decision, there is nothing left to sign off.
--
-- IDEMPOTENT: safe to re-run. ADDITIVE: no column is dropped or rewritten
-- beyond the one-time backfill below, which only ever fills nulls.
-- ============================================================

alter table public.admin_feedback
  add column if not exists reviewed_at timestamptz;

comment on column public.admin_feedback.reviewed_at is
  'Admin sign-off on a finished topic. Null on a shipped / issue_created row '
  'means the outcome is waiting for review and the topic stays on the ACTIVE '
  'board ("Abnahme"); a timestamp archives it as Erledigt. Reopening the '
  'conversation sets it back to null and the status back to ''open''. Never read '
  'or written by the autonomous routine — its contract is status-only.';

-- One-time: everything that ended before the gate existed counts as reviewed.
-- `coalesce` picks the most honest stamp available for each row rather than
-- pretending they were all signed off at migration time.
update public.admin_feedback
   set reviewed_at = coalesce(shipped_at, processed_at, updated_at, created_at)
 where status in ('shipped', 'issue_created')
   and reviewed_at is null;

-- The board reads the pending-review set on every load; everything else about
-- this column is a single-row write.
create index if not exists admin_feedback_pending_review_idx
  on public.admin_feedback (status, created_at)
  where reviewed_at is null and status in ('shipped', 'issue_created');
