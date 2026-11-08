-- Nachschub-HQ W1.4 - news the user collected ("Lesezeichen" is gone, r1 d-model-note: news are collected).
-- News bookmarks used to live in localStorage; the client copies them into this table on the next visit
-- (r2 d2-newsmove = copy: the local key is cleared only after the copy is confirmed).
-- Gallery needs no table: an up-voted wallpaper (wallpaper_votes) counts as collected.
-- Purely additive. Owner-only RLS.

create table if not exists public.user_news_collected (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  news_id      text        not null,
  collected_at timestamptz not null default now(),
  primary key (user_id, news_id),
  constraint user_news_collected_id_len check (char_length(news_id) between 1 and 300)
);

comment on table public.user_news_collected is
  'News items a user collected (Sammlung). news_id = the feed item id. Owner-only. Max 500 per user (trigger).';

create or replace function public.user_news_collected_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('user_news_collected:' || new.user_id::text, 0));
  if (select count(*) from public.user_news_collected where user_id = new.user_id) >= 500 then
    raise exception 'user_news_collected: row limit reached (500)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.user_news_collected_cap() from public, anon, authenticated;

drop trigger if exists user_news_collected_cap on public.user_news_collected;
create trigger user_news_collected_cap before insert on public.user_news_collected
  for each row execute function public.user_news_collected_cap();

alter table public.user_news_collected enable row level security;
revoke all on table public.user_news_collected from anon;
grant select, insert, delete on table public.user_news_collected to authenticated;

drop policy if exists user_news_collected_select_own on public.user_news_collected;
create policy user_news_collected_select_own on public.user_news_collected
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists user_news_collected_insert_own on public.user_news_collected;
create policy user_news_collected_insert_own on public.user_news_collected
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists user_news_collected_delete_own on public.user_news_collected;
create policy user_news_collected_delete_own on public.user_news_collected
  for delete to authenticated using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
