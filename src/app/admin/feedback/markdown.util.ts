/**
 * Minimal, safe Markdown -> HTML for the admin feedback board.
 *
 * Supports the subset admins actually use in feedback: headings (`#`..`###`),
 * bold, italic, inline code, links, images, unordered/ordered lists,
 * blockquotes, paragraphs and line breaks. Everything else renders as plain
 * text.
 *
 * IMAGES ARE NOT PART OF THE HTML. Every `![alt](src)` is *lifted out* of the
 * text flow and returned separately (feedback a660536a): a chat message that
 * carries screenshots should read as text with small attachment thumbnails at
 * the end, not as a wall of full-width pictures. Rendering them is the job of
 * `sc-feedback-attachments`, which binds src/alt through Angular instead of
 * innerHTML — hence the extracted values are raw (un-escaped) strings.
 *
 * SAFETY: source text is HTML-escaped, so no raw user markup can reach the DOM
 * - only this function's own known tag set is emitted. Links are restricted to
 * http/https/mailto; image sources to https or self-generated
 * `data:image/<raster>;base64` URIs (early feedback screenshots were compressed
 * client-side into such data URIs; today they are uploaded to storage). The
 * HTML is additionally run through Angular's [innerHTML] sanitizer at the
 * binding site, and image sources through Angular's URL sanitizer at their
 * [src] binding (defence in depth).
 *
 * LONG WORDS: a whitespace-free run of `FEEDBACK_LONG_WORD_CHARS` or more is
 * wrapped in `<span class="sc-longword">` so it renders on one line and
 * overflows its container instead of re-wrapping the card around it — see
 * `markLongWords` for the why.
 *
 * Deliberately dependency-free: a controlled subset is safer and lighter than
 * pulling `marked` + `dompurify` into the bundle for an admins-only surface.
 */
import { FEEDBACK_LONG_WORD_CHARS } from '../../feedback/feedback-limits';

/** One image lifted out of a feedback body, in source order. */
export interface FeedbackImage {
  /** Trusted source URL — `https:` or a raster `data:image/*;base64` URI. */
  readonly src: string;
  /** Alt text as written in the markdown; may be empty. */
  readonly alt: string;
}

/** A feedback body split into its text flow and its attachments. */
export interface RenderedFeedbackBody {
  /** Sanitized HTML for the text flow — never contains an `<img>`. */
  readonly html: string;
  /** Images pulled out of the flow, to be shown as thumbnails at the end. */
  readonly images: readonly FeedbackImage[];
}

// Object-replacement char — a sentinel that cannot appear in escaped output
// nor in normal feedback text. Used to shield inline-code spans from further
// formatting, then swapped back at the end.
const CODE_MARK = '￼';
const CODE_MARK_RE = new RegExp(CODE_MARK + '(\\d+)' + CODE_MARK, 'g');

// Image sources we trust: https, or the compressed data URIs the composer
// produces (raster only — never SVG, which can carry script when treated as a
// document).
const IMG_SRC_RE = /^(?:https:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Escape + apply inline formatting (bold, italic, code, links) to one text run.
 * Images are removed from the run and collected into `images` instead.
 */
function inline(raw: string, images: FeedbackImage[]): string {
  // Pull inline-code spans out first so their contents aren't re-formatted —
  // and so image markup inside backticks stays literal code.
  const codes: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(esc(c));
    return CODE_MARK + (codes.length - 1) + CODE_MARK;
  });

  // Images: ![alt](src) — only https / trusted data:image URIs are lifted out;
  // anything else stays literal text and falls through to the passes below.
  // This runs *before* escaping so the collected src/alt are raw values fit for
  // an Angular property binding (an escaped `&amp;` would break a query string).
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, url: string) => {
    if (!IMG_SRC_RE.test(url)) return m;
    images.push({ src: url, alt });
    return '';
  });

  s = esc(s);

  // Links: [text](url) - only http(s)/mailto schemes survive.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>');

  s = markLongWords(s);

  // Restore protected code spans.
  s = s.replace(CODE_MARK_RE, (_m, i: string) => `<code>${codes[+i]}</code>`);
  return s;
}

// Splits an HTML fragment into alternating text / tag parts. Because the group
// captures, `split` always yields text at the even indices — including empty
// strings when the fragment starts or ends with a tag.
const TAG_SPLIT_RE = /(<[^>]*>)/;

/**
 * Wrap every whitespace-free run of at least `FEEDBACK_LONG_WORD_CHARS`
 * characters in a marker span (admin feedback 0a0fad31: "wenn ein wort länger
 * ist als x buchstaben wird es in einer zeile dargestellt und overflowed statt
 * umzubrechen").
 *
 * The span carries no styling of its own — `.sc-longword` in styles.scss does
 * that, and it has to be a GLOBAL rule: this markup reaches the DOM through
 * `[innerHTML]`, which never gets a component's style-scoping attribute, so a
 * component-scoped selector would silently not match it.
 *
 * Runs over the already-escaped, already-formatted fragment and skips the tag
 * parts, so a long `href` or a marker span of our own is never touched. Inline
 * code is still a short `CODE_MARK` sentinel at this point and therefore stays
 * out of it as well.
 */
function markLongWords(html: string): string {
  if (!html) return html;
  return html
    .split(TAG_SPLIT_RE)
    .map((part, idx) => (idx % 2 === 1 ? part : wrapLongWords(part)))
    .join('');
}

function wrapLongWords(text: string): string {
  if (text.length < FEEDBACK_LONG_WORD_CHARS) return text;
  return text.replace(/\S+/g, (word) =>
    word.length >= FEEDBACK_LONG_WORD_CHARS ? `<span class="sc-longword">${word}</span>` : word,
  );
}

function render(src: string): RenderedFeedbackBody {
  const images: FeedbackImage[] = [];
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  // A run that held nothing but an image is empty once the image is lifted out;
  // dropping it keeps stray empty paragraphs / list items out of the flow.
  const filled = (runs: string[]) => runs.filter((r) => r.trim() !== '');

  const flushPara = () => {
    if (para.length) {
      const runs = filled(para.map((l) => inline(l, images)));
      if (runs.length) out.push(`<p>${runs.join('<br>')}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const t = lines[i].trim();

    if (t === '') {
      flushPara();
      i++;
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      const lvl = h[1].length + 2; // # -> h3, ## -> h4, ### -> h5
      const head = inline(h[2], images);
      if (head.trim() !== '') out.push(`<h${lvl}>${head}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^[-*+]\s+/.test(t)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^[-*+]\s+/, ''), images));
        i++;
      }
      const kept = filled(items);
      if (kept.length) out.push(`<ul>${kept.map((it) => `<li>${it}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(t)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(inline(lines[i].trim().replace(/^\d+\.\s+/, ''), images));
        i++;
      }
      const kept = filled(items);
      if (kept.length) out.push(`<ol>${kept.map((it) => `<li>${it}</li>`).join('')}</ol>`);
      continue;
    }

    if (/^>\s?/.test(t)) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(inline(lines[i].trim().replace(/^>\s?/, ''), images));
        i++;
      }
      const kept = filled(quoted);
      if (kept.length) out.push(`<blockquote>${kept.join('<br>')}</blockquote>`);
      continue;
    }

    para.push(t);
    i++;
  }

  flushPara();
  return { html: out.join(''), images };
}

// Bodies are re-rendered on every change-detection pass (the templates call
// `render(row.body)` directly). Memoising keeps that cheap and — more
// importantly — hands the attachment component a stable `images` reference, so
// an OnPush thumbnail row is not torn down and rebuilt on every tick.
const CACHE_LIMIT = 256;
const cache = new Map<string, RenderedFeedbackBody>();

/**
 * Render one feedback body: HTML for the text, plus the images lifted out of it.
 * Memoised per source string.
 */
export function renderFeedbackBody(src: string): RenderedFeedbackBody {
  const key = src ?? '';
  const hit = cache.get(key);
  if (hit) return hit;

  const rendered = render(key);
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, rendered);
  return rendered;
}
