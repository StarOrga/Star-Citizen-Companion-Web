-- "Continue on your phone": one-time hand-off codes (concept 2026-10-25 header/
-- footer analysis, spec section 11).
--
-- A signed-in desktop asks `handoff-create` for a code; the phone peeks at it
-- (read-only) and, after an explicit tap, redeems it at `/handoff` through
-- `handoff-redeem` and gets a NEW session of its own (never the desktop's
-- tokens). Only the SHA-256 of the code is stored, so a DB read does not yield
-- redeemable codes. All writes go through edge functions with the service role;
-- the owner may only READ their rows (the desktop lists its connected phones).
--
-- Alpha policy: new table, nothing dropped.
-- ROLLBACK: select cron.unschedule('handoff-codes-cleanup');
--           drop function public.handoff_peek(text), public.handoff_redeem(text, text),
--             public.handoff_attach_session(uuid, uuid), public.handoff_kill_session(uuid, uuid),
--             public.handoff_revoke(uuid, uuid), public.handoff_fail(uuid);
--           drop table public.handoff_codes;

create table public.handoff_codes (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- sha256 hex of the code. The code itself is never stored.
  code_hash       text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  -- Same-origin relative path, validated by the edge function before insert.
  target_path     text not null check (target_path like '/%' and target_path not like '//%' and length(target_path) <= 512),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '60 seconds',
  consumed_at     timestamptz,
  -- Coarse label of the redeeming device ("Android - Chrome"), shown on the desktop.
  consumed_device text,
  -- auth.sessions id of the session minted for the phone; lets the owner revoke it.
  session_id      uuid,
  -- Set by revoke. A consumed row revoked BEFORE its session_id was attached
  -- makes handoff_attach_session() refuse, and redeem then kills the session.
  revoked_at      timestamptz,
  -- "Connected" means the session is attached, not merely that the code was
  -- consumed: consumed_at is set first, session_id only after a successful mint.
  session_attached boolean generated always as (session_id is not null) stored
);

create index handoff_codes_user_created_idx on public.handoff_codes (user_id, created_at desc);
create index handoff_codes_expires_idx on public.handoff_codes (expires_at);

alter table public.handoff_codes enable row level security;

-- Owner reads own rows. No insert/update/delete policy: only the service role
-- (which bypasses RLS) writes.
create policy handoff_codes_select_own on public.handoff_codes
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Column-level grant: the code hash and session id stay unreadable even for the owner.
revoke all on public.handoff_codes from anon, authenticated;
grant select (id, user_id, target_path, created_at, expires_at, consumed_at, consumed_device, revoked_at, session_attached)
  on public.handoff_codes to authenticated;

-- Read-only look at a live code: who would the phone be signed in as? Does NOT
-- consume. Revoked / used / expired codes answer nothing.
create function public.handoff_peek(p_hash text)
returns table (user_id uuid, target_path text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.user_id, c.target_path from public.handoff_codes c
   where c.code_hash = p_hash
     and c.consumed_at is null
     and c.revoked_at is null
     and c.expires_at > now();
$$;

-- Atomic single-use redeem: one UPDATE ... WHERE consumed_at IS NULL AND not
-- expired AND not revoked, so two parallel redeems cannot both win.
create function public.handoff_redeem(p_hash text, p_device text)
returns table (user_id uuid, target_path text, id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.handoff_codes c
     set consumed_at = now(),
         consumed_device = left(p_device, 80)
   where c.code_hash = p_hash
     and c.consumed_at is null
     and c.revoked_at is null
     and c.expires_at > now()
  returning c.user_id, c.target_path, c.id;
$$;

-- Store the phone's session id, unless the owner revoked in the meantime.
-- Returns false when nothing changed: the caller must then kill the session it
-- just minted and fail closed. Serialised with handoff_revoke() by the row lock.
create function public.handoff_attach_session(p_id uuid, p_session uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
  update public.handoff_codes
     set session_id = p_session
   where id = p_id and consumed_at is not null and revoked_at is null and session_id is null;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- A redeem that failed after the consume (user lookup, generateLink, verifyOtp,
-- GoTrue 429, attach): mark the row revoked so it can never show up as a
-- connected phone. Only touches rows that never got a session.
create function public.handoff_fail(p_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.handoff_codes
     set revoked_at = coalesce(revoked_at, now())
   where id = p_id and session_id is null;
$$;

-- Delete one auth session (refresh tokens cascade). Scoped by owner. The `auth`
-- schema belongs to supabase_auth_admin; on the cloud project postgres has
-- DELETE (verified 2026-10-26: has_table_privilege = true), but see the
-- suspend_user note in 20260904020000: where the grant is missing we fail with a
-- DISTINCT error the edge function maps to `revoke_unavailable`.
create function public.handoff_kill_session(p_session uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare n int;
begin
  begin
    delete from auth.sessions where id = p_session and user_id = p_user;
    get diagnostics n = row_count;
  exception when insufficient_privilege then
    raise exception 'revoke_unavailable' using errcode = '42501';
  end;
  return n > 0;
end;
$$;

-- Owner revokes one hand-off. Returns what actually happened:
--   'revoked'  the phone's session was deleted
--   'pending'  consumed but no session attached yet; redeem will now fail closed
--   'burned'   never redeemed; the code can no longer be used
--   'already'  was revoked before, nothing changed
--   'none'     no such row for this owner
create function public.handoff_revoke(p_id uuid, p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare r record;
begin
  update public.handoff_codes
     set revoked_at = now(),
         consumed_at = coalesce(consumed_at, now())
   where id = p_id and user_id = p_user and revoked_at is null
  returning session_id, (consumed_device is not null) as was_redeemed into r;

  if not found then
    if exists (select 1 from public.handoff_codes where id = p_id and user_id = p_user) then
      return 'already';
    end if;
    return 'none';
  end if;

  if r.session_id is not null then
    perform public.handoff_kill_session(r.session_id, p_user);
    return 'revoked';
  end if;
  return case when r.was_redeemed then 'pending' else 'burned' end;
end;
$$;

revoke all on function public.handoff_peek(text) from public, anon, authenticated;
revoke all on function public.handoff_redeem(text, text) from public, anon, authenticated;
revoke all on function public.handoff_attach_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.handoff_fail(uuid) from public, anon, authenticated;
grant execute on function public.handoff_fail(uuid) to service_role;
revoke all on function public.handoff_kill_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.handoff_revoke(uuid, uuid) from public, anon, authenticated;
grant execute on function public.handoff_peek(text) to service_role;
grant execute on function public.handoff_redeem(text, text) to service_role;
grant execute on function public.handoff_attach_session(uuid, uuid) to service_role;
grant execute on function public.handoff_kill_session(uuid, uuid) to service_role;
grant execute on function public.handoff_revoke(uuid, uuid) to service_role;

-- Cleanup: unconsumed rows are useless once expired. Consumed, UNREVOKED rows
-- are kept (their session may still live and the desktop lists them to revoke);
-- revoked rows go after a day. pg_cron is already enabled (20260906130000);
-- never `create extension pg_cron` again (2BP01).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'handoff-codes-cleanup') then
    perform cron.unschedule('handoff-codes-cleanup');
  end if;
end $$;

select cron.schedule(
  'handoff-codes-cleanup',
  '*/15 * * * *',
  $job$
  delete from public.handoff_codes
   where (consumed_at is null and revoked_at is null and expires_at < now() - interval '5 minutes')
      or (revoked_at is not null and revoked_at < now() - interval '1 day')
      -- phone signed itself out / session deleted elsewhere (password change,
      -- global sign-out): the row no longer describes a live session
      or (session_id is not null and not exists (select 1 from auth.sessions s where s.id = session_id))
      -- consumed but never attached (crash between consume and attach)
      or (consumed_at is not null and session_id is null and consumed_at < now() - interval '10 minutes');
  $job$
);
