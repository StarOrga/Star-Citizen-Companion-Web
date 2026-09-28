/**
 * Pure helpers that connect a stored feedback body to signed attachment URLs.
 *
 * The `feedback-images` bucket is private (AUD-115/AUD-351). A body still
 * stores the bucket's PUBLIC object URL — it is a stable identifier that every
 * existing body and draft already carries, and `feedbackImagePath()` maps it to
 * the object path. It is never fetched directly: rendering swaps it for a
 * short-lived signed URL obtained by `FeedbackAttachmentSignerService`.
 *
 * Deliberately free of Angular and of value imports from the composer — only a
 * type comes from `markdown.util.ts`, so no runtime import cycle can form (see
 * the note in `feedback-images.util.ts`).
 */

import type { RenderedFeedbackBody } from '../admin/feedback/markdown.util';
import { feedbackImagePath } from './feedback-images.util';

/** Any http(s) URL in a body — markdown image, markdown link or a bare URL. */
const URL_RE = /https?:\/\/[^\s)\]"<>]+/g;

/**
 * Every `feedback-images` object path a body references, in source order and
 * without duplicates. Foreign URLs and `data:` URIs are ignored.
 */
export function attachmentPathsOf(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of (body ?? '').matchAll(URL_RE)) {
    const path = feedbackImagePath(m[0]);
    if (path && !seen.has(path)) {
      seen.add(path);
      out.push(path);
    }
  }
  return out;
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Swap the public bucket URL in every `href` of the rendered HTML for its
 * signed URL (keyed by object path). Only `html` changes: `images` stays the
 * SAME array reference — `renderFeedbackBody` memoises precisely so the OnPush
 * thumbnail row gets a stable input, and the attachment component signs the
 * thumbnails itself. When nothing was replaced the input object is returned.
 */
export function applySignedUrls(
  rendered: RenderedFeedbackBody,
  signed: ReadonlyMap<string, string>,
): RenderedFeedbackBody {
  if (signed.size === 0 || !rendered.html.includes('href="')) return rendered;
  let changed = false;
  const html = rendered.html.replace(/href="([^"]*)"/g, (m, raw: string) => {
    const path = feedbackImagePath(unescapeHtml(raw));
    if (!path) return m;
    const url = signed.get(path);
    if (!url) return m;
    changed = true;
    return `href="${escapeAttr(url)}"`;
  });
  return changed ? { html, images: rendered.images } : rendered;
}
