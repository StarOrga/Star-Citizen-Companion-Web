# Brand marks

Everything in this directory except `scc-mark.svg` is **generated**. Do not hand-edit it —
`npm run check:brand-icons` runs in `prebuild` and will fail the build.

```bash
npm run gen:brand-icons      # rewrite every mark and raster
npm run check:brand-icons    # verify the working tree matches (what CI runs)
```

## The master

`scc-mark.svg` is the SC Companion **desktop app's** icon, vendored byte-for-byte from

    Star-Citizen-Companion-App/modules/desktop/resources/app-icon-taskbar.svg

It is the only authored file here. The desktop app owns the artwork; this repo consumes it.

**When the desktop app changes its icon**, re-vendor and regenerate:

```bash
cp ../Star-Citizen-Companion-App/modules/desktop/resources/app-icon-taskbar.svg \
   public/icons/brand/scc-mark.svg
npm run gen:brand-icons
```

The web app ships that file **unchanged at every size** — browser tab, PWA icon, header logo,
boot splash, extension — exactly as the desktop app does for its taskbar icon. It is the icon
people already recognise, so nothing here redraws it for small sizes. (An earlier version did:
a "compact" mark with hard orbit rings and a brain glyph, which is why the browser tab looked
like a different product from the app on the taskbar.)

`scripts/brand/marks.mjs` derives the sibling marks by **appending a badge after** the master's
markup, asserting only on its close marker (`<!-- end N% margin scale group -->`). If the
upstream artwork is restructured, the generator **fails loudly** rather than emitting a broken
icon — fix the marker in `marks.mjs` and re-run.

## The family

| Product | Mark | What it is |
|---|---|---|
| SC Companion (app + web) | `scc-mark*` | The master, untouched. |
| Data Uploader | `uploader-mark*` | The master, untouched, with an **upward arrow** badge over the core — it pushes extracted data up into SCC. |
| Starscape | `starscape-mark*` | The master, untouched, with a **monitor** badge over the core — it paints the verse across the desktop. |

The base artwork is pixel-for-pixel the desktop app's in all three; the badge sits on top,
centred on the core and inside the accretion disk's inner orbit, so the ring and wisps stay
fully visible around it. A product reads as "SCC, plus this" — never as a cousin.

All three are in the **same cyan**. Colour is deliberately not a differentiator: the desktop
app's tray already uses hue to encode *state* (active / notification / error), so a red icon
there must mean "error", never "uploader".

## The tiers

| Tier | Sizes | Why it exists |
|---|---|---|
| `-mark` (app) | ≥128px | The master, badge drawn at its natural weight. |
| small | 16–64px | The master with a **bolder, larger** badge. At these sizes the master collapses to a disc and a glowing point — that *is* the desktop app's 16px icon — and the badge has to survive it. Never written as a file: for SCC it is the master itself, for the siblings it is only rasterised (and inlined into the uploader's HTML). |
| `-mark-tray` | 16–24px | Dark disc **plus a bright rim**: the disc carries the silhouette on a *light* taskbar, the rim on a *dark* one. A disc alone is the bug — `#0d2635` on a dark taskbar is invisible, which is exactly how the desktop app's tray icon came to read as missing. Geometry mirrors the desktop app's own tray mark. |

To iterate on a badge without churning every committed raster, render only the reference
sheet: `node scripts/build-brand-icons.mjs --sheet=/tmp/sheet.png`.

## `family-sheet.png`

A rendered contact sheet of the whole family at true pixel size — the artifact that
makes "does the nova still read at 16px?" answerable in review, which a diff of SVG path
data cannot. It carries **no text**: `resvg` resolves fonts from the host, so a label would
render differently on the Linux build machine and fail `--check` on nothing but a font.
The legend therefore lives here:

- **Columns**, left to right: SC Companion · Starscape · Data Uploader.
- **Rows**, top to bottom: app tier at 128px · small tier at 48/32/24/16 · tray tier at 24/16.
- **The two strips** at the bottom are the point of the exercise: small @24 then tray @16,
  on the Windows dark taskbar (`#1c1c1c`) and the light one (`#f3f3f3`). This is where a
  dark disc used to disappear and where the three products have to stay apart.

`-mark-mono.svg` is the Safari pinned-tab mask: flat black shapes only, no gradients.

## Filenames are cache-busting

`public/icons/` is copied unhashed and — until this change — was matched by no ngsw asset
group at all. Overwriting a mark in place would leave the CDN and every browser cache serving
the old artwork indefinitely, so the retired `verse-compass*.svg` / `icon-192.png` /
`icon-512.png` were **deleted and replaced under new names** rather than edited.

Already-installed PWAs keep their old home-screen icon regardless; the OS caches it at install
time. `manifest.webmanifest`'s `"id": "/"` must not change — that would orphan those installs.
