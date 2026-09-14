-- ============================================================
-- 20260914160000_concept_pages.sql
-- Concept pages hosted ON the website — the interactive /concept HTML that
-- used to need a local bridge on the admin's machine now lives in a table
-- and is served by the `concept-page` edge function.
--
-- WHY
--   Admin feedback #224 (dbdb2ffe): the routine posted a text-only concept
--   into a feedback thread, and the admin asked for a link — reachable only
--   by admins, and only through the link posted in the thread — on which he
--   can work through the concept (choose, comment, submit) exactly like the
--   local `docs/concepts/*.html` pages, but "über die Webseite". The local
--   pages talk to a Python bridge over `/decisions`, `/heartbeat`, `/reload`,
--   `/draft` and `/attachments`; that bridge cannot exist for a hosted page,
--   so the `concept-page` edge function answers the same protocol out of
--   this table.
--
-- WHAT
--   `concept_pages` — one row per hosted concept.
--     html            the full concept document (engine + content), served
--                     verbatim by `GET /concept-page/<id>?t=<ticket>`
--     decisions       what the page POSTs to `/decisions` (the concept
--                     engine's payload: submitted/template/decisions/
--                     comments/allFields/action/submission_id)
--     draft           the engine's durable draft mirror (`/draft`) — the
--                     union of the last non-empty value per text key, so a
--                     browser reset cannot lose the admin's notes
--     submitted_at    stamped on every POST carrying `submitted: true`
--     processed_at    stamped by the routine (`concept-read --mark-processed`)
--                     once it has read a submission; exposed to the page as
--                     `_processed_at` / `_picked_up_at`
--     reload_counter  bumped by the routine when it republishes the html
--                     (`concept-publish --id`); the page polls `/reload` and
--                     reloads itself when the counter grows
--
-- WHO SEES IT
--   Admins may SELECT (`public.is_admin()`), nobody else. There is NO client
--   insert/update/delete policy: the routine writes through the Management
--   API (service role) and the edge function writes with the service-role
--   key after checking its own HMAC ticket. `anon` has no grant at all — the
--   page itself is fetched through the function, never through PostgREST.
--
-- PURELY ADDITIVE — nothing is dropped, renamed, or rewritten.
-- IDEMPOTENT: safe to re-run.
-- ============================================================

create table if not exists public.concept_pages (
  id             uuid primary key default gen_random_uuid(),
  feedback_id    uuid references public.admin_feedback(id) on delete cascade,
  title          text not null,
  html           text not null,
  decisions      jsonb not null default '{"submitted": false, "decisions": [], "comments": []}'::jsonb,
  draft          jsonb not null default '{}'::jsonb,
  submitted_at   timestamptz,
  processed_at   timestamptz,
  reload_counter integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.concept_pages is
  'Interactive concept pages hosted on the website (admin feedback #224). '
  'Served by the concept-page edge function behind an HMAC ticket that only '
  'an admin session can mint; written by the routine (service role) and by '
  'the function. Admins read, nobody else.';
comment on column public.concept_pages.decisions is
  'The concept engine''s /decisions payload as last POSTed by the page.';
comment on column public.concept_pages.draft is
  'Durable mirror of the page''s text fields (/draft): {"recovered": {key: text}}.';
comment on column public.concept_pages.reload_counter is
  'Incremented on every republish of html; the page reloads when it grows.';

create index if not exists concept_pages_feedback_id_idx
  on public.concept_pages (feedback_id);

drop trigger if exists concept_pages_updated_at on public.concept_pages;
create trigger concept_pages_updated_at before update on public.concept_pages
  for each row execute function public.set_updated_at();

alter table public.concept_pages enable row level security;

drop policy if exists concept_pages_admin_select on public.concept_pages;
create policy concept_pages_admin_select on public.concept_pages
  for select to authenticated using (public.is_admin());

-- Supabase grants ALL on new objects in `public` to anon + authenticated by
-- default. The table is read by admins only, and even that read happens
-- through the routine tooling — the browser never queries it directly.
revoke all on public.concept_pages from public, anon, authenticated;
grant select on public.concept_pages to authenticated;
