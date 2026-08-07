-- 20260530 · Invite-only access gate
-- ---------------------------------------------------------------
-- Locks the app down to invite-only: a user may pass the login page
-- only if an admin invited them (Supabase `inviteUserByEmail`, which
-- stamps auth.users.invited_at) or they are the bootstrap admin.
--
-- Self-registrations (open email/password sign-up or first-time Google
-- OAuth) land with is_approved = false and are bounced back to /login
-- by the client `approvedGuard`. For full server-side hardening also
-- disable "Allow new users to sign up" in Supabase Auth settings.

-- ============================================================
-- profiles.is_approved
-- ============================================================
alter table public.profiles
  add column if not exists is_approved boolean not null default false;

-- Backfill: everyone who already has an account stays in (alpha — the
-- existing roster is the trusted set; we don't want to lock anyone out).
update public.profiles set is_approved = true where is_approved = false;

-- ============================================================
-- handle_new_user — only invited users (or the bootstrap admin) are auto-approved
-- ============================================================
-- The bootstrap account is matched by the SHA-256 of its lowercased
-- e-mail, not by the address — this repo is public. Same account, just
-- not readable here (see scripts/check-no-personal-emails.mjs).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  is_bootstrap boolean := encode(sha256(convert_to(lower(new.email), 'UTF8')), 'hex')
    = 'd6deeeba4dcdf15e121a7a1b0ce98f1c4c0330cd77d272d86f254c49ad12d687';
  -- inviteUserByEmail stamps invited_at; open sign-ups leave it null.
  is_invited boolean := new.invited_at is not null;
begin
  insert into public.profiles (id, display_name, role, is_approved)
  values (
    new.id,
    split_part(new.email, '@', 1),
    case when is_bootstrap then 'admin' else 'viewer' end,
    is_bootstrap or is_invited
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
