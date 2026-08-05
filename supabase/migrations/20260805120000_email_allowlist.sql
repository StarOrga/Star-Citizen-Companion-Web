-- ============================================================
-- 20260805120000_email_allowlist.sql
-- Access control: admin-managed email allowlist (design doc
-- docs/superpowers/specs/2026-08-05-access-control-allowlist-design.md, C4/C5/C8).
--
-- WHAT THIS CREATES
--   allowed_emails         — the source of truth for "who may sign in".
--                             admin-only in every direction (no leak of who
--                             is invited to anon / non-admin authenticated).
--   handle_new_user()      — extended (not replaced-away): a signup whose
--                             email matches an allowed_emails row is now
--                             auto-approved with the pre-assigned role, on
--                             top of the existing bootstrap/invited paths.
--                             Grandfathered: the trigger only fires on
--                             auth.users INSERT, so no existing account is
--                             touched.
--   list_allowed_emails()  — admin RPC, projects `joined` (an auth.users row
--                             exists for that email already).
--   remove_allowed_email() — admin RPC, deletes one entry.
--
-- C8 — RLS hardening for existing self-scoped "sensitive" tables
--   Self-only policies (auth.uid() = user_id) do not check profiles.is_approved,
--   so a signed-up-but-never-approved account (valid JWT, is_approved=false —
--   reachable today only by direct PostgREST call, since GoTrue self-serve
--   sign-up still creates the auth.users row before any allowlist check runs)
--   could read/write ITS OWN rows in hangar/loadout/link/draft tables even
--   though the app-level approvedGuard would bounce it. Not a cross-account
--   leak, but a real "unapproved callers get working data access" gap named
--   explicitly in C8. Fixed additively here with a new is_approved() helper
--   and RESTRICTIVE (AND-combined, so nothing already granted is widened)
--   policies on the affected tables. Admin/telemetry/feedback-board tables
--   are already is_admin()-gated and are not touched. Public game-content
--   tables (codex/news/starscape/ship_pledge_links) are intentionally left
--   world-readable — that is the documented non-goal.
--
-- ALPHA-PHASE DATA POLICY: additive only, nothing dropped.
-- ============================================================

-- ============================================================
-- allowed_emails — admin-managed sign-in allowlist
-- ============================================================
create table public.allowed_emails (
  email       citext primary key,
  role        text not null default 'viewer' check (role in ('admin', 'collaborator', 'viewer')),
  added_by    uuid references auth.users(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz          -- stamped by handle_new_user() on first matching signup
);

comment on table public.allowed_emails is
  'Admin-managed allowlist: an email present here (unconsumed or not) may '
  'sign in and is auto-approved at the pre-assigned role. Admin-only RLS in '
  'every direction — must never leak who is invited to anon or a non-admin '
  'authenticated caller. See design doc C4.';

create index allowed_emails_added_by_idx on public.allowed_emails (added_by);

alter table public.allowed_emails enable row level security;

drop policy if exists "allowed_emails_admin_select" on public.allowed_emails;
create policy "allowed_emails_admin_select" on public.allowed_emails
  for select to authenticated using (public.is_admin());

drop policy if exists "allowed_emails_admin_insert" on public.allowed_emails;
create policy "allowed_emails_admin_insert" on public.allowed_emails
  for insert to authenticated with check (public.is_admin());

drop policy if exists "allowed_emails_admin_update" on public.allowed_emails;
create policy "allowed_emails_admin_update" on public.allowed_emails
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "allowed_emails_admin_delete" on public.allowed_emails;
create policy "allowed_emails_admin_delete" on public.allowed_emails
  for delete to authenticated using (public.is_admin());

-- Belt and braces: strip Supabase's default ALL grant to anon/authenticated,
-- then hand back exactly what the admin-only policies above are written for.
-- service_role bypasses RLS inherently and needs no grant (used by the
-- invite-user edge function to upsert).
revoke all on public.allowed_emails from public, anon, authenticated;
grant select, insert, update, delete on public.allowed_emails to authenticated;

-- ============================================================
-- handle_new_user() — add the allowlist branch, keep bootstrap + invited
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_bootstrap boolean := lower(new.email) = 'jeremy.treder@gmail.com';
  -- inviteUserByEmail stamps invited_at; open sign-ups leave it null.
  is_invited   boolean := new.invited_at is not null;
  allow_row    public.allowed_emails%rowtype;
  is_approved  boolean;
  assigned_role text;
begin
  select * into allow_row from public.allowed_emails a where a.email = new.email;

  is_approved := is_bootstrap or is_invited or (allow_row.email is not null);
  assigned_role := case
    when is_bootstrap then 'admin'
    when allow_row.email is not null then allow_row.role
    else 'viewer'
  end;

  insert into public.profiles (id, display_name, role, is_approved)
  values (
    new.id,
    split_part(new.email, '@', 1),
    assigned_role,
    is_approved
  )
  on conflict (id) do nothing;

  if allow_row.email is not null then
    update public.allowed_emails
      set consumed_at = now()
      where email = allow_row.email and consumed_at is null;
  end if;

  return new;
end;
$$;

-- ============================================================
-- Admin RPC — list_allowed_emails()
-- ============================================================
create or replace function public.list_allowed_emails()
returns table (
  email       citext,
  role        text,
  note        text,
  created_at  timestamptz,
  consumed_at timestamptz,
  joined      boolean
)
language plpgsql security definer set search_path = public stable as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;

  return query
    select
      a.email,
      a.role,
      a.note,
      a.created_at,
      a.consumed_at,
      exists (select 1 from auth.users u where u.email = a.email) as joined
    from public.allowed_emails a
    order by a.created_at desc;
end;
$$;

revoke execute on function public.list_allowed_emails() from public, anon;
grant execute on function public.list_allowed_emails() to authenticated;

-- ============================================================
-- Admin RPC — remove_allowed_email(target_email)
-- ============================================================
create or replace function public.remove_allowed_email(target_email citext)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  delete from public.allowed_emails where email = target_email;
end;
$$;

revoke execute on function public.remove_allowed_email(citext) from public, anon;
grant execute on function public.remove_allowed_email(citext) to authenticated;

-- ============================================================
-- Service-role helper — email_to_user_id(email)
-- The GoTrue admin JS SDK's listUsers() has no reliable server-side email
-- filter across client versions; the invite-user edge function instead
-- calls this SECURITY DEFINER lookup (service_role execute only — auth.users
-- is not exposed to PostgREST, so anon/authenticated get nothing either way,
-- but the grant is explicit for clarity).
-- ============================================================
create or replace function public.email_to_user_id(target_email citext)
returns uuid language sql security definer set search_path = public, auth stable as $$
  select id from auth.users where email = target_email limit 1;
$$;

revoke execute on function public.email_to_user_id(citext) from public, anon, authenticated;
grant execute on function public.email_to_user_id(citext) to service_role;

-- ============================================================
-- C8 — is_approved() helper + RESTRICTIVE gates on self-scoped
-- sensitive tables (hangar/loadouts/links/drafts/p4k_uploads) and the
-- p4k-uploads storage bucket. Additive: no existing
-- policy is dropped or replaced, this only narrows further via AND.
-- Every existing user was backfilled to is_approved=true in
-- 20260530000001, so no currently-working account is affected.
-- ============================================================
create or replace function public.is_approved()
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select p.is_approved from public.profiles p where p.id = auth.uid()), false);
$$;

comment on function public.is_approved() is
  'True iff the calling auth.uid() has profiles.is_approved = true. Used as a '
  'RESTRICTIVE RLS gate on self-scoped tables so an authenticated-but-never-'
  'approved account (reachable via direct PostgREST, bypassing the app gate) '
  'cannot use its own hangar/loadout/link/draft rows either.';

do $$
declare
  t text;
begin
  foreach t in array array[
    'hangar_ships', 'hangar_ship_configs', 'hangar_role_loadouts',
    'hangar_concept_ships', 'user_ship_links', 'feedback_drafts',
    'p4k_uploads'
  ]
  loop
    execute format(
      'drop policy if exists %I on public.%I;',
      t || '_approved_gate', t
    );
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.is_approved()) with check (public.is_approved());',
      t || '_approved_gate', t
    );
  end loop;
end $$;

-- R1 (redteam): the p4k-uploads storage bucket is the same threat class — its
-- owner policies (see 00002_storage_bucket_p4k.sql) are self-folder /
-- authenticated but never checked is_approved(), so an unapproved account could
-- PUT up to 300MB and read/delete its objects via the Storage API directly.
-- Scoped RESTRICTIVE gate: only the p4k-uploads bucket is narrowed, every other
-- bucket's policies are left exactly as-is (bucket_id <> 'p4k-uploads' => true).
drop policy if exists "p4k_uploads_approved_gate" on storage.objects;
create policy "p4k_uploads_approved_gate" on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'p4k-uploads' or public.is_approved())
  with check (bucket_id <> 'p4k-uploads' or public.is_approved());
