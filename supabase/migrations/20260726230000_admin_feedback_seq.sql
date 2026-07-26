-- ============================================================
-- 20260726230000_admin_feedback_seq.sql
-- A stable, sequential topic number for the feedback board.
--
-- WHY (admin_feedback 21587480, verbatim: "Bitte gib jedem Titel der Anfragen
-- eine Fortlaufende NUmmer, damit man sich auf sachen beziehen könnte.")
--   A topic can only be referred to today by quoting its text or by pasting a
--   uuid. The board wants a short handle — "#42" — that an admin, another admin
--   and the routine can all use in prose.
--
--   That handle MUST be assigned server-side. The obvious cheap alternative — a
--   client-side list index — is useless for the stated purpose: the board is
--   filtered by author/status, re-ordered by relevance while searching, split
--   into Aktiv/Archiv and topics get deleted, so a positional number would mean
--   something different in every view and would silently shift under a topic
--   the admin already referred to. A sequence-backed column is the same number
--   forever, in every view, for everybody.
--
-- WHAT THIS CREATES / CHANGES (purely additive — nothing dropped or renamed, no
-- existing value overwritten):
--   sequence public.admin_feedback_seq_seq  — the number generator
--   admin_feedback.seq (integer, not null, unique)
--                                           — the topic number, defaulted from
--                                             that sequence on insert
--   admin_feedback_normalize_user_insert()  — extended: an API insert of a
--                                             USER-submitted topic gets its seq
--                                             assigned server-side, so a
--                                             non-admin cannot pick their own
--                                             number (all other pinned columns
--                                             are unchanged)
--
-- BACKFILL
--   Every pre-existing row is numbered by `created_at` ascending (id as the
--   tiebreaker for rows sharing a timestamp), so the OLDEST topic on the board
--   becomes #1 and the numbering reads like the board's own history. Only rows
--   with `seq is null` are touched, which makes a re-run a no-op.
--
-- GAPS ARE EXPECTED, AND THAT IS FINE
--   Sequences are not transactional: a rolled-back insert, an insert rejected by
--   RLS, or a deleted topic leaves its number unused. A reference number only has
--   to be *stable and unique*, never dense — closing gaps would mean renumbering
--   topics, which is exactly the thing this column exists to prevent.
--
-- VISIBILITY: ADMIN-ONLY, DELIBERATELY
--   The number rides on `admin_feedback`'s existing admin-only SELECT policy and
--   is NOT added to `public.my_feedback`. The author of a user-submitted topic
--   never sees it. Reason: the projection in `my_feedback` is security-critical
--   (security_invoker = false + an auto-updatable view, see
--   20260726170000_user_feedback_channel.sql), and the asked-for benefit —
--   referring to a topic in an internal conversation — is entirely on the admin
--   side. Exposing it later is a two-line, additive change to that view; it would
--   have to keep the `author_id = auth.uid() and source = 'user'` filter and the
--   `revoke all … / grant select` pair exactly as they are.
--
-- IDEMPOTENT: safe to re-run (if-not-exists / or-replace, backfill guarded by
-- `seq is null`, setval recomputed from the data).
-- ============================================================

-- ============================================================
-- 1) The generator
-- ============================================================

create sequence if not exists public.admin_feedback_seq_seq
  as integer minvalue 1 start with 1;

comment on sequence public.admin_feedback_seq_seq is
  'Topic numbers for public.admin_feedback.seq. Monotonic, never reused, gaps '
  'expected (rolled-back / RLS-rejected inserts and deleted topics burn a value).';

-- ============================================================
-- 2) The column
--
-- Added nullable so the existing rows can be numbered in a defined ORDER first;
-- NOT NULL is asserted at the end, once every row carries a number.
-- ============================================================

alter table public.admin_feedback
  add column if not exists seq integer;

comment on column public.admin_feedback.seq is
  'Stable, sequential topic number shown next to the topic title in the admin '
  'panel ("#42") so a topic can be referred to by number instead of by its text '
  'or its uuid (feedback 21587480). Assigned from admin_feedback_seq_seq on '
  'insert and never changed afterwards — reordering, filtering, searching or '
  'deleting topics must not move it. Gaps are normal. Admin-only: not projected '
  'into public.my_feedback.';

-- ============================================================
-- 3) Backfill — oldest topic first, so #1 is the board's first entry
-- ============================================================

do $backfill$
declare
  base integer;
begin
  -- Where to continue from. 0 on the first run (the column is brand new); on a
  -- partially numbered table the already-assigned numbers are left untouched and
  -- the rest is appended above them.
  select coalesce(max(seq), 0) into base from public.admin_feedback;

  with ordered as (
    select id,
           row_number() over (order by created_at asc, id asc) as rn
      from public.admin_feedback
     where seq is null
  )
  update public.admin_feedback f
     set seq = base + o.rn
    from ordered o
   where f.id = o.id;
end
$backfill$;

-- Continue the generator above whatever the backfill assigned. `is_called =
-- false` makes the NEXT nextval() return exactly this value, so the first topic
-- created after this migration is (max + 1) rather than (max + 2).
select setval(
  'public.admin_feedback_seq_seq',
  coalesce((select max(seq) from public.admin_feedback), 0) + 1,
  false
);

-- ============================================================
-- 4) Wire the generator up and lock the column down
-- ============================================================

alter table public.admin_feedback
  alter column seq set default nextval('public.admin_feedback_seq_seq');

-- Tie the sequence's lifetime to the column (a future drop of the column takes
-- the sequence with it instead of leaving an orphan).
alter sequence public.admin_feedback_seq_seq owned by public.admin_feedback.seq;

alter table public.admin_feedback
  alter column seq set not null;

-- The number is a reference handle, so it has to be unique. Doubles as the index
-- behind a "jump to #42" lookup.
create unique index if not exists admin_feedback_seq_key
  on public.admin_feedback (seq);

-- The DEFAULT is evaluated as the INSERTing role, so every role that may insert
-- needs USAGE. Same revoke-then-grant shape as the rest of the feedback area:
-- Supabase grants ALL on new objects in `public` to anon + authenticated, and
-- `anon` can never insert a topic (both insert policies require auth.uid()), so
-- it has no business touching the generator either.
revoke all on sequence public.admin_feedback_seq_seq from public, anon, authenticated;
grant usage on sequence public.admin_feedback_seq_seq to authenticated;

-- ============================================================
-- 5) A non-admin does not get to pick their own number
--
-- `seq` is defaulted, so the insert policy's WITH CHECK cannot pin it: defaults
-- are applied BEFORE the policy runs, which means the check sees whatever value
-- the request supplied and a hand-crafted insert could nail a user topic to
-- "#1" (unique-violation noise) or to "#999999" (a number the board would then
-- show, and that a much later legitimate insert would collide with).
--
-- The existing BEFORE INSERT guard for user-submitted topics is exactly the
-- place for this: it already forces `triaged` and pins the timestamps of API
-- inserts for the same class of reason. Recreated here verbatim except for the
-- two added `new.seq := nextval(...)` lines. Fully qualified because the
-- function runs with `search_path = ''`.
--
-- Admin/routine inserts are left to the DEFAULT — an admin may already UPDATE
-- every column of every row (admin_feedback_update), so there is nothing to
-- protect against there, and going through the default keeps the common path at
-- exactly one consumed sequence value.
-- ============================================================

create or replace function public.admin_feedback_normalize_user_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Only normalise requests that came through the API (PostgREST sets the JWT
  -- claims GUC). A migration or backfill running as postgres keeps full control.
  via_api boolean := nullif(current_setting('request.jwt.claims', true), '') is not null;
  recent  integer;
begin
  if new.source <> 'user' then
    return new;
  end if;
  new.triaged := false;
  if via_api then
    -- The topic number is the routine's/board's to hand out, never the
    -- submitter's (feedback 21587480). Overwriting the supplied value burns one
    -- extra sequence value per user submission; gaps are expected by design.
    new.seq := nextval('public.admin_feedback_seq_seq');
    new.created_at := now();
    new.updated_at := now();
    select count(*) into recent
      from public.admin_feedback f
     where f.source = 'user'
       and f.author_id = new.author_id
       and f.created_at > now() - interval '1 hour';
    if recent >= 10 then
      raise exception 'feedback rate limit reached: at most 10 topics per hour'
        using errcode = '54000';
    end if;
  elsif new.seq is null then
    -- Non-API insert that bypassed the default (explicit column list with a NULL
    -- seq): still give it a number rather than failing the NOT NULL constraint.
    new.seq := nextval('public.admin_feedback_seq_seq');
  end if;
  return new;
end;
$$;

comment on function public.admin_feedback_normalize_user_insert() is
  'BEFORE INSERT guard for user-submitted feedback: forces triaged = false, '
  'assigns the topic number (seq) server-side, pins the timestamps of API inserts '
  'to now() (they drive the oldest-first queues) and rate-limits an author to 10 '
  'topics per hour. Admin/routine inserts pass through and take seq from the '
  'column default.';

-- The trigger itself is unchanged (already created in
-- 20260726170000_user_feedback_channel.sql); recreated for the idempotent path.
drop trigger if exists admin_feedback_normalize_user_insert on public.admin_feedback;
create trigger admin_feedback_normalize_user_insert
  before insert on public.admin_feedback
  for each row execute function public.admin_feedback_normalize_user_insert();
