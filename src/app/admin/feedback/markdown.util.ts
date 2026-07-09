/**
 * Minimal, safe Markdown -> HTML for the admin feedback board.
 *
 * Supports the subset admins actually use in feedback: headings (`#`..`###`),
 * bold, italic, inline code, links, images, unordered/ordered lists,
 * blockquotes, paragraphs and line breaks. Everything else renders as plain
 * text.
 *
 * SAFETY: source text is HTML-escaped *first*, so no raw user markup can reach
 * the DOM - only this function's own known tag set is emitted. Links are
 * restricted to http/https/mailto; images to https or self-generated
 * `data:image/<raster>;base64` URIs (feedback screenshots are compressed
 * client-side into such data URIs). The result is additionally run through
 * Angular's [innerHTML] sanitizer at the binding site (defence in depth).
 *
 * Deliberately dependency-free: a controlled subset is safer and lighter than
 * pulling `marked` + `dompurify` into the bundle for an admins-only surface.
 */

// Object-replacement char — a sentinel that cannot appear in escaped output
// nor in normal feedback text. Used to shield inline-code spans from further
// formatting, then swapped back at the end.
const CODE_MARK = '￼';
const CODE_MARK_RE = new RegExp(CODE_MARK + '(\\d+)' + CODE_MARK, 'g');

// Second sentinel (a private-use char) that shields already-emitted <img> tags
// from the inline formatting passes, mirroring how inline code is protected.
const IMG_MARK = '';
const IMG_MARK_RE = new RegExp(IMG_MARK + '(\\d+)' + IMG_MARK, 'g');

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

/** Escape + apply inline formatting (bold, italic, code, links, images) to one text run. */
function inline(raw: string): string {
  // Pull inline-code spans out first so their contents aren't re-formatted.
  const codes: string[] = [];
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(esc(c));
    return CODE_MARK + (codes.length - 1) + CODE_MARK;
  });

  s = esc(s);

  // Images: ![alt](src) - only https / trusted data:image URIs survive. Emitted
  // tags are shielded so the link/bold/italic passes cannot corrupt the src.
  const imgs: string[] = [];
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, url: string) => {
    if (!IMG_SRC_RE.test(url)) return m;
    imgs.push(`<img src="${url}" alt="${alt}" loading="lazy">`);
    return IMG_MARK + (imgs.length - 1) + IMG_MARK;
  });

  // Links: [text](url) - only http(s)/mailto schemes survive.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, url: string) => {
    if (!/^(https?:\/\/|mailto:)/i.test(url)) return m;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_]+)_/g, '$1<em>$2</em>');

  // Restore protected code spans and shielded images.
  s = s.replace(CODE_MARK_RE, (_m, i: string) => `<code>${codes[+i]}</code>`);
  s = s.replace(IMG_MARK_RE, (_m, i: string) => imgs[+i]);
  return s;
}

export function renderMarkdown(src: string): string {
  const lines = (src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
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
      out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^[-*+]\s+/.test(t)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(t)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(`<li>${inline(lines[i].trim().replace(/^\d+\.\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (/^>\s?/.test(t)) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(inline(lines[i].trim().replace(/^>\s?/, '')));
        i++;
      }
      out.push(`<blockquote>${quoted.join('<br>')}</blockquote>`);
      continue;
    }

    para.push(t);
    i++;
  }

  flushPara();
  return out.join('');
}
