-- ============================================================
-- 20260929012045_admin_feedback_board_delta.sql
-- Feedback board: one delta read instead of three full selects (AUD-341, AUD-155; plan D14).
--
-- WHAT / WHY
--   The board polled every 20 s: every topic, every reply (with ALL topic ids in
--   one in(...) URL) and every author message — each select silently capped at
--   1000 rows (supabase/config.toml max_rows). This function answers in ONE call:
--   p_since null → the whole board; p_since set → only topics whose updated_at or
--   created_at is newer, and messages created after it, plus the live topic ids
--   and the message counts the client needs to notice deletions. A jsonb scalar
--   is one row, so max_rows never truncates it.
--
--   Why updated_at is enough: the trigger admin_feedback_touch_updated_at
--   (20260706223810_admin_feedback.sql) bumps it on EVERY update, including the
--   status sync from the author channel. Messages are never edited (insert/delete
--   policies only), and a trigger pins created_at of author messages
--   (20260726170000_user_feedback_channel.sql). The client re-reads with a 30 s
--   overlap, so a transaction that committed just after a poll is not missed.
--
--   The column lists match the three selects in admin-feedback.component.ts
--   exactly — add a column there, add it here.
--
-- SECURITY INVOKER (not DEFINER)
--   RLS keeps applying exactly as for the three selects it replaces
--   (admin_feedback_read, admin_feedback_messages_read,
--   feedback_author_messages_read, profiles_admin_read_all).
--
-- WHO CALLS IT
--   src/app/admin/feedback/admin-feedback.component.ts refresh(). Until this
--   migration is live the component falls back to the old three selects when
--   the RPC answers PGRST202 (function missing).
--
-- Drops nothing. No table changes.
-- ============================================================

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
        'created_at', f.created_at, 'updated_at', f.updated_at, 'shipped_at', f.shipped_at,
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

comment on function public.admin_feedback_board_delta(timestamptz) is
  'Feedback board read in one call: whole board (p_since null) or only what changed since p_since, plus live topic ids and message counts to detect deletions. SECURITY INVOKER, RLS applies (plan D14).';

-- Supabase grants EXECUTE on new public functions to anon + authenticated by default.
revoke all on function public.admin_feedback_board_delta(timestamptz) from public, anon;
grant execute on function public.admin_feedback_board_delta(timestamptz) to authenticated;
