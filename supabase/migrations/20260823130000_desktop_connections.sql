-- 20260823130000_desktop_connections.sql
-- Per-account desktop-app check-in ledger (admin feedback 924bf1d8).
--
-- The new download menu on the Codex landing (Data Uploader) and in the
-- Starscape header must answer "is this player's desktop app connected?", where
-- connected means "checked in within the last 30 days, otherwise expired".
-- Nothing in the schema could answer that before: telemetry_events is
-- deliberately anonymous (salted hashes, no user id) and the release tables are
-- about builds, not accounts.
--
-- What counts as a check-in:
--   1. The loopback OAuth handoff — /uploader/auth (uploader) and
--      /desktop/connect (Starscape). That IS the connect event, and the website
--      observes it directly; both pages now call desktop_touch_connection().
--   2. The desktop apps themselves, on startup, with their stored session — the
--      same RPC, which is why it is granted to `authenticated` and takes an
--      optional app version.
--   3. Fallback for the uploader only: the newest p4k_bundles row uploaded by
--      the account. An upload is proof the tool ran signed in as that user, and
--      it predates this ledger, so existing collaborators do not read as
--      "never connected" on day one.
--
-- Alpha-phase policy: ADDITIVE only. No table is dropped, renamed or altered.

create table if not exists public.desktop_connections (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  product       text        not null check (product in ('uploader', 'starscape')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  app_version   text,
  primary key (user_id, product)
);

create index if not exists desktop_connections_recent_idx
  on public.desktop_connections (product, last_seen_at desc);

comment on table public.desktop_connections is
  'One row per (account, desktop product): when that account last proved a running desktop app. '
  'Written only through desktop_touch_connection(); read through my_desktop_connections(). '
  'The 30-day connected/expired split lives in the UI (src/app/desktop/desktop-access.ts).';
comment on column public.desktop_connections.last_seen_at is
  'Newest check-in. Anything older than 30 days is presented as an expired connection.';

alter table public.desktop_connections enable row level security;

-- Own rows are readable directly; writes go exclusively through the RPC below,
-- so a client can never backdate or forge somebody else's check-in.
drop policy if exists "desktop_connections_read_own" on public.desktop_connections;
create policy "desktop_connections_read_own" on public.desktop_connections
  for select to authenticated
  using (user_id = auth.uid());

-- Admins may read all of them ("has that user ever connected?" is a support
-- question). Still read-only — no insert/update/delete policy exists for anyone.
drop policy if exists "desktop_connections_read_admin" on public.desktop_connections;
create policy "desktop_connections_read_admin" on public.desktop_connections
  for select to authenticated
  using (public.is_admin());

-- ------------------------------------------------------------------
-- desktop_touch_connection — record a check-in for the CALLER only
-- ------------------------------------------------------------------
-- SECURITY DEFINER so the table needs no write policy at all. The row is keyed
-- on auth.uid(); p_product is whitelisted; the version string is truncated.
create or replace function public.desktop_touch_connection(
  p_product text,
  p_app_version text default null
)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_product is null or p_product not in ('uploader', 'starscape') then
    raise exception 'invalid product: %', p_product;
  end if;

  insert into public.desktop_connections (user_id, product, first_seen_at, last_seen_at, app_version)
  values (v_uid, p_product, v_now, v_now, left(p_app_version, 40))
  on conflict (user_id, product) do update
    set last_seen_at = v_now,
        -- Keep the last known version when the caller does not send one.
        app_version = coalesce(excluded.app_version, desktop_connections.app_version);

  return v_now;
end $$;

comment on function public.desktop_touch_connection(text, text) is
  'Upsert the calling account''s check-in for one desktop product. Callable by the web loopback '
  'handoff pages and by the desktop apps themselves with their stored session.';

revoke all on function public.desktop_touch_connection(text, text) from public, anon;
grant execute on function public.desktop_touch_connection(text, text) to authenticated;

-- ------------------------------------------------------------------
-- my_desktop_connections — the caller's own check-ins, merged
-- ------------------------------------------------------------------
-- SECURITY DEFINER because of the p4k_bundles fallback, which must not depend on
-- that table's collaborator-only read policy. It is hard-scoped to auth.uid()
-- and returns nothing at all for an anonymous caller — there is no parameter to
-- point it at another account.
create or replace function public.my_desktop_connections()
returns table (product text, last_seen_at timestamptz, app_version text)
language plpgsql security definer stable set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return;
  end if;

  return query
  with signals as (
    select dc.product as p, dc.last_seen_at as seen, dc.app_version as ver
      from public.desktop_connections dc
     where dc.user_id = v_uid
    union all
    select 'uploader'::text, max(b.created_at), null::text
      from public.p4k_bundles b
     where b.uploaded_by = v_uid
    having max(b.created_at) is not null
  )
  select s.p, max(s.seen), (array_agg(s.ver order by s.seen desc))[1]
    from signals s
   group by s.p;
end $$;

comment on function public.my_desktop_connections() is
  'The calling account''s desktop check-ins, newest per product (uploader also falls back to its '
  'newest p4k_bundles upload). Never exposes another account''s rows.';

revoke all on function public.my_desktop_connections() from public, anon;
grant execute on function public.my_desktop_connections() to authenticated;
