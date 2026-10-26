-- "Continue on your phone": one-time hand-off codes (concept 2026-10-25 header/
-- footer analysis, spec section 11).
--
-- A signed-in desktop asks `handoff-create` for a code; the phone redeems it at
-- `/handoff?c=<code>` through `handoff-redeem` and gets a NEW session of its own
-- (never the desktop's tokens). Only the SHA-256 of the code is stored, so a DB
-- read does not yield redeemable codes. All writes go through edge functions
-- with the service role; the owner may only READ their rows (the desktop polls
-- its row to show "phone connected").
--
-- Alpha policy: new table, nothing dropped.
-- ROLLBACK: select cron.unschedule('handoff-codes-cleanup');
--           drop function public.handoff_redeem(text, text), public.handoff_revoke_session(uuid, uuid);
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
  revoked_at      timestamptz
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
grant select (id, user_id, target_path, created_at, expires_at, consumed_at, consumed_device, revoked_at)
  on public.handoff_codes to authenticated;

-- Atomic single-use redeem: one UPDATE ... WHERE consumed_at IS NULL AND not
-- expired, so two parallel redeems cannot both win.
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
     and c.expires_at > now()
  returning c.user_id, c.target_path, c.id;
$$;

-- Kill the phone's session (and with it its refresh-token family). Scoped by
-- owner so a mismatched id is a no-op.
create function public.handoff_revoke_session(p_session uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare n int;
begin
  delete from auth.sessions where id = p_session and user_id = p_user;
  get diagnostics n = row_count;
  update public.handoff_codes set revoked_at = now()
   where session_id = p_session and user_id = p_user and revoked_at is null;
  return n > 0;
end;
$$;

revoke all on function public.handoff_redeem(text, text) from public, anon, authenticated;
revoke all on function public.handoff_revoke_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.handoff_redeem(text, text) to service_role;
grant execute on function public.handoff_revoke_session(uuid, uuid) to service_role;

-- Cleanup: unconsumed rows are useless once expired; consumed rows stay a day so
-- the desktop can still show "phone connected" / offer revoke. pg_cron is already
-- enabled (20260906130000); never `create extension pg_cron` again (2BP01).
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
   where (consumed_at is null and expires_at < now() - interval '5 minutes')
      or created_at < now() - interval '1 day';
  $job$
);
