-- ============================================================
-- 20260726120000_user_feedback_channel.sql
-- Feedback channel for non-admin users (viewer / collaborator).
--
-- WHY
--   Viewers and collaborators deliberately never see the admin panel, so today
--   they have no way to send feedback at all. They now get their own FAB. Their
--   submission lands as a normal topic on the ADMINS' existing board — same
--   list, same workflow, just attributed to that person — while everything the
--   admins and the routine say to each other stays invisible to them.
--
-- SCHEMA DECISION (feedback 5920cf8c, question (1) — never answered by the
-- admin, so this is the routine's own recommendation, applied deliberately):
--   REUSE `public.admin_feedback` instead of adding a parallel user-feedback
--   table. One board, one status machine, one workflow/queue/search
--   implementation; a second table would have forked all of it and every admin
--   view would have had to union two shapes. The non-admin half is carved out
--   by four additive columns plus a restricted, column-projecting VIEW —
--   `public.my_feedback` — which is the only thing a non-admin may read.
--
-- HARD PRIVACY RULE (feedback 5920cf8c, question (2), confirmed by the admin):
--   A non-admin must NEVER be able to read `public.admin_feedback_messages`.
--   That table carries the admin <-> Claude conversation. This migration does
--   not add a single policy to it; its only SELECT policy stays
--   `public.is_admin()`, re-asserted defensively at the bottom of this file.
--   Non-admins also never read `public.admin_feedback` itself (no SELECT policy
--   applies to them) — they see the projection in `public.my_feedback` and
--   nothing else, so `processing_note`, `ship_ref`, `processed_at` and the raw
--   `status` never leave the admin side.
--   The one non-obvious part of that guarantee is the GRANTS: Supabase grants ALL
--   on everything new in `public` to anon + authenticated by default, and this
--   view is auto-updatable AND runs with owner rights. Every `grant` in this file
--   is therefore preceded by an explicit `revoke ... from public, anon,
--   authenticated` — a `grant select` on its own leaves a write-through bypass of
--   admin_feedback's RLS wide open (found by the red-team pass on this file).
--
-- KNOWN, PRE-EXISTING GAP (not introduced here, do not assume otherwise):
--   Screenshot attachments live in the PUBLIC `feedback-images` bucket
--   (20260713000000). Public-bucket objects are downloadable by URL and the
--   bucket-wide read policy makes them listable, so attachments in ADMIN replies
--   are not secret today either. This feature adds non-admins as writers to the
--   same bucket; it does not widen the read side, but the secrecy rule above
--   covers message TEXT, not attachment bytes. Worth its own item.
--
-- WHAT THIS CREATES / CHANGES (purely additive — nothing is dropped or renamed,
-- no row is modified):
--   admin_feedback.source        — 'admin' (default, every existing row) | 'user'
--   admin_feedback.triaged       — routine release gate; true for every existing
--                                  row, forced false on a non-admin insert
--   admin_feedback.decision_note — the admin's explanation when a user topic is
--                                  declined ("nicht umsetzen"), shown to the author
--   admin_feedback.status        — CHECK vocabulary widened by 'declined' and
--                                  'needs_input_author'
--   admin_feedback.status_before_author_question
--                                — admin-only memo so an author question is a
--                                  parenthesis, not a reset
--   feedback_author_messages     — the AUTHOR-VISIBLE message channel (admin <->
--                                  feedback author). Separate table on purpose:
--                                  it is the only way `admin_feedback_messages`
--                                  can stay categorically admin-only.
--   public.owns_feedback(uuid)   — security-definer ownership probe
--   public.feedback_awaits_author(uuid)
--                                — ownership + "a question to you is open"
--   public.my_feedback           — the author-facing coarse-status projection
--   3 triggers                   — status sync from the author channel, and two
--                                  BEFORE-INSERT guards (untriaged + pinned
--                                  timestamps + rate limit)
--
-- TWO FLAVOURS OF "NEEDS INPUT" (feedback 5920cf8c, question (3), confirmed by
-- the admin — the distinction is the whole point):
--   needs_input        — the ROUTINE asks the ADMIN. Admin-only in every sense:
--                        the question lives in `admin_feedback_messages`, and the
--                        author sees the topic as plain "in Bearbeitung".
--   needs_input_author — the ADMIN asks the AUTHOR. Author-facing: it is set from
--                        the author channel, surfaces in `my_feedback` as
--                        'question', and parks the topic out of the routine's
--                        `status = 'open'` queue while the answer is pending.
--
-- IDEMPOTENT: safe to re-run (if-not-exists / or-replace / drop-if-exists).
-- ============================================================

-- ============================================================
-- 1) admin_feedback: mark author-submitted topics
-- ============================================================

alter table public.admin_feedback
  add column if not exists source text not null default 'admin';

alter table public.admin_feedback drop constraint if exists admin_feedback_source_check;
alter table public.admin_feedback
  add constraint admin_feedback_source_check check (source in ('admin', 'user'));

-- Release gate for the autonomous routine. Author-submitted topics enter
-- untriaged so a stranger cannot inject work straight into an agent that
-- implements-and-ships on its own; an admin flips this once he has read the
-- topic. Every pre-existing (admin-authored) row defaults to true, so the
-- routine's behaviour on the existing board is unchanged.
alter table public.admin_feedback
  add column if not exists triaged boolean not null default true;

-- The admin's written explanation attached to a 'declined' topic. Author-facing
-- (surfaced through public.my_feedback), unlike processing_note which is the
-- routine's internal scratch pad and stays admin-only.
alter table public.admin_feedback
  add column if not exists decision_note text;

comment on column public.admin_feedback.source is
  'admin = posted on the internal board by an admin (default, all legacy rows). '
  'user = submitted through the non-admin feedback FAB by a viewer/collaborator; '
  'author_id is that user and the row is projected to them via public.my_feedback.';

comment on column public.admin_feedback.triaged is
  'Release gate for the autonomous feedback routine: it must only queue topics '
  'with triaged = true. Author-submitted (source=''user'') rows start false so an '
  'admin reads them before the routine may implement and ship them.';

comment on column public.admin_feedback.decision_note is
  'Admin-written explanation shown to the FEEDBACK AUTHOR when a user topic is '
  'declined (status = ''declined''). Author-visible — unlike processing_note.';

-- An admin question to the author is a *parenthesis* around whatever the topic
-- was doing, not a reset: this remembers the status the topic had when the
-- question was asked, so the author's answer restores it instead of flattening
-- everything to 'open'. Without it, asking the author while the ROUTINE had its
-- own question open (status = 'needs_input' — the canonical case: the routine
-- asks the admin what the author meant, the admin asks the author) would have
-- silently dropped the routine's open question.
alter table public.admin_feedback
  add column if not exists status_before_author_question text;

comment on column public.admin_feedback.status_before_author_question is
  'Admin-only. The status a topic had when an admin asked its author something '
  '(status -> needs_input_author); the author''s answer restores it and clears '
  'this column. Never projected into public.my_feedback.';

-- 'declined' = the admin decided not to implement a user-submitted topic and
-- cleared it off the active board, leaving decision_note as the explanation.
-- Terminal, like shipped / issue_created / legacy rejected. It is a soft close
-- rather than a DELETE precisely because the author still has to be able to see
-- "nicht umgesetzt" + the reason; a hard delete would cascade the author's own
-- thread away and leave them with a silently vanished topic.
--
-- 'needs_input_author' = the ADMIN asked the AUTHOR something and waits on the
-- answer. Active (not terminal), but deliberately NOT 'open', so the autonomous
-- routine — whose queue is `status = 'open'` — leaves the topic alone while the
-- question is pending. Maintained by the trigger in section 3b, never by hand.
-- Not to be confused with 'needs_input' (the routine asking the admin), which
-- stays invisible to the author.
alter table public.admin_feedback drop constraint if exists admin_feedback_status_check;
alter table public.admin_feedback
  add constraint admin_feedback_status_check
  check (status in ('open', 'in_progress', 'shipped', 'rejected', 'needs_input',
                    'issue_created', 'declined', 'needs_input_author'));

-- The author's own "my feedback" read (via public.my_feedback).
create index if not exists admin_feedback_author_source_idx
  on public.admin_feedback (author_id, source, created_at desc)
  where source = 'user';

-- ============================================================
-- 2) Ownership probe (security definer)
--
-- A policy on feedback_author_messages cannot simply `exists (select 1 from
-- admin_feedback ...)`: RLS applies inside policy subqueries too, and a
-- non-admin has no SELECT policy on admin_feedback, so the probe would always
-- come back false and lock the author out of their own thread. This definer
-- function answers exactly one boolean question and leaks nothing else.
-- ============================================================

create or replace function public.owns_feedback(fid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_feedback f
    where f.id = fid
      and f.source = 'user'
      and f.author_id = auth.uid()
  );
$$;

-- The stricter sibling: the caller owns the topic AND an admin's question to
-- them is currently open. The author channel is for *answering*, not a general
-- chat with the admins — without this an author could post unlimited messages
-- into their own topic (each one triggering a status write), and the admin would
-- have a spam channel he never opened.
create or replace function public.feedback_awaits_author(fid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.admin_feedback f
    where f.id = fid
      and f.source = 'user'
      and f.author_id = auth.uid()
      and f.status = 'needs_input_author'
  );
$$;

comment on function public.feedback_awaits_author(uuid) is
  'True when the calling user is the author of the given user-submitted topic AND '
  'an admin question to them is open (status = needs_input_author). Gates the '
  'author''s insert into feedback_author_messages to actual answers.';

comment on function public.owns_feedback(uuid) is
  'True when the calling user is the author of the given USER-submitted feedback '
  'topic. Security definer so RLS policies can probe admin_feedback ownership '
  'without granting the caller any read access to that table.';

revoke all on function public.owns_feedback(uuid) from public, anon, authenticated;
grant execute on function public.owns_feedback(uuid) to authenticated;
revoke all on function public.feedback_awaits_author(uuid) from public, anon, authenticated;
grant execute on function public.feedback_awaits_author(uuid) to authenticated;

-- ============================================================
-- 3) The author-visible message channel
--
-- Deliberately a SEPARATE table from admin_feedback_messages. Splitting by a
-- flag on the existing table would have meant one SELECT policy having to hide
-- individual rows of a table non-admins can query — one wrong predicate and the
-- admin <-> Claude conversation leaks. Two tables make the rule structural:
-- non-admins simply have no policy on admin_feedback_messages at all.
-- ============================================================

create table if not exists public.feedback_author_messages (
  id           uuid primary key default gen_random_uuid(),
  feedback_id  uuid not null references public.admin_feedback (id) on delete cascade,
  author_id    uuid references public.profiles (id) on delete set null,
  -- true  = written by an admin, addressed to the feedback author
  -- false = written by the feedback author themselves
  from_admin   boolean not null default false,
  -- true only on an admin message that explicitly asks the AUTHOR something.
  -- This is what surfaces to the author as the "Rückfrage an dich" status, and
  -- it is opt-in: an ordinary admin note keeps the topic reading "in Bearbeitung".
  is_question  boolean not null default false,
  body         text not null check (length(btrim(body)) between 1 and 20000),
  created_at   timestamptz not null default now(),
  -- Only an admin message can be a question to the author.
  constraint feedback_author_messages_question_check
    check (not is_question or from_admin)
);

create index if not exists feedback_author_messages_thread_idx
  on public.feedback_author_messages (feedback_id, created_at);

comment on table public.feedback_author_messages is
  'Admin <-> feedback-author channel for user-submitted topics. EVERYTHING here '
  'is visible to the topic author. The admin <-> routine conversation lives in '
  'admin_feedback_messages, which non-admins can never read.';

alter table public.feedback_author_messages enable row level security;

-- Admins read the whole channel; the topic author reads their own topic's.
drop policy if exists feedback_author_messages_read on public.feedback_author_messages;
create policy feedback_author_messages_read on public.feedback_author_messages
  for select to authenticated
  using (public.is_admin() or public.owns_feedback(feedback_id));

-- An admin writes into the channel as themselves; only an admin may ask. The
-- `user_topic` probe is not redundant: a channel message on an ADMIN-authored
-- topic has nobody to reach, and asking there would park the topic on
-- `needs_input_author` forever (no author exists who could answer it).
drop policy if exists feedback_author_messages_insert_admin on public.feedback_author_messages;
create policy feedback_author_messages_insert_admin on public.feedback_author_messages
  for insert to authenticated
  with check (
    public.is_admin()
    and from_admin = true
    and author_id = auth.uid()
    and exists (
      select 1 from public.admin_feedback f
      where f.id = feedback_id and f.source = 'user'
    )
  );

-- The author answers in their own topic's channel and can never impersonate an
-- admin message (from_admin/is_question forced false). `feedback_awaits_author`
-- also requires that a question is actually open, so the channel cannot be used
-- as an unsolicited chat.
drop policy if exists feedback_author_messages_insert_author on public.feedback_author_messages;
create policy feedback_author_messages_insert_author on public.feedback_author_messages
  for insert to authenticated
  with check (
    not public.is_admin()
    and from_admin = false
    and is_question = false
    and author_id = auth.uid()
    and public.feedback_awaits_author(feedback_id)
  );

-- Only admins prune the channel (a topic delete cascades anyway).
drop policy if exists feedback_author_messages_delete on public.feedback_author_messages;
create policy feedback_author_messages_delete on public.feedback_author_messages
  for delete to authenticated
  using (public.is_admin());

-- Same reasoning as for the view: revoke Supabase's default ALL from both roles
-- and hand back only what the policies above are written for. UPDATE in
-- particular has no policy at all (a message is immutable once sent) and TRUNCATE
-- is not even subject to RLS, so neither may stay granted.
revoke all on public.feedback_author_messages from public, anon, authenticated;
grant select, insert, delete on public.feedback_author_messages to authenticated;

-- ============================================================
-- 3b) The author-question status, maintained by the channel itself
--
-- The admin's decision (feedback 5920cf8c, question (3)): asking the AUTHOR
-- something needs its own status, and unlike `needs_input` it IS visible to the
-- author. Deriving it from "is the last channel message an unanswered admin
-- question?" would have left the routine's `status = 'open'` queue free to pick
-- the topic up and ship it while the admin is still waiting for an answer — so
-- it is a real status value, and this trigger is what sets and clears it:
--
--   admin asks (from_admin and is_question) -> remember the current status in
--       `status_before_author_question`, then park at 'needs_input_author'
--       (only on a USER topic, never on a terminal one — a shipped/declined row
--        stays closed, and an admin-authored topic has no author to ask)
--   author answers (not from_admin)         -> restore the remembered status
--       (default 'open') and force `triaged = false`
--
-- Why the restore instead of a flat 'open': asking the author is a parenthesis
-- around whatever the topic was doing. The canonical case is the routine parking
-- a user topic as `needs_input` ("what did the author mean?"), the admin passing
-- that on to the author, and the answer coming back — a flat 'open' would have
-- thrown the routine's own open question away.
--
-- Why `triaged = false` on the way back: the answer is fresh, unreviewed text
-- from outside, and the thing waiting behind `status = 'open'` is an agent that
-- implements and merges on its own. So the admin releases it again, exactly like
-- for the first submission. This is the one place where a non-admin action moves
-- `triaged` at all — and it can only ever move it towards *more* review.
--
-- SECURITY DEFINER is required, not convenience: the author who inserts the
-- answering message has no UPDATE policy on admin_feedback at all (by design),
-- so the status flip has to happen with the definer's rights. The function stays
-- deliberately narrow — one row, the two transitions above, and no column an
-- author could turn to their advantage.
-- ============================================================

create or replace function public.feedback_author_channel_sync_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.from_admin and new.is_question then
    update public.admin_feedback
       set status_before_author_question =
             case
               -- Don't overwrite the memo on a follow-up question.
               when status = 'needs_input_author' then status_before_author_question
               else status
             end,
           status = 'needs_input_author'
     where id = new.feedback_id
       and source = 'user'
       and status not in ('shipped', 'issue_created', 'rejected', 'declined');
  elsif not new.from_admin then
    update public.admin_feedback
       set status = coalesce(status_before_author_question, 'open'),
           status_before_author_question = null,
           triaged = false
     where id = new.feedback_id
       and status = 'needs_input_author';
  end if;
  return null;
end;
$$;

comment on function public.feedback_author_channel_sync_status() is
  'Keeps admin_feedback.status in sync with the author channel: an admin question '
  'parks a USER topic as needs_input_author (author-visible, out of the routine''s '
  'open queue) after memorising its previous status; the author''s answer restores '
  'that status and sets triaged = false so an admin re-reads before the routine '
  'acts on outside text. Security definer because the answering author has no '
  'UPDATE right on admin_feedback.';

drop trigger if exists feedback_author_messages_sync_status on public.feedback_author_messages;
create trigger feedback_author_messages_sync_status
  after insert on public.feedback_author_messages
  for each row execute function public.feedback_author_channel_sync_status();

-- The channel is rendered in insert order, so a client-supplied `created_at`
-- would let an author sort their answer *above* the question it answers. Pin it
-- for API inserts (a migration running as postgres keeps control).
create or replace function public.feedback_author_messages_pin_created_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null then
    new.created_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_author_messages_pin_created_at on public.feedback_author_messages;
create trigger feedback_author_messages_pin_created_at
  before insert on public.feedback_author_messages
  for each row execute function public.feedback_author_messages_pin_created_at();

-- ============================================================
-- 4) admin_feedback: let a non-admin file a topic
--
-- INSERT only. No SELECT / UPDATE / DELETE policy is added for non-admins, so
-- the base table stays closed to them and the projection below is their only
-- read path. The WITH CHECK pins every routine/admin-owned column to its
-- neutral value, so a hand-crafted request cannot file a topic pre-marked as
-- shipped, pre-triaged, or attributed to somebody else.
-- ============================================================

drop policy if exists admin_feedback_insert_author on public.admin_feedback;
create policy admin_feedback_insert_author on public.admin_feedback
  for insert to authenticated
  with check (
    not public.is_admin()
    and author_id = auth.uid()
    and source = 'user'
    and status = 'open'
    and triaged = false
    and ship_ref is null
    and processing_note is null
    and decision_note is null
    and status_before_author_question is null
    and shipped_at is null
    and processed_at is null
  );

-- ------------------------------------------------------------
-- 4b) …and the two things a WITH CHECK cannot express
--
-- (a) `triaged` DEFAULTS to true (so every legacy admin row keeps working), while
--     the policy above demands false. A caller that simply omits the column would
--     therefore fail with a bare 42501 that reads like "you may not post at all".
--     Forcing it here makes "a user topic starts untriaged" an invariant of the
--     table instead of a courtesy of one client.
-- (b) The timestamps were unpinned: `created_at` is what the routine's queue and
--     the board order by (oldest first), so a hand-crafted insert with
--     `created_at = '1970-01-01'` would have nailed a topic to the head of both
--     queues for good.
-- Plus a cheap rate limit — the board is a shared surface and a 20 000-character
-- topic is one request away for anyone with an account.
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
  if via_api then
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
  end if;
  return new;
end;
$$;

comment on function public.admin_feedback_normalize_user_insert() is
  'BEFORE INSERT guard for user-submitted feedback: forces triaged = false, pins '
  'the timestamps of API inserts to now() (they drive the oldest-first queues) and '
  'rate-limits an author to 10 topics per hour. Admin/routine inserts pass through.';

drop trigger if exists admin_feedback_normalize_user_insert on public.admin_feedback;
create trigger admin_feedback_normalize_user_insert
  before insert on public.admin_feedback
  for each row execute function public.admin_feedback_normalize_user_insert();

-- ============================================================
-- 5) public.my_feedback — the author-facing projection
--
-- A SECURITY DEFINER view (security_invoker = false, i.e. it runs as the view
-- owner and bypasses the base tables' RLS) is the column-projection mechanism
-- here: Postgres RLS filters rows, not columns, and column-level GRANTs are
-- per-role rather than per-user, so neither can hide processing_note/ship_ref
-- from an author while showing them to an admin. The view does both jobs at
-- once: it selects only author-safe columns and hard-filters
-- `author_id = auth.uid() and source = 'user'` inside its own definition, which
-- a caller cannot switch off.
--
-- !! THE GRANTS BELOW ARE LOAD-BEARING, NOT COSMETIC !!
-- This view is *auto-updatable* (single FROM entry, no aggregate/DISTINCT), and
-- Supabase's default privileges grant ALL on new tables/views in `public` to
-- anon + authenticated. Combined with security_invoker = false that made the
-- view a write-through hole straight past every RLS policy on admin_feedback:
-- a signed-in viewer could INSERT a topic that defaulted to source='admin',
-- triaged=true (landing directly in the autonomous routine's queue), UPDATE a
-- topic's body after an admin had released it, or DELETE a topic and cascade the
-- admin thread with it. Verified exploitable before the revoke below was added
-- (2026-07-26, red-team pass on this migration). `grant select` alone does NOT
-- take the default privileges away — only an explicit REVOKE from BOTH roles
-- does, so keep the revoke/grant pair exactly as it is.
-- security_barrier additionally stops a leaky operator/function in a caller's
-- WHERE from being evaluated before the view's own author filter.
--
-- Coarse status mapping (feedback 5920cf8c, question (3), confirmed):
--   open | in_progress | needs_input | issue_created -> 'in_progress'  ("In Bearbeitung")
--       -- note: `needs_input` means the ROUTINE is asking the ADMIN. That
--          conversation is invisible to the author, so it must read as plain
--          "in Bearbeitung" and must NOT look like a question to them.
--   needs_input_author                              -> 'question'   ("Rückfrage an dich")
--       -- the ONLY question flavour the author ever sees: an admin explicitly
--          asked THEM. Set/cleared by the trigger in 3b, so the author's answer
--          takes the topic back to "in Bearbeitung" on its own.
--   shipped                                         -> 'done'       ("Umgesetzt")
--   declined | legacy rejected                      -> 'declined'   ("Nicht umgesetzt" + decision_note)
--
-- The mapping is intentionally driven by `status` alone (no peek into the
-- channel): one source of truth, and the client's `coarseAuthorStatus()` in
-- `user-feedback.types.ts` mirrors this CASE one-to-one.
-- ============================================================

drop view if exists public.my_feedback;
create view public.my_feedback
with (security_invoker = false, security_barrier = true) as
select
  f.id,
  f.body,
  f.created_at,
  f.updated_at,
  -- Only ever populated on a declined topic, and only shown there: an admin who
  -- drafts a note before deciding must not have it leak early.
  case when f.status in ('declined', 'rejected') then f.decision_note end as decision_note,
  case
    when f.status in ('declined', 'rejected') then 'declined'
    when f.status = 'shipped'                 then 'done'
    when f.status = 'needs_input_author'      then 'question'
    else 'in_progress'
  end as author_status
from public.admin_feedback f
where f.source = 'user'
  and f.author_id = auth.uid();

comment on view public.my_feedback is
  'Author-facing projection of public.admin_feedback: a user sees only their own '
  'submitted topics, and of those only body/timestamps, the coarse status and the '
  'admin decision note. Deliberately security_invoker = false — running as the view '
  'owner is what makes the column projection enforceable; the row filter '
  '(author_id = auth.uid()) is baked into the view body and cannot be bypassed. '
  'Raw status, processing_note, ship_ref and processed_at never leave the admin side. '
  'READ-ONLY BY GRANT: the view is auto-updatable and runs with owner rights, so '
  'INSERT/UPDATE/DELETE must stay revoked from anon AND authenticated — otherwise it '
  'is a write-through bypass of every RLS policy on admin_feedback.';

-- Strip Supabase's default ALL grant (anon AND authenticated), then hand back
-- read only. Order matters; `grant select` on its own would leave the write
-- privileges in place. See the block comment above.
revoke all on public.my_feedback from public, anon, authenticated;
grant select on public.my_feedback to authenticated;

-- ============================================================
-- 6) Re-assert the hard rule on admin_feedback_messages
--
-- No non-admin policy is added anywhere in this migration; this recreates the
-- existing admin-only SELECT policy verbatim so the guarantee is visible in the
-- newest migration that touches the feedback area rather than only in the 2026-07-10 one.
-- ============================================================

drop policy if exists admin_feedback_messages_read on public.admin_feedback_messages;
create policy admin_feedback_messages_read on public.admin_feedback_messages
  for select to authenticated
  using (public.is_admin());

comment on table public.admin_feedback_messages is
  'Per-topic replies on the ADMIN board: the admin <-> routine conversation. '
  'ADMINS ONLY — a non-admin must never be able to select from this table. The '
  'author-visible channel for user-submitted topics is '
  'public.feedback_author_messages.';
