-- ============================================================
-- 20260928211217_feedback_images_private.sql
-- Make the `feedback-images` bucket private and replace its bucket-wide
-- public read policy with a scoped one (AUD-115, AUD-351 · plan D01 step 4).
--
-- WHY
--   20260726170000_user_feedback_channel.sql:37-43 already recorded it as a
--   "KNOWN, PRE-EXISTING GAP": screenshots and files live in a PUBLIC bucket,
--   so every attachment — including admin replies and admin-only files — is
--   downloadable by URL, and the bucket-wide `feedback_images_public_read`
--   policy made the objects listable for anon as well. Since the user channel
--   (non-admin writers) that is private user data behind a guessable listing.
--
--   The app no longer loads the public URL: a body keeps it as a stable
--   identifier, and rendering signs it (FeedbackAttachmentSignerService,
--   1 h signed URLs). That app change must be LIVE before this migration runs
--   (signing works on the still-public bucket too), so no attachment breaks.
--
-- WHAT
--   1. storage.buckets.public = false for 'feedback-images'.
--   2. drops the policy "feedback_images_public_read" (anon + authenticated
--      SELECT on the whole bucket). No data is dropped; objects stay.
--   3. public.can_read_feedback_image(text) — SECURITY DEFINER, so the policy
--      can probe feedback_author_messages / admin_feedback without granting
--      the caller read access to them. True for: the object's uploader (own
--      uid folder), any admin, or the author of a USER topic whose
--      author-channel messages reference the object (an admin reply with a
--      screenshot). The join mirrors public.owns_feedback() (source = 'user'
--      and author_id = auth.uid()) without one definer call per message row.
--      A plain "own folder or admin" rule would hide admin screenshots in the
--      author channel from the author — hence the third branch.
--   4. policy "feedback_images_scoped_read" (authenticated SELECT) using it.
--   Upload / delete policies (feedback_images_owner_upload from 20260904040000,
--   feedback_images_owner_delete) and the restrictive approval gates for
--   INSERT/DELETE from 20260805120000_email_allowlist.sql stay unchanged.
--
-- IDEMPOTENT: safe to re-run (plain update, drop policy if exists before every
--   create policy, create or replace function, revoke before grant).
--
-- ROLLBACK: update storage.buckets set public = true where id = 'feedback-images';
--           drop policy if exists "feedback_images_scoped_read" on storage.objects;
--           drop function if exists public.can_read_feedback_image(text);
--           create policy "feedback_images_public_read" on storage.objects
--             for select to anon, authenticated using (bucket_id = 'feedback-images');
--           (the original policy from 20260713000000_feedback_images_bucket.sql:29-32)
-- ============================================================

update storage.buckets set public = false where id = 'feedback-images';

drop policy if exists "feedback_images_public_read" on storage.objects;

create or replace function public.can_read_feedback_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (
           select 1
           from public.feedback_author_messages m
           join public.admin_feedback f on f.id = m.feedback_id
           where f.source = 'user'
             and f.author_id = auth.uid()
             and strpos(m.body, p_name) > 0
         );
$$;

comment on function public.can_read_feedback_image(text) is
  'Read gate for the private feedback-images bucket: uploader, admin, or the author of a user topic whose author-channel messages reference the object (AUD-115).';

-- Supabase grants EXECUTE on every new public function to anon + authenticated
-- by default: revoke first, then grant only what the policy needs.
revoke all on function public.can_read_feedback_image(text) from public, anon, authenticated;
grant execute on function public.can_read_feedback_image(text) to authenticated;

drop policy if exists "feedback_images_scoped_read" on storage.objects;
create policy "feedback_images_scoped_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback-images' and public.can_read_feedback_image(name));
