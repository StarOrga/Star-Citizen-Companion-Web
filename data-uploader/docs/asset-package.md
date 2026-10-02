# 3D asset package (ships, FPS weapons)

A **ready-to-display** 3D package per entity, built at upload time by the
Python extractor (`data-uploader/python/sc_extract/assets3d/`). The web only
loads GLBs and shows/hides them — no geometry math, no name matching, no
second coordinate system.

```
root GLB (hull / weapon body) + shared part GLBs + optional interior GLB
                              + manifest (package.json) that places every part
```

## On disk (export `--out`)

| Path | What | Keyed by |
|---|---|---|
| `<ship_id>/models/<ship_id>_<paint>.glb` | hull — unchanged hull3d contract | ship |
| `_parts/<sha256>.glb` | one geometry-only part per distinct item mesh, shared by every entity | content sha256 |
| `_parts/index.json` | cache: geometry path → sha/bytes/bounds/error (`_format: part-geometry-v1`) | geometry path |
| `_interiors/<sha256>.glb` | optional interior layer (`--interior`) | content sha256 |
| `<ship_id>/package.json` | the manifest | ship |

Uploaders (Wave 2) store blobs by sha256 and rewrite nothing: the manifest
already refers to every GLB by sha256 (`root.sha256`, `interior.sha256`,
`parts{sha}`, `placements[].partSha256`).

## Pipeline

| Stage | Module / entry point | Output (typed) |
|---|---|---|
| 1 EXTRACT | `datacore.DataCoreSource(df, reader)` — `.entity(cls)`, `.default_loadout(cls)`, `.helpers(geo)` | `EntityDef`, `LoadoutEntry` |
| 2 RESOLVE | `entity.resolve_entity(root, loadout, source, extra_ports=())` | `ResolvedPort` (CryEngine space, root-relative world matrix) |
| 3 EXPORT | `parts.PartStore(...).export(geometry_path, material_path)` / `package.export_parts(resolved, store)` | `PartRef` (sha256, bytes, bounds) |
| 4 ENRICH | `enrich.enrich(resolved, root, {geometry_path: sha})` | `Placement` rows (glTF space, groups, codex refs, port metadata) |
| 5 PACKAGE | `package.build_package(kind, root, loadout, source, store, root_glb, ...)` → `PackageResult`; `manifest.validate_manifest(m)`, `manifest.write_manifest(m, path)`; `package.check_locators(m, root_glb)` | `Manifest` |

Ship-only wiring lives in `assets3d/ships.py` (`vehicle_ports` — port
sizes/types from the vehicle implementation XML, `export_interior`,
`build_ship_package`). CLI: `python -m sc_extract.skin_export_app … --package
[--interior]`; the `done` event gains `ships[].package` (bytes, placements,
locator check) and a run-level `packages` summary (dedup ratio, cache hits).

### FPS weapons (Wave 2) — the intended call

```python
from sc_extract.assets3d.datacore import DataCoreSource, P4KReader, load_datacore
from sc_extract.assets3d.parts import PartStore
from sc_extract.assets3d.package import build_package
from sc_extract.assets3d.manifest import write_manifest

reader = P4KReader(p4k); src = DataCoreSource(load_datacore(reader), reader)
store = PartStore(out / "_parts", reader.read, reader.exists, converter, optimize, out / "_work_parts")
weapon = src.entity("behr_rifle_ballistic_01")
body = store.export(weapon.geometry_path, weapon.material_path)      # root GLB, deduped
res = build_package("fps_weapon", weapon, src.default_loadout(weapon.class_name),
                    src, store, store.path_of(body.sha256) if body.sha256 else None)
write_manifest(res.manifest, out / weapon.class_name / "package.json")
store.save_index()
```

`optimize` is any `(in_glb, out_glb, texture_size, simplify_error) -> None`
that runs `gltf-transform optimize` (today `Hull3DExporter._optimize`).
Attachments (optics, barrels, underbarrels, magazines) land in group
`attachments` via their `AttachDef.Type`.

## Manifest (`schemaVersion: 1`)

Canonical schema: `sc_extract/assets3d/manifest.schema.json`; typed mirror:
`sc_extract/assets3d/manifest.py` (`Manifest`, `Placement`, …); a test keeps
both in step.

| Field | Meaning |
|---|---|
| `kind` | `ship` \| `fps_weapon` |
| `coordinateSystem` | always `gltf-y-up-metres` |
| `entity` | `{className, guid}` — `codex_items.class_name` + DataCore GUID |
| `root` | `{sha256, bytes, bounds{min,max}}` or null |
| `interior` | `{sha256, bytes}` or null (lazy layer, same space as root) |
| `parts` | `{sha256: {bytes, geometryPath, bounds}}` — only parts this entity places |
| `placements[]` | every port, parents before children |

Placement: `id` (port path `a/b`, unique), `portName`, `helperName`,
`parentPort` (id or null), `group`
(`weapons|missiles|components|attachments|interior|other`), `itemClass`,
`itemGuid`, `itemType`, `itemSubType`, `itemSize`, `parentClass`
(`codex_item_ports.parent_class_name`), `port` (`{minSize, maxSize, types,
flags, editable}` or null — `types` is the compatible set), `loadout`
(`default` \| `empty`), `partSha256` (or null), `position` `[x,y,z]`,
`rotation` `[x,y,z,w]` (both null = not placeable).

**Transforms are absolute** (root-relative, every parent already composed).
A viewer puts each part GLB under the root with `position`/`rotation` as-is —
it must NOT nest it under its parent placement. `parentPort` is for
show/hide cascades and labels only.

## Coordinates

Everything after EXTRACT works in glTF space. Helper transforms come from
`DataCoreSource.helpers(geometry_path)`: first the `.cga` chunk scan
(`geometry.helpers_from_cga_bytes`, CryEngine `+Z`-up, converted
`(x, y, z) → (x, z, −y)` in `assets3d/transforms.py`), and — because on LIVE
4.x that scan finds no nodes for ships or items — otherwise the node tree of
the cgf-converter output (`PartStore.helpers`, cached per geometry path in
`_parts/index.json`). That tree is what the published GLBs are built from, so
part origins and placements share one space by construction.

Every build checks root-level placements against the hull GLB's own locators
(`scenes[].extras.hardpoints`, written by hull3d from its separate conversion):
they must coincide within 1 cm (`package.check_locators`, reported per ship).
LIVE 4.x: Gladius 61, Cutlass Black 113, Arrow 57 locators, max error 0.1 mm.

## Policy

Geometry only — no CIG texture ever leaves the P4K (RSI Fankit FAQ);
`glb_materials.strip_to_geometry` raises instead of shipping a textured part.
Parts are optimized with simplify + meshopt like the hull.
