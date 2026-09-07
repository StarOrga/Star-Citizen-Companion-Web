/**
 * Minimal, safe Markdown -> HTML for the admin feedback board.
 *
 * Supports the subset admins actually use in feedback: headings (`#`..`###`),
 * bold, italic, inline code, links, images, unordered/ordered lists,
 * blockquotes, paragraphs and line breaks. Everything else renders as plain
 * text.
 *
 * BARE URLS ARE LINKED TOO (feedback 85cfb5ca): almost nobody writing feedback
 * types `[text](url)` — they paste the URL. A pasted `https://`, `http://` or
 * `www.` run therefore becomes a real anchor, emitted by the same code path —
 * and with the same `target`/`rel` — as an explicit markdown link. A host with
 * neither marker (`example.com`) is left alone on purpose: prose is full of
 * dotted tokens, and `markdown.util.ts` would otherwise link to the `.ts` TLD.
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

// Same sentinel char, distinct shape (`L` prefix), for anchors built out of a
// bare URL. They are shielded for the same reason code spans are: an `_` or a
// `*` inside a pasted URL must not be read as emphasis once it sits in an href.
// Explicit `[text](url)` links are deliberately NOT shielded — they keep going
// through the emphasis passes exactly as they did before.
const LINK_MARK_RE = new RegExp(CODE_MARK + 'L(\\d+)' + CODE_MARK, 'g');

// A pasted URL, matched on the ALREADY-ESCAPED text: the run can contain
// entities (`&amp;` in a query string) but never a raw `<`, `>` or `"`. The
// leading guard keeps the match off things that only look like a URL inside a
// bigger token (`user@www.x`, `.../https://...`); `CODE_MARK` is excluded so an
// adjacent code sentinel is never swallowed into an href. Brackets, stars and
// backticks end the run as well, so leftover markdown around a URL is not
// eaten into it; round parentheses stay in, because `.../Foo_(bar)` is a real
// URL and `splitUrlTail` hands an unbalanced one back to the sentence.
const AUTOLINK_RE = new RegExp(
  '(^|[^\\w@/])((?:https?://|www\\.)[^\\s<>"`*\\[\\]' + CODE_MARK + ']+)',
  'gi',
);

// Sentence punctuation — including the escaped form of a closing quote — that a
// writer puts AFTER a URL rather than into it.
const URL_TAIL_RE = /(?:&(?:quot|amp|lt|gt|#\d+);|[.,;:!?'"\u00ab\u00bb])$/;
const URL_CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };

// Image sources we trust: https, or the compressed data URIs the composer
// produces (raster only — never SVG, which can carry script when treated as a
// document).
const IMG_SRC_RE = /^(?:https:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;

const occurrences = (s: string, ch: string) => s.split(ch).length - 1;

/**
 * Split a greedily matched URL run into the URL itself and the trailing
 * punctuation that belongs to the sentence: `see https://a.b/x.` links `x`, not
 * `x.`, and `(https://a.b)` keeps its bracket outside the anchor — while a URL
 * whose own brackets balance (`.../Foo_(bar)`) survives intact.
 */
function splitUrlTail(raw: string): [url: string, tail: string] {
  let url = raw;
  let tail = '';
  for (;;) {
    const m = URL_TAIL_RE.exec(url);
    if (m) {
      tail = m[0] + tail;
      url = url.slice(0, -m[0].length);
      continue;
    }
    const last = url.slice(-1);
    const open = URL_CLOSERS[last];
    if (open && occurrences(url, last) > occurrences(url, open)) {
      tail = last + tail;
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return [url, tail];
}

/** Turn every bare URL in one escaped text run into a shielded anchor. */
function linkifyRun(text: string, links: string[]): string {
  if (!text) return text;
  return text.replace(AUTOLINK_RE, (m: string, before: string, raw: string) => {
    const [url, tail] = splitUrlTail(raw);
    // A `www.` match still has to look like host + TLD; a `https://` one needs
    // an authority at all. Anything else stays the literal text it was.
    const schemeless = /^www\./i.test(url);
    const ok = schemeless
      ? /^www\.[\w-]+\.[a-z]{2,}/i.test(url)
      : /^https?:\/\/[^\s/?#]/i.test(url);
    if (!ok) return m;
    const href = schemeless ? `https://${url}` : url;
    links.push(`<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    return `${before}${CODE_MARK}L${links.length - 1}${CODE_MARK}${tail}`;
  });
}

/**
 * Run `linkifyRun` over a fragment that already holds the anchors built from
 * explicit `[text](url)` markup, skipping both those tags and everything
 * between `<a>` and `</a>` — so an explicit link is never linked a second time
 * and anchors are never nested.
 */
function autolink(fragment: string, links: string[]): string {
  let inAnchor = false;
  return fragment
    .split(TAG_SPLIT_RE)
    .map((part, idx) => {
      if (idx % 2 === 1) {
        if (/^<a[\s>]/i.test(part)) inAnchor = true;
        else if (/^<\/a\s*>/i.test(part)) inAnchor = false;
        return part;
      }
      return inAnchor ? part : linkifyRun(part, links);
    })
    .join('');
}

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
  const links: string[] = [];
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

  // Bare URLs: after the explicit links, so their text and href already sit
  // inside an <a> and are skipped; before the emphasis passes, which the
  // sentinel this leaves behind is immune to.
  s = autolink(s, links);

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>');

  s = markLongWords(s);

  // Restore the autolinked anchors, running the long-word pass over each one so
  // a pasted URL is marked exactly like the text of an explicit link would be.
  s = s.replace(LINK_MARK_RE, (_m, i: string) => markLongWords(links[+i]));

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
