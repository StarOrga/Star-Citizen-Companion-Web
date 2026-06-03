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
        ▼  gltf-transform optimize  (weld · simplify · webp@1024 · draco)
   web glb  (~3 MB)  ──►  <model-viewer> in the Angular app (lazy-loaded route)
```

Plus per skin: the official store **icon** (`Data/UI/SharedAssets/PaintColorLogos/
Paint_Cutlass_*_Icon.dds` → WebP) and the official **name/description**
(`Data/Localization/english/global.ini`).

## Why an external geometry converter?

`scdatatools` 1.0.4 cannot parse SC 4.x Ivo *mesh* chunks (unknown chunk-type
ids — see `geometry.py`). **Markemp/Cryengine-Converter v2.0.0** is the first
release that reads them; v1.7.1 fails silently (empty glb). It is a ~117 MB
self-contained .NET binary → fetched, never committed.

## Setup

```bash
python tools/fetch_tools.py          # downloads cgf-converter-2.exe to ./tools/
# gltf-transform is pulled on demand via `npx` (Node required)
```

## Run (Cutlass pilot)

```bash
python -m sc_extract.cutlass_pilot \
    --p4k "C:\...\StarCitizen\LIVE\Data.p4k" \
    --out ./out --converter ./tools/cgf-converter-2.exe \
    --texture-size 1024 [--limit 2]
```

Output:
```
out/DRAK_Cutlass_Black/
  ├─ models/DRAK_Cutlass_Black_<skin>.glb   (~3 MB each, lazy-load these)
  ├─ icons/<skin>.webp
  └─ skins.json                             (name · desc · source · model · icon)
```

## Status

- **Pilot**: Cutlass Black, skin locations wired explicitly in `cutlass_pilot.py`.
- **Next**: generalise discovery (auto-find each ship's hull `.cga` + paint `.mtl`
  + icons via the DataCore) so it runs for every ship in the P4K.

## Cost / knobs

- ~155 MB intermediate glb per skin (scratch, auto-deleted unless `--keep-work`).
- `--texture-size` (default 1024) and `simplify_error` (0.002) trade size vs. fidelity.
- One skin ≈ texture-extract (~2–3 min) + convert + optimize. Runs are serial.
