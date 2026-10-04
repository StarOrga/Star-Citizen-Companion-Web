# 3D Hull Export (`hull3d.py`)

Turns a ship's CryEngine geometry from `Data.p4k` into **one web-ready,
geometry-only glTF per ship**, plus the official store icon of every paint.
Data is **100% from the P4K**; the only external pieces are *build tools*
(geometry converter + glTF optimizer).

## Why geometry only (since uploader 0.37.0)

Every object in the public `ship-skins` bucket can be downloaded by anyone. The
RSI Fankit & Fandom FAQ forbids uploading CIG content "for … download by others"
and says CIG is "not fine with taking assets from our games … and distributing
those separately"; the ToS (XIII.B/C) forbids copying RSI content without
written permission. Fan viewers CIG has tolerated for years show the *shape* as
a hologram (RSI's own holoviewer, SC-Holoviewer, myfleet) — not the textured
asset. So the published glb carries the shape only and the web viewer draws it
as a hologram (`src/app/codex/ship-hologram.ts`). Liveries are shown through
their official store icon.

It also ended the grainy hull of 2026-09-23: the textured Avenger Stalker had
57 % of its triangles on a 256 px tiling `greeble` atlas and 20 % on no
material at all — the converter's submaterial mapping against a *paint* `.mtl`
is not reliable enough to publish textures from.

Enforced on three levels: `strip_to_geometry` raises instead of letting a
texture through, `skins.json` carries `"format"` (`geometry-v2` since the
hardpoint extras, see below) so a cached build of an older pipeline is rebuilt, and `ingest-skins` signs no glb for an uploader
older than 0.37.0 and prunes every row/object a ship's commit no longer lists.

## Pipeline

```
Data.p4k
  ├─ DRAK_Cutlass_Black.cga + .cgam   (whole-ship hull mesh — no socpak assembly!)
  └─ <paint>.mtl                      (the factory paint — only to name the submaterials)
        │
        ▼  cgf-converter v2.0.0  -glb -objectdir <root> -mtl <paint>
   raw glb
        │
        ▼  glb_materials repair  (no-op skin · interior strip · strip_to_geometry)
        ▼  gltf-transform optimize  (weld · join, no simplify, no palette)
        ▼  [gltf-transform simplify --lock-border, only on a budget retry]
        ▼  hole gate  (mesh_integrity vs. the raw mesh — refuses a gappy hull)
        ▼  gltf-transform meshopt
   web glb  ──►  <model-viewer> in the Angular app, rendered as hologram
```

Plus per paint: the official store **icon** (`Data/UI/SharedAssets/PaintColorLogos/
Paint_Cutlass_*_Icon.dds` → WebP) and the official **name/description**
(`Data/Localization/english/global.ini`). The hull hangs off the factory paint's
catalog entry; every other paint is an icon-only row.

The sections below describe the repair steps. Section 2 (layered paint
materials) documents the textured era; its values are no longer published.

## Post-conversion repair (`glb_materials.py`)

The converter's output is *extracted* correctly but does not **render**
correctly. Two defects, both invisible in an offline glb dump and both only
visible in a spec-compliant viewer (three.js / `<model-viewer>`), produced the
white shapeless blob of admin feedback d7f44a41.

### 1. No-op rigid skin (geometry)

cgf-converter does not export a `.cga` node hierarchy as a node hierarchy — it
wraps it in a **skin**: every mesh node gets `"skin": 0`, every vertex is rigidly
bound (weight 1) to the joint that *is* its own node, and that joint's inverse
bind matrix is the exact inverse of the node's global transform. Every joint
matrix therefore evaluates to the identity.

glTF 2.0 §3.7.4 requires a renderer to **ignore the transform of a skinned mesh
node**, so `<model-viewer>` placed every sub-object at the scene origin.
Measured on the LIVE `DRAK_Cutlass_Black`:

| | world bounding box |
| --- | --- |
| node hierarchy (the truth, = the in-game 35.72 × 26.15 × 10.04 m) | 26.15 × 10.04 × 35.72 m |
| spec-compliant skinning (what the viewer drew) | 18.88 × 9.84 × 23.78 m |

Wings, tail and engines pile into the fuselage; the decal planes stick out as
detached slivers. The vertex data was never wrong — only its placement.
`strip_noop_skins` deletes a skin **only** when all 209 joint matrices are the
identity (i.e. it deforms nothing); a skin with a real bind pose is kept and the
reason logged. Dropping the skin also unblocks `gltf-transform optimize`, whose
`flatten`/`join` passes skip skinned meshes.

### 2. Layered paint materials (colour)

A ship's paint is not in texture slots. The painted panels use the `HardSurface`
shader with an **empty** `<Textures/>` block; the colour lives in `<MatLayers>`
as a layer `.mtl` plus `TintColor` / `GlossMult`:

```xml
<Material Name="Paint_Secondary" Shader="HardSurface" Diffuse="1,1,1">
  <Textures />
  <MatLayers>
    <Layer Name="Primary" Path="Materials/.../drak_lf_paintedpanels_a_clean.mtl"
           TintColor="0.012983,0.012983,0.012983" GlossMult="0.548"/>
```

cgf-converter ignores `MatLayers` and emits `baseColorFactor = [1,1,1,1]`. On the
Cutlass those submaterials are **~42 % of the hull triangles**, so the ship came
out pure white — and `gltf-transform optimize`'s `palette` pass then merged all
of them into a single untextured `PaletteMaterial001`, cementing it. Hence
`--palette false` in the optimize flags.

`parse_paint_mtl` + `patch_glb_materials` fold the layer values back in:
`baseColorFactor` = `Diffuse` × Primary `TintColor`, `roughnessFactor` =
`1 - GlossMult` (fallback `1 - Shininess/255`), `metallicFactor` = 1 only when
the layer library is a `*_metalpanels_*` material, alpha from `Opacity`. A
material the converter textured correctly is never second-guessed.

The pass also drops `KHR_materials_pbrSpecularGlossiness` (archived by Khronos;
three.js removed support in r165, so `<model-viewer>` 4.x ignores it) after
promoting its diffuse texture into `pbrMetallicRoughness`. The orphaned
spec/gloss textures are then pruned by `optimize` — worth ~30 % of the file
size on its own.

**Known limit:** a livery whose look comes from the runtime tint-palette /
`$TintPaletteDecal` decal system (e.g. Cutlass "Elysium") is *not* reproducible
from the `.mtl` — its paint submaterials are byte-identical to the standard
finish. Such liveries correctly render as the base hull; only liveries that
differ in `TintColor`/`GlossMult`/layer library (e.g. Gold Scale, Skull and
Crossbones) differ visually.

### 3. Interior strip

`drop_interior_geometry` removes primitives whose material is an interior one
(`internal_*`, `Int_*`, `*_INT`, `*interior*`) **and that no outside view can
see**. The name is only a hint: an interior-named material that covers more
than 0.05 % of the first-hit pixels from 26 directions around the ship is part
of the visible skin and is kept (`visible_interior_materials`). Measured on
LIVE: Cutlass Black `internal_pom` 2.4 %, `internal_structure` 0.46 %,
`Glass_INT` 0.11 %; Gladius `internal_mesh` 1.1 %, `glass_int` 0.27 % —
dropping them by name punched see-through holes into both hulls. An exterior
false positive is worse than leftover interior. Set `strip_interior=False` to
keep all of it.

### 4. Double-sided classes

`strip_to_geometry` marks the hull/glass/glow classes `doubleSided`. 2–4 % of
the pixels an outside view sees on a raw CIG hull are panels wound inward
(mirror-aware, glTF §3.7.4); a single-sided renderer culls them into dark
see-through patches.

## Hull integrity (`mesh_integrity.py`)

The hole gate. Reference = the raw converter glb after the un-rig, before any
strip, proxies excluded (`Hull3DExporter.raw_reference`). Both meshes are
splatted into first-hit depth maps from 26 directions (384 px); a pixel inside
the reference silhouette where the candidate shows nothing, or a surface more
than 1 % of the bbox diagonal behind, is a hole. `hole_ratio` = hole pixels /
reference pixels; also logged: open boundary edges and triangle counts.

| LIVE hull | old (simplify 0.002) | new (gated) |
| --- | --- | --- |
| AEGS_Avenger_Stalker | 0.31 % (worst view 2.2 %) | 0.03 % |
| AEGS_Gladius | 0.43 % (worst view 5.8 %) | 0.04 % |
| DRAK_Cutlass_Black | 1.05 % (worst view 4.1 %) | 0.06 % |

`max_hole_ratio` = 0.2 %. Every ladder rung is measured on the uncompressed
optimize output before `meshopt` (meshopt buffers are not decodable in Python).
If the first rung fails the hull is not exported (`HullIntegrityError`); if a
later rung fails, the last gap-free rung is kept even over budget.

## Why an external geometry converter?

`scdatatools` 1.0.4 cannot parse SC 4.x Ivo *mesh* chunks (unknown chunk-type
ids — see `geometry.py`). **Markemp/Cryengine-Converter v2.0.0** is the first
release that reads them; v1.7.1 fails silently (empty glb). It is a ~117 MB
self-contained .NET binary → fetched, never committed.

## Setup

```bash
python tools/fetch_tools.py          # downloads cgf-converter-2.exe to ./tools/
# @gltf-transform/cli is BUNDLED with the desktop app and run via Electron's own
# Node (ELECTRON_RUN_AS_NODE) — no global Node/npx needed at runtime. Plain
# `npx @gltf-transform/cli` is only the dev fallback when running outside the app.
```

## Run (Cutlass pilot)

```bash
python -m sc_extract.cutlass_pilot \
    --p4k "C:\...\StarCitizen\LIVE\Data.p4k" \
    --out ./out --converter ./tools/cgf-converter-2.exe \
    [--texture-size 512] [--limit 2]
```

Output:
```
out/DRAK_Cutlass_Black/
  ├─ models/DRAK_Cutlass_Black_<skin>.glb   (ONE geometry-only hull per ship)
  ├─ icons/<skin>.webp
  └─ skins.json                             (name · desc · source · model · icon)
```

## Status

- **Generalised**: `ship_discovery.py` pattern-matches the P4K layout to build a
  `ShipSpec` for **any** ship (hull `.cga` + paint `.mtl` + icons). Run it via
  `python -m sc_extract.ship_export --ship <id:MFR:Ship:SeriesToken>` (or the
  events-emitting `skin_export_app`, which the desktop "3D-Modelle" step spawns).
- **Reference pilot**: `cutlass_pilot.py` keeps the original Cutlass Black wiring
  with skin locations hand-checked — useful as a known-good baseline.

## Cost / knobs

- ~155 MB intermediate glb per ship (scratch, auto-deleted unless `--keep-work`).
- `simplify_error` (0 = none) is the first ladder rung; `--texture-size` is
  inert since the hull carries no texture.
- One hull = convert + repair + geometry strip + optimize, serial; no DDS is
  extracted any more.

## Speed (whole-catalog runs)

A LIVE 4.10 catalog run (271 ships) averaged ~8 min per ship one at a time —
~35 h. The same ships measured 25 s (parts cached) to ~4 min on an idle box.
What changed, none of it touching the output (each checked byte for byte
against the previous pipeline: hull glb, `package.json`, parts, interior):

- **Parallel ships** — `skin_export_app --workers N` builds N ships at once in
  spawned processes fed from one queue (0 = auto from cores and RAM; the
  uploader passes `skinWorkersFor(speed profile)`: minimal 1, standard 3 and
  maximum 4 on 12 threads). Each worker opens its own P4K + DataCore (~2–5 min,
  ~3 GB), so RAM caps the count (6 GB per worker). Workers write their own
  part index (`_parts/index.w<N>.json`, all read on start) and scratch dirs
  (`_work_w<N>`, `_work_parts_w<N>`); content-addressed files publish
  race-free (`parts.publish_blob`).
- **One conversion per mesh** — the hull's raw converter output also feeds
  the ship's node tree (port placement) and the interior layer; a parent item
  converted for its node tree keeps that raw glb for its own part export.
  Converter runs per ship halved (Freelancer: 92 → 46).
- **One optimizer process** — `gltf_worker.mjs` runs the gltf-transform CLI's
  command table in one long-lived Node instead of one Node per call (~0.6 s
  start-up each, two calls per part): optimize + meshopt for a 45-part ship
  60 s → 11 s. Falls back to one Node per call if it cannot start or dies;
  `SC_GLTF_WORKER=0` disables it.
- **Step timing** — every ship logs where its time went
  (`MISC_Fortune: 498s — hole-gate 227.8s/3 · interior-scan 56.3s/1 · convert …
  · other …`) and the run logs the sum. `~stdout-wait` books time the export
  sat blocked on a host that stopped reading its events.

The remaining big step is the hole gate (numpy, single-threaded per worker):
~40 s per checked rung on a 600k-triangle hull. It is a quality gate, not
overhead — make it faster, never coarser.

Note the uploader runs the export at below-normal priority on `standard`:
anything else busy on the machine (a game, a build, another heavy job) wins
the scheduler, and the export then waits at 0 % CPU. The step timing shows it
as `other`.

## Size budget (`--max-model-mb`, default 1.5)

Each web glb carries a size budget. A hull over budget is re-optimized up the
simplify ladder `0 → 0.0005 → 0.001 → 0.002` (border-locked) until it fits. The
hole gate is authoritative: a rung that tears the skin ends the ladder and the
last gap-free rung is kept, over budget or not. If even the last step is over
budget the hull is still exported and a `warn` is logged. `--max-model-mb 0`
disables the budget. 1.5 MB since the gap-free export: unsimplified hulls
measured 0.44 MB (Avenger Stalker) to 1.44 MB (Gladius) meshopt-compressed.
Simplification is why the old 0.6 MB budget held — and why the hulls had gaps.

Storage: hulls live in Cloudflare R2 (`ship-skins/` prefix, served by
`cloudflare/assets-worker`), not in the 1 GB Supabase quota the textured era was
sized against. One geometry-only hull per ship plus ~11 kB WebP store icons.

## Hardpoints (`geometry-v2`)

`optimize` (flatten + join + prune) removes every node without a mesh, so the
converter's locator nodes would not reach the web. `_collect_hardpoints` reads
them from the raw glb right after the un-rig, and every optimize attempt gets
them written back into its JSON chunk (BIN chunk untouched):

```
scenes[scene].extras.hardpoints = { "<node name as-is>": [x, y, z], ... }
```

- Nodes whose name matches `^(hardpoint|helper|hp)[_.]` (case-insensitive),
  reachable from the active scene; first wins on a duplicate name; at most 2000.
- World position in glb model space: metres, glTF Y-up, rounded to 4 decimals,
  non-finite skipped. This is the space `<model-viewer>` hotspots use.
- Valid after optimize because optimize never moves the scene: `flatten` bakes
  parent transforms into the mesh nodes and quantization only adds a dequantize
  transform on them. Checked with the real CLI on a rotated/translated
  hierarchy: the world bounding box before and after was identical.

## Shared hulls (`_hulls/<sha256>.glb`)

Variants often carry a byte-identical hull (8x `DRAK_Cutlass_Black_*`, 5x
`ANVL_Valkyrie_*`). The uploader sends each glb's SHA-256; `ingest-skins` (R2
mode) stores it once at `ship-skins/_hulls/<sha256>.glb` and points every
variant's `ship_skins.model_path` there. An existing shared object is never
re-signed or overwritten (`exists: true`), a commit is refused while its shared
hull is missing (409 `hull_missing`), a shared hull no row references yet
(= uploaded by this run) is read back and its SHA-256 checked against the path,
max 20 MB (409 `hull_hash_mismatch` / `hull_too_large`, object deleted), the per-ship prune only lists
`<ship_id>/`, and a shared hull is deleted only once no `ship_skins` row of any
ship references it. Ship ids starting with `_` are refused. Older uploaders (no
hash) keep the per-ship `<ship_id>/<skin_id>.glb` path.

**Deploy order:** deploy `ingest-skins` before releasing an uploader that sends
hashes. The reverse order is safe but dedups nothing: the old function ignores
`sha256` and answers with the per-ship path, which the new uploader falls back to.
