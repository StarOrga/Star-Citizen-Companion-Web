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

/**
 * True for anything the app renders as a picture rather than as a file link.
 *
 * Lives here rather than next to `PendingImage` on purpose: this module is
 * imported by the draft service, which the composer imports in turn, so a VALUE
 * exported from the composer and used here would close a real runtime import
 * cycle. The `PendingImage` type above is fine — types are erased.
 */
export function isImageAttachment(att: Pick<PendingImage, 'mime'>): boolean {
  return !att.mime || att.mime.startsWith('image/');
}

/** Thrown when a non-admin tries to send something that is not an image. */
export const ATTACHMENT_TYPE_BLOCKED = 'attachment-type-not-allowed';

/** File extension for a known image MIME type (JPEG is the compressed default). */
function extForType(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'jpg';
  }
}

/**
 * Extension for a non-image attachment, taken from the file name rather than
 * guessed from the MIME type — the name is what the admin will recognise in the
 * thread, and `application/octet-stream` maps to nothing useful. Restricted to
 * a conservative character set because it becomes part of a storage object path.
 */
function extForName(name: string, fallback: string): string {
  const dot = name.lastIndexOf('.');
  const raw = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,8}$/.test(raw) ? raw : fallback;
}

/**
 * The role gate for attachments (admin feedback 312a4acc), applied at the one
 * place every send path funnels through.
 *
 * Viewers and collaborators may attach IMAGES ONLY. This is not merely a
 * nicer-looking file picker: the composer's `accept` attribute is a hint the
 * browser is free to ignore and a drag-and-drop bypasses it entirely, so the
 * rule has to exist somewhere that is not the picker. The storage policy in
 * migration 20260904040000 is the authoritative copy — this one turns the same
 * refusal into an error the user can read before a request is even made.
 */
export function assertAttachmentsAllowed(
  images: readonly PendingImage[],
  allowFiles: boolean,
): void {
  if (allowFiles) return;
  if (images.every((img) => isImageAttachment(img))) return;
  throw new Error(ATTACHMENT_TYPE_BLOCKED);
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
  allowFiles = false,
): Promise<string[]> {
  assertAttachmentsAllowed(images, allowFiles);
  if (!uid || images.length === 0) return [];
  const bucket = client.storage.from(FEEDBACK_IMAGES_BUCKET);
  const urls: string[] = [];
  for (const img of images) {
    if (img.url) {
      urls.push(img.url);
      continue;
    }
    // A non-image attachment (admins only) keeps its original bytes and its own
    // extension; an image is the re-encoded data URI the composer produced.
    const blob = img.file ?? dataUrlToBlob(img.dataUrl);
    const ext = isImageAttachment(img)
      ? extForType(blob.type)
      : extForName(img.name, 'bin');
    const path = `${uid}/${crypto.randomUUID()}.${ext}`;
    const contentType = blob.type || img.mime || 'application/octet-stream';
    const { error } = await bucket.upload(path, blob, { contentType, upsert: false });
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

/**
 * Compose the stored body: text with any uploaded attachments appended as
 * markdown.
 *
 * Images become `![name](url)`, which `renderFeedbackBody` lifts out into the
 * thumbnail row. A non-image attachment becomes a plain `[name](url)` link, so
 * it rides in the text flow as a real anchor the reader can open — there is no
 * thumbnail to show for a log file, and inventing one would be a lie about what
 * is behind it.
 */
export function buildFeedbackBody(
  text: string,
  images: readonly PendingImage[],
  urls: readonly string[],
): string {
  const imgMd = urls
    .map((url, i) => (isImageAttachment(images[i]) ? `![${images[i].name}](${url})` : `[${images[i].name}](${url})`))
    .join('\n\n');
  return [text, imgMd].filter((s) => s.length > 0).join('\n\n');
}
