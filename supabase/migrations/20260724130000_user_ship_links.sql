-- ============================================================================
-- 20260724130000_user_ship_links.sql
--
-- WHAT THIS CREATES
--   public.is_rsi_pledge_ship_url(text)  - the single SQL source of truth for
--                                          the RSI pledge-link allowlist
--   public.user_ship_links               - PER-USER, PRIVATE pledge links
--   public.ship_pledge_links             - GLOBAL, admin-curated pledge links
--   + a NOT VALID allowlist check on the existing
--     public.hangar_concept_ships.rsi_url column
--
-- WHY (admin feedback f7d3bd9a)
--   Our catalog has no reliable per-ship RSI slug (codex `class_name` is the
--   datamined class, not the RSI store slug), so a ship detail page can only
--   link to the generic RSI ships listing. Users want to pin the real pledge
--   page - for a ship we have no link for, or for a ship not in the catalog at
--   all. That means storing an ATTACKER-CONTROLLED URL and rendering it as an
--   `href`, so the whole design is about containment:
--
--   1. ALLOWLIST, NOT DENYLIST. Only one shape is storable, anchored ^...$:
--        https://robertsspaceindustries.com/en/pledge/ships/<slug>/<Name>
--      https only; exact host (a suffix/subdomain look-alike such as
--      `robertsspaceindustries.com.evil.tld` can never match an anchored
--      pattern); no query, no fragment, no userinfo, no port, no whitespace.
--      Alternate schemes (javascript:, data:) cannot even begin to match.
--   2. THE URL IS DATA, NEVER AN INSTRUCTION. It is rendered only as
--      <a [href] target="_blank" rel="noopener noreferrer nofollow">, never via
--      innerHTML, and it is never placed into an LLM prompt.
--   3. PRIVATE FIRST. A user's link is visible ONLY to that user (owner-only
--      RLS). It becomes visible to everyone exclusively through an explicit
--      admin promotion into public.ship_pledge_links - never automatically,
--      never as a side effect of a user action.
--
--   The `ship-link` Edge Function is the write authority (it parses the URL,
--   enforces the allowlist and rate-limits submissions). These CHECK
--   constraints are the layer no client and no bug in a client can bypass:
--   they also cover a direct PostgREST insert by the row owner.
--
-- ADDITIVE: this migration drops nothing, renames nothing and deletes no data.
--   The constraint on the pre-existing hangar_concept_ships.rsi_url column is
--   added NOT VALID on purpose - it gates every future INSERT/UPDATE while
--   leaving historic rows untouched, so no user loses a link they saved before
--   the allowlist existed.
-- IDEMPOTENT: safe to re-run.
-- ============================================================================

-- ── the allowlist, once ──────────────────────────────────────────────────────
-- Mirrored byte-for-byte in:
--   src/app/core/rsi-pledge-link.util.ts        (client, friendly error)
--   supabase/functions/ship-link/_rsi-url.ts    (server, the write authority)
-- `returns null on null input` makes a NULL url pass the CHECK, which is what
-- a nullable "link is optional" column needs.
create or replace function public.is_rsi_pledge_ship_url(url text)
returns boolean
language sql
immutable
set search_path = public
returns null on null input
as $$
  select url ~ '^https://robertsspaceindustries\.com/en/pledge/ships/[a-z0-9-]+/[A-Za-z0-9-]+$'
     and url !~ '[[:space:]]'
     and length(url) <= 300;
$$;

comment on function public.is_rsi_pledge_ship_url(text) is
  'True when the argument is exactly an official RSI pledge-ship permalink '
  '(https://robertsspaceindustries.com/en/pledge/ships/<slug>/<Name>). '
  'Anchored allowlist for user-supplied links - rejects any other host '
  '(incl. suffix/subdomain look-alikes), scheme, port, userinfo, query or '
  'fragment. Feedback f7d3bd9a.';

grant execute on function public.is_rsi_pledge_ship_url(text) to authenticated;

-- ── per-user, private links ──────────────────────────────────────────────────
create table if not exists public.user_ship_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- codex_ships.class_name (soft FK, patch-stable slug). Deliberately NOT a
  -- real FK: a user may pin a link for a ship that is not in the catalog yet.
  ship_slug   text not null check (ship_slug ~ '^[A-Za-z0-9_.-]{1,120}$'),
  url         text not null check (public.is_rsi_pledge_ship_url(url)),
  -- Audit: who actually wrote the row. Equal to user_id for every normal
  -- submission (RLS enforces it); kept separate so the column keeps its meaning
  -- if a support/admin write path is ever added.
  created_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint user_ship_links_user_ship_key unique (user_id, ship_slug)
);

comment on table public.user_ship_links is
  'A user''s own RSI pledge link for a ship (feedback f7d3bd9a). PRIVATE: '
  'owner-only RLS, visible to nobody else. Written through the ship-link edge '
  'function, which is the allowlist + rate-limit authority; the url CHECK is '
  'the un-bypassable gate. Promotion to a global link is an explicit admin '
  'action into public.ship_pledge_links - it never happens automatically.';

create index if not exists user_ship_links_user_idx
  on public.user_ship_links (user_id, created_at desc);
create index if not exists user_ship_links_slug_idx
  on public.user_ship_links (ship_slug);

drop trigger if exists user_ship_links_updated_at on public.user_ship_links;
create trigger user_ship_links_updated_at
  before update on public.user_ship_links
  for each row execute function public.set_updated_at();

alter table public.user_ship_links enable row level security;

-- Owner-only, all four verbs. `created_by = auth.uid()` on write keeps the
-- audit column honest even on a direct PostgREST call.
drop policy if exists user_ship_links_self_select on public.user_ship_links;
create policy user_ship_links_self_select on public.user_ship_links
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_ship_links_self_insert on public.user_ship_links;
create policy user_ship_links_self_insert on public.user_ship_links
  for insert to authenticated
  with check (auth.uid() = user_id and auth.uid() = created_by);

drop policy if exists user_ship_links_self_update on public.user_ship_links;
create policy user_ship_links_self_update on public.user_ship_links
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and auth.uid() = created_by);

drop policy if exists user_ship_links_self_delete on public.user_ship_links;
create policy user_ship_links_self_delete on public.user_ship_links
  for delete to authenticated using (auth.uid() = user_id);

-- Explicit table privileges (RLS narrows them to the owner). Stated rather than
-- inherited from Supabase's default privileges, like admin_feedback does.
grant select, insert, update, delete on public.user_ship_links to authenticated;

-- Signed-out visitors never touch user-owned link data.
revoke all on public.user_ship_links from anon;

-- ── global, admin-curated links ──────────────────────────────────────────────
-- The ONLY table that makes a link visible to everyone. Nothing a user does can
-- write here: every write policy requires public.is_admin().
create table if not exists public.ship_pledge_links (
  ship_slug      text primary key check (ship_slug ~ '^[A-Za-z0-9_.-]{1,120}$'),
  url            text not null check (public.is_rsi_pledge_ship_url(url)),
  -- Provenance of a promotion: which user's private link was published, and
  -- which admin published it. Both nullable so account deletion cannot cascade
  -- away a curated catalog entry.
  source_user_id uuid references auth.users (id) on delete set null,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.ship_pledge_links is
  'Globally visible RSI pledge link per ship slug (feedback f7d3bd9a). '
  'Public read; writes are admin-only. A user-submitted link reaches this '
  'table only through an explicit admin promotion, never automatically.';

drop trigger if exists ship_pledge_links_updated_at on public.ship_pledge_links;
create trigger ship_pledge_links_updated_at
  before update on public.ship_pledge_links
  for each row execute function public.set_updated_at();

alter table public.ship_pledge_links enable row level security;

-- Read: public, like the rest of the codex (see 20260710190000_public_codex_read).
drop policy if exists ship_pledge_links_public_read on public.ship_pledge_links;
create policy ship_pledge_links_public_read on public.ship_pledge_links
  for select to anon, authenticated using (true);

drop policy if exists ship_pledge_links_admin_insert on public.ship_pledge_links;
create policy ship_pledge_links_admin_insert on public.ship_pledge_links
  for insert to authenticated with check (public.is_admin());

drop policy if exists ship_pledge_links_admin_update on public.ship_pledge_links;
create policy ship_pledge_links_admin_update on public.ship_pledge_links
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists ship_pledge_links_admin_delete on public.ship_pledge_links;
create policy ship_pledge_links_admin_delete on public.ship_pledge_links
  for delete to authenticated using (public.is_admin());

grant select on public.ship_pledge_links to anon, authenticated;
grant insert, update, delete on public.ship_pledge_links to authenticated;

-- ── retrofit the older free-form link column ─────────────────────────────────
-- public.hangar_concept_ships.rsi_url (20260711001000) is the other place where
-- a user pastes an RSI link, and it has been free-form text until now. Add the
-- same allowlist as a NOT VALID constraint: enforced for every future write,
-- but existing rows are neither checked nor rewritten, so this stays additive
-- and loses no user data.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'hangar_concept_ships_rsi_url_allowlist'
      and conrelid = 'public.hangar_concept_ships'::regclass
  ) then
    alter table public.hangar_concept_ships
      add constraint hangar_concept_ships_rsi_url_allowlist
      check (public.is_rsi_pledge_ship_url(rsi_url)) not valid;
  end if;
end $$;

comment on constraint hangar_concept_ships_rsi_url_allowlist on public.hangar_concept_ships is
  'NOT VALID on purpose: gates all future writes to the RSI pledge-link '
  'allowlist without touching rows saved before the allowlist existed '
  '(feedback f7d3bd9a).';
