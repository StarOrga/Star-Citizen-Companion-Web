-- Search concept / #832 part 1: find gallery images by title or series.
-- verse_wallpapers is publicly readable (policy verse_wallpapers_public_read,
-- select granted to anon + authenticated), so the RPC is security INVOKER and
-- granted to both. pg_trgm already exists (schema extensions) - not re-created.

create index if not exists verse_wallpapers_title_trgm
  on public.verse_wallpapers using gin (title extensions.gin_trgm_ops);
create index if not exists verse_wallpapers_series_trgm
  on public.verse_wallpapers using gin (series extensions.gin_trgm_ops);

create or replace function public.search_gallery(p_query text, p_limit int default 8)
returns table (image_id text, title text, series text, published_at timestamptz, preview_url text)
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select left(btrim(coalesce(p_query, '')), 80) as t
  ),
  esc as (
    select t, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as e from q
  )
  select w.image_id, w.title, w.series, w.published_at, w.preview_url
    from public.verse_wallpapers w, esc
   where char_length(esc.t) >= 2
     and (
       w.title ilike '%' || esc.e || '%'
       or w.series ilike '%' || esc.e || '%'
       or word_similarity(esc.t, coalesce(w.title, '')) >= 0.45
     )
   order by
     (w.title ilike esc.e || '%') desc,
     (w.title ilike '%' || esc.e || '%') desc,
     word_similarity(esc.t, coalesce(w.title, '')) desc,
     w.published_at desc nulls last
   limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;

revoke all on function public.search_gallery(text, int) from public;
grant execute on function public.search_gallery(text, int) to anon, authenticated;

notify pgrst, 'reload schema';
