/**
 * Screenshot attachments for feedback messages.
 *
 * Extracted from `admin-feedback.component.ts` so the non-admin feedback panel
 * (feedback 5920cf8c) can attach screenshots through exactly the same path
 * instead of growing a second, drifting copy. The storage bucket
 * (`feedback-images`, migration 20260713000000) already allows any
 * authenticated user to write into their own uid-prefixed folder, so nothing
 * about the upload differs between the two callers.
 *
 * Images are uploaded rather than inlined as base64 because a single compressed
 * screenshot blows past the message body's 20 000-character check constraint.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { PendingImage } from '../admin/feedback/feedback-composer.component';

/** Storage bucket backing feedback screenshot attachments. */
export const FEEDBACK_IMAGES_BUCKET = 'feedback-images';

/** File extension for a known image MIME type (JPEG is the compressed default). */
function extForType(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'jpg';
  }
}

/** Decode a `data:<mime>;base64,<data>` URI into a Blob for upload. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Upload the composer's queued images and return their public URLs, in order.
 * Throws on the first failure so the caller can keep the draft intact.
 *
 * An image that already carries a `url` was uploaded when it was attached to a
 * persisted draft (`FeedbackDraftService.uploadAttachment`) — it is passed
 * through instead of being stored a second time, so sending a restored draft
 * costs no upload at all and leaves no duplicate object behind.
 */
export async function uploadFeedbackImages(
  client: SupabaseClient,
  uid: string | null,
  images: readonly PendingImage[],
): Promise<string[]> {
  if (!uid || images.length === 0) return [];
  const bucket = client.storage.from(FEEDBACK_IMAGES_BUCKET);
  const urls: string[] = [];
  for (const img of images) {
    if (img.url) {
      urls.push(img.url);
      continue;
    }
    const blob = dataUrlToBlob(img.dataUrl);
    const path = `${uid}/${crypto.randomUUID()}.${extForType(blob.type)}`;
    const { error } = await bucket.upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error(error.message);
    urls.push(bucket.getPublicUrl(path).data.publicUrl);
  }
  return urls;
}

/**
 * Object path inside `feedback-images` for one of its public URLs, or null when
 * the URL points somewhere else — then it is not ours to delete.
 */
export function feedbackImagePath(url: string): string | null {
  const marker = `/object/public/${FEEDBACK_IMAGES_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx < 0) return null;
  const path = url.slice(idx + marker.length).split('?')[0];
  return path ? decodeURIComponent(path) : null;
}

/** Compose the stored body: text with any uploaded images appended as markdown. */
export function buildFeedbackBody(
  text: string,
  images: readonly PendingImage[],
  urls: readonly string[],
): string {
  const imgMd = urls.map((url, i) => `![${images[i].name}](${url})`).join('\n\n');
  return [text, imgMd].filter((s) => s.length > 0).join('\n\n');
}
