-- ============================================================
-- Feedback attachments — who may upload what (admin feedback 312a4acc)
--
-- Until now `feedback-images` accepted four image MIME types and nothing else,
-- for everybody. Two things change:
--
--   1. ADMINS may attach arbitrary files (a log, a crash dump, a PDF). The
--      bucket's `allowed_mime_types` is therefore cleared — a MIME allow-list
--      is a bucket-wide setting and cannot distinguish who is uploading.
--   2. Because of (1), the per-role rule moves into the INSERT policy, where it
--      *can* see the uploader: everyone keeps their image upload, but a
--      non-image object may only be written by an admin.
--
-- The rule is expressed on the object NAME's extension rather than on a MIME
-- header. `storage.objects.metadata` is not populated at the time the row's
-- WITH CHECK runs, and a client-supplied `content-type` would be the client's
-- word for it anyway; the path is minted by `uploadFeedbackImages`, which
-- derives the extension from the actual file. A viewer renaming a `.exe` to
-- `.png` gains the right to store bytes they could already have stored as a
-- JPEG — the gate is about what the surface *offers*, and about keeping the
-- non-image path an admin affordance, not about content inspection.
--
-- The 5 MB per-object ceiling stays exactly as it was; the composer now checks
-- it client-side too, so an oversized file is refused with a sentence instead
-- of an unreadable storage error.
--
-- Alpha-phase data policy: additive only — no table is dropped, no existing
-- object is touched, and every object already in the bucket stays readable.
-- ============================================================

-- Widen the bucket: the per-role decision lives in the policy below, not here.
update storage.buckets
set allowed_mime_types = null
where id = 'feedback-images';

-- Uploads still land in the uploader's own uid-prefixed folder; on top of that,
-- anything that is not one of the known image extensions is admin-only.
-- Idempotent: drop first (no `if not exists` for policies).
drop policy if exists "feedback_images_owner_upload" on storage.objects;
create policy "feedback_images_owner_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      lower(name) ~ '\.(png|jpe?g|gif|webp|avif)$'
      or public.is_admin()
    )
  );
