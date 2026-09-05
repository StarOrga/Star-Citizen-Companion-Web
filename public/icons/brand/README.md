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

`scripts/brand/marks.mjs` derives the sibling marks by splicing on comment markers in that
file (`<!-- ===== ACCRETION DISK`, `<!-- ===== BRAIN-NEBULA CORE`, `<!-- Brain lobes`). If the
upstream artwork is restructured, the generator **fails loudly** rather than emitting a broken
icon — fix the markers in `marks.mjs` and re-run.

## The family

| Product | Mark | Core glyph | Accretion disk |
|---|---|---|---|
| SC Companion (app + web) | `scc-mark*` | brain-nebula | three orbits |
| Starscape | `starscape-mark*` | four-point nova | one wide planetary ring |
| Data Uploader | `uploader-mark*` | ascending data stream | orbits broken open |

All three are the **same artwork** in the **same cyan**. Colour is deliberately not a
differentiator: the desktop app's tray already uses hue to encode *state* (active /
notification / error), so a red icon there must mean "error", never "uploader".

## The tiers

| Tier | Sizes | Why it exists |
|---|---|---|
| `-mark` | ≥128px | The full artwork, Gaussian blur and all. |
| `-mark-compact` | 16–64px | No blur — it dissolves into grey mush at small sizes. Bolder ring, tighter core, larger glyph. |
| `-mark-tray` | 16–24px | Dark disc **plus a bright rim**: the disc carries the silhouette on a *light* taskbar, the rim on a *dark* one. A disc alone is the bug — `#0d2635` on a dark taskbar is invisible, which is exactly how the desktop app's tray icon came to read as missing. Geometry mirrors the desktop app's own tray mark. |

## `family-sheet.png`

A rendered contact sheet of the whole family at true pixel size — the artifact that
makes "does the nova still read at 16px?" answerable in review, which a diff of SVG path
data cannot. It carries **no text**: `resvg` resolves fonts from the host, so a label would
render differently on the Linux build machine and fail `--check` on nothing but a font.
The legend therefore lives here:

- **Columns**, left to right: SC Companion · Starscape · Data Uploader.
- **Rows**, top to bottom: app tier at 128px · compact tier at 48/32/24/16 · tray tier at 24/16.
- **The two strips** at the bottom are the point of the exercise: compact @24 then tray @16,
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
