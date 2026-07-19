// starscape-summary/summary-svg.ts
// -----------------------------------------------------------------------
// PURE SVG builder for the Starscape "This Week in Verse News" wallpaper.
// No Deno/Node APIs are used here (no fetch, no fs, no crypto) so this
// module can be imported unmodified from BOTH the Deno edge function
// (index.ts) and the Node preview harness (preview.mjs), guaranteeing the
// preview accurately represents production output.
//
// Design spec: see the PR description / task brief for the full brand
// rationale (SCC compass motif, icon-safe zone, Orbitron/Rajdhani pairing).
// -----------------------------------------------------------------------

export interface SummaryItem {
  title: string;
  channel?: string;
  category?: string;
  publishedAt?: string;
}

export interface SummarySvgOptions {
  width: number;
  height: number;
  weekLabel: string;
  /** data: URI (or any href resvg can inline) for the hero (items[0]) image. */
  heroDataUri?: string;
  /** data: URIs aligned to items[1..], one per list row. */
  thumbDataUris?: (string | undefined)[];
}

// ---- Brand palette -----------------------------------------------------
const BG = '#050810';
const CYAN = '#00d4ff';
const TEXT_PRIMARY = '#EAF6FF';
const TEXT_SECONDARY = '#D7E6F2';
const TEXT_MUTED2 = '#9fb3c8';
const TEXT_MUTED = '#5f7488';

// ---- Small text-layout helpers -----------------------------------------
// resvg renders SVG <text>/<tspan> without auto-wrap, so multi-line labels
// are pre-wrapped here using an estimated average glyph width per font.
// This is deliberately approximate (no real font metrics available in a
// pure module) — good enough for a background image, not pixel-perfect.
const AVG_CHAR_WIDTH: Record<string, number> = {
  orbitron: 0.62,
  rajdhani: 0.52,
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxWidthPx: number, fontSizePx: number, font: 'orbitron' | 'rajdhani', maxLines: number): string[] {
  const ratio = AVG_CHAR_WIDTH[font];
  const charWidth = Math.max(1, ratio * fontSizePx);
  const charsPerLine = Math.max(4, Math.floor(maxWidthPx / charWidth));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (candidate.length > charsPerLine && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = candidate;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);

  // Truncate remaining content with an ellipsis if we ran out of lines.
  const consumedWords = lines.join(' ').split(/\s+/).length;
  if (lines.length >= maxLines && consumedWords < words.length) {
    let last = lines[maxLines - 1];
    while (last.length > 0 && (last.length + 1) > charsPerLine - 1) {
      last = last.slice(0, -1);
    }
    lines[maxLines - 1] = last.replace(/[.,;:\s]+$/, '') + '…';
  }
  return lines.length ? lines : [''];
}

function formatWeekDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
}

function channelLabel(channel: string | undefined, category: string | undefined): string {
  if (category) return category.toUpperCase();
  if (!channel) return 'VERSE NEWS';
  const map: Record<string, string> = {
    'comm-link': 'COMM-LINK',
    patch: 'PATCH NOTES',
    spectrum: 'SPECTRUM',
    youtube: 'VIDEO',
    status: 'STATUS',
  };
  return map[channel] ?? channel.toUpperCase();
}

// ---- Reusable fragment builders -----------------------------------------

function coverImage(id: string, href: string, x: number, y: number, w: number, h: number, rx = 0): string {
  // preserveAspectRatio="xMidYMid slice" gives CSS `background-size: cover`
  // behaviour inside a clip rect, so source images of any aspect ratio fill
  // the target box without distortion.
  const clip = `clip-${id}`;
  return `
    <clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" /></clipPath>
    <image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clip})" />`;
}

function placeholderFill(id: string, x: number, y: number, w: number, h: number, rx = 0): string {
  // Branded gradient placeholder used whenever a source image failed to fetch.
  const grad = `ph-${id}`;
  return `
    <defs>
      <linearGradient id="${grad}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0a1420" />
        <stop offset="0.55" stop-color="#0d2233" />
        <stop offset="1" stop-color="#051018" />
      </linearGradient>
    </defs>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${grad})" />
    <circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) * 0.22}" fill="none" stroke="${CYAN}" stroke-opacity="0.18" stroke-width="1.5" />`;
}

// ---- Main builder ---------------------------------------------------------

export function buildSummarySvg(items: SummaryItem[], opts: SummarySvgOptions): string {
  const { width: w, height: h, weekLabel, heroDataUri, thumbDataUris = [] } = opts;
  const hero = items[0];
  const listItems = items.slice(1, 5);

  const contentX = 0.26 * w;
  const contentRight = 0.94 * w;
  const contentWidth = contentRight - contentX;

  // ---------- 1. Hero art (full bleed) ----------
  const heroBlock = heroDataUri
    ? coverImage('hero', heroDataUri, 0, 0, w, h)
    : `<defs>${placeholderFillDefs()}</defs>${placeholderRectOnly('hero-bg', 0, 0, w, h)}`;

  // ---------- 2. Gradient overlays ----------
  const overlays = `
    <defs>
      <linearGradient id="grad-h" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${BG}" stop-opacity="0.96" />
        <stop offset="0.55" stop-color="${BG}" stop-opacity="0.32" />
        <stop offset="1" stop-color="${BG}" stop-opacity="0.55" />
      </linearGradient>
      <linearGradient id="grad-v" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.60" stop-color="${BG}" stop-opacity="0" />
        <stop offset="1" stop-color="${BG}" stop-opacity="0.92" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${w}" height="${h}" fill="url(#grad-h)" />
    <rect x="0" y="0" width="${w}" height="${h}" fill="url(#grad-v)" />`;

  // ---------- 3. Compass-ring motif ----------
  const ringCx = 0.72 * w;
  const ringCy = 0.42 * h;
  const ringR = 0.30 * h;
  const compass = `
    <circle cx="${ringCx}" cy="${ringCy}" r="${ringR}" fill="none" stroke="${CYAN}" stroke-opacity="0.10" stroke-width="1" />
    <circle cx="${ringCx}" cy="${ringCy}" r="${ringR * 0.72}" fill="none" stroke="${CYAN}" stroke-opacity="0.08" stroke-width="1" />`;

  // ---------- 4. Content band ----------
  // 4a. Eyebrow
  const eyebrowY = 0.115 * h;
  const eyebrowFontSize = 0.014 * h;
  const eyebrowGlyphR = 0.009 * h;
  const eyebrow = `
    <circle cx="${contentX + eyebrowGlyphR}" cy="${eyebrowY - eyebrowFontSize * 0.35}" r="${eyebrowGlyphR}" fill="none" stroke="${CYAN}" stroke-width="1.5" opacity="0.9" />
    <circle cx="${contentX + eyebrowGlyphR}" cy="${eyebrowY - eyebrowFontSize * 0.35}" r="${eyebrowGlyphR * 0.4}" fill="${CYAN}" opacity="0.9" />
    <text x="${contentX + eyebrowGlyphR * 2 + 14}" y="${eyebrowY}" font-family="Orbitron" font-weight="700" font-size="${eyebrowFontSize}" fill="${CYAN}" letter-spacing="6">VERSE NEWS</text>
    <line x1="${contentX + eyebrowGlyphR * 2 + 14 + 9 * eyebrowFontSize}" y1="${eyebrowY - eyebrowFontSize * 0.7}" x2="${contentX + eyebrowGlyphR * 2 + 14 + 9 * eyebrowFontSize}" y2="${eyebrowY + eyebrowFontSize * 0.25}" stroke="${CYAN}" stroke-opacity="0.5" stroke-width="1" />
    <text x="${contentRight}" y="${eyebrowY}" font-family="Orbitron" font-weight="500" font-size="${0.009 * h}" fill="${TEXT_MUTED2}" text-anchor="end" letter-spacing="2">${escapeXml(weekLabel)}</text>`;

  // 4b. Headline (hero title)
  const headlineFontSize = 0.029 * h;
  const headlineTop = 0.16 * h;
  const headlineLineHeight = headlineFontSize * 1.12;
  const tickX = contentX;
  const tickWidth = 4;
  const headlineTextX = tickX + tickWidth + 20;
  const headlineTitle = hero?.title ?? 'No Verse News this week';
  const headlineLines = wrapText(headlineTitle, contentWidth - (tickWidth + 20), headlineFontSize, 'orbitron', 2);
  const headlineTextEls = headlineLines
    .map((line, i) => `<tspan x="${headlineTextX}" dy="${i === 0 ? 0 : headlineLineHeight}">${escapeXml(line)}</tspan>`)
    .join('');
  const headlineBlockHeight = headlineLineHeight * headlineLines.length;
  const headline = `
    <rect x="${tickX}" y="${headlineTop - headlineFontSize * 0.85}" width="${tickWidth}" height="${headlineBlockHeight + headlineFontSize * 0.1}" fill="${CYAN}" />
    <text x="${headlineTextX}" y="${headlineTop}" font-family="Orbitron" font-weight="700" font-size="${headlineFontSize}" fill="${TEXT_PRIMARY}">${headlineTextEls}</text>`;

  // 4c. Category pill + date row
  const metaY = headlineTop + headlineBlockHeight + 0.008 * h;
  const catLabel = hero ? channelLabel(hero.channel, hero.category) : '';
  const dateLabel = hero ? formatWeekDate(hero.publishedAt) : '';
  const pillFontSize = 0.0115 * h;
  const pillPadX = 12;
  const pillW = Math.max(60, catLabel.length * pillFontSize * 0.62 + pillPadX * 2);
  const pillH = pillFontSize * 2.0;
  const metaRow = catLabel
    ? `
    <rect x="${headlineTextX}" y="${metaY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="${CYAN}" fill-opacity="0.12" />
    <text x="${headlineTextX + pillW / 2}" y="${metaY + pillH * 0.68}" font-family="Rajdhani" font-weight="600" font-size="${pillFontSize}" fill="${CYAN}" text-anchor="middle" letter-spacing="1.5">${escapeXml(catLabel)}</text>
    <text x="${headlineTextX + pillW + 14}" y="${metaY + pillH * 0.68}" font-family="Rajdhani" font-weight="500" font-size="${pillFontSize}" fill="${TEXT_MUTED}">${escapeXml(dateLabel)}</text>`
    : '';

  // 4d. List rows (items[1..4])
  const listTop = 0.345 * h;
  const rowHeight = 0.108 * h;
  const thumbH = rowHeight * 0.62;
  const thumbW = thumbH * (120 / 72);
  const rowGap = 0;
  const listRows = listItems
    .map((it, i) => {
      const rowY = listTop + i * (rowHeight + rowGap);
      const thumbY = rowY + (rowHeight - thumbH) / 2;
      const thumbX = contentX;
      const indexLabel = String(i + 2).padStart(2, '0');
      const indexFontSize = 0.011 * h;
      const thumbHref = thumbDataUris[i];
      const thumbBlock = thumbHref
        ? coverImage(`thumb-${i}`, thumbHref, thumbX, thumbY, thumbW, thumbH, 8)
        : placeholderFill(`thumb-${i}`, thumbX, thumbY, thumbW, thumbH, 8);
      const border = `<rect x="${thumbX}" y="${thumbY}" width="${thumbW}" height="${thumbH}" rx="8" fill="none" stroke="${CYAN}" stroke-opacity="0.35" stroke-width="1" />`;

      const textX = thumbX + thumbW + 18;
      const textMaxWidth = contentRight - textX - 40; // leave room for index glyph on the right
      const rowFontSize = 0.0148 * h;
      const rowLineHeight = rowFontSize * 1.18;
      const titleLines = wrapText(it.title, textMaxWidth, rowFontSize, 'rajdhani', 2);
      const titleBlockHeight = rowLineHeight * titleLines.length;
      const titleTop = rowY + rowHeight / 2 - titleBlockHeight / 2 + rowFontSize * 0.8;
      const titleTextEls = titleLines
        .map((line, li) => `<tspan x="${textX}" dy="${li === 0 ? 0 : rowLineHeight}">${escapeXml(line)}</tspan>`)
        .join('');
      const tag = channelLabel(it.channel, it.category);
      const tagFontSize = 0.0088 * h;

      const indexGlyph = `<text x="${contentRight}" y="${rowY + rowHeight / 2 + indexFontSize * 0.35}" font-family="Orbitron" font-weight="500" font-size="${indexFontSize}" fill="${CYAN}" fill-opacity="0.55" text-anchor="end">${indexLabel}</text>`;

      const divider = i > 0
        ? `<line x1="${contentX}" y1="${rowY}" x2="${contentRight}" y2="${rowY}" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1" />`
        : '';

      return `
      ${divider}
      ${thumbBlock}
      ${border}
      <text x="${textX}" y="${titleTop}" font-family="Rajdhani" font-weight="600" font-size="${rowFontSize}" fill="${TEXT_SECONDARY}">${titleTextEls}</text>
      <text x="${textX}" y="${titleTop + titleBlockHeight + tagFontSize * 0.9}" font-family="Rajdhani" font-weight="500" font-size="${tagFontSize}" fill="${TEXT_MUTED}" letter-spacing="1">${escapeXml(tag)}</text>
      ${indexGlyph}`;
    })
    .join('\n');

  // 4e. Footer wordmark
  const footerY = 0.85 * h;
  const footerFontSize = 0.008 * h;
  const footer = `<text x="${contentX}" y="${footerY}" font-family="Rajdhani" font-weight="500" font-size="${footerFontSize}" fill="${TEXT_MUTED}" letter-spacing="2">sc-companion.vercel.app · STARSCAPE</text>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${BG}" />
  ${heroBlock}
  ${overlays}
  ${compass}
  ${eyebrow}
  ${headline}
  ${metaRow}
  ${listRows}
  ${footer}
</svg>`;
}

// Small helpers kept separate to avoid duplicating the hero placeholder markup.
function placeholderFillDefs(): string {
  return `
    <linearGradient id="ph-hero-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0a1420" />
      <stop offset="0.55" stop-color="#0d2233" />
      <stop offset="1" stop-color="#051018" />
    </linearGradient>`;
}
function placeholderRectOnly(id: string, x: number, y: number, w: number, h: number): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#ph-${id})" />`;
}
