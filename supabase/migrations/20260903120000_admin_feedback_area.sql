-- 20260903120000_admin_feedback_area.sql
--
-- Feedback 835fec58: "Wenn ich Feedback gebe, kannst du die Möglichkeit mit
-- einbinden 'Fenster' oder so, dass du weißt, worauf man sich bezieht? Wenn ich
-- das anklicke, dass du weißt, ich gebe das Feedback für Codex ab! oder für
-- Verse etc."
--
-- A topic gets an AREA tag: which part of the app it is about. The client
-- pre-selects it from the route the sender is on and lets them correct it, so
-- the common case costs the sender nothing and the reader still knows the
-- subject without inferring it from the prose.
--
-- ADDITIVE ONLY. One nullable column plus its CHECK. No table is dropped, no
-- policy is added, removed or widened, and no existing column changes type or
-- nullability. Every topic that exists today keeps `area = null`, which the UI
-- renders as nothing — deliberately, because a backfilled guess would be
-- indistinguishable from something a sender actually said.
--
--   public.admin_feedback.area  — text, nullable, CHECK'd against the vocabulary
--   public.my_feedback          — recreated so an author sees their own tag
--
-- ============================================================
-- 1) The column
--
-- text + CHECK rather than an enum: the vocabulary tracks the app's top-level
-- sections and will be re-cut occasionally, and altering a CHECK is a plain
-- DDL statement while altering an enum in a transaction is not. The constraint
-- is the real gate — `admin_feedback_insert_author` (the non-admin INSERT
-- policy) pins the routine-owned columns but says nothing about `area`, so
-- without this a crafted request could write arbitrary text into a column the
-- board renders. Values mirror `FEEDBACK_AREAS` in
-- src/app/feedback/feedback-area.types.ts one-to-one; changing one side alone
-- is a bug.
--
--   news      /news, /news/patches
--   codex     /codex/**
--   hangar    /hangar/**            (a Codex subview in the nav, its own area to a sender)
--   starscape /starscape
--   desktop   /download, /uploader, /p4k, /desktop*  (the apps outside the website)
--   settings  /settings
--   admin     /admin/**             (never offered to non-admins by the picker)
--   other     everything else — an honest bucket, not a dumping ground
-- ============================================================

alter table public.admin_feedback
  add column if not exists area text;

alter table public.admin_feedback drop constraint if exists admin_feedback_area_check;
alter table public.admin_feedback
  add constraint admin_feedback_area_check
  check (area is null or area in ('news', 'codex', 'hangar', 'starscape',
                                  'desktop', 'settings', 'admin', 'other'));

comment on column public.admin_feedback.area is
  'Which part of the app the topic is about, tagged by the sender''s composer '
  '(pre-selected from their current route, overridable). Nullable: every topic '
  'filed before feedback 835fec58 has none, and untagged must stay visibly '
  'untagged rather than being backfilled with a guess. Vocabulary is pinned by '
  'admin_feedback_area_check and mirrors FEEDBACK_AREAS in the client.';

-- ============================================================
-- 2) public.my_feedback — project the tag back to its author
--
-- The view is the author's ONLY read path (see 20260726170000): it runs as its
-- owner and hand-picks author-safe columns, so a new column is invisible to the
-- author until it is listed here. `area` is listed because it is the author's
-- own statement about their own topic — it discloses nothing the admin side
-- added. Raw status, processing_note, ship_ref, seq and processed_at stay out,
-- exactly as before.
--
-- Recreated verbatim apart from that one line. The revoke/grant pair below is
-- LOAD-BEARING and repeated for the same reason as in the original migration:
-- the view is auto-updatable and runs with owner rights, so Supabase's default
-- ALL grant on a freshly created view would be a write-through bypass of every
-- RLS policy on admin_feedback. `grant select` alone does not remove it.
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
  end as author_status
from public.admin_feedback f
where f.source = 'user'
  and f.author_id = auth.uid();

comment on view public.my_feedback is
  'Author-facing projection of public.admin_feedback: a user sees only their own '
  'submitted topics, and of those only body/timestamps, their own area tag, the '
  'coarse status and the admin decision note. Deliberately security_invoker = false — '
  'running as the view owner is what makes the column projection enforceable; the row '
  'filter (author_id = auth.uid()) is baked into the view body and cannot be bypassed. '
  'Raw status, processing_note, ship_ref and processed_at never leave the admin side. '
  'READ-ONLY BY GRANT: the view is auto-updatable and runs with owner rights, so '
  'INSERT/UPDATE/DELETE must stay revoked from anon AND authenticated — otherwise it '
  'is a write-through bypass of every RLS policy on admin_feedback.';

revoke all on public.my_feedback from public, anon, authenticated;
grant select on public.my_feedback to authenticated;
