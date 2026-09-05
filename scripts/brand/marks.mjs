/**
 * SCC brand mark family — one master, two derivations, three size tiers.
 *
 * ## Why this file exists
 *
 * Four products ship an icon: the SC Companion desktop app (a separate repo),
 * this web app, the Data Uploader (Electron) and Starscape (Rust). Before this
 * module they shared *one* mark verbatim — so on a taskbar you could not tell
 * which SCC window you were clicking — while the PWA install icon and the
 * browser extension were still on a third, retired mark ("Verse Compass").
 *
 * ## The system
 *
 * MASTER: `public/icons/brand/scc-mark.svg` is the desktop app's icon,
 * vendored byte-for-byte. It is the single source of the family's identity:
 * the dark verse disc (StarUI `--surface-canvas` #0d2635), the nebula wisps,
 * the tilted accretion disk and the glowing cyan core.
 *
 * DERIVATION: Starscape and the Data Uploader are the SAME artwork with two
 * surgical swaps — the core glyph, and the accretion disk's signature. Nothing
 * else changes: same palette, same wisps, same star field. They are siblings,
 * not cousins.
 *
 * COLOUR IS DELIBERATELY NOT A DIFFERENTIATOR. In the desktop app the tray icon
 * already uses hue to encode *state* (active / notification / error). If it
 * also encoded product identity, a red icon would be ambiguous: broken, or the
 * uploader? So every product is cyan, and shape alone carries identity.
 *
 * That constraint has a cost, and it is paid in the glyph choice. A glyph must
 * stay unambiguous at 16px, which is the size Windows actually hands a tray.
 * Measured against the master's soft core at that size:
 *   - a crescent-lit planet collapses into the same blob    → rejected
 *   - a framed "vista" rectangle turns to mush below 24px   → rejected
 *   - a hard-edged four-point nova survives                 → shipped
 *
 * TIERS: one drawing cannot serve 16px and 512px, so each product has three.
 *   app      >=128px — the full master artwork, blur and all.
 *   compact  16-64px — redrawn: no Gaussian blur (it dissolves), bolder ring,
 *                      tighter core, glyph scaled up to carry the silhouette.
 *   tray     16-24px — NO dark disc. A dark disc on a dark Windows taskbar is
 *                      invisible, which is exactly how the old tray icon read
 *                      as "missing". Bright annulus + solid glyph on
 *                      transparency instead: legible on light AND dark.
 */

// StarUI design tokens — the master is already built on these.
export const C = {
  canvas: '#0d2635', // --surface-canvas
  base: '#52c1e6', // --accent-primary
  bright: '#7dd5f0',
  hi: '#a0dcf0',
  gold: '#c8a84b', // the master's secondary wisp accent
};

export const PRODUCTS = ['scc', 'starscape', 'uploader'];

// ─── Core glyphs, authored in the master's inner 300-unit space (centre 150,150)

/** Four-point nova — Starscape paints the verse across the desktop. */
const novaMaster = `
  <!-- Starscape: four-point nova replaces the brain lobes -->
  <path d="M150,66 C157.5,120 180,142.5 234,150 C180,157.5 157.5,180 150,234 C142.5,180 120,157.5 66,150 C120,142.5 142.5,120 150,66 Z"
        fill="${C.hi}" fill-opacity=".55"/>
  <path d="M150,96 C154.2,129 171,145.8 204,150 C171,154.2 154.2,171 150,204 C145.8,171 129,154.2 96,150 C129,145.8 145.8,129 150,96 Z"
        fill="#eaf7fd" fill-opacity=".95"/>`;

/** Ascending stream — the uploader pushes extracted data into SCC. */
const arrowMaster = `
  <!-- Data Uploader: ascending data stream replaces the brain lobes -->
  <path d="M150,78 L201,150 L172.5,150 L172.5,189 L127.5,189 L127.5,150 L99,150 Z"
        fill="${C.hi}" fill-opacity=".9" stroke="${C.bright}" stroke-width="6" stroke-linejoin="round"/>
  <rect x="108" y="204" width="84" height="16.5" rx="8.25" fill="${C.bright}" fill-opacity=".9"/>`;

// ─── Accretion-disk signatures, same coordinate space ────────────────────────

/** Starscape: ONE wide, steeply tilted band — a planetary ring, not a disk. */
const ringStarscape = `
  <!-- Starscape signature: a single wide planetary ring instead of the 3-orbit disk -->
  <g>
    <ellipse cx="150" cy="150" rx="138" ry="45" fill="none" stroke="${C.base}" stroke-width="3.2" opacity=".5" transform="rotate(-24,150,150)"/>
    <ellipse cx="150" cy="150" rx="138" ry="45" fill="none" stroke="${C.gold}" stroke-width="1.2" opacity=".3" transform="rotate(-24,150,150)"/>
    <ellipse cx="150" cy="150" rx="138" ry="45" fill="none" stroke="${C.bright}" stroke-width="5" stroke-dasharray="8 760" opacity=".85" transform="rotate(-24,150,150)" filter="url(#fDk)"/>
  </g>`;

/** Uploader: the orbits are broken — the stream punches out through the disk. */
const ringUploader = `
  <!-- Data Uploader signature: orbits broken open where the stream exits -->
  <g>
    <ellipse cx="150" cy="150" rx="105" ry="28" fill="none" stroke="${C.base}" stroke-width="1.8" opacity=".34" stroke-dasharray="78 39" stroke-dashoffset="19" transform="rotate(-20,150,150)"/>
    <ellipse cx="150" cy="150" rx="86" ry="22" fill="none" stroke="${C.base}" stroke-width="1.5" opacity=".28" stroke-dasharray="60 30" stroke-dashoffset="15" transform="rotate(-20,150,150)"/>
    <ellipse cx="150" cy="150" rx="105" ry="28" fill="none" stroke="${C.bright}" stroke-width="5" stroke-dasharray="8 577" opacity=".85" transform="rotate(-20,150,150)" filter="url(#fDk)"/>
    <ellipse cx="150" cy="150" rx="86" ry="22" fill="none" stroke="${C.base}" stroke-width="4.5" stroke-dasharray="7 464" opacity=".8" transform="rotate(-20,150,150)" filter="url(#fDk)"/>
  </g>`;

const DERIVATION = {
  starscape: { glyph: novaMaster, disk: ringStarscape, label: 'Starscape' },
  uploader: { glyph: arrowMaster, disk: ringUploader, label: 'SC Data Uploader' },
};

// ─── app tier: surgical derivation from the vendored master ──────────────────

const MARK_DISK = '<!-- ===== ACCRETION DISK';
const MARK_CORE = '<!-- ===== BRAIN-NEBULA CORE';
const MARK_LOBES = '<!-- Brain lobes';
// Matched by shape, not by wording: the margin percentage in this comment
// changes whenever the mark is resized upstream (it went 15% → 5% when the
// taskbar icon was enlarged), and that is a legitimate edit that must not
// hard-fail an otherwise-valid derivation.
const MARK_END_RE = /<\/g><!-- end \d+% margin scale group -->/;

/**
 * Derive a product's app-tier mark from the master SVG source.
 *
 * The master is edited in the *other* repo, so this asserts on the section
 * markers rather than trusting line numbers: if the artwork is restructured
 * upstream, the build fails loudly instead of emitting a silently broken icon.
 */
export function deriveAppMark(masterSvg, product) {
  if (product === 'scc') return masterSvg;
  const d = DERIVATION[product];
  if (!d) throw new Error(`unknown product: ${product}`);

  for (const [name, marker] of [
    ['ACCRETION DISK', MARK_DISK],
    ['BRAIN-NEBULA CORE', MARK_CORE],
    ['Brain lobes', MARK_LOBES],
  ]) {
    if (!masterSvg.includes(marker)) {
      throw new Error(
        `master mark no longer contains the "${name}" marker (${marker}). ` +
          'The upstream artwork was restructured — re-vendor scc-mark.svg and ' +
          'update scripts/brand/marks.mjs to match before shipping.',
      );
    }
  }

  const iDisk = masterSvg.indexOf(MARK_DISK);
  const iCore = masterSvg.indexOf(MARK_CORE);
  const iLobes = masterSvg.indexOf(MARK_LOBES);
  const endMatch = MARK_END_RE.exec(masterSvg);
  if (!endMatch) {
    throw new Error(
      'master mark has no "end <n>% margin scale group" close marker. The upstream ' +
        'artwork was restructured — re-vendor scc-mark.svg and update scripts/brand/marks.mjs.',
    );
  }
  const iEnd = endMatch.index;
  if (!(iDisk < iCore && iCore < iLobes && iLobes < iEnd)) {
    throw new Error('master mark sections are out of order — re-check scc-mark.svg');
  }

  const head = masterSvg.slice(0, iDisk); // defs, background, clouds, wisps, stars
  const coreHead = masterSvg.slice(iCore, iLobes); // halo + core glow: shared
  const tail = masterSvg.slice(iEnd); // close the margin group + </svg>

  return `${head}${d.disk}

${coreHead}${d.glyph}

  <!-- Soft centre — kept from the master so the core reads identically -->
  <circle cx="150" cy="150" r="3.5" fill="${C.hi}" opacity=".6"/>
</g>

${tail}`;
}

// ─── compact + tray tiers: redrawn for small sizes ───────────────────────────

const GLYPH_COMPACT = {
  scc: () => {
    // The master's lobes, mapped from its 300-space onto the 100-unit canvas.
    const s = 0.5;
    const tx = (50 - 150 * s).toFixed(2);
    const ty = (50 - 147 * s).toFixed(2);
    return `<g transform="translate(${tx},${ty}) scale(${s})">
    <path d="M150,125 C137,120 123,125 120,136 C117,147 119,160 126,166 C133,172 143,172 150,170" fill="${C.hi}" fill-opacity=".40"/>
    <path d="M150,125 C163,120 177,125 180,136 C183,147 181,160 174,166 C167,172 157,172 150,170" fill="${C.hi}" fill-opacity=".40"/>
    <path d="M150,126 C139,127 127,136 124,147 C121,156 122,164 128,170 C134,174 143,172 150,170" fill="none" stroke="${C.bright}" stroke-width="6.5" stroke-linecap="round"/>
    <path d="M150,126 C161,127 173,136 176,147 C179,156 178,164 172,170 C166,174 157,172 150,170" fill="none" stroke="${C.bright}" stroke-width="6.5" stroke-linecap="round"/>
    <line x1="150" y1="124" x2="150" y2="171" stroke="${C.hi}" stroke-width="4"/>
  </g>`;
  },
  starscape: () => `<path d="M50,22 C52.5,40 60,47.5 78,50 C60,52.5 52.5,60 50,78 C47.5,60 40,52.5 22,50 C40,47.5 47.5,40 50,22 Z" fill="${C.hi}"/>
  <path d="M50,32 C51.4,43 57,48.6 68,50 C57,51.4 51.4,57 50,68 C48.6,57 43,51.4 32,50 C43,48.6 48.6,43 50,32 Z" fill="#eaf7fd"/>`,
  uploader: () => `<path d="M50,26 L67,50 L57.5,50 L57.5,63 L42.5,63 L42.5,50 L33,50 Z" fill="${C.hi}" stroke="${C.bright}" stroke-width="2" stroke-linejoin="round"/>
  <rect x="36" y="68" width="28" height="5.5" rx="2.75" fill="${C.bright}"/>`,
};

const RING_COMPACT = {
  scc: `<g transform="rotate(-20 50 50)">
    <ellipse cx="50" cy="50" rx="45" ry="12.5" fill="none" stroke="${C.base}" stroke-width="2.2" opacity=".65"/>
    <ellipse cx="50" cy="50" rx="36" ry="10" fill="none" stroke="${C.base}" stroke-width="1.7" opacity=".5"/>
    <ellipse cx="50" cy="50" rx="27" ry="7.5" fill="none" stroke="${C.base}" stroke-width="1.3" opacity=".4"/>
    <circle cx="95" cy="50" r="2.6" fill="${C.bright}"/><circle cx="14" cy="50" r="2.2" fill="${C.hi}"/>
  </g>`,
  starscape: `<g transform="rotate(-24 50 50)">
    <ellipse cx="50" cy="50" rx="46" ry="15" fill="none" stroke="${C.base}" stroke-width="3.2" opacity=".7"/>
    <ellipse cx="50" cy="50" rx="46" ry="15" fill="none" stroke="${C.gold}" stroke-width="1.2" opacity=".45"/>
    <circle cx="96" cy="50" r="2.4" fill="${C.bright}"/>
  </g>`,
  uploader: `<g transform="rotate(-20 50 50)">
    <ellipse cx="50" cy="50" rx="45" ry="12.5" fill="none" stroke="${C.base}" stroke-width="2.4" opacity=".68" stroke-dasharray="52 26" stroke-dashoffset="13"/>
    <ellipse cx="50" cy="50" rx="34" ry="9.5" fill="none" stroke="${C.base}" stroke-width="1.8" opacity=".5" stroke-dasharray="40 20" stroke-dashoffset="10"/>
    <circle cx="95" cy="50" r="2.6" fill="${C.bright}"/>
  </g>`,
};

/** compact tier — 16-64px. No blur filters: they dissolve at these sizes. */
export function compactMark(product) {
  // Namespaced because the compact mark gets INLINED into HTML documents, where
  // SVG gradient ids are document-global — a bare id="c" would collide with any
  // other inline SVG on the page and silently swap one mark's fill for another.
  const gD = `${product}-mark-disc`;
  const gC = `${product}-mark-core`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by scripts/build-brand-icons.mjs — edit scripts/brand/marks.mjs instead. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="64" height="64" role="img">
  <defs>
    <radialGradient id="${gD}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#143049"/><stop offset="70%" stop-color="${C.canvas}"/><stop offset="100%" stop-color="${C.canvas}"/></radialGradient>
    <radialGradient id="${gC}" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${C.hi}" stop-opacity=".9"/><stop offset="45%" stop-color="${C.bright}" stop-opacity=".42"/><stop offset="100%" stop-color="${C.base}" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="50" cy="50" r="49.5" fill="url(#${gD})"/>
  <circle cx="50" cy="50" r="48.4" fill="none" stroke="${C.base}" stroke-width="2.2" opacity=".55"/>
  ${RING_COMPACT[product]}
  <circle cx="50" cy="50" r="22" fill="url(#${gC})"/>
  ${GLYPH_COMPACT[product]()}
</svg>
`;
}

/**
 * The compact mark's markup without the XML prolog, for inlining into HTML.
 *
 * The boot splash and the uploader's header cannot fetch an asset — the splash
 * paints before Angular boots, the uploader derives its favicon from the DOM.
 * Both used to carry a hand-copied duplicate of the mark that nothing kept in
 * sync; this is spliced in by the generator instead and verified by `--check`.
 */
export function inlineMark(product, rootAttrs = '') {
  const svg = compactMark(product)
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .replace(/^<!--[\s\S]*?-->\s*/, '')
    .trim();
  return rootAttrs ? svg.replace('<svg ', `<svg ${rootAttrs} `) : svg;
}

/**
 * Safari pinned-tab mask icon: a flat monochrome silhouette. The format takes
 * solid shapes only — gradients, opacity and strokes with alpha are ignored —
 * so this is the mark reduced to ring, orbit and core.
 */
export function monoMark() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by scripts/build-brand-icons.mjs — edit scripts/brand/marks.mjs instead. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <path d="M50,2 A48,48 0 1,1 49.99,2 Z M50,10 A40,40 0 1,0 50.01,10 Z" fill="black"/>
  <path d="M50,36 A45,13 0 1,1 49.99,36 Z M50,42 A39,7 0 1,0 50.01,42 Z" fill="black" transform="rotate(-20 50 50)"/>
  <circle cx="50" cy="50" r="13" fill="black"/>
</svg>
`;
}

const GLYPH_TRAY = {
  // Identity at 16px is the glyph silhouette — colour stays uniform, because in
  // the desktop app hue already means tray STATE.
  //
  // SCC keeps the master's small core: a glowing point IS its mark. The two
  // siblings do not get that luxury. At the master's core radius their glyphs
  // land on ~1.7 device pixels in a 16px slot and all three tray icons collapse
  // into the same dot, so nova and stream are drawn roughly 2.5x larger — big
  // enough to survive the downscale, still inside the accretion ring.
  scc: `<circle cx="50" cy="50" r="10.6" fill="url(#scc-tray-core)"/>`,
  starscape: `<path d="M50,19 C53.1,42 58,46.9 81,50 C58,53.1 53.1,58 50,81 C46.9,58 42,53.1 19,50 C42,46.9 46.9,42 50,19 Z" fill="url(#starscape-tray-core)"/>`,
  uploader: `<path d="M50,20 L74,60 L26,60 Z" fill="url(#uploader-tray-core)"/>
  <rect x="34" y="66" width="32" height="9" rx="4.5" fill="${C.hi}"/>`,
};

/**
 * tray tier — 16-24px.
 *
 * This mirrors the desktop app's own tray construction rather than inventing a
 * second one: a near-opaque dark disc, which carries the silhouette on a LIGHT
 * taskbar, plus a bright rim, which carries it on a DARK one. The disc alone is
 * the bug — #0d2635 on a dark taskbar is invisible, and that is exactly how the
 * app's tray icon came to read as missing. Proportions are the master's tray
 * geometry scaled from its 32-unit canvas onto this 100-unit one, so all four
 * products' tray icons are built the same way at the size the OS actually draws.
 *
 * No blur filters and no margin: both are unreadable at 16px.
 */
export function trayMark(product) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED by scripts/build-brand-icons.mjs — edit scripts/brand/marks.mjs instead. -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="32" height="32" role="img">
  <defs>
    <radialGradient id="${product}-tray-halo"><stop offset="0%" stop-color="${C.hi}" stop-opacity=".55"/><stop offset="40%" stop-color="${C.bright}" stop-opacity=".275"/><stop offset="100%" stop-color="${C.bright}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${product}-tray-core"><stop offset="0%" stop-color="#ffffff" stop-opacity=".92"/><stop offset="38%" stop-color="${C.hi}"/><stop offset="100%" stop-color="${C.bright}"/></radialGradient>
  </defs>
  <circle cx="50" cy="50" r="47" fill="${C.canvas}" fill-opacity=".97"/>
  <circle cx="50" cy="50" r="46.1" fill="none" stroke="${C.base}" stroke-width="5.6" stroke-opacity=".85"/>
  <g transform="rotate(-22 50 50)">
    <ellipse cx="50" cy="50" rx="32.5" ry="11.25" fill="none" stroke="${C.bright}" stroke-width="3.6" stroke-opacity=".55"/>
    <ellipse cx="50" cy="50" rx="21.9" ry="7.5" fill="none" stroke="${C.bright}" stroke-width="2.5" stroke-opacity=".33"/>
  </g>
  <circle cx="50" cy="50" r="26.25" fill="url(#${product}-tray-halo)"/>
  ${GLYPH_TRAY[product]}
</svg>
`;
}
