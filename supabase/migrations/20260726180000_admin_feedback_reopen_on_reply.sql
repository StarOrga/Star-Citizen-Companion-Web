-- ============================================================
-- 20260726180000_admin_feedback_reopen_on_reply.sql
-- An admin reply reopens an archived (non-shipped terminal) topic.
--
-- WHY
--   Replying in a topic's thread is the admin's natural "let's keep going here"
--   gesture, and for a `shipped` topic it already works: the post-ship review
--   loop (docs/feedback-routine "Post-ship review & continue", queue query (d))
--   reopens it as a continuation. But the other three terminal statuses —
--   `issue_created`, `declined` and legacy `rejected` — were hard dead ends: the
--   reply composer is rendered for them too, so an admin *could* type a reply, but
--   it landed silently in the Archive and nothing ever picked the topic up again.
--   The admin's request: an answer on ANY archived thread should bring the topic
--   back onto the active board (ToDo) so the routine works it further.
--
-- WHAT THIS DOES
--   A trigger on `admin_feedback_messages`: when a HUMAN admin (is_system = false)
--   posts into a topic sitting in a non-shipped terminal status, flip that topic
--   back to `open`. From there the routine's ordinary `status = 'open' and triaged`
--   queue (query (a)) picks it up like any first-time item — so NO routine change
--   and NO panel change is needed: `feedbackBucket` already maps `open` -> ToDo
--   and the row leaves the Archive tab for Active on the next refresh.
--
-- WHY A TRIGGER (and not the client, and not a presentation trick)
--   * Structural — it is the exact mirror of the author-channel status trigger in
--     20260726170000 (an author's answer restores a parked topic's status). The
--     reopen happens no matter which client posted the reply.
--   * The routine stays honest. Its rule "never touch a terminal row" is preserved
--     because the row is no longer terminal once reopened — it is a plain `open`
--     item. No new query, no per-status special case.
--   * `shipped` is deliberately EXCLUDED here. It keeps its own continuation path
--     (query (d)) because that path preserves `shipped_at` for re-ship detection;
--     flipping shipped -> open would throw that away. The two mechanisms are
--     disjoint by status, so they never both fire on one topic.
--
-- WHY is_system = false
--   The routine posts its replies as `is_system = true` (service_role). Gating on
--   `is_system = false` means only a HUMAN reply reopens — exactly the shipped
--   continuation's own convergence rule — so the routine's own messages (e.g. a
--   review reply) can never reopen a topic on their own. And a non-admin can never
--   insert into admin_feedback_messages at all (RLS), so an is_system=false insert
--   is always an admin.
--
-- REOPEN SIDE EFFECTS (admin-confirmed defaults, 2026-07-26)
--   * ship_ref  -> null: an `open` item on the routine's queue must not carry a
--     "link that closed the topic". The routine writes a fresh ship_ref when it
--     ships; the issue itself still lives on GitHub.
--   * decision_note -> null: the "nicht umgesetzt" reason shown to a user topic's
--     author is obsolete the moment the topic is reopened. Clearing it also flips
--     the author's coarse status (public.my_feedback) off 'declined' back to
--     'in_progress' ("In Bearbeitung") on its own.
--   * triaged is left UNTOUCHED (admin-confirmed): a reopened topic that was
--     released stays released and the routine resumes; one that was never released
--     still needs an explicit "Für die Routine freigeben". triaged can only ever
--     move towards MORE review, never less.
--   * processing_note gets a reopen marker (distinct from the reaper's
--     'auto-reopened' prefix, so lifecycleSnapshot's reopened counter is not
--     inflated by it).
--
-- SECURITY DEFINER: an admin has an UPDATE policy on admin_feedback, but the
-- function is defined this way for parity with the sibling triggers and so the
-- reopen is not silently dependent on the caller's row-level UPDATE rights.
--
-- IDEMPOTENT: safe to re-run (or-replace / drop-if-exists).
-- ============================================================

create or replace function public.admin_feedback_reopen_on_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a human reply, and only on the three non-shipped terminal statuses.
  -- `shipped` is intentionally absent — it reopens via the routine's query (d),
  -- which preserves shipped_at.
  if new.is_system then
    return null;
  end if;

  update public.admin_feedback
     set status          = 'open',
         ship_ref        = null,
         decision_note   = null,
         processing_note = 'reopened: admin replied on an archived topic — back on the routine''s queue',
         processed_at    = now()
   where id = new.feedback_id
     and status in ('issue_created', 'declined', 'rejected');

  return null;
end;
$$;

comment on function public.admin_feedback_reopen_on_reply() is
  'Reopens an archived topic when an admin replies in its thread: a human '
  '(is_system=false) reply on an issue_created / declined / legacy rejected topic '
  'flips it back to status=''open'' (clearing ship_ref and decision_note) so the '
  'routine''s open queue picks it up again. shipped is excluded — it keeps its own '
  'post-ship continuation path (query (d)), which preserves shipped_at.';

drop trigger if exists admin_feedback_reopen_on_reply on public.admin_feedback_messages;
create trigger admin_feedback_reopen_on_reply
  after insert on public.admin_feedback_messages
  for each row execute function public.admin_feedback_reopen_on_reply();
