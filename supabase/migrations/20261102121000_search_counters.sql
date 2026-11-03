-- Search concept (parity C9/C10): anonymous counters. No user id anywhere.
-- Written/read only through the RPCs below; the tables have RLS on, no policy
-- and no grants. Both tables are capped so a spamming client cannot grow them
-- without bound (new keys are dropped once the cap is reached).

create table if not exists public.search_misses (
  query   text primary key,
  hits    int not null default 1,
  last_at timestamptz not null default now()
);

create table if not exists public.search_opens (
  entity_kind text not null,
  class_name  text not null,
  hits        int not null default 1,
  last_at     timestamptz not null default now(),
  primary key (entity_kind, class_name)
);

alter table public.search_misses enable row level security;
alter table public.search_opens enable row level security;
revoke all on public.search_misses from anon, authenticated;
revoke all on public.search_opens from anon, authenticated;

comment on table public.search_misses is 'Searches without a hit: normalized text + count, no user id (C10).';
comment on table public.search_opens is 'How often an entity was opened from search: count only, no user id (C9).';

create or replace function public.search_log_miss(p_query text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q text := left(lower(btrim(coalesce(p_query, ''))), 120);
begin
  if char_length(q) < 2 then return; end if;
  if not exists (select 1 from public.search_misses where query = q)
     and (select count(*) from public.search_misses) >= 5000 then
    return;
  end if;
  insert into public.search_misses as m (query) values (q)
  on conflict (query) do update set hits = m.hits + 1, last_at = now();
end;
$$;

create or replace function public.search_log_open(p_kind text, p_class text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := left(btrim(coalesce(p_kind, '')), 40);
  c text := left(btrim(coalesce(p_class, '')), 200);
begin
  if k = '' or c = '' then return; end if;
  if not exists (select 1 from public.search_opens where entity_kind = k and class_name = c)
     and (select count(*) from public.search_opens) >= 20000 then
    return;
  end if;
  insert into public.search_opens as o (entity_kind, class_name) values (k, c)
  on conflict (entity_kind, class_name) do update set hits = o.hits + 1, last_at = now();
end;
$$;

create or replace function public.search_popularity(p_limit int default 500)
returns table (entity_kind text, class_name text, hits int)
language sql
security definer
set search_path = public
stable
as $$
  select o.entity_kind, o.class_name, o.hits
    from public.search_opens o
   order by o.hits desc, o.last_at desc
   limit least(greatest(coalesce(p_limit, 500), 1), 2000);
$$;

create or replace function public.admin_search_misses(p_limit int default 100)
returns table (query text, hits int, last_at timestamptz)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select m.query, m.hits, m.last_at
      from public.search_misses m
     order by m.hits desc, m.last_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

revoke all on function public.search_log_miss(text) from public;
revoke all on function public.search_log_open(text, text) from public;
revoke all on function public.search_popularity(int) from public;
revoke all on function public.admin_search_misses(int) from public;
grant execute on function public.search_log_miss(text) to anon, authenticated;
grant execute on function public.search_log_open(text, text) to anon, authenticated;
grant execute on function public.search_popularity(int) to anon, authenticated;
grant execute on function public.admin_search_misses(int) to authenticated;

notify pgrst, 'reload schema';
