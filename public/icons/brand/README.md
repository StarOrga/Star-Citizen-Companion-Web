# Brand marks

Everything in this directory except `vc-mark.svg` is **generated**. Do not hand-edit it —
`npm run check:brand-icons` runs in `prebuild` and will fail the build.

```bash
npm run gen:brand-icons      # rewrite every mark and raster
npm run check:brand-icons    # verify the working tree matches (what CI runs)
```

## The master

`vc-mark.svg` is the Verse Companion **desktop app's** icon, vendored byte-for-byte from

    Star-Citizen-Companion-App/modules/desktop/resources/app-icon-taskbar.svg

It is the only authored file here. The desktop app owns the artwork; this repo consumes it.

**When the desktop app changes its icon**, re-vendor and regenerate:

```bash
git -C ../Star-Citizen-Companion-App show origin/main:modules/desktop/resources/app-icon-taskbar.svg \
   > public/icons/brand/vc-mark.svg
npm run gen:brand-icons
```

Then give the changed files new names (see "Filenames are cache-busting" below) and update
every reference — otherwise browsers and the CDN keep the old icon.

`npm run check:brand-upstream` (part of `prebuild`) fails when `vc-mark.svg` no longer matches
the app's `origin/main`. It runs wherever a `Star-Citizen-Companion-App` checkout sits next to
this repo (or `VC_APP_REPO` points at one) and skips on CI and Vercel. It exists because the app
redrew its icon on 2026-10-14 (#1450) and the web showed the old one for a month (feedback #344).

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
| Verse Companion (app + web) | `vc-mark*` | The master, untouched. |
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
| `-mark-tray` | 16–24px | The notification area. For the siblings it is the **taskbar icon itself** — the master with the small tier's badge scaled up by 40%, so the tray shows the same nebula disc, glow and ring as the taskbar and the enlarged badge still tells Starscape and the Uploader apart. (An earlier flat rim-only redraw read cleanly but looked like a third product next to the taskbar icon.) For SCC it mirrors the desktop app's own tray construction — dark disc plus bright rim — for the family sheet only; the real SCC tray lives in the desktop app repo. |

To iterate on a badge without churning every committed raster, render only the reference
sheet: `node scripts/build-brand-icons.mjs --sheet=/tmp/sheet.png`.

## `family-sheet.png`

A rendered contact sheet of the whole family at true pixel size — the artifact that
makes "does the nova still read at 16px?" answerable in review, which a diff of SVG path
data cannot. It carries **no text**: `resvg` resolves fonts from the host, so a label would
render differently on the Linux build machine and fail `--check` on nothing but a font.
The legend therefore lives here:

- **Columns**, left to right: Verse Companion · Starscape · Data Uploader.
- **Rows**, top to bottom: app tier at 128px · small tier at 48/32/24/16 · tray tier at 24/16.
- **The two strips** at the bottom are the point of the exercise: small @24 then tray @16,
  on the Windows dark taskbar (`#1c1c1c`) and the light one (`#f3f3f3`). This is where a
  dark disc used to disappear and where the three products have to stay apart.

`-mark-mono.svg` is the Safari pinned-tab mask: flat black shapes only, no gradients.

## Filenames are cache-busting

`public/icons/` is copied unhashed and — until this change — was matched by no ngsw asset
group at all. Overwriting a mark in place would leave the CDN and every browser cache serving
the old artwork indefinitely, so the retired `verse-compass*.svg` / `icon-192.png` /
`icon-512.png` were **deleted and replaced under new names** rather than edited. The same
happened in 2026-11 (#344): the `scc-*` files became `vc-*`, and the apps menu's hand-extracted
`starscape-tray.png` / `uploader-tray.png` became the generated `*-tray-48.png`. The product key
in the generator stays `scc`; only the file prefix changed (`FILE_PREFIX` in
`scripts/build-brand-icons.mjs`). `public/favicon.ico` keeps its fixed name, because browsers
request it by that path.

Already-installed PWAs keep their old home-screen icon regardless; the OS caches it at install
time. `manifest.webmanifest`'s `"id": "/"` must not change — that would orphan those installs.
