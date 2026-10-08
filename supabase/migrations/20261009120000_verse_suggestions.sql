-- Verse hub, part 2: Kartograph suggestions + community constellation.
--
-- Builds on 20261009100000_verse_hub.sql. Nothing is dropped.
--
--   verse_kartograph_rank()      the caller's rank = patches with all 7 stars
--                                (same rule as verse_explorer_state().kartograph)
--   verse_suggestions            rank >= 1 may suggest a top item; own rows +
--                                admin read; only admins change status
--   verse_promote_suggestion()   admin: suggestion -> verse_pins row (briefing pin)
--   verse_community_stars()      anon-safe aggregate per patch line: explorer
--                                count + count per star_key, never a user id

-- ============================================================
-- 1 — Kartograph rank of the caller
--
-- SECURITY DEFINER because it is evaluated inside an RLS policy; it only ever
-- looks at auth.uid()'s own rows, so it leaks nothing about other users.
-- ============================================================
create or replace function public.verse_kartograph_rank()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from (select sp.patch_line
            from public.verse_star_progress sp
           where sp.user_id = auth.uid()
           group by sp.patch_line
          having count(*) >= 7) full_patches;
$$;

revoke execute on function public.verse_kartograph_rank() from public, anon;
grant execute on function public.verse_kartograph_rank() to authenticated;

-- ============================================================
-- 2 — verse_suggestions
-- ============================================================
create table if not exists public.verse_suggestions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  item_url   text        not null check (char_length(item_url) between 1 and 500 and item_url ~ '^(https://|/)'),
  note       text        check (note is null or char_length(note) <= 500),
  status     text        not null default 'open' check (status in ('open', 'pinned', 'dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists verse_suggestions_status_idx on public.verse_suggestions (status, created_at desc);
create index if not exists verse_suggestions_user_idx on public.verse_suggestions (user_id, created_at desc);

alter table public.verse_suggestions enable row level security;
revoke all on public.verse_suggestions from anon;
grant select, insert, update, delete on public.verse_suggestions to authenticated;

drop policy if exists verse_suggestions_read on public.verse_suggestions;
create policy verse_suggestions_read on public.verse_suggestions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Kartograph rank >= 1, own row, always 'open', at most 10 per day.
drop policy if exists verse_suggestions_kartograph_insert on public.verse_suggestions;
create policy verse_suggestions_kartograph_insert on public.verse_suggestions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'open'
    and public.verse_kartograph_rank() >= 1
    and (select count(*) from public.verse_suggestions s
          where s.user_id = (select auth.uid()) and s.created_at > now() - interval '1 day') < 10
  );

drop policy if exists verse_suggestions_admin_update on public.verse_suggestions;
create policy verse_suggestions_admin_update on public.verse_suggestions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists verse_suggestions_admin_delete on public.verse_suggestions;
create policy verse_suggestions_admin_delete on public.verse_suggestions
  for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- 3 — promote a suggestion to a briefing pin (admin)
--
-- SECURITY INVOKER: the verse_pins / verse_suggestions admin policies decide;
-- the explicit is_admin() check only turns a silent no-op into a clear 42501.
-- ============================================================
create or replace function public.verse_promote_suggestion(
  p_id uuid,
  p_title text,
  p_kind text default 'link',
  p_weight int default 0
)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_url text;
  v_note text;
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'only admins promote suggestions' using errcode = '42501';
  end if;
  select s.item_url, s.note into v_url, v_note from public.verse_suggestions s where s.id = p_id;
  if v_url is null then
    raise exception 'suggestion not found' using errcode = 'P0002';
  end if;
  v_key := 'suggestion:' || p_id::text;
  insert into public.verse_pins (item_key, kind, title, url, summary, weight)
  values (v_key, p_kind, p_title, v_url, v_note, p_weight)
  on conflict (item_key) do update
    set kind = excluded.kind, title = excluded.title, url = excluded.url,
        summary = excluded.summary, weight = excluded.weight;
  update public.verse_suggestions set status = 'pinned' where id = p_id;
  return v_key;
end;
$$;

revoke execute on function public.verse_promote_suggestion(uuid, text, text, int) from public, anon;
grant execute on function public.verse_promote_suggestion(uuid, text, text, int) to authenticated;

-- ============================================================
-- 4 — community constellation (anon-safe aggregate)
--
-- Counts only: how many explorers earned >= 1 star on the line and how many
-- earned each star. No user id, no per-user row ever leaves the function.
-- ============================================================
create or replace function public.verse_community_stars(p_patch_line text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'patch_line', p_patch_line,
    'explorers', (select count(distinct sp.user_id)::int
                    from public.verse_star_progress sp where sp.patch_line = p_patch_line),
    'stars', coalesce((select jsonb_object_agg(k.star_key, k.n)
                         from (select sp.star_key, count(*)::int as n
                                 from public.verse_star_progress sp
                                where sp.patch_line = p_patch_line
                                group by sp.star_key) k), '{}'::jsonb));
$$;

revoke execute on function public.verse_community_stars(text) from public;
grant execute on function public.verse_community_stars(text) to anon, authenticated;
