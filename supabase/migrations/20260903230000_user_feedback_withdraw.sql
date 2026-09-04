-- 20260903230000_user_feedback_withdraw.sql
--
-- Feedback 892013b6: "Es sollte möglich sein, Feedback selber wieder zu löschen
-- wenn man sieht es wurde schon gemacht >.<"
--
-- An author may WITHDRAW their own topic — but only while withdrawing costs
-- nobody anything. The window is deliberately narrow:
--
--   * the topic is theirs (`source = 'user'`, `author_id = auth.uid()`),
--   * it is still `open` — the routine has not claimed it, so no branch, no PR
--     and no shipped change hangs off it, and
--   * NOBODY has written on it yet — neither the author-facing channel nor the
--     internal admin <-> routine thread has a single message.
--
-- The last condition is the one that is easy to miss. A topic can come BACK to
-- `open` long after it was worked on (the reaper reopens an orphaned claim, an
-- admin reply reopens an archived topic, "Gespräch wieder aufnehmen" reopens a
-- shipped one) and then carries a conversation the admin owns. `status = 'open'`
-- alone would let one click cascade that whole thread away. "Untouched" is the
-- honest reading of the ask anyway: I filed it, then noticed it already exists.
--
-- Everything past that window stays exactly as it is. A topic somebody has
-- answered, worked on, shipped or declined is a record, not a draft — the author
-- keeps seeing it, and only an admin can remove it.
--
-- ADDITIVE ONLY. One new function, one new DELETE policy, and `my_feedback`
-- recreated with one column appended. No table, column, policy or grant is
-- dropped or narrowed; the existing admin-only `admin_feedback_delete` policy is
-- untouched and keeps working (policies are OR'd).
--
--   public.feedback_withdrawable(uuid)  — the window, as one predicate
--   public.admin_feedback               — + policy admin_feedback_delete_author
--   public.my_feedback                  — + can_delete, so the UI can offer it
--
-- ============================================================
-- 1) The window, defined once
--
-- Both the policy and the view need this answer, and they must never drift: a
-- button the database then refuses is worse than no button. So it lives in one
-- SECURITY DEFINER function, exactly like `feedback_awaits_author`
-- (20260726170000) and for the same reason — the author cannot read
-- `admin_feedback` or `admin_feedback_messages` at all, so an inline EXISTS in an
-- invoker-rights context would silently evaluate to "no messages" and open the
-- window wide.
--
-- STABLE + SET search_path TO '' + fully qualified names, per the same house
-- rules the sibling helpers follow.
-- ============================================================

create or replace function public.feedback_withdrawable(fid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
    from public.admin_feedback f
    where f.id = fid
      and f.source = 'user'
      and f.author_id = auth.uid()
      and f.status = 'open'
  )
  and not exists (
    select 1 from public.feedback_author_messages m where m.feedback_id = fid
  )
  and not exists (
    select 1 from public.admin_feedback_messages m where m.feedback_id = fid
  );
$function$;

comment on function public.feedback_withdrawable(uuid) is
  'May the CURRENT user withdraw (hard-delete) this feedback topic? True only '
  'for their own source=''user'' topic that is still status=''open'' AND carries '
  'no message in either thread — i.e. nothing has been built on it and nobody '
  'has replied to it. Single source of truth for the admin_feedback_delete_author '
  'policy and the my_feedback.can_delete column, so the offered button and the '
  'enforced rule can never drift apart.';

-- ============================================================
-- 2) The DELETE policy
--
-- Permissive, so it is OR'd with the existing admin-only `admin_feedback_delete`
-- — admins lose nothing. `not is_admin()` mirrors the author INSERT policy
-- (`admin_feedback_insert_author`): the two halves of this board stay separate
-- rules rather than one predicate nobody can read.
--
-- The cascade is intentional and total. Every child FK on admin_feedback is ON
-- DELETE CASCADE (author messages, admin messages, drafts, read state), which is
-- precisely why the window above requires both threads to be empty: inside it
-- there is nothing left to cascade but the row's own draft and read marker.
-- ============================================================

drop policy if exists admin_feedback_delete_author on public.admin_feedback;
create policy admin_feedback_delete_author on public.admin_feedback
  for delete
  to authenticated
  using ((not public.is_admin()) and public.feedback_withdrawable(id));

-- ============================================================
-- 3) public.my_feedback — tell the author when the button applies
--
-- The author-visible status is COARSE on purpose: `open`, `in_progress`,
-- `needs_input` and `issue_created` all read as "in Bearbeitung". So the client
-- cannot derive the window from what it already has — without this column it
-- would have to offer the button on every topic and let most clicks fail.
--
-- Recreated verbatim apart from the appended `can_delete`. The revoke/grant pair
-- below is LOAD-BEARING and repeated for the same reason as in 20260726170000
-- and 20260903120000: the view runs with owner rights, so Supabase's default ALL
-- grant on a freshly created view would be a write-through bypass of every RLS
-- policy on admin_feedback. `grant select` alone does not remove it.
-- ============================================================

drop view if exists public.my_feedback;
create view public.my_feedback
with (security_invoker = false, security_barrier = true) as
select
  f.id,
  f.body,
  f.created_at,
  f.updated_at,
  f.area,
  -- Only ever populated on a declined topic, and only shown there: an admin who
  -- drafts a note before deciding must not have it leak early.
  case when f.status in ('declined', 'rejected') then f.decision_note end as decision_note,
  case
    when f.status in ('declined', 'rejected') then 'declined'
    when f.status = 'shipped'                 then 'done'
    when f.status = 'needs_input_author'      then 'question'
    else 'in_progress'
  end as author_status,
  -- The withdraw window (feedback 892013b6), computed by the same predicate the
  -- DELETE policy enforces. Never a second implementation of the rule.
  public.feedback_withdrawable(f.id) as can_delete
from public.admin_feedback f
where f.source = 'user'
  and f.author_id = auth.uid();

comment on view public.my_feedback is
  'Author-facing projection of public.admin_feedback: a user sees only their own '
  'submitted topics, and of those only body/timestamps, their own area tag, the '
  'coarse status, the admin decision note and whether they may still withdraw it. '
  'Deliberately security_invoker = false — running as the view owner is what makes '
  'the column projection enforceable; the row filter (author_id = auth.uid()) is '
  'baked into the view body and cannot be bypassed. Raw status, processing_note, '
  'ship_ref and processed_at never leave the admin side. '
  'READ-ONLY BY GRANT: the view is auto-updatable and runs with owner rights, so '
  'INSERT/UPDATE/DELETE must stay revoked from anon AND authenticated — otherwise it '
  'is a write-through bypass of every RLS policy on admin_feedback.';

revoke all on public.my_feedback from public, anon, authenticated;
grant select on public.my_feedback to authenticated;
