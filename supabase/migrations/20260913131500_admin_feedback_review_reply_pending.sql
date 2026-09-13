-- ============================================================
-- 20260913131500_admin_feedback_review_reply_pending.sql
-- A shipped topic remembers that its ✅ review reply is still owed.
--
-- WHY
--   STEP 4b of the routine posts the review reply only after the Production
--   deployment for the merge SHA was observed green — up to 15 minutes of
--   polling AFTER the merge. That polling is the last thing a run does, and
--   it is exactly where a run dies when the usage limit hits (observed
--   2026-09-06 13:07Z: three PRs merged, the run died at 98 % of the 5-h
--   window mid-verification, no reply was ever posted). Until now the reply
--   depended on the SAME run surviving; nothing in the queue could see that
--   a reply was missing, because query (d) only triggers on a new HUMAN
--   message (concept 2026-09-13-feedback-routine-takt-anweisung, 6d).
--
-- WHAT
--   `review_reply_pending` is set to true in the same UPDATE that marks the
--   topic `shipped`, and cleared by the run that actually posts the reply.
--   Query (f) — `status = 'shipped' and review_reply_pending` — is read at the
--   start of every working run, BEFORE new items are claimed: the next run
--   re-verifies the deployment (never trusts the old merge blindly — Vercel
--   may have rate-limited it) and posts the reply the dead run owed.
--
-- WHO SEES IT
--   Admins (existing policies). The column is not part of the `my_feedback`
--   view, so feedback authors never see routine bookkeeping.
--
-- PURELY ADDITIVE — nothing is dropped, renamed, or rewritten.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

alter table public.admin_feedback
  add column if not exists review_reply_pending boolean not null default false;

comment on column public.admin_feedback.review_reply_pending is
  'True from the moment a topic is marked shipped until the ✅/⏳ review reply '
  'has actually been posted in its thread. Query (f) of the routine picks '
  'these up first thing in a run, so a run that dies during deploy '
  'verification never leaves a shipped topic without its reply.';

create index if not exists admin_feedback_review_reply_pending_idx
  on public.admin_feedback (shipped_at)
  where review_reply_pending;
