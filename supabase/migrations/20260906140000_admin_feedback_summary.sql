-- ============================================================
-- 20260906140000_admin_feedback_summary.sql
-- `admin_feedback.summary` — the one-line title the routine writes for a topic.
--
-- WHY
--   The board's card head shows the first 96 characters of the body, cut mid
--   word. For a topic that opens with "Lass uns doch wann kommt der nächste
--   Patch über die patch liste und suche machen und so ein bi…" that row says
--   nothing at all: the ask is in sentence three, and the reader has to open the
--   topic to learn what #200 even is (feedback d08f1983).
--
--   Nothing client-side fixes that — no truncation heuristic can know which
--   sentence carries the request. The one reader that does know is the routine,
--   which reads the whole topic anyway when it claims it. So it writes the
--   title, once, as a by-product of work it already does.
--
-- WHAT THIS CHANGES
--   admin_feedback.summary — a short, neutral, single-line restatement of what
--                            the topic asks for, in the topic's own language.
--                            NULL means "nobody summarised this yet"; the board
--                            then falls back to the body-derived title exactly
--                            as before, so every pre-existing row keeps working
--                            and no backfill is needed.
--
--   The 120-character check keeps it a title. The board renders ~96 characters
--   in a card head and ~120 in the topic sheet, so anything longer would only
--   be cut off again — the cap makes that a write-time error instead of a
--   silent ellipsis.
--
-- WHO WRITES IT
--   The admin-feedback routine, when it claims a topic (docs/feedback-routine
--   "The topic's title"). No trigger, no edge function, no LLM call from the
--   client: the summary costs nothing extra because the routine has already
--   read the topic to decide what to build.
--
-- DELIBERATELY NOT IN `my_feedback`
--   The author-facing view keeps showing the author their own words. The
--   summary is the board's internal shorthand, like `seq`; adding it to the
--   view would mean recreating it (and its load-bearing revoke/grant pair) for
--   a column the author has no use for.
--
-- IDEMPOTENT: safe to re-run. ADDITIVE: nothing is dropped, rewritten or
-- backfilled.
-- ============================================================

alter table public.admin_feedback
  add column if not exists summary text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_feedback_summary_len'
  ) then
    alter table public.admin_feedback
      add constraint admin_feedback_summary_len
      check (summary is null or char_length(summary) <= 120);
  end if;
end $$;

comment on column public.admin_feedback.summary is
  'One-line title for the topic, written by the admin-feedback routine when it '
  'claims the row. NULL = not summarised yet; the board falls back to the '
  'body-derived title. Max 120 chars (admin_feedback_summary_len).';
