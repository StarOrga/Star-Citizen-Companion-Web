-- ============================================================
-- 20260907220000_admin_feedback_complex.sql
-- `admin_feedback.complex` — the admin's "think harder about this one" opt-in.
--
-- WHY
--   Every topic on this board is worked by the same autonomous routine at the
--   same default reasoning depth. Most of them deserve exactly that. A few do
--   not: a topic that spans three layers, rewrites a flow, or asks for a
--   judgement call is worked badly by an agent that treats it like a label
--   change — and the only person who knows that in advance is the admin who
--   writes it (feedback 423e5130: "soll links neben dem senden button eine
--   checkbox sein für 'complex' … die reasoning stufe zwei stufen höher
--   stellen").
--
--   The app cannot turn a model's reasoning knob — that is a property of the
--   agent runtime, not of a web client. What it CAN do is carry the admin's
--   judgement to the agent that picks the topic up, in the one place the agent
--   already reads. This column is that carrier; the rule it triggers lives in
--   `docs/feedback-routine.md` ("Complex topics are worked one gear higher").
--
-- WHAT THIS CHANGES
--   admin_feedback.complex — boolean, NOT NULL, DEFAULT false. `false` is the
--                            normal topic and the value every pre-existing row
--                            takes, so nothing is backfilled and no reader
--                            changes behaviour until an admin ticks the box.
--
--   NOT NULL on purpose: a nullable flag would give the routine three states
--   for a two-state question, and "unknown" would have to be read as "no"
--   everywhere anyway. The DEFAULT makes the ALTER a metadata-only operation
--   in Postgres 11+, so no table rewrite happens on apply.
--
-- WHO WRITES IT
--   The admin's new-topic composer (`feedback-composer.component.ts`), on
--   INSERT. No RLS change was needed for that: `admin_feedback_insert` checks
--   `public.is_admin() and author_id = auth.uid()` and enumerates no columns,
--   and the table-level `grant insert` covers columns added later. An admin may
--   also flip it afterwards through the existing `admin_feedback_update` policy
--   (any admin may edit any row of the internal board).
--
-- ONE THING IS PINNED (hardening, nothing is weakened)
--   The non-admin insert policy `admin_feedback_insert_author` pins every
--   routine-owned column to its neutral value, but it cannot pin a column that
--   did not exist when it was written. Left alone, a hand-crafted request from
--   any signed-in viewer could file a topic pre-marked `complex = true` and so
--   decide how much thinking the routine spends on it — a cost lever handed to
--   an account that may not otherwise write anything to this board.
--
--   The fix goes where the same class of fix already lives: the BEFORE INSERT
--   guard `admin_feedback_normalize_user_insert`, which exists precisely for
--   "the things a WITH CHECK cannot express" and already forces `triaged` and
--   the timestamps for user-sourced rows. Recreated VERBATIM from
--   20260726230000_admin_feedback_seq.sql except for the single added
--   `new.complex := false;` line. No policy is created, dropped or widened, no
--   grant changes, and the admin path is untouched (the guard returns early for
--   every row whose `source` is not 'user').
--
--   An admin may still mark a user topic complex later — the guard is BEFORE
--   INSERT only, so the UPDATE path stays open. That is deliberate: triage is
--   exactly when an admin learns how big a user's ask really is.
--
-- IDEMPOTENT: safe to re-run. ADDITIVE: nothing is dropped, rewritten or
-- backfilled; the only existing object touched is the trigger function above,
-- replaced with itself plus one line.
-- ============================================================

alter table public.admin_feedback
  add column if not exists complex boolean not null default false;

comment on column public.admin_feedback.complex is
  'Admin opt-in (feedback 423e5130): this topic is more involved than usual, so '
  'the routine that works it raises its reasoning/effort two steps above the '
  'default (see docs/feedback-routine.md). Default false = an ordinary topic. '
  'Set in the admin new-topic composer; pinned to false for user-submitted rows '
  'by admin_feedback_normalize_user_insert.';

-- ------------------------------------------------------------
-- The user-insert guard, verbatim + `new.complex := false;`
-- ------------------------------------------------------------
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
  -- How much thinking a topic gets is the admin board's call, never the
  -- submitter's (feedback 423e5130). A user topic an admin considers complex is
  -- marked as such at triage, through the UPDATE path.
  new.complex := false;
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
  'BEFORE INSERT guard for user-submitted feedback: forces triaged = false and '
  'complex = false, assigns the topic number (seq) server-side, pins the '
  'timestamps of API inserts to now() (they drive the oldest-first queues) and '
  'rate-limits an author to 10 topics per hour. Admin/routine inserts pass '
  'through and take seq from the column default.';

-- The trigger itself is unchanged (created in 20260726170000, recreated in
-- 20260726230000); recreated again for the idempotent path.
drop trigger if exists admin_feedback_normalize_user_insert on public.admin_feedback;
create trigger admin_feedback_normalize_user_insert
  before insert on public.admin_feedback
  for each row execute function public.admin_feedback_normalize_user_insert();
