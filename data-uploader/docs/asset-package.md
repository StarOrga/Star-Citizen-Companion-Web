# 3D asset package (ships, FPS weapons, ship items)

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
| `_fps/<WeaponClassName>/package.json` | FPS weapon manifest (root = weapon body in `_parts/`) | weapon class |
| `_items/<ItemClassName>/package.json` | standalone ship-item manifest (root = the item's part in `_parts/`) | item class |

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

### FPS weapons (`kind: "fps_weapon"`, `assets3d/fps.py`)

A personal weapon's `SGeometryResourceParams` points at a **`.cdf`**
(CharacterDefinition), not a `.cga`: skeleton `.chr` + `CA_SKIN` meshes (the
body) + `CA_BONE` `.cgf`s hung on bones. So:

| Piece | Source |
|---|---|
| root GLB (weapon body) | every `CA_SKIN` `.skin` (model space) + every `CA_BONE` mesh at bone × `RelPosition/RelRotation`, merged into ONE part by `PartStore.export_composite(cdf, …)` → `_parts/<sha>.glb`, cached under the `.cdf` path in `_parts/index.json`. Ammo/shell bindings (`…/ammo/`, `…/shells/`) are skipped. Single-mesh weapons (`.cga`/`.cgf`) use `PartStore.export`. |
| port helpers | the **bones** of the `.chr` (`#ivo` `CompiledBones` chunk `0xC2011111`, 68-byte records, world pose; `fps.bones_from_chr`) — `sight_attachment`, `magAttach`, `barrel_attachment`, `underbarrel_attachment`. The converter's `.skin` node tree only carries deforming bones, so it cannot supply them. |
| attachments | ordinary `.cgf` parts via `PartStore.export` — one GLB per attachment geometry, shared by every weapon (and every tint). Their origin is the attach point, so the bone transform places them directly. |
| ports | `SItemPortContainerComponentParams.Ports`, minus interaction helpers (`item_grab`: no types, size 0). Every slot is listed: the default attachment where the loadout has one, otherwise `itemClass: null`, `loadout: "empty"` with `port.types` (e.g. `WeaponAttachment.IronSight`), `minSize`/`maxSize`, flags. Compatible attachments are NOT pre-placed. |

Codex refs: `entity.className`/`guid` = `codex_weapons.class_name`/`guid`
(`weapon_class = 'FPS'`); an attachment placement's `itemClass`/`itemGuid` =
`codex_items.class_name`/`guid`, `itemType`/`itemSubType`/`itemSize` =
`codex_items.attach_type`/`sub_type`/`size` (e.g. `WeaponAttachment` /
`IronSight` / 3).

Which weapons (`fps.fps_weapon_classes`, default of `--fps`): records under
`scitem/weapons/fps_weapons/` (not `…/dev/`; melee/throwables/mines live in
sibling folders), class name passing the codex's `_is_catalog_entity`
(drops template/test/placeholder/AI/NPC tokens), `AttachDef.Type ==
WeaponPersonal`, body geometry present in the P4K. Tint/paint variants are
their own classes; their geometry dedups in `_parts`.

No locator cross-check for FPS (`locators: null`): the bones ARE the
placement source and the body GLB carries no independent locator set.

### Standalone ship items (`kind: "item"`, `assets3d/items.py`)

Components, ship weapons, missiles, racks and gimbals on their own (item
detail page). The root is the item's OWN part — `PartStore.export(item
geometry)`, i.e. the very `_parts/<sha>.glb` a ship package's placement for
that item references (`partSha256`), so nothing is stored twice and the web
links "docked in ship" ↔ item page via `partSha256` / `itemClass`; per-part
`bounds` (for hover highlight) sit in the ship manifest's `parts{}`.
Placements are the item's own ports (rack → missiles, gimbal → gun), same
enrichment as everywhere. They are filled from the ITEM's own default
loadout. Most racks and every gimbal on LIVE 4.x have none (the ship's loadout
fills them), so a standalone `Mount_Gimbal_S3` or `MRCK_S03_AEGS_Sabre_Firebird`
lists its ports as empty slots. Self-filled examples:
`MRCK_S05_BEHR_PDC_Missile_16_S1` (16 missiles) and `AEGS_Idris_K_Turret_Large`.
LIVE 4.x default set: 1356 items. FPS: 387 weapons pass the record rule and
360 of them have a convertible body (60 distinct bodies). The other 27 have a
`.cdf` without a skin or bone mesh and are skipped. Default set (`items.item_classes`): records under
`scitem/ships/`, `_is_catalog_entity`, `AttachDef.Type` in `items.ITEM_TYPES`
(WeaponGun, WeaponMining, WeaponDefensive, Turret, TurretBase,
MissileLauncher, Missile, Torpedo, Bomb, BombLauncher, Shield, PowerPlant,
Cooler, QuantumDrive, JumpDrive, Radar, QuantumInterdictionGenerator, EMP,
TractorBeam, TowingBeam, SalvageHead, MiningModifier), geometry present.

### CLI

```
python -m sc_extract.skin_export_app --p4k … --out … --converter … \
    --fps [--weapon <class|glob> …] --items [--item <class|glob> …] [--max-packages N]
```

Ship flags are independent (`--ship`/`--manifest` may be omitted). `--max-packages`
caps each glob (or the whole kind when no filter is given). The `done` event
gains `fpsPackages` / `itemPackages`: `[{className, manifestPath (relative to
--out), bytes (manifest), rootSha256, rootBytes, partBytes, parts, placements,
withPart}]`; `packages` (dedup summary) counts every entity of the run.

Generic changes made for FPS (backwards compatible): `PartStore.export_composite`
+ `parts.merge_glbs` (multi-mesh part), `PartStore._publish` (shared tail of
`_build`), `datacore.port_types_with_subtypes` (port `types` now
`Type.SubType` — ships' DataCore ports gain subtypes too, matching the
vehicle-XML ports), manifest kind `item`.

## Manifest (`schemaVersion: 1`)

Canonical schema: `sc_extract/assets3d/manifest.schema.json`; typed mirror:
`sc_extract/assets3d/manifest.py` (`Manifest`, `Placement`, …); a test keeps
both in step.

| Field | Meaning |
|---|---|
| `kind` | `ship` \| `fps_weapon` \| `item` |
| `coordinateSystem` | always `gltf-y-up-metres` |
| `entity` | `{className, guid}` — DataCore class name + GUID: `codex_ships` / `codex_weapons` (FPS + ship guns) / `codex_components` / `codex_items` `.class_name` + `.guid` |
| `root` | `{sha256, bytes, bounds{min,max}}` or null |
| `interior` | `{sha256, bytes}` or null (lazy layer, same space as root) |
| `parts` | `{sha256: {bytes, geometryPath, bounds}}` — only parts this entity places |
| `placements[]` | every port, parents before children |

Placement: `id` (port path `a/b`, unique), `portName`, `helperName`,
`parentPort` (id or null), `group`
(`weapons|missiles|components|attachments|interior|other`), `itemClass`,
`itemGuid`, `itemType`, `itemSubType`, `itemSize`, `parentClass`
(`codex_item_ports.parent_class_name`), `port` (`{minSize, maxSize, types,
flags, editable}` or null — `types` is the compatible set, `Type.SubType` per accepted
subtype, e.g. `WeaponAttachment.IronSight`), `loadout`
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

## Upload (Wave 2b)

Code: `src/main/asset-package-ingest.ts` (transport), `src/lib/asset-package.ts`
(planning, retry, concurrency), edge function `ingest-skins` actions
`package_sign` / `package_commit` (`supabase/functions/ingest-skins/_packages.ts`).
`skin_export_app` is always spawned with `--package --interior`; `--fps` only
when the request sets `fps` (off until the extractor flag is on the release).

R2 keys (under `ship-skins/`): `_parts/<sha>.glb`, `_interiors/<sha>.glb`,
`_manifests/<sha256 of the manifest bytes>.json`; a ship's hull stays in
`_hulls/<sha>.glb` (hull flow, uploaded before its package). Manifests are plain
JSON: the Worker streams R2 bytes as stored and a presigned PUT does not carry a
`Content-Encoding`, so compression is left to the edge.

Per entity: skip when `.package-uploaded` holds the manifest sha, or when the
server says `unchanged` (the `asset_packages` row already names it); otherwise
`package_sign` (<= 200 objects, hex sha256 + exact bytes, per-kind size limits)
-> `exists` objects are not PUT, the rest go with 4 parallel PUTs and 3 retries
(500 ms, 1 s, 2 s) -> `package_commit`, which re-reads the manifest, checks its
hash, derives every column from it and verifies each object it names is stored
at the declared size (409 `package_object_missing` / `_size_mismatch` /
`manifest_*`). `known` shares stored shas across entities of one run. Needs
uploader >= 0.41.0 (426 otherwise) and R2 mode (501 `r2_required`). FPS
packages are picked up from `<out>/_fps/<className>/package.json`.

Orphan parts after a manifest change are left in place (see storage.md).

## Policy

Geometry only — no CIG texture ever leaves the P4K (RSI Fankit FAQ);
`glb_materials.strip_to_geometry` raises instead of shipping a textured part.
Parts are optimized with simplify + meshopt like the hull.
