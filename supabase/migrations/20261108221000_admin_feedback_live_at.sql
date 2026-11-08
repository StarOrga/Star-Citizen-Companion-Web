-- ============================================================
-- 20261108221000_admin_feedback_live_at.sql
-- Feedback: "shipped" must mean ONLINE, not merely merged (batch 2026-11-08, note #4).
--
-- WHAT / WHY
--   `status = 'shipped'` is set when the PR merged. Production can lag behind the merge
--   (Vercel Hobby rate limit: on 2026-11-08 v0.238.0 / #1027 merged while production stayed on
--   the commit before), so the board and the author saw "done" for a change nobody could see.
--   `live_at` is stamped by the feedback watcher (scripts/routine-watcher.mjs settleLive) once
--   the Production deployment of the merge commit, or of a later commit, succeeded.
--     status = 'shipped' and live_at is null      -> merged, not online yet ("lagging")
--     status = 'shipped' and live_at is not null  -> online
--   The status enum stays as it is: queues, reaper and review gate all key on 'shipped'.
--
--   * trigger: a topic that (re-)enters 'shipped' starts without live_at, so a re-ship after a
--     continuation is verified again.
--   * public.my_feedback: the author sees 'done' only when live_at is set; a lagging topic still
--     reads "in Bearbeitung", and the "done" notification fires when it is really online.
--   * public.admin_feedback_board_delta: carries live_at so the admin board can show the lag.
--
-- BACKFILL
--   Topics shipped more than a day ago are assumed online (live_at = shipped_at). Younger ones
--   stay null and are verified by the watcher on its next tick.
--
-- Drops nothing (my_feedback is dropped and recreated verbatim apart from the done-rule; the
-- revoke/grant pair is the load-bearing one of 20260903230000_user_feedback_withdraw.sql).
-- ============================================================

alter table public.admin_feedback add column if not exists live_at timestamptz;

comment on column public.admin_feedback.live_at is
  'When the Production deployment carrying the merge was seen succeeding (set by the feedback watcher). Null on a shipped topic = merged, not online yet.';

update public.admin_feedback
   set live_at = shipped_at
 where status = 'shipped' and live_at is null and shipped_at is not null and shipped_at < now() - interval '1 day';

create or replace function public.admin_feedback_reset_live_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    new.live_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists admin_feedback_reset_live_at on public.admin_feedback;
create trigger admin_feedback_reset_live_at
  before update of status on public.admin_feedback
  for each row execute function public.admin_feedback_reset_live_at();

-- ---- author-facing status: 'done' only when online ----------------------------------------
drop view if exists public.my_feedback;
create view public.my_feedback
with (security_invoker = false, security_barrier = true) as
select
  f.id,
  f.body,
  f.created_at,
  f.updated_at,
  f.area,
  case when f.status in ('declined', 'rejected') then f.decision_note end as decision_note,
  case
    when f.status in ('declined', 'rejected') then 'declined'
    when f.status = 'shipped' and f.live_at is not null then 'done'
    when f.status = 'needs_input_author'      then 'question'
    else 'in_progress'
  end as author_status,
  public.feedback_withdrawable(f.id) as can_delete
from public.admin_feedback f
where f.source = 'user'
  and f.author_id = auth.uid();

comment on view public.my_feedback is
  'Author-facing projection of public.admin_feedback: a user sees only their own '
  'submitted topics, and of those only body/timestamps, their own area tag, the '
  'coarse status (done = shipped AND online, live_at set), the admin decision note and whether they may still withdraw it. '
  'Deliberately security_invoker = false — running as the view owner is what makes '
  'the column projection enforceable; the row filter (author_id = auth.uid()) is '
  'baked into the view body and cannot be bypassed. Raw status, processing_note, '
  'ship_ref and processed_at never leave the admin side. '
  'READ-ONLY BY GRANT: the view is auto-updatable and runs with owner rights, so '
  'INSERT/UPDATE/DELETE must stay revoked from anon AND authenticated — otherwise it '
  'is a write-through bypass of every RLS policy on admin_feedback.';

revoke all on public.my_feedback from public, anon, authenticated;
grant select on public.my_feedback to authenticated;

-- ---- admin board: live_at in the delta read -----------------------------------------------
create or replace function public.admin_feedback_board_delta(p_since timestamptz default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'now', now(),
    'full', p_since is null,
    'topics', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'seq', f.seq, 'author_id', f.author_id, 'body', f.body, 'status', f.status,
        'ship_ref', f.ship_ref, 'processing_note', f.processing_note,
        'created_at', f.created_at, 'updated_at', f.updated_at, 'shipped_at', f.shipped_at, 'live_at', f.live_at,
        'processed_at', f.processed_at, 'reviewed_at', f.reviewed_at, 'source', f.source,
        'triaged', f.triaged, 'decision_note', f.decision_note, 'area', f.area,
        'summary', f.summary, 'complex', f.complex,
        'author', case when p.id is null then null else
          jsonb_build_object('display_name', p.display_name, 'username', p.username, 'role', p.role) end
      ) order by f.created_at)
      from public.admin_feedback f
      left join public.profiles p on p.id = f.author_id
      where p_since is null or f.updated_at > p_since or f.created_at > p_since
    ), '[]'::jsonb),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'feedback_id', m.feedback_id, 'author_id', m.author_id,
        'is_system', m.is_system, 'body', m.body, 'created_at', m.created_at,
        'author', case when p.id is null then null else
          jsonb_build_object('display_name', p.display_name, 'username', p.username, 'role', p.role) end
      ) order by m.created_at)
      from public.admin_feedback_messages m
      left join public.profiles p on p.id = m.author_id
      where p_since is null or m.created_at > p_since
    ), '[]'::jsonb),
    'author_messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'feedback_id', a.feedback_id, 'author_id', a.author_id,
        'from_admin', a.from_admin, 'is_question', a.is_question,
        'body', a.body, 'created_at', a.created_at
      ) order by a.created_at)
      from public.feedback_author_messages a
      where p_since is null or a.created_at > p_since
    ), '[]'::jsonb),
    'topic_ids', coalesce((select jsonb_agg(f.id) from public.admin_feedback f), '[]'::jsonb),
    'message_count', (select count(*) from public.admin_feedback_messages),
    'author_message_count', (select count(*) from public.feedback_author_messages)
  );
$$;

revoke all on function public.admin_feedback_board_delta(timestamptz) from public, anon;
grant execute on function public.admin_feedback_board_delta(timestamptz) to authenticated;
