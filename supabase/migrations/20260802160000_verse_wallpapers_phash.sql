-- Starscape near-duplicate detection: remember what each wallpaper LOOKS like.
--
-- `verse_wallpapers` deduped by CDN media id only, which catches the same asset
-- and nothing else. RSI publishes one studio scene as several separate assets —
-- the Foundation Festival 2026 comm-link contributed 8 rows, 4 of them the same
-- hangar with the same camera and lighting, two of those wearing the SAME armour
-- set from the front and from the back. At gallery tile size that reads as the
-- identical photo repeated, every copy linking to the identical comm-link.
--
-- `phash` is the 256-bit dHash of the image (64 hex chars), produced by
-- supabase/functions/fetch-verse-news/perceptual-hash.ts. fetch-verse-news
-- compares each new candidate against the stored hashes and drops one that is
-- within NEAR_DUPLICATE_MAX_DISTANCE bits of a wallpaper the gallery already has.
--
-- Nullable on purpose: WebP has no lightweight pure-JS decoder on the edge
-- runtime, so those rows carry no hash. A null hash never matches anything —
-- such an image is always kept, which is the safe direction (a redundant tile is
-- visible and fixable; artwork rejected in error is gone once its article leaves
-- the feed).
--
-- No index: the capture path reads the whole hash column once per crawl and
-- compares in memory. Hamming distance is not indexable by btree anyway, and the
-- table is in the low hundreds of rows.

alter table public.verse_wallpapers
  add column if not exists phash text;

comment on column public.verse_wallpapers.phash is
  '256-bit dHash (64 hex chars) of the image, written by fetch-verse-news. Used '
  'to reject near-duplicate artwork at capture time. Null = not hashable '
  '(undecodable format) and therefore never treated as a duplicate.';
