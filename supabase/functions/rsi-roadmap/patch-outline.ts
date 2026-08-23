// One RSI patch note → a flat, typed outline of what is in it.
//
// Source: POST https://robertsspaceindustries.com/api/spectrum/forum/thread/nested
//         { slug, channel_id: "190048", sort: "votes", page: 1 }, header X-Tavern-Id: 1
// Public, unauthenticated. Same forum the patch-note TITLES already come from
// (see .claude/deep-knowledge/verse-news-sources.md) — the list endpoint simply
// never carries the post body, which is why the patch board knew every patch by
// name and nothing about its contents.
//
// The body arrives as Draft.js content blocks. RSI's authors use FOUR shapes and
// they all have to survive, because the mix differs per note:
//
//   header-one          → section heading   ("Features and Gameplay")
//   blockquote          → sub-heading       ("Ships & Vehicles")
//   unordered-list-item → bullet            ("Long Term Persistence: Preserved")
//   unstyled            → prose … OR a bullet, when the author typed the bullet
//                         glyph by hand ("► Vehicle Combat Hit Markers")
//
// That last case is not an edge case: the 4.9 LIVE release notes write EVERY
// feature line as `unstyled` prefixed with `►`. Treating unstyled as prose would
// have turned the entire feature list of the current patch into an unsearchable
// wall of paragraphs.

/** What a line of a patch note is. */
export type PatchOutlineKind = 'heading' | 'subheading' | 'bullet' | 'text';

export interface PatchOutlineNode {
  kind: PatchOutlineKind;
  text: string;
  /** Draft.js indentation level for nested bullets; 0 for everything else. */
  depth: number;
  /** Absolute http(s) links this line carries, in reading order. Omitted when none. */
  links?: string[];
}

export interface PatchOutline {
  /** RSI thread slug — the cache key and the client's join key. */
  slug: string;
  /** Thread subject as published; lets a consumer verify it got the right note. */
  subject: string;
  nodes: PatchOutlineNode[];
  /** How many of `nodes` are bullets — the "N Punkte" badge on the row. */
  bulletCount: number;
  /** True when the parser hit its cap and dropped the tail (see MAX_NODES). */
  truncated: boolean;
}

/**
 * Hard caps. A patch note is a few hundred lines at most; these exist so a
 * pathological thread cannot blow up the cached row or the client payload,
 * not to shorten normal notes. `truncated` reports when they bit.
 */
export const MAX_NODES = 800;
export const MAX_LINE = 500;

/**
 * Bullet glyphs RSI authors type at the start of an `unstyled` line.
 *
 * Deliberately NOT including `-`: a note that opens a line with a hyphen is
 * usually writing a range or a minus sign ("-10% power draw"), and misreading
 * that as a bullet would strip the sign out of the text.
 */
const BULLET_GLYPHS = /^[►▶•▪●‣⁃»]+\s*/;

/** Collapse Draft.js whitespace (RSI indents list items with four spaces). */
function tidy(raw: string): string {
  return raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * entityMap is an ARRAY in the live payload but the Draft.js spec calls for an
 * object keyed by entity index. Both are read, because a change between them is
 * exactly the kind of silent shape drift that would cost us every link.
 */
function entityHref(entityMap: unknown, key: unknown): string | null {
  if (entityMap === null || typeof entityMap !== 'object') return null;
  const entry = Array.isArray(entityMap)
    ? entityMap[Number(key)]
    : (entityMap as Record<string, unknown>)[String(key)];
  if (!entry || typeof entry !== 'object') return null;
  const rec = entry as Record<string, unknown>;
  if (String(rec['type'] ?? '').toUpperCase() !== 'LINK') return null;
  const data = rec['data'];
  if (!data || typeof data !== 'object') return null;
  const href = (data as Record<string, unknown>)['href'] ?? (data as Record<string, unknown>)['url'];
  if (typeof href !== 'string') return null;
  const v = href.trim();
  return /^https?:\/\//i.test(v) ? v : null;
}

function blockLinks(block: Record<string, unknown>, entityMap: unknown): string[] | undefined {
  const ranges = block['entityRanges'];
  if (!Array.isArray(ranges) || ranges.length === 0) return undefined;
  const out: string[] = [];
  for (const range of ranges) {
    if (!range || typeof range !== 'object') continue;
    const href = entityHref(entityMap, (range as Record<string, unknown>)['key']);
    if (href && !out.includes(href)) out.push(href);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Is this `unstyled` block really a heading the author typed in bold?
 *
 * RSI writes "Important Build Info" and "Testing/Feedback Focus" as plain
 * paragraphs carrying a BOLD (usually also UNDERLINE) style range across the
 * WHOLE line. Read literally they are prose, and the bullets underneath them
 * lose the only label that says what they are about. The whole-line condition
 * is what keeps a sentence with one bold word out of the headings.
 */
function isBoldWholeLine(ranges: unknown, rawLength: number): boolean {
  if (!Array.isArray(ranges) || ranges.length === 0 || rawLength === 0) return false;
  return ranges.some((r) => {
    if (!r || typeof r !== 'object') return false;
    const rec = r as Record<string, unknown>;
    const style = String(rec['style'] ?? '').toUpperCase();
    if (style !== 'BOLD') return false;
    const offset = Number(rec['offset']);
    const length = Number(rec['length']);
    if (!Number.isFinite(offset) || !Number.isFinite(length)) return false;
    // Trailing whitespace is often left out of the range — allow a little slack.
    return offset <= 1 && length >= rawLength - 2;
  });
}

/** Draft.js block type + text → our node kind, plus the text with any glyph removed. */
function classify(
  type: string,
  text: string,
  raw: string,
  inlineStyleRanges: unknown,
): { kind: PatchOutlineKind; text: string } {
  if (type.startsWith('header-')) return { kind: 'heading', text };
  if (type === 'blockquote') return { kind: 'subheading', text };
  if (type === 'unordered-list-item' || type === 'ordered-list-item') {
    return { kind: 'bullet', text: text.replace(BULLET_GLYPHS, '') };
  }
  const stripped = text.replace(BULLET_GLYPHS, '');
  // A hand-typed glyph is the author saying "this is a list item" — honour it.
  if (stripped !== text) return { kind: 'bullet', text: stripped };
  if (isBoldWholeLine(inlineStyleRanges, raw.trimEnd().length)) return { kind: 'subheading', text };
  return { kind: 'text', text };
}

/**
 * Parse a thread's `content_blocks` into an outline.
 *
 * Only `text` containers are read. Spectrum also emits `image` / `embed`
 * containers; a patch note's meaning lives entirely in its text, and pulling
 * images in here would drag this function into the image pipeline that has
 * repeatedly taken fetch-verse-news down.
 */
export function parseContentBlocks(contentBlocks: unknown): { nodes: PatchOutlineNode[]; truncated: boolean } {
  const nodes: PatchOutlineNode[] = [];
  let truncated = false;
  if (!Array.isArray(contentBlocks)) return { nodes, truncated };

  for (const container of contentBlocks) {
    if (!container || typeof container !== 'object') continue;
    const rec = container as Record<string, unknown>;
    if (str(rec['type']) !== 'text') continue;
    const data = rec['data'];
    if (!data || typeof data !== 'object') continue;
    const blocks = (data as Record<string, unknown>)['blocks'];
    const entityMap = (data as Record<string, unknown>)['entityMap'];
    if (!Array.isArray(blocks)) continue;

    for (const b of blocks) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      const rawText = typeof block['text'] === 'string' ? block['text'] : '';
      const text = tidy(rawText);
      if (!text) continue; // Draft.js pads with empty blocks for vertical space.
      if (nodes.length >= MAX_NODES) {
        truncated = true;
        return { nodes, truncated };
      }
      const { kind, text: clean } = classify(
        str(block['type']), text, rawText, block['inlineStyleRanges'],
      );
      if (!clean) continue;
      const depth = Number(block['depth']);
      const links = blockLinks(block, entityMap);
      nodes.push({
        kind,
        text: clean.length > MAX_LINE ? clean.slice(0, MAX_LINE).trimEnd() + '…' : clean,
        depth: Number.isFinite(depth) && depth > 0 ? Math.min(depth, 4) : 0,
        ...(links ? { links } : {}),
      });
    }
  }
  return { nodes, truncated };
}

/** A thread payload (`data` of forum/thread/nested) → the outline we cache. */
export function parseThreadOutline(slug: string, raw: unknown): PatchOutline | null {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const data = root && root['data'] && typeof root['data'] === 'object'
    ? (root['data'] as Record<string, unknown>)
    : null;
  if (!data) return null;
  const { nodes, truncated } = parseContentBlocks(data['content_blocks']);
  // A thread that parsed to nothing is a shape change or an erased post, not an
  // empty patch note — reporting it as an empty outline would cache the failure.
  if (nodes.length === 0) return null;
  return {
    slug,
    subject: str(data['subject']),
    nodes,
    bulletCount: nodes.filter((n) => n.kind === 'bullet').length,
    truncated,
  };
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * The RSI thread slug inside a patch-note permalink, or '' when the url is not
 * one. Kept here so the edge function and the client agree on what a slug is.
 *
 * `…/spectrum/community/SC/forum/190048/thread/<slug>` → `<slug>`.
 */
export function slugFromThreadUrl(url: string): string {
  const m = /\/thread\/([a-z0-9-]{1,160})(?:[/?#]|$)/i.exec(url);
  return m ? m[1].toLowerCase() : '';
}

/** Guard for a slug arriving as a query parameter. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]{1,160}$/.test(slug);
}
