-- Starscape wallpaper gallery (#133) — METADATA ONLY, no image copies.
--
-- Design decision (maintainer directive): we deliberately do NOT store
-- full-res image bytes in Supabase Storage. The gallery hotlinks the
-- ORIGINAL RSI CDN urls (media.robertsspaceindustries.com/<id>/source.<ext>,
-- verified largest variant, browser-hotlinkable) so the database only grows
-- by one small metadata row per image — never by megabytes of pixels.
--
-- Rows are written by the fetch-verse-news edge function (service role)
-- as a best-effort side effect of the normal news crawl, deduped by the
-- CDN image id. Public read: the gallery is a public page (#131).

create table if not exists public.verse_wallpapers (
  image_id     text primary key,          -- media CDN id (url path segment) → dedupe
  source_url   text not null,             -- ORIGINAL full-res variant (…/source.<ext>)
  preview_url  text not null,             -- cover variant (≤1140w) for grid thumbnails
  title        text,                      -- source article title
  series       text,                      -- comm-link series/category (filtering)
  article_url  text not null,             -- RSI permalink → attribution link
  published_at timestamptz,               -- article publish date (sorting)
  captured_at  timestamptz not null default now()
);

comment on table public.verse_wallpapers is
  'Starscape gallery (#133): metadata + ORIGINAL RSI CDN links for high-res '
  'news imagery. No image bytes are stored — hotlinks only, deduped by CDN id. '
  'Written by fetch-verse-news (service role).';

create index if not exists verse_wallpapers_published_idx
  on public.verse_wallpapers (published_at desc nulls last);

alter table public.verse_wallpapers enable row level security;

drop policy if exists verse_wallpapers_public_read on public.verse_wallpapers;
create policy verse_wallpapers_public_read on public.verse_wallpapers
  for select to anon, authenticated using (true);

-- Writes are service-role only (no client write policy + explicit revoke).
revoke insert, update, delete, truncate on public.verse_wallpapers from anon, authenticated;
grant select on public.verse_wallpapers to anon, authenticated;
