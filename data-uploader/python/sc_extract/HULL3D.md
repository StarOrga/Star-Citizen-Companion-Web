# 3D Hull + Skin Export (`hull3d.py`)

Turns a ship's CryEngine geometry + paint materials from `Data.p4k` into
**web-ready, textured glTF — one `.glb` per skin**. Data is **100% from the P4K**;
the only external pieces are *build tools* (geometry converter + glTF optimizer).

## Pipeline

```
Data.p4k
  ├─ DRAK_Cutlass_Black.cga + .cgam   (whole-ship hull mesh — no socpak assembly!)
  ├─ <paint>.mtl                      (one per livery, in .../Cutlass/Cutlass_Black/)
  └─ referenced *.dds (+ split mips)  (scdatatools collect_and_unsplit)
        │
        ▼  cgf-converter v2.0.0  -glb -embedtextures -objectdir <root> -mtl <paint>
   textured glb  (~155 MB, full-res)
        │
        ▼  glb_materials repair  (no-op skin · paint tints · interior strip)
        ▼  gltf-transform optimize  (weld · simplify · webp@512 · draco, no palette)
        ▼  over the per-skin budget? re-optimize at 256
   web glb  (≤0.6 MB)  ──►  <model-viewer> in the Angular app (lazy-loaded route)
```

Plus per skin: the official store **icon** (`Data/UI/SharedAssets/PaintColorLogos/
Paint_Cutlass_*_Icon.dds` → WebP) and the official **name/description**
(`Data/Localization/english/global.ini`).

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
(`internal_*`, `Int_*`, `*_INT`, `*interior*`). The Showroom is an exterior
viewer, so this geometry is never seen — but on the Cutlass it is ~26 % of the
triangles and the majority of the texture payload (the interior POM/decal
atlases are the largest images in the file). Set `strip_interior=False` to keep
it.

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
  ├─ models/DRAK_Cutlass_Black_<skin>.glb   (~0.6 MB each, lazy-load these)
  ├─ icons/<skin>.webp
  └─ skins.json                             (name · desc · source · model · icon)
```

## Status

- **Generalised**: `ship_discovery.py` pattern-matches the P4K layout to build a
  `ShipSpec` for **any** ship (hull `.cga` + paint `.mtl` + icons). Run it via
  `python -m sc_extract.ship_export --ship <id:MFR:Ship:SeriesToken>` (or the
  events-emitting `skin_export_app`, which the desktop "3D-Skins" view spawns).
- **Reference pilot**: `cutlass_pilot.py` keeps the original Cutlass Black wiring
  with skin locations hand-checked — useful as a known-good baseline.

## Cost / knobs

- ~155 MB intermediate glb per skin (scratch, auto-deleted unless `--keep-work`).
- `--texture-size` (default 512) and `simplify_error` (0.002) trade size vs. fidelity.
- One skin ≈ texture-extract (~2–3 min) + convert + repair + optimize, serial.
  Measured end-to-end on the LIVE `DRAK_Cutlass_Black` standard finish: 189 s.

## Size budget (`--max-model-mb`, default 0.6)

The whole livery catalog has to fit the Supabase storage quota, so each web glb
carries a **per-skin size budget**. A skin that lands over budget is re-optimized
down a quality ladder — texture halves, `simplify_error` doubles — until it fits:

```
512 / 0.002  →  256 / 0.004   (floor: MIN_TEXTURE_SIZE)
```

How big is "the whole catalog"? Measured against the live `codex_ships` rows of
the current build (`payload->'skins'`), not estimated: **314 ships, 302 of them
with at least one livery, 1729 liveries listed, 391 of those material-backed**
— i.e. ~391 glbs is a full build.

The Supabase free plan gives 1 GB of file storage *in total*, and the other
buckets already hold ~831 MB (news-images 809 MB, codex-previews 2.1 MB,
feedback-images 0.3 MB), so **ship-skins has ~150 MB to work with**:

| per-skin glb | full catalog (391 skins) | fits ~150 MB? |
| --- | --- | --- |
| 3.01 MB — shipped, 1024 px, spec-gloss kept | ~1.18 GB | no, by 8× |
| 2.11 MB — after the spec-gloss strip alone | ~825 MB | no |
| 0.64 MB — + 512 px + interior strip | ~250 MB | no |
| **0.39 MB — + the 256 px ladder step (current default)** | **~151 MB** | **yes** |

All four rows are measured on the LIVE `DRAK_Cutlass_Black` standard finish, not
modelled. The quality cost of the last row is texture resolution (256 px) and
~51 k triangles instead of 273 k — acceptable for a 320 px-tall viewer stage,
and the ladder still lets a light ship keep 512 px.

Icons are noise by comparison (~11 kB WebP each, ~4 MB for the catalog).

Most skins pass at step 0, so **only the heavy ones lose fidelity** rather than
the whole catalog being exported at a blanket-low resolution. If even the last
step is over budget the skin is still exported (a too-big skin beats a missing
one) and a `warn` is logged. `--max-model-mb 0` disables the budget entirely.

Each retry costs one more `gltf-transform optimize` pass over the ~155 MB raw
glb — the P4K texture extract and cgf-converter step are *not* repeated.
