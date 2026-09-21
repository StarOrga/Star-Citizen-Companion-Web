/**
 * SCC brand mark family — one master, two badges, three size tiers.
 *
 * ## Why this file exists
 *
 * Four products ship an icon: the SC Companion desktop app (a separate repo),
 * this web app, the Data Uploader (Electron) and Starscape (Rust). The desktop
 * app's icon is the one people already know from their taskbar, so it is the
 * anchor of the family: every product has to be recognisable as *that* icon
 * first, and as a specific product second.
 *
 * ## The system
 *
 * MASTER: `public/icons/brand/scc-mark.svg` is the desktop app's icon,
 * vendored byte-for-byte. It is the single source of the family's identity:
 * the dark verse disc (StarUI `--surface-canvas` #0d2635), the nebula wisps,
 * the tilted accretion disk and the glowing cyan core. The web app ships it
 * unchanged at every size, exactly as the desktop app does — an earlier version
 * of this file redrew a "compact" mark for the small sizes, and that redraw is
 * what made the browser tab, the header logo and the boot splash look like a
 * different product from the app on the taskbar.
 *
 * DERIVATION: Starscape and the Data Uploader are the master, untouched, with a
 * product badge laid over its core. Nothing in the master's markup is edited,
 * moved or removed — the badge is appended on top, so the base artwork stays
 * pixel-for-pixel the desktop app's and the product reads as "SCC, plus this".
 *   - Data Uploader: an upward arrow — it pushes extracted data up into SCC.
 *   - Starscape:     a monitor — it paints the verse across the desktop.
 *
 * COLOUR IS DELIBERATELY NOT A DIFFERENTIATOR. In the desktop app the tray icon
 * already uses hue to encode *state* (active / notification / error). If it
 * also encoded product identity, a red icon would be ambiguous: broken, or the
 * uploader? So every product is cyan, and shape alone carries identity.
 *
 * TIERS: one badge cannot serve 16px and 512px, so each product has three.
 *   app    >=128px — the master with the badge drawn at its natural weight.
 *   small  16-64px — the master with a bolder, larger badge: at these sizes the
 *                    master itself collapses to a disc and a dot (that IS the
 *                    desktop app's 16px icon), and the badge has to survive it.
 *   tray   16-24px — the notification area: the master with the small tier's
 *                    badge scaled up by 40%, so the tray icon IS the taskbar
 *                    icon and the badge still tells the siblings apart once the
 *                    master has collapsed to a disc and a dot. (SCC's own tray
 *                    lives in the desktop app repo; its flat rim construction
 *                    is only mirrored here for the family sheet.)
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

// ─── Product badges ───────────────────────────────────────────────────────────
//
// Authored in the master's OUTER 300-unit space: the canvas is 0..300 and the
// core sits at (150,150). The master's 5% margin group maps its inner (150,150)
// onto the same outer point, so "centre of the core" is (150,150) in both.
//
// Every id is namespaced (`<product>-badge-…`) because the app-tier SVG gets
// inlined into HTML documents, where gradient ids are document-global.
//
// No <text>, no fonts, no external references: the renderer resolves fonts from
// the host, and a label would make the bytes differ between a dev box and the
// Linux build machine, which would fail `--check` on nothing but a font.

/**
 * `tier` decides how much finesse the plate can afford:
 *   app   — the plate is a translucent pane of glass: the master's core glow
 *           (already sitting behind it) bleeds through, so a soft blur filter
 *           on the outer halo is safe (blur is fine at >=128px).
 *   small — the plate has to survive 16px as a bold silhouette, so it stays
 *           near-opaque and no blur filter is defined at all.
 */
const badgeDefs = (product, tier) => `
  <defs>
    ${tier === 'app' ? `<filter id="${product}-badge-soft" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>` : ''}
    <radialGradient id="${product}-badge-halo" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${C.bright}" stop-opacity="${tier === 'app' ? '.34' : '.5'}"/><stop offset="35%" stop-color="${C.base}" stop-opacity="${tier === 'app' ? '.16' : '.2'}"/><stop offset="70%" stop-color="${C.base}" stop-opacity="${tier === 'app' ? '.06' : '.08'}"/><stop offset="100%" stop-color="${C.base}" stop-opacity="0"/></radialGradient>
    <radialGradient id="${product}-badge-plate" cx="50%" cy="40%" r="62%"><stop offset="0%" stop-color="#1a3d54" stop-opacity="${tier === 'app' ? '.42' : '.92'}"/><stop offset="100%" stop-color="${C.canvas}" stop-opacity="${tier === 'app' ? '.5' : '.9'}"/></radialGradient>
    <radialGradient id="${product}-badge-core" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="${C.hi}" stop-opacity=".82"/><stop offset="55%" stop-color="${C.bright}" stop-opacity=".3"/><stop offset="100%" stop-color="${C.bright}" stop-opacity="0"/></radialGradient>
    <linearGradient id="${product}-badge-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${C.hi}" stop-opacity=".95"/><stop offset="55%" stop-color="${C.base}" stop-opacity=".65"/><stop offset="100%" stop-color="${C.base}" stop-opacity=".35"/></linearGradient>
    <linearGradient id="${product}-badge-ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#eaf7fd"/><stop offset="100%" stop-color="${C.hi}"/></linearGradient>
  </defs>`;

/**
 * Data Uploader — an ascending arrow over a landing bar, with a faint motion
 * trail of two shrinking chevrons underneath: the arrow isn't just present,
 * it's mid-ascent.
 *
 * `r` is the badge plate radius (the disc that lifts the glyph off the nebula);
 * the arrow is sized so its shaft sits on the core and its head clears the
 * accretion disk's inner orbit. `tier` selects the glass-plate finesse
 * (see `badgeDefs`) — the glyph geometry itself is still supplied per tier by
 * the caller so `small` stays bold.
 */
const uploaderBadge = ({ tier, r, rim, head, shaft, bar, trail, stroke }) => `
<!-- ===== PRODUCT BADGE: Data Uploader (laid over the untouched master) ===== -->
<g>${badgeDefs('uploader', tier)}
  <circle cx="150" cy="150" r="${r + 20}" fill="url(#uploader-badge-halo)"${tier === 'app' ? ` filter="url(#uploader-badge-soft)"` : ''}/>
  ${tier === 'app' ? `<circle cx="150" cy="150" r="${r}" fill="none" stroke="${C.bright}" stroke-width="${rim * 1.8}" stroke-opacity=".22" filter="url(#uploader-badge-soft)"/>` : ''}
  <circle cx="150" cy="150" r="${r}" fill="url(#uploader-badge-plate)"/>
  <circle cx="150" cy="150" r="${r * 0.86}" fill="url(#uploader-badge-core)"/>
  <circle cx="150" cy="150" r="${r}" fill="none" stroke="${tier === 'app' ? `url(#uploader-badge-rim)` : C.base}" stroke-width="${rim}" stroke-opacity="${tier === 'app' ? '.85' : '.9'}"/>
  ${tier === 'app' ? `<circle cx="150" cy="150" r="${r - rim * 2}" fill="none" stroke="${C.hi}" stroke-width="${rim * 0.4}" stroke-opacity=".3"/>` : ''}
  <path d="M${150 - trail.w},${150 + trail.y} L150,${150 + trail.y - trail.h} L${150 + trail.w},${150 + trail.y}"
        fill="none" stroke="${C.bright}" stroke-width="${trail.sw}" stroke-linecap="round" stroke-opacity=".5"/>
  <path d="M${150 - trail.w * 0.66},${150 + trail.y + trail.gap} L150,${150 + trail.y + trail.gap - trail.h * 0.7} L${150 + trail.w * 0.66},${150 + trail.y + trail.gap}"
        fill="none" stroke="${C.bright}" stroke-width="${trail.sw}" stroke-linecap="round" stroke-opacity=".25"/>
  <path d="M150,${150 - head.top} L${150 + head.w},${150 - head.base} L${150 + shaft.w},${150 - head.base} L${150 + shaft.w},${150 + shaft.bottom} L${150 - shaft.w},${150 + shaft.bottom} L${150 - shaft.w},${150 - head.base} L${150 - head.w},${150 - head.base} Z"
        fill="url(#uploader-badge-ink)" stroke="${C.bright}" stroke-width="${stroke}" stroke-linejoin="round"/>
  <rect x="${150 - bar.w}" y="${150 + bar.y}" width="${bar.w * 2}" height="${bar.h}" rx="${bar.h / 2}" fill="${C.bright}"/>
</g>`;

/** Four-point star path centred on (cx,cy) with half-size `s` — the verse on screen. */
const star4 = (cx, cy, s) => {
  const k = s * 0.16;
  return `M${cx},${cy - s} C${cx + k},${cy - k} ${cx + k},${cy - k} ${cx + s},${cy} C${cx + k},${cy + k} ${cx + k},${cy + k} ${cx},${cy + s} C${cx - k},${cy + k} ${cx - k},${cy + k} ${cx - s},${cy} C${cx - k},${cy - k} ${cx - k},${cy - k} ${cx},${cy - s} Z`;
};

/**
 * Starscape — a monitor on a stand, its screen lit by a small four-point star:
 * the verse, on the desktop. `tier` selects the glass-plate finesse (see
 * `badgeDefs`); the app tier also gets a faint diagonal sheen across the
 * screen, echoing the master's tilted disk without competing with it.
 */
const starscapeBadge = ({ tier, r, rim, screen, bezel, stand, star }) => {
  const top = 150 - screen.top;
  const mid = top + screen.h / 2;
  return `
<!-- ===== PRODUCT BADGE: Starscape (laid over the untouched master) ===== -->
<g>${badgeDefs('starscape', tier)}
  <circle cx="150" cy="150" r="${r + 20}" fill="url(#starscape-badge-halo)"${tier === 'app' ? ` filter="url(#starscape-badge-soft)"` : ''}/>
  ${tier === 'app' ? `<circle cx="150" cy="150" r="${r}" fill="none" stroke="${C.bright}" stroke-width="${rim * 1.8}" stroke-opacity=".22" filter="url(#starscape-badge-soft)"/>` : ''}
  <circle cx="150" cy="150" r="${r}" fill="url(#starscape-badge-plate)"/>
  <circle cx="150" cy="150" r="${r * 0.86}" fill="url(#starscape-badge-core)"/>
  <circle cx="150" cy="150" r="${r}" fill="none" stroke="${tier === 'app' ? `url(#starscape-badge-rim)` : C.base}" stroke-width="${rim}" stroke-opacity="${tier === 'app' ? '.85' : '.9'}"/>
  ${tier === 'app' ? `<circle cx="150" cy="150" r="${r - rim * 2}" fill="none" stroke="${C.hi}" stroke-width="${rim * 0.4}" stroke-opacity=".3"/>` : ''}
  <rect x="${150 - screen.w}" y="${top}" width="${screen.w * 2}" height="${screen.h}" rx="${screen.rx}"
        fill="${C.canvas}" fill-opacity=".92" stroke="url(#starscape-badge-ink)" stroke-width="${bezel}"/>
  ${tier === 'app' ? `<path d="M${150 - screen.w + bezel},${top + screen.h * 0.62} L${150 - screen.w * 0.25},${top + bezel} L${150 + screen.w * 0.1},${top + bezel} L${150 - screen.w + bezel},${top + screen.h * 0.92} Z" fill="${C.hi}" fill-opacity=".08"/>` : ''}
  <path d="${star4(150, mid, star)}" fill="#eaf7fd"/>
  <rect x="${150 - stand.neck}" y="${top + screen.h}" width="${stand.neck * 2}" height="${stand.gap}" fill="${C.bright}"/>
  <rect x="${150 - stand.foot}" y="${top + screen.h + stand.gap}" width="${stand.foot * 2}" height="${stand.h}" rx="${stand.h / 2}" fill="${C.bright}"/>
</g>`;
};

/**
 * The tray tier is the small tier's badge scaled up uniformly. At 16–24px the
 * master collapses to a dark disc with a glow, so the badge is the only thing
 * that still says *which* product this is — it gets 40% more of the tile. The
 * plate (r 64 → ~90, plus its 20-unit halo) still sits inside the master's
 * 147-unit disc, so the ring and the outer wisps stay visible around it.
 */
const TRAY_SCALE = 1.4;
const scaled = (geom, f = TRAY_SCALE) =>
  Object.fromEntries(
    Object.entries(geom).map(([k, v]) => [
      k,
      typeof v === 'number' ? Math.round(v * f * 10) / 10 : typeof v === 'object' ? scaled(v, f) : v,
    ]),
  );

const SMALL_GEOM = {
  uploader: {
    r: 64, rim: 6,
    head: { top: 42, base: 4, w: 36 }, shaft: { w: 14, bottom: 22 },
    bar: { w: 26, y: 32, h: 10 }, trail: { w: 13, y: 42, gap: 10, h: 8, sw: 3.5 }, stroke: 4,
  },
  starscape: {
    r: 64, rim: 6,
    screen: { w: 40, top: 40, h: 52, rx: 6 }, bezel: 7,
    stand: { neck: 7, gap: 9, foot: 24, h: 9 }, star: 15,
  },
};

/** Badge geometry per tier. `small` is bolder and larger so it survives 16px; `tray` is `small` × 1.4. */
const BADGE = {
  uploader: {
    app: uploaderBadge({
      tier: 'app', r: 52, rim: 3,
      head: { top: 34, base: 6, w: 27 }, shaft: { w: 10, bottom: 18 },
      bar: { w: 19, y: 26, h: 7 }, trail: { w: 10, y: 34, gap: 8, h: 6, sw: 2.5 }, stroke: 3,
    }),
    small: uploaderBadge({ tier: 'small', ...SMALL_GEOM.uploader }),
    tray: uploaderBadge({ tier: 'small', ...scaled(SMALL_GEOM.uploader) }),
  },
  starscape: {
    app: starscapeBadge({
      tier: 'app', r: 52, rim: 3,
      screen: { w: 32, top: 32, h: 42, rx: 5 }, bezel: 4,
      stand: { neck: 5, gap: 8, foot: 18, h: 6 }, star: 11,
    }),
    small: starscapeBadge({ tier: 'small', ...SMALL_GEOM.starscape }),
    tray: starscapeBadge({ tier: 'small', ...scaled(SMALL_GEOM.starscape) }),
  },
};

// The master's own close marker. Matched by shape, not by wording: the margin
// percentage changes whenever the mark is resized upstream (it went 15% → 5%
// when the taskbar icon was enlarged), which is a legitimate edit.
const MARK_END_RE = /<\/g><!-- end \d+% margin scale group -->\s*<\/svg>\s*$/;

/**
 * Derive a product's mark from the master SVG source.
 *
 * `tier` is `app` (>=128px), `small` (16-64px) or `tray` (the notification
 * area: `small` with the badge scaled up). For `scc` all are the master itself —
 * the web app ships the desktop app's icon unchanged.
 *
 * The master is edited in the *other* repo, so this asserts on its close marker
 * rather than trusting structure: if the artwork is restructured upstream, the
 * build fails loudly instead of emitting a silently broken icon.
 */
export function deriveAppMark(masterSvg, product, tier = 'app') {
  if (!PRODUCTS.includes(product)) throw new Error(`unknown product: ${product}`);
  if (tier !== 'app' && tier !== 'small' && tier !== 'tray') throw new Error(`unknown tier: ${tier}`);
  if (product === 'scc') return masterSvg;

  if (!MARK_END_RE.test(masterSvg)) {
    throw new Error(
      'master mark no longer ends with its "end <n>% margin scale group" close marker. ' +
        'The upstream artwork was restructured — re-vendor scc-mark.svg and update ' +
        'scripts/brand/marks.mjs before shipping.',
    );
  }
  const iEnd = masterSvg.lastIndexOf('</svg>');
  return `${masterSvg.slice(0, iEnd)}${BADGE[product][tier]}
</svg>
`;
}

/**
 * A mark's markup without the XML prolog, for inlining into HTML.
 *
 * The boot splash and the uploader's header cannot fetch an asset — the splash
 * paints before Angular boots, the uploader derives its favicon from the DOM.
 * Both used to carry a hand-copied duplicate of the mark that nothing kept in
 * sync; this is spliced in by the generator instead and verified by `--check`.
 *
 * Ids are namespaced on the way in: the master's `id="coreG"` is fine in a
 * standalone file, but inline it shares the document with every other SVG.
 */
export function inlineMark(masterSvg, product, rootAttrs = '') {
  const svg = deriveAppMark(masterSvg, product, 'small')
    .replace(/^<\?xml[^>]*\?>\s*/, '')
    .trim()
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${product}-mark-${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${product}-mark-${id})`);
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

// ─── tray tier ────────────────────────────────────────────────────────────────

/**
 * tray tier — 16-24px.
 *
 * Starscape and the Data Uploader: the master, untouched, with the badge
 * scaled up (see `TRAY_SCALE`). The tray icon is therefore the taskbar icon —
 * the same nebula disc, glow and ring people already see in the taskbar — and
 * the enlarged badge is what keeps the two siblings apart once the master has
 * collapsed to a disc and a dot. An earlier tray tier was a flat, rim-only
 * redraw of the mark; it read cleanly at 16px but looked like a third product
 * next to the taskbar icon it was supposed to belong to.
 *
 * SCC keeps the flat construction below: its tray lives in the desktop app
 * repo, and this file only mirrors that construction for the family sheet.
 */
export function trayMark(product, masterSvg) {
  if (product !== 'scc') {
    if (!masterSvg) throw new Error(`trayMark(${product}) needs the master SVG`);
    return deriveAppMark(masterSvg, product, 'tray');
  }
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
  <circle cx="50" cy="50" r="10.6" fill="url(#scc-tray-core)"/>
</svg>
`;
}
