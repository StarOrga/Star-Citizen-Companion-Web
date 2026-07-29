-- ============================================================
-- 20260729120000_feedback_drafts.sql
-- Server-side, account-bound drafts for every feedback composer.
--
-- WHY
--   A user typed a long feedback topic (Verse News / videos / categories),
--   never pressed send, and closed the tab — the text was gone. The only
--   safety net was a single localStorage key for the NEW-TOPIC box, text only,
--   gated behind the opt-in `preferences` consent category (ConsentService,
--   issue #130). So: no draft at all for anyone who declined preference
--   storage, no draft at all for thread replies, no draft ever for attached
--   screenshots, and nothing that survives switching device or browser.
--
--   Unsent input is the user's own content, not a convenience preference. It
--   now lives on the account, is written unconditionally, and is deleted only
--   when the user sends the message or explicitly discards the draft. Nothing
--   else — not a reload, not a panel close, not a session change — clears it.
--
-- WHAT THIS CREATES (purely additive — nothing is dropped, renamed or updated):
--   public.feedback_drafts        — one row per (user, composer). PRIVATE to
--                                   its author: admins have no read policy
--                                   here either, an unsent draft is nobody
--                                   else's business.
--   public.feedback_drafts_guard() — BEFORE INSERT/UPDATE guard: pins
--                                   updated_at on API writes, refuses a
--                                   feedback_id the caller may not see, and
--                                   caps how many drafts one account may hold.
--
-- SCOPE KEY
--   `scope` identifies the composer instance, not the topic: 'user:new',
--   'user:reply:<uuid>', 'admin:new', 'admin:thread:<uuid>',
--   'admin:author:<uuid>', 'admin:workflow:<uuid>'. It is the client's key and
--   deliberately opaque to the database — the (user_id, scope) primary key is
--   the whole contract, so a new composer needs no migration.
--
-- ATTACHMENTS
--   `images` holds only REFERENCES — [{ id, name, url }] — never bytes. A
--   composer that persists a draft uploads its screenshots into the existing
--   public `feedback-images` bucket (20260713000000, owner-folder write policy)
--   right away and stores the resulting URLs here; sending the message reuses
--   those very URLs instead of uploading again. That keeps the row a few
--   hundred bytes instead of multiple megabytes of base64, which is also why
--   the size cap below is small enough to make a bytes-in-jsonb regression fail
--   loudly instead of quietly bloating the table.
--
-- IDEMPOTENT: safe to re-run (if-not-exists / or-replace / drop-if-exists).
-- ============================================================

create table if not exists public.feedback_drafts (
  -- auth.users, not profiles: a draft is bound to the login, and deleting the
  -- account must take the unsent text with it (the delete-user function relies
  -- on exactly this cascade).
  user_id     uuid not null references auth.users (id) on delete cascade,
  scope       text not null check (length(btrim(scope)) between 1 and 120),
  -- Set when the composer belongs to one topic (a reply box). The cascade is
  -- the cleanup mechanism: delete the topic, its drafts go with it — otherwise
  -- rows for threads that no longer exist would accumulate forever, invisible
  -- to the user because their composer is gone too.
  feedback_id uuid references public.admin_feedback (id) on delete cascade,
  body        text not null default '' check (length(body) <= 20000),
  images      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (user_id, scope),
  -- jsonb_array_length() errors on a non-array, and a CHECK gives no
  -- short-circuit guarantee — hence the CASE rather than a plain AND.
  constraint feedback_drafts_images_check check (
    jsonb_typeof(images) = 'array'
    and jsonb_array_length(
          case when jsonb_typeof(images) = 'array' then images else '[]'::jsonb end
        ) <= 10
    -- References only. 10 x (uuid + file name + storage url) fits in 8 KB with
    -- room to spare; a single base64 data URI would blow straight past it.
    and octet_length(images::text) <= 8192
  )
);

-- Makes the ON DELETE CASCADE from admin_feedback an index scan instead of a
-- sequential one, and it is the only non-PK access path this table has.
create index if not exists feedback_drafts_feedback_idx
  on public.feedback_drafts (feedback_id)
  where feedback_id is not null;

comment on table public.feedback_drafts is
  'Unsent composer input (text + uploaded screenshot references), one row per '
  '(user, composer scope). PRIVATE to its author — no admin read policy exists '
  'here on purpose. Written unconditionally (it is the user''s own content, not '
  'a preference), and removed only by a successful send or an explicit discard.';

comment on column public.feedback_drafts.scope is
  'Client-owned composer identity, e.g. user:new | user:reply:<uuid> | '
  'admin:new | admin:thread:<uuid> | admin:author:<uuid> | admin:workflow:<uuid>. '
  'Opaque to the database.';

comment on column public.feedback_drafts.images is
  'JSON array of attachment REFERENCES [{id, name, url}] pointing into the '
  'feedback-images bucket — never image bytes (see the size check).';

-- ============================================================
-- Guard: pinned timestamp, no foreign topic, bounded per account
--
-- SECURITY DEFINER for the row cap only: the count has to be the true number of
-- the caller's drafts, and under RLS a caller could otherwise never be told
-- "you already have 100" by a policy-filtered count. It touches nothing the
-- caller does not already own.
-- ============================================================

create or replace function public.feedback_drafts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- PostgREST sets the JWT claims GUC; a migration or backfill running as
  -- postgres keeps full control.
  via_api boolean := nullif(current_setting('request.jwt.claims', true), '') is not null;
  held    integer;
begin
  if via_api then
    new.updated_at := now();
  end if;

  -- A draft may only be pinned to a topic the caller is actually able to open:
  -- an admin to any, an author to their own. Without this the FK would answer
  -- "does this uuid exist on the board?" for anyone willing to read the error.
  if new.feedback_id is not null
     and not (public.is_admin() or public.owns_feedback(new.feedback_id)) then
    raise exception 'draft may not reference a foreign feedback topic'
      using errcode = '42501';
  end if;

  -- Cheap ceiling on a table every keystroke can reach. 100 open drafts is far
  -- beyond any real board session and still bounds a looping client.
  --
  -- The `not exists` is load-bearing: the client saves with UPSERT, and a
  -- BEFORE INSERT trigger fires before ON CONFLICT resolves — without it, an
  -- account sitting exactly on the cap could no longer edit the drafts it
  -- already has, only delete them.
  if tg_op = 'INSERT' then
    select count(*) into held
      from public.feedback_drafts d
     where d.user_id = new.user_id;
    if held >= 100
       and not exists (
         select 1 from public.feedback_drafts d2
          where d2.user_id = new.user_id and d2.scope = new.scope
       ) then
      raise exception 'draft limit reached: at most 100 stored drafts per account'
        using errcode = '54000';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.feedback_drafts_guard() is
  'BEFORE INSERT/UPDATE guard for public.feedback_drafts: pins updated_at on API '
  'writes, refuses a feedback_id the caller cannot see (the FK would otherwise be '
  'an existence oracle for the admin board), and caps an account at 100 drafts.';

drop trigger if exists feedback_drafts_guard on public.feedback_drafts;
create trigger feedback_drafts_guard
  before insert or update on public.feedback_drafts
  for each row execute function public.feedback_drafts_guard();

-- ============================================================
-- RLS — owner only, in every direction
-- ============================================================

alter table public.feedback_drafts enable row level security;

drop policy if exists feedback_drafts_read on public.feedback_drafts;
create policy feedback_drafts_read on public.feedback_drafts
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists feedback_drafts_insert on public.feedback_drafts;
create policy feedback_drafts_insert on public.feedback_drafts
  for insert to authenticated
  with check (user_id = auth.uid());

-- USING and WITH CHECK both, so a draft can never be moved onto another account.
drop policy if exists feedback_drafts_update on public.feedback_drafts;
create policy feedback_drafts_update on public.feedback_drafts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists feedback_drafts_delete on public.feedback_drafts;
create policy feedback_drafts_delete on public.feedback_drafts
  for delete to authenticated
  using (user_id = auth.uid());

-- Supabase grants ALL on new objects in `public` to anon + authenticated by
-- default, and TRUNCATE is not subject to RLS at all — strip first, then hand
-- back exactly the four verbs the policies above are written for. anon keeps
-- nothing: a draft belongs to an account.
revoke all on public.feedback_drafts from public, anon, authenticated;
grant select, insert, update, delete on public.feedback_drafts to authenticated;
