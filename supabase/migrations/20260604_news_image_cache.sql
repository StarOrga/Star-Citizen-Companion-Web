-- ============================================================
-- Verse-news image cache — public asset bucket + cache index
--
-- Backs server-side caching of RSI Comm-Link / YouTube thumbnails. Previously
-- the client hot-linked the upstream RSI CDN urls directly; RSI's signed
-- `/i/<sha1>/…` proxy urls expire and cross-origin hotlinking is rate/referer
-- limited, so cards frequently rendered the empty gradient placeholder.
--
-- `fetch-verse-news` now downloads each image once (service-role) into the
-- `news-images` bucket and returns our own durable public url. The
-- `verse_image_cache` table is the fast "already cached?" index so we don't
-- re-download on every request.
--
-- Alpha-phase data policy: additive only — no existing table is touched.
-- ============================================================

-- ---- public asset bucket (post + cover image variants) -----------------
-- Public-read like ship-skins / codex-previews: news art is non-sensitive.
-- Writes are service-role only (no client write policy below).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'news-images', 'news-images', true, 10485760,  -- 10 MB/object ceiling
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do nothing;

-- public read of news-images objects (anon + authenticated).
-- Idempotent: Postgres has no `create policy if not exists`, so drop first —
-- this migration must survive a re-run (db:push retries / db:reset).
drop policy if exists "news_images_public_read" on storage.objects;
create policy "news_images_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'news-images');

-- ---- cache index --------------------------------------------------------
-- One row per cached source image. `source_key` = SHA-1 of the variant-stripped
-- upstream url (so post/cover variants share a key); doubles as the storage
-- folder name. `ext` is the stored file extension (cover/post.<ext>).
create table if not exists public.verse_image_cache (
  source_key text primary key,
  ext        text not null,
  cached_at  timestamptz not null default now()
);

-- Only the service role (edge function) reads/writes this index. RLS on with no
-- policy = deny anon/authenticated, service role bypasses. Keeps the security
-- advisor happy (no "RLS disabled" finding).
alter table public.verse_image_cache enable row level security;
