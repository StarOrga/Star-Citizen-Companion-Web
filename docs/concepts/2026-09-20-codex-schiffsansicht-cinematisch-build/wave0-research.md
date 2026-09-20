# Wave 0 — Research: Codex ship page inventory, data pipeline, silhouette contract

(Persisted verbatim from the devops:research agent, 2026-09-20. Worktree: C:/Users/Jerem/IdeaProjects/Star-Citizen-Companion-Web/.claude/worktrees/devops-learn-einsatz-optimize-6bd7e8. All paths relative to it.)

## A · Inventory of today's ship page ("nothing lost" checklist)

Scope: `/codex/ship/:className` = `src/app/codex/codex-detail.component.ts` (4004 lines) plus the children it imports at `codex-detail.component.ts:284`. Not on the ship page: `codex-patch-headline`, `codex-status-banner`, `codex-zone-rail`, `codex-bridge`, `codex-board-*` (other codex routes).

Legend for "Gap": SC = size class, HHP = hull HP, MS = missile salvo, WIE = per-weapon IR/EM, FL = flight stats.

| # | Region | Info or function | File:line | Data source | Notes |
|---|---|---|---|---|---|
| 1 | Crumb row | Back link "← codex.detail.back" to `/codex` | codex-detail.component.ts:289 | RouterLink | anchor |
| 2 | Crumb row | Data pill `codex.detail.dataPill {build,n}` = `patchVersion-channel.buildNumber` + schema version; `.pending` + `codex.detail.dataPillPending` when re-extract pending; tooltip `codex.detail.dataPillAria` | :291-295, :3049-3057 | `svc.build()` → `isReExtractPending(schemaVersion)` | Concept round 2 hv-s3: schema/current info admin+collaborator only, viewers see patch version only |
| 3 | Crumb row | Fallback provenance `codex.provenance.build {channel,patch,build}` + tooltip `codex.provenance.tooltip` | :296-300, :2183 | `provenance()` | |
| 4 | States | Loading skeleton / error card `codex.error.title` / `codex.detail.notFound` | :303-308 | `loading()`, `error()`, `detail()` | |
| 5 | Stage (hero) | Hero art `sc-fallback-image` candidates `heroArt()`, alt = `displayName()`; fallback icon + `codex.detail.noArtwork` | :340-345, :2206 | `heroArt()` | |
| 6 | Stage | Live 3D on the stage: `sc-ship-skin-viewer [embedded]=true` with `hardpointPorts`, `activePorts`, events `hovered`, `locatable`, `available` | :329-338 | `shipClassName()`, `hardpointPortRefs()` :2735 | 3D loads the ship-skins glb |
| 7 | Stage | 2D⇄3D toggle (`aria-pressed`, `codex.detail.heroView2d/3d`, `heroSwitchTo2d/3d`), only when `has3dView()` | :355-370, :1661-1678 | `heroView3d`, `has3dView` | |
| 8 | Stage foot | Eyebrow "Manufacturer · Role" | :389, :3066-3070 | `manufacturerName()`, role chip | |
| 9 | Stage foot | `<h1>` display name | :390, :2159 | `displayName()` | |
| 10 | Stage foot | Chips: career, crew `codex.detail.chipCrew {n}`, cargo (3 states: `n SCU` / `chipCargoUnknown` gap / `chipNoCargo` ghost), mass `t` | :393-401, :3072-3116 | `ShipPayload.career/cargoScu/cargoStatus/hull.mass`, `row.role/crew_size` | SC gap: size-class chip skipped :3082-3084 |
| 11 | Stage foot | Module census chips (count + `labelKey` + optional `detailKey {n}`), `aria-label codex.detail.equipment` | :409-421, :3785 | `stageCounts()` | |
| 12 | Stage actions | Pin/compare toggle ★/☆ `codex.compare.pinned` / `codex.detail.actionCompare` | :522-525 | `isPinned()`, `togglePin()` | Concept drops the compare button — conflict with "no function lost" → open Q4 |
| 13 | Stage actions | Factory loadout (discard draft) `codex.detail.actionFactoryLoadout` | :526-528, :2590 | `discardLoadoutDraft()` | |
| 14 | Stage actions | Copy share link `codex.detail.actionCopyLink` + toast `codex.detail.linkCopied` | :529-534, :2579 | `copyShareLink()` → clipboard, URL carries `?loadout=` | |
| 15 | Stage actions | Switch ship anchor → `/codex?kind=ship` `codex.detail.actionSwitchShip` | :536-538 | RouterLink | concept replaces with search/hangar bar |
| 16 | Tool row | Edition picker `<details>` `codex.editionPicker.label/standard/count`, anchors to `/codex/ship/<slug>` with `aria-current` | :547-567, :1732-1734 | `editionOptions()`, `currentEdition()` | |
| 17 | Tool row | Skin/livery picker `<details>` `codex.skinPicker.label/standard/count` | :568-588, :1722-1724 | `skinOptions()`, `currentLivery()` | distinct from ship_skins 3D liveries |
| 18 | Tool row | `<code>` classNameSlug | :589 | `detail().classNameSlug` | |
| 19 | Tool row | Add to hangar `quickSearch.addToHangar` (hidden when in hangar) | :591-595, :1651 | `HangarService`, `inHangar()` | |
| 20 | Tool row | RSI link: pinned pledge link or fallback RSI listing; `codex.detail.viewOnRsi` | :602-612, :1710-1718 | `pledgeLink()` = my link ?? global | |
| 21 | Tool row | Ship-link form toggle (auth users) `codex.shipLink.add/edit` | :613-617 | `auth.user()` | |
| 22 | Ship-link form | URL input, save/remove/cancel, errors `codex.shipLink.error.*`, saved, hint | :622-654 | `ShipLinkService.saving()` | |
| 23 | Ship-link form | Admin-only promote/unpromote global link `codex.shipLink.adminTitle/promote/unpromote/adminHint` | :655-670 | `role.isAdmin()` | red-accent rule applies |
| 24 | Rank card | `sc-codex-rank-card`: radar SVG, sr-only axis list, legend, verdict `codex.rank.verdict {pct,band,n}` + percentile tooltip, profile radio chips (disabled with reason), scope `<select>` (sizeClass disabled, all, career), scope hint, bar list with `—` gap dashes, `codex.rank.lensNote` | codex-rank-card.component.ts:60-157; detail :677-686 | `rankResult()`, `rankProfile`, `rankScope`, `rankDisabledReasons()`, `rankCohortLoading()` :2969-3027 | SC gap (`[sizeClass]="null"` :679) |
| 25 | KPI band | `sc-codex-kpi-band [cells]`; cells per active mission from stock vs current sheet; tooltips `codex.kpi.tooltipBurstDps/SustainedDps` | codex-kpi-band.component.ts:23; detail :698, :2963 | `kpiCells()` ← `buildKpiStrip` (codex-kpi-sets.ts) | full cell catalogue per mission not enumerated (kpi-sets.ts) |
| 26 | Mission bar | Mission chips `all, combat, transport, travel, stealth, mining, salvage` (`codex.mission.*`), label, reset `codex.mission.lensReset`; capabilities gate chips; changed count | codex-mission-bar.component.ts:30-55; codex-mission.ts:88-142; detail :700-704 | `activeMissionId`, `shipCapabilities()`, persisted `loadStoredMission/storeMission` (:111-113) | mission reorders + folds sections (:3223-3225) |
| 27 | Draft bar | `sc-codex-loadout-save-bar`: draftLabel/draftChanged(Plural)/draftNotice/draftDiscard/draftApplyAndSave, changesSummary/unsaveableHint/saving; events save / discard / addAndSave | codex-loadout-save-bar.component.ts:38-72; detail :705-714 | `draftChangedCount()`, `saveableEntries()`, `saving()`, `saveError()`, `inHangar()` | save → hangar_ship_configs |
| 28 | Draft persistence | Draft mirrored to URL `?loadout=<encoded>` AND `localStorage[LOCAL_DRAFT_STORAGE_KEY]`; URL wins; ignored on ship/build mismatch | :2602-2650 | `encodeDraftParam`, `serializeLocalDraft`, `restoreDraft` | share link = this URL |
| 29 | Loadout column | Heading `codex.detail.columnLoadout` + count + `sc-info-note` (`loadoutExplainerLabel/hardpointExplainer/moduleOrderHint`) | :730-747 | `moduleCount()` | |
| 30 | Loadout column | 2D hull map `sc-ship-hardpoint-map [markers][frame][activePorts] (hovered)` — only when extract carries coordinates | :754-760, :2669-2725 | `payload.hardpointTransforms` + `payload.hardpointFrame` | box schematic, no outline |
| 31 | Loadout column | `sc-codex-hardpoint-layout` primary sections: sections/order/folded/occupants/locatable/active; events reverted, hovered, inspected, swapRequested | :761-771 | `primaryModuleSections()` :3184 | |
| 32 | Layout: section | `<details>` per section (merged "Antrieb & Systeme" with subs), heading `codex.moduleSection.<sec>`, census, fixedTag, split/group toggle, fold preview chips | codex-hardpoint-layout.component.ts:316-411 | LayoutSection | open state via `(toggle)` |
| 33 | Layout: section notes | `sec.notes[]` translated with params | :417-419 | SectionNote | |
| 34 | Layout: row (occupied) | Card button: size badge, item name, role tag, meta, damage-channel tags, grade, stat chip, headline figure (`codex.module.total`, value, unit, delta ±), port label, secondary stats `<dl>` with `n×`, derived `*`, hint ⓘ, `noStats`, `statsNoteKey` | :435-511 | LayoutSlot | hover/focus emits port for map highlight :425-426 |
| 35 | Layout: row (empty, swappable) | "open bay" button, `codex.swap.pickHere` | :512-534 | `emptySwappable` | |
| 36 | Layout: row (empty, static) | static label | :535-550 | | |
| 37 | Layout: draft state | tag `codex.loadout.draftState.{changed,pending,unresolved}` + revert ↺ `codex.loadout.revert` | :554-563 | `draftState`, `draftPaths` | |
| 38 | Layout: row tools | ⓘ inspect `codex.inspect.openStats`, ⇄ swap `codex.swap.open` (configurable only) | :570-579 | | |
| 39 | Layout: children | Nested sub-slots (gun in gimbal, missiles in rack) with badge/name/meta/damage/grade, figure, port, stats, ⓘ, empty kid pickable or static | :592-690 | `LayoutChild` via `childrenFor` :3397 | sub-port ids are the mount's own itemPorts |
| 40 | Analysis column | Heading `codex.detail.columnAnalysis` + "3" | :778-782 | | Concept: 4 tiles (4th Signatur & Kühlung) |
| 41 | Offensive panel | `<details>` title, readHint, noStockGuns gap, weapon table (colWeapon/Size/Alpha/Sustained/Burst, total), damage-channel split, effective range, projectile speed, longestGunNote, mixedRangeWarning, missiles salvoDamage/lockTime/range/targeting/slowestMissileNote; collapsed when mission folds weapons | codex-analysis-panels.component.ts:144-250; detail :783, :3211, :3225 | `offensivePanel()` | MS: salvo row exists |
| 42 | Defensive panel | shield hp/regen/fullIn/regenDelay/downedDelay/mixedGeneratorNote, gap noShields; resistance per channel, gap noResistances; hull row gap noHullMass; armor physical/energy/distortion/penetration/deflection, noArmorData; effectiveHp / effectiveHpGap | :294-347; detail :784 | `defensivePanel()` | HHP gap :330 |
| 43 | Ship panel | flight (scm/max/boost/pitch/yaw/roll, `codex.hull.flightMissing`), mass (equipped mass, massEquipmentNote), systems (quantum speed/range/spool, quantum fuel, hydrogen), signature (IR, EM idle/max gap noEmissionModel; cross-section x/y/z gap noSignature + crossSectionNote), hull (dimensions L×W×H, crew, hull HP gap) | detail :3228-3306; panel :383-386 | `shipPayload().flight/stats`, `dimensions()`, `techStats()`, `currentKpiSheet()` | FL gap (build-diff.ts:8-10), HHP, ship IR/EM |
| 44 | 3D section | Full `sc-ship-skin-viewer` below columns when stage is 2D; livery selector inside viewer | :809-819 | `shipClassName()` | ship-skin-viewer internals not read |
| 45 | Fixed systems | "Zelle & feste Systeme" `codex.detail.columnFixed` + count, show/hide empty ports toggle `showEmptyPorts/hideEmptyPorts {count}`, layout with tail sections | :827-850, :1684 | `tailModuleSections()`, `hiddenEmptyCount()` | |
| 46 | Description | `codex.detail.description` + text | :854-859 | `description()` :2176 | |
| 47 | Ammunition | damage bars per channel `codex.damage.<ch>` | :899-912 | `damage()` | kind-dependent |
| 48 | Key stats / weapon params / armor | grouped stat grids `codex.detail.keyStats/weaponParams/armorStats`, `codex.statGroup.*` | :915-963 | `componentStatGroups()` | mostly non-ship kinds |
| 49 | Hardpoints (structural) | `codex.detail.hardpoints` + count + hint; groups `codex.portCategory.*`, expandable port rows (size range, type chips), hover highlight, compat list lazy-load with anchors to `/codex/<kind>/<slug>` + chips | :966-1034, :1756-1757 | `hardpointGroups()` :3826, `compat()` | |
| 50 | Crafting | `codex.detail.craftedFrom` recipe + ingredients + `openBlueprint`; `usedInBlueprints` | :1037-1085 | `recipe()`, `usedInBlueprints()` | ship: normally absent |
| 51 | Spec / raw | toggles `showFullSpec/hideFullSpec`, `showRaw/hideRaw`; spec tables + provenance; raw JSON `<pre>` | :1088-1120, :2356-2357 | `specSections()`, `rawJson()` | |
| 52 | Energy dock | `sc-codex-energy-dock` sticky: title, budget used/total (overBudget), position radio group, minimise/expand; re-extract gap tags; minimised strip (IR, EM, cross-section, cooling %, readiness); pip stacks per group (click = allocate, arrow keys, aria-pressed, top-off), group toggle with tooltip, grp-state; facts with tooltips + delta chips; heat gauge (coolingPercent/coolingValue, gap noCoolingData); readiness ✓/✕; footer modes radio (`codex.energy.mode.*`), presets stealth/auto/reset; draftNote; gap noReactorData; state in localStorage + URL power param | codex-energy-dock.component.ts:117-350, :1041-1102; detail :1127-1134; contracts spec :9-16 | `draftSummaryOccupants()`, `shipPayload().stats`, `crossSectionMax()`, `currentUserId()`; emits `sheetChange` → `powerSheet` | Concept it.10: energy summary into expanded strip panel; Schleichen as preset |
| 53 | Compare tray | floating `sc-codex-compare-tray`: tray/remove/open/close/clear/mixedKind/showAll/diffOnly/property/noCommon, ship anchors | codex-compare-tray.component.ts:46-119; detail :1138 | pinned set | |
| 54 | Component modal | ⓘ sheet: damage tags, hardpoint/close/parameters/general/projectile/noStats/openDetail, Esc closes | codex-component-modal.component.ts:72-265; detail :1142, :3641-3659 | `inspected()` | |
| 55 | Swap picker | modal: title {port,size}, installed / installedNone, appliesToMany/One, clear slot, close, fitInferred hint, loading/failed/none, search, scope segmented (compareWith), baseline segmented (deltaAgainst, previewHint), type filter, count, column chooser, sortable/filterable table via `sc-column-menu`, row pick, equipped tag, bars + optimum marker, delta cell, scroll cues, filter chips, sort hint; column prefs in localStorage | codex-swap-picker.component.ts:176-414, :809-827 | `swapTarget()` (raw `port`) :2366-2373; `onSwapPicked` :2442 | |
| 56 | Weapon detail | sheet: intro, close/Esc, rows physical/energy/distortion/thermal/biochemical/stun, fireRate, projectilesPerShot, projectileSpeed, lifetime, range, alpha, burstDps, sustainedDps, penetration, IR/EM online, powerDraw, hp, distortion pool/regen, mass, size, grade, itemClass, itemPorts, factoryFit, aimYaw/aimRate, spread, recoil, magazine, overheat; `[href]` | codex-weapon-detail.component.ts:55-320; detail :1144, :3646 | `weaponDetail()` | WIE: rows exist (:262-268); fixture 0 for a repeater |
| 57 | Hover sync | one `activePorts` signal shared by list rows, 2D map markers, 3D hotspots; `locatablePorts` = union extract coords + glb locators | detail :2750-2786 | | Holotable pins must join this signal |
| 58 | Keyboard | Esc closes modal/picker/weapon detail; Enter/Space picks row; ArrowUp/Down steps pips; Esc dismisses dock tooltips | component-modal :265, weapon-detail :155, swap-picker :182/:344, energy-dock :125/:210-211 | | |
| 59 | i18n | all keys under `codex.*` in `public/i18n/{de,en}.json`; `src/app/codex/i18n-keys.spec.ts` guards them | | | new keys go to both files |

Not covered: `ship-skin-viewer.component.ts` template, `codex-kpi-sets.ts` full cell catalogue, `codex-compare.service`, `codex-loadout-draft.ts` nested path separator.

## B · Uploader + data pipeline facts

**3D model / skin extraction.** `data-uploader/python/sc_extract/hull3d.py:1-21`: P4K → `.cga` + `.cgam` + paint `.mtl` + DDS (scdatatools) → `cgf-converter -embedtextures` → textured glb → `gltf-transform optimize` → web glb ~3 MB, one per skin. `ship_discovery.py` builds `ShipSpec {ship_id, hull_cga, objectdir_anchor, paints[]}` (:96-103). Ids `[A-Za-z0-9_-]+` (:44-51).

**Upload path.** `data-uploader/src/main/skin-ingest.ts:96-230`: edge fn `ingest-skins` `{action:'sign', ship_id, objects}` → signed URLs → PUT `.glb`/`.webp` → `{action:'commit', ship_id, skins:[...]}` (`supabase/functions/ingest-skins/index.ts:10-15`). Object path `<ship_id>/<skin_id>.<ext>` (:17-19, :182). Bucket `ship-skins`: public read, 25 MB, mime glb/webp (`supabase/migrations/20260603_ship_skins.sql:16-29`). Table `public.ship_skins(ship_id=codex_ships.class_name, skin_id, name, description, source, name_verified, model_path, icon_path, model_bytes, sort)` unique `(ship_id, skin_id)` (:32-46); RLS authenticated read, service-role write (:55-62); public read via `20260710190000_public_codex_read.sql`.

**Format reaching the server.** GLB + WebP in storage; JSON catalog rows via `ingest-catalog` batched ops `init/upsert/ports/clear_ports/ingredients/strings/locale_strings/preview/finalize` (`supabase/functions/ingest-catalog/index.ts:10-20`). Preview art base64 webp → bucket `codex-previews/<build>/<name>` (:251-266). Nothing from Data.p4k itself is uploaded.

**Per-port identities.** Extractor `dataforge_extract.py:1313-1314` `_item_ports(comps)` → `payload.itemPorts[].portName`, `_default_loadout(comps)` → `payload.defaultLoadout[].itemPortName`; CryEngine helper strings that also survive as glb node names (`src/app/codex/glb-hardpoints.ts:5-11`). DB `codex_item_ports` columns `build_id, channel, patch_version, build_number, parent_class_name, parent_kind, port_name, min_size, max_size, types, flags, port_index, helper_name, position, rotation` (`ingest-catalog/index.ts:66-71`). Web `LayoutTarget.port` → `SwapTarget.port` (`codex-detail.component.ts:2366-2373`); nested sub-ports `isNestedPath/topSegment` (:175-185); hangar `loadout[].portName` joins `codex_item_ports.port_name` (`20260613000000_hangar.sql:71-73`). Sub-slot ids from the mount item's own `itemPorts` (`codex-detail.component.ts:3397-3418`).

**Existing geometry / hardpoint position data — three sources:**
1. Extract: `geometry.py:1-45` reads hull `.cga` (Ivo chunks): AABB → `dimensions`, NAME/NODE tables → world transform of helper nodes. `hardpoints.py:1-27, :121` (`resolve_hardpoint_transforms`) joins ports to helpers by exact name; emits `hardpointTransforms {port → {position[x,y,z] m, rotation quat, helper, source}}` (max 512, :42) + `hardpointFrame {min,max,source}`. Into `codex_ships.payload` (`dataforge_extract.py:1315-1361`) and per item port (`:1321-1326`; `20260726220000_ship_hardpoint_transforms.sql:31-41`). Axes +X starboard, +Y nose, +Z up.
2. Web 2D: `hardpoint-map.ts:11-16, :149-166` projects to top (x=X, y=1−Y) and side views in 0..1; `ship-hardpoint-map.component.ts` draws a box schematic (no outline).
3. Web 3D: `glb-hardpoints.ts:1-28` reads locator nodes from the glb at runtime → `<model-viewer>` hotspots.
**No silhouette/outline exists anywhere** (grep `silhouette|top_down|topdown` in `data-uploader/`: none). Only bounding boxes.

**Hangar schema.** `20260613000000_hangar.sql`: `hangar_ships(user_id, ship_class_name, custom_name, status owned|wishlist, pinned_rank 1..3, selected_skin_id, notes)` unique `(user_id, ship_class_name)` (:33-49); `hangar_ship_configs(hangar_ship_id, name, role enum combat|mining|salvage|cargo|exploration|racing|medical|multipurpose, loadout jsonb [{portName,className,kind}], is_active)` one active per ship (:62-82); `hangar_role_loadouts` (:98-120); RLS self-only CRUD (:22-25, :130-147, :155-167); `hangar_concept_ships` (`20260711001000`). **No share model in DB**: sharing = URL `?loadout=` + localStorage (`codex-detail.component.ts:2602-2650`) + power params (`codex-model-contracts.spec.ts:9-16`). Pledge links: `user_ship_links` (`20260724130000`) via `ShipLinkService`, admin promote. Follow/fork share semantics + loadout variants (concept it.2/3) — none exist.

**Build / patch history.** `00008_codex_catalog.sql:67-91`: `codex_builds(channel, patch_version, build_number unique, schema_version, is_current, quality_score, tool_version, entity_counts, manifest, extracted_at)`; one current per channel (:85-86); `set_current_codex_build(uuid)` (:324-336) called by `ingest-catalog finalize` (:304-312). Every `codex_*` row keyed `(channel, patch_version, build_number, class_name)` (:58, :132); old builds never pruned (`codex-build-diff.ts:3-4`) → two builds comparable by SQL today; only implemented diff = `CodexService.ownedFleetDeltas` on ship-row flight+crew (`codex-build-diff.ts:5-12, :52-60`), renders nothing because flight is null. Detail page reads only `svc.build()` (current) — no patch selector (`codex-detail.component.ts:3034`). Re-extract flag `isReExtractPending(schemaVersion)` (:3055).

**Alpha data policy.** Root `CLAUDE.md`: schema rewrites may drop legacy tables (except `auth.users` + `profiles`); document drops. Recent migrations self-declare additive (`20260603:10`, `20260613:27`, `20260726220000:3-5`).

Two pipelines: `ingest-catalog` vs `ingest-skins` (memory `sc-codex-two-pipelines`); skin glb build is a separate cached step (`dataforge_extract.py:1362-1364`).

## C · Silhouette contract proposal

### C1 · JSON produced by the uploader, consumed verbatim by the website

```jsonc
{
  "schema": 1,
  "shipClassName": "DRAK_Cutlass_Black",
  "build": { "channel": "LIVE", "patchVersion": "4.9.0", "buildNumber": "..." },
  "generatedAt": "2026-09-21T10:00:00Z",
  "toolVersion": "0.31.0",
  "source": {
    "hullCga": "Data/Objects/Spaceships/Ships/DRAK/Cutlass/DRAK_Cutlass_Black.cga",
    "method": "glb-topdown-raster-trace",
    "modelSpace": "cryengine:+X right,+Y nose,+Z up",
    "frame": { "min": [x,y,z], "max": [x,y,z], "source": "bbox" }
  },
  "silhouette": {
    "viewBox": "0 0 1000 1000",
    "noseUp": true,
    "path": "M ... Z",
    "bbox": { "x": 120, "y": 40, "w": 760, "h": 920 },
    "scaleMPerUnit": 0.0323,
    "pointCount": 312, "simplifyToleranceM": 0.15
  },
  "anchors": [
    { "portId": "hardpoint_gun_left", "x": 31.2, "y": 42.7, "side": "port", "depth": 0.31, "source": "helper", "helper": "hardpoint_gun_left", "clamped": false }
  ],
  "unresolved": ["hardpoint_shield_generator_2"]
}
```
Rules: no client-side projection (uploader emits the %); `source.frame` + existing `payload.hardpointTransforms` stay as audit trail. Anchors derive from the same join `hardpoints.py` already does with the projection of `hardpoint-map.ts:160-161`, so anchors exist for every ship that already has `hardpointTransforms` — the silhouette path is the only new artefact.

Silhouette derivation (new uploader code): (a) project all triangles of the mesh to XY, union, trace outer contour, simplify; (b) rasterise XY projection to 1024² mask and trace contours (opencv `findContours` + `approxPolyDP`), keep outer contour + holes. Recommend (b). Input: raw hull `.cga` via cgf-converter output before texture/simplify (ships without paints still get a silhouette) — open Q1.

### C2 · Where it lives — recommendation

| Option | Pros | Cons |
|---|---|---|
| A. keys in `codex_ships.payload` | zero migration | path adds KB to every list/detail fetch; not separately cacheable |
| B. **new table `codex_ship_silhouettes`** `(build_id fk codex_builds, channel, patch_version, build_number, class_name, view_box, path text, bbox jsonb, anchors jsonb, unresolved jsonb, meta jsonb, generated_at)` unique on the natural key | build-scoped like every codex_* table; additive; fetched only by the Holotable view; RLS mirror codex_* | one migration + one ingest op |
| C. bucket `ship-silhouettes/<class>.json` | CDN cached | no build scoping; two sources of truth |

**Recommendation: B.** Migration `supabase/migrations/2026MMDDHHMMSS_codex_ship_silhouettes.sql` (additive). Ingest: extend `ingest-catalog` with ops `silhouettes` (pinned columns like `PORT_COLUMNS` at `ingest-catalog/index.ts:66-80`) and `clear_silhouettes` (mirror of `clear_ports` :268-274), driven from `data-uploader/src/main/catalog-bridge.ts` as one more catalog phase (`src/lib/catalog-phases.ts`). Same auth gates (:26-32), same forward-compat degrade (:230-238). Web: `CodexService.shipSilhouette(className)` current build only; pure module `src/app/codex/holo-silhouette.ts` validates like `readHardpointFrame`.

### C3 · Website behaviour when the silhouette is missing / partial

- `silhouette == null` or row absent → neutral placeholder (ring/box in the frame's aspect if `frame` exists, else 1:1) — never a generic ship shape. Pins in group rings by `ShipModuleSection`, each ring labelled; badge `codex.holo.noGeometry` next to the 2D/3D switch with tooltip reason (`notExtracted` / `noHullMesh`).
- Silhouette present, ports in `unresolved[]` → pins in their group ring at the silhouette edge, dashed, tooltip `codex.holo.pinUnresolved`.
- Ports absent from both `anchors` and `unresolved` → same as unresolved.
- Hover/active via the existing `activePorts` signal (`codex-detail.component.ts:2783-2786`).
- 3D toggle independent (depends on `ship_skins.model_path`).

### C4 · Known data gaps to render as "—" with a reason

| Gap | Where today | Origin |
|---|---|---|
| Size class | rank scope `sizeClass` disabled (rank-card :125-127), no chip (:3082-3084), `[sizeClass]="null"` :679 | extractor never emits one (`dataforge_extract.py:1327-1365`) |
| Hull HP | `codex.summary.gap.noHullMass` (:3301; analysis-panels :330) | `_hull_stats` (`dataforge_extract.py:1341-1346`) |
| Flight stats | `codex.hull.flightMissing` (:3260); diff renders nothing (`codex-build-diff.ts:8-10`) | extractor ships null (`dataforge_extract.py:1338-1341`) |
| Ship IR / EM | `codex.summary.gap.noEmissionModel` (:3283-3288) | no scalar ship emission fields |
| Cross-section | `codex.summary.gap.noSignature` (:3292) | only after re-extract (`dataforge_extract.py:1300-1305`) |
| Cargo SCU | `chipCargoUnknown` (:3106-3107) | open beds |
| Missile salvo / lock / range | analysis-panels :230-250 | missile ammo payload |
| Per-weapon IR/EM | weapon detail (:262-268), picker cols | 0 vs missing must be distinguished (`swapResourceStats` :49-51) |
| Reactor / cooling | `codex.energy.gap.*` (energy-dock :175-180, :281, :315) | occupant resource stats missing |
| Shields / resistances / armor | analysis-panels :303, :325, :342, :347 | missing occupant payloads / `ARMR_<Ship>` absent (`dataforge_extract.py:1347`) |
| Stock guns | `noStockGuns` (:159-160) | no nested fit for the mount |
| Equipped mass | `noEquipmentMass` (:3264) | occupants without mass |
| Hardpoint positions | 2D map hidden (:754, :2719-2725) | catalog ingested before uploader re-run (`20260726220000:5-9`) |

## Open questions for the user

1. Silhouette source: raw hull `.cga` (every ship) vs. already-built web glb (only ships with `ship_skins.model_path`)?
2. Anchors ownership: uploader emits final % only — leave the existing 2D `sc-ship-hardpoint-map` untouched (strict) or switch it to the same anchors?
3. Storage: new build-scoped table `codex_ship_silhouettes` + `ingest-catalog` ops (recommended) vs keys in `codex_ships.payload`?
4. Compare / switch-ship buttons: concept discards them, rule "no function lost" — keep reachable in the Holotable or accept the loss for this view?
5. Patch selector + build diff: in scope (needs `CodexService` build-scoped fetch + occupant diff) or follow-up?

## Decisions taken by the user (2026-09-20, after Wave 0)

1. **Silhouette source = raw hull `.cga`** for every ship. ADDITIONALLY: the uploader also derives silhouettes for **weapons, components and armor items** (every catalog entity with a mesh) and the website uses them as the image of those entities' **tile view** (Kachelansicht) when no preview art exists / alongside it. Styling (SCC web style as in the concept: cyan outline, soft glow, smoothing/denoising of the contour) is applied by the uploader itself — the website only renders the delivered path.
2. **Storage = new build-scoped table** (`codex_silhouettes`: `kind` + `class_name` keyed, so ships and items share one table) + `ingest-catalog` ops `silhouettes` / `clear_silhouettes`. Additive migration.
3. **Compare (★ pin + tray) and "Schiff wechseln" are NOT in the Holotable view** — loss accepted for this view; the alt/neu switch keeps them reachable in the classic view.
4. **Patch selector + Δ view is IN scope**: build-scoped detail fetch in `CodexService`, diff over KPIs / ports / perspectives, admin-only schema rows in `--sc-accent-hot`.
5. (from strict) the existing 2D `sc-ship-hardpoint-map` stays untouched.
