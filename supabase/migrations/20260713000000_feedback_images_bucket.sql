-- ============================================================
-- Feedback images — storage bucket for admin-feedback attachments
--
-- The rich reply composer lets admins attach screenshots. Until now those were
-- inlined into the message `body` as base64 `data:` URIs, which blew past the
-- `admin_feedback_messages_body_check` 20 000-char ceiling (a single compressed
-- screenshot is 150–400 KB → ~200 K+ base64 chars) — every attach failed the
-- insert. Attachments now upload here and the body carries only the tiny public
-- URL.
--
-- Public-read like ship-skins / news-images: the board itself is admin-only, and
-- objects are namespaced under an unguessable per-user UUID path, so a public
-- bucket keeps `<img src>` rendering synchronous (no signed-URL expiry to track)
-- without exposing an enumerable listing. Writes are restricted to the
-- authenticated uploader's own folder.
--
-- Alpha-phase data policy: additive only — no existing table is touched.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-images', 'feedback-images', true, 5242880,  -- 5 MB/object ceiling
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- Public read of feedback-images objects (anon + authenticated) so the stored
-- markdown URL renders directly. Idempotent: drop first (no `if not exists`).
drop policy if exists "feedback_images_public_read" on storage.objects;
create policy "feedback_images_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'feedback-images');

-- Authenticated users may upload only into their own uid-prefixed folder
-- (mirrors the p4k-uploads owner-folder convention).
drop policy if exists "feedback_images_owner_upload" on storage.objects;
create policy "feedback_images_owner_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owners may delete their own uploads (e.g. a mis-attached screenshot).
drop policy if exists "feedback_images_owner_delete" on storage.objects;
create policy "feedback_images_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
