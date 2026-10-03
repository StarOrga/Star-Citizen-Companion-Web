# Ship blueprints

Line drawings of every ship hull, drawn by the uploader from the hull GLB it
already exports, stored in R2 next to the hulls and drawn by the web app in
three places:

| Where | LOD | What it shows |
|---|---|---|
| Codex search results (landing) | `icon` | small top view next to a ship hit |
| Ship tiles (Codex list, Bridge lanes + hero, Hangar) | `icon` | placeholder until the store image has loaded, then cross-fades to it |
| Ship page, Holotable → **Schema** | `full` | static top view with every hardpoint marked, side elevation under it, keyboard list |

Not to be confused with the codex's crafting blueprints (`codex_blueprints`,
`blueprint-detail.component.ts`) — those are game recipes. The web code lives
in `src/app/codex/ship-blueprint/`.

## Why the uploader draws them

Hull GLBs are 0.6-3.5 MB (median 840 kB). A search list cannot download them
to draw an icon, and an edge function or the assets Worker must not decode
them per request (in-request image decoding took production down three
times). The uploader has the hull on disk anyway, so it draws once per hull
and uploads two small vector files: one file serves every size.

## Pipeline

1. `skin_export_app.py` exports `<ship>/models/<ship>_<paint>.glb` as before
   (geometry only, meshopt, quantized).
2. During the skin upload, `src/main/blueprint-ingest.ts` runs for **every**
   ship of the run, including ships whose hull is already live (`.uploaded`):
   - `src/lib/blueprint/glb.ts` reads the GLB with `@gltf-transform/core`
     (meshopt decoder, quantization, node transforms) into welded
     world-space triangles (0.5 mm weld grid);
   - `src/lib/blueprint/build.ts` draws both files;
   - the result is cached in `<ship>/blueprint/{full,icon}.svg` +
     `meta.json`, keyed by hull sha256 and `BLUEPRINT_GENERATOR`;
   - `ingest-skins` `blueprint_sign` (R2 cost gate, presigned PUT or
     `exists`) → PUT `image/svg+xml` → `blueprint_commit`;
   - `<ship>/.blueprint-uploaded` names the committed shas, so a live ship
     costs no call. A hull uploaded in the same run forces a re-commit.
3. A failed blueprint never fails the ship. A closed cost gate, a function
   without R2 or an older function (unknown action) stop the blueprint step
   for the rest of the run; the log ends with one `Blueprints: …` line.

Drawing a hull takes ~0.5-1 s (Gladius 36k triangles ~0.5 s, Reclaimer
86k ~0.8 s) on the main process, between two network calls.

## Drawing algorithm (`src/lib/blueprint/geometry.ts`)

Per view, at 1600 drawing units along the hull's longest side:

1. **Depth raster** — every triangle z-buffered (nearest surface wins), plus
   every vertex stamped, so a wing seen edge-on still covers its pixels.
2. **Silhouette** — the coverage mask, closed by one pixel, traced with
   marching squares (outer outline + holes, even-odd), Douglas-Peucker.
3. **Feature lines** — mesh edges that are
   - a *view contour* (one face toward the viewer, one away) → main line,
   - a crease over 62° → main line, over 28° → detail line,
   - an open panel border (used by one triangle) → detail line,

   sampled per pixel and kept only where nothing nearer covers them (depth
   test against the 3×3 neighbourhood) and not on the silhouette. Lines are
   drawn nearest-first into an occupancy grid, so the top and bottom rim of a
   vertical wall do not both survive. Visible runs are chained into
   polylines and simplified.
4. **Budget** — longest lines first, 9000 points per view (outline extra).

The `icon` LOD reuses the same analysis: the outline simplified harder and
the 48 longest main lines, scaled to 400 units — a low-resolution raster of
its own would stair-step the outline.

## File format (contract with the web and `ingest-skins`)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H"
     data-sc-blueprint="1" data-lod="full|icon" data-extent-m="L B H"
     fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <g class="bp-view" data-view="top|side"
     data-projection='{"frame":"gltf-y-up-metres","m":[[…4],[…4]],"box":[x,y,w,h]}'>
    <path class="bp-hull" fill-rule="evenodd" stroke-width="2" d="M…l…z"/>
    <path class="bp-major" stroke-width="1.2" d="…"/>
    <path class="bp-minor" stroke-width="0.6" stroke-opacity="0.7" d="…"/>
  </g>
</svg>
```

- Views: `top` looks down, `side` looks from starboard; **nose to the right**
  in both, starboard down in `top`. `full` has both views stacked on the same
  x axis, `icon` only `top`.
- `data-projection.m` maps a glTF model-space point (metres, +X starboard,
  +Y up, -Z nose — the hull GLB's and the asset package manifest's frame) to
  drawing units: `svg_x = m[0]·(x, y, z, 1)`, `svg_y = m[1]·(x, y, z, 1)`.
  CryEngine positions (`payload.hardpointTransforms`) convert as `(X, Z, -Y)`.
- Paths use only `M`, `l` and `z` with integers.
- Stroke defaults are presentation attributes, so the file also renders on
  its own (the samples in `docs/concepts/blueprint/`). The web never injects
  the file: `parseShipBlueprint` reads the paths and the projection, and the
  components draw them with the app's colour tokens.

## Storage

- R2: `ship-skins/_blueprints/<sha256>.svg`, content-addressed, served by the
  assets Worker `immutable` as `image/svg+xml` with
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.
  R2 only — no Supabase-bucket fallback.
- DB: `ship_skins.blueprint_path` / `blueprint_icon_path` on the hull rows
  (`model_path is not null`), exposed per ship by `ship_skins_index`
  (migration `20261003214512_ship_blueprints.sql`). The web reads the index
  once per session (`ShipBlueprintService`), so a ship without a drawing never
  costs a request.
- `blueprint_commit` reads both objects back: size (full ≤ 512 kB, icon
  ≤ 64 kB), sha256, UTF-8 and an allow-list of the generator's own markup
  (`svg`/`g`/`path`, fixed attributes, no entities, no text). A bad object no
  row links is deleted. A replaced drawing is deleted once no row links it.
- Sizes: full ~80-135 kB, icon ~2-3 kB.

## Samples and checks

```bash
cd data-uploader
npx esbuild scripts/blueprint-from-glb.ts --bundle --platform=node --format=esm --outfile=<tmp>/bp.mjs
node <tmp>/bp.mjs <out> gladius=<AEGS_Gladius hull.glb> reclaimer=<AEGS_Reclaimer hull.glb>
```

The committed samples in `docs/concepts/blueprint/` come from the live hulls
(`https://sc-assets.sc-assets-worker.workers.dev/ship-skins/AEGS_Gladius/standard.glb`,
`…/AEGS_Reclaimer/standard.glb`); `supabase/functions/ingest-skins/_blueprints.test.mjs`
checks them against the commit allow-list.

Web dev override: `localStorage['sc.shipBlueprints.devBase'] = '<folder url>/'`
with a `ship_blueprints.json` (`[{ship_id, blueprint_path, blueprint_icon_path}]`)
and the files those paths name (non-production builds only).
