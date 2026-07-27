# Codex Showroom — 3D Ship Liveries as a First-Class Destination

**Date:** 2026-07-26
**Status:** Design — awaiting review
**Branch:** `claude/3d-models-skins-codex-4b98b2`

## Problem

The team can extract real, textured 3D models of ships wearing their in-game
**liveries** (paint jobs) and render them interactively in the browser. The whole
pipeline already exists end-to-end and works:

- Uploader (`data-uploader/python/sc_extract/hull3d.py`) → `.glb` + `.webp` per skin.
- `ingest-skins` edge function → `ship_skins` table + public `ship-skins` bucket.
- `ShipSkinViewerComponent` renders `.glb` via `@google/model-viewer`.

**But it is invisible.** The viewer only appears buried inside a single ship's
detail page. Live DB state (LIVE build 4.9.0):

| Fact | Value |
|---|---|
| Liveries in DB | 7, all with `.glb` |
| Ships covered | 1 (Drake Cutlass Black) |
| LIVE ships total | 313 |
| Join integrity | clean, 0 orphans |

A user browsing the Codex would never discover that 3D models exist. The genuinely
special asset is hidden, and the sparse coverage (1/313) makes any naïve
"which ships have 3D" grid read as 312 broken slots.

## Goal

Make 3D liveries a **discoverable, valued, and delightful** part of the Codex —
scaling gracefully from 1 ship today to 100+ as coverage grows, without ever
looking empty or broken.

## Naming & Metaphor (decided)

- **Showroom** — the new **public, datamined, info/browse** surface for liveries.
  Route `/codex/showroom`. This is reference content, not owned content.
- **Hangar** — already exists (`src/app/hangar/*`) as the user's **own/imported
  RSI fleet**. NOT reused here; the two must stay distinct.
- **Holo-Bay** — a **visual/animation style layer** (holo-projector materialization,
  in-fiction ASOP/viVid aesthetic), applied in the Showroom viewer and built
  **reusable** so the personal Hangar can later adopt the same 3D look.

## Data Provenance — hard guardrail

**All livery/skin data flows exclusively through the data-uploader →
`ingest-skins` pipeline, build-scoped.** No manual seeding, no one-off inserts via
Claude Code / the Management API, no hardcoded ship or livery counts anywhere. Every
number the Showroom shows (livery count, ships covered, "newly modeled") is
**derived at read time** from whatever the uploader has populated for the current
LIVE build. This keeps the catalog version-accurate patch over patch: when the
uploader ingests a new build, the Showroom reflects it automatically with zero code
or data changes. The only data-shaping code we touch is *inside the uploader itself*
(U1/U2), which runs at extract time — never a direct DB write from this app or this
session.

## Core Reframe (from the rethink)

Four independent code-blind lenses (product-value, ux-design, enduser-feel,
architecture) converged on one idea:

> **Treat 3D not as a per-ship feature, but as a curated, livery-first destination.**

- The countable unit is the **livery**, not the ship. Say "7 liveries in 3D",
  never "1 of 313 ships". A gallery of 7 rotating paint jobs is lush; a 1/313
  coverage meter is an embarrassment.
- **Sparse coverage is the exhibit, not a gap.** A museum with one masterpiece
  builds a lit room around it; it does not hang 312 empty frames.
- **Provenance is the collector hook.** `ship_skins.source`
  (`store|event|subscriber|factory|pu_npc`) already exists — surface it as
  rarity/origin ("2019 Subscriber", "Store paint", "Factory default").
- **The heavy 3D download must be gated behind explicit intent** and staged as a
  holo-materialization so the multi-MB fetch *feels* like the wow, not a stall.

## Architecture — Two Planes, One Build Key

The load-bearing rule: **never let one data path serve both "what exists" and
"render the thing".** Two planes that never share a query, URL, or cache bucket.

### Discovery plane (cheap, metadata only)

Answers "which ships have 3D liveries in the current build, and how many?" — knows
livery names, ship slug, source flags, and the **poster (webp) URL**. It **never**
references, resolves, or carries a `.glb` URL. Small forever (hundreds of rows).

- **New DB view `ship_skins_index`** (plain view, not materialized — the dataset is
  tiny; a view stays trivially fresh and needs no refresh step):
  ```sql
  -- one row per ship that has ≥1 livery, joined to the current LIVE build's
  -- codex_ships for the display name. Poster = the first available icon.
  create view public.ship_skins_index as
  select
    s.ship_id,
    count(*)                              as livery_count,
    count(s.model_path)                   as model_count,
    min(s.icon_path) filter (where s.icon_path is not null) as poster_path,
    array_agg(distinct s.source)          as sources,
    max(s.created_at)                     as latest_added
  from public.ship_skins s
  group by s.ship_id;
  ```
  Ship display names + build scoping are joined **client-side** against the already
  fetched `codex_ships` set (the Codex service already resolves the current LIVE
  build), so the view stays build-agnostic and dependency-free. RLS: inherits the
  public read already granted on `ship_skins` (anon SELECT).
- **New `ShowroomService`** (`providedIn:'root'`) — a brand-new service; the
  existing `HangarService` (personal fleet) is untouched. Two reads only:
  - `listShowroomShips()` → `ShowroomShipCard[]` (gallery feed; poster + counts + sources)
  - `hasLiveries(shipId)` → derived from the same cached list (badge probe; no extra fetch)

### Asset plane (heavy, intent-gated)

The multi-MB `.glb` bytes and the ~1 MB `@google/model-viewer` runtime. Reached
**only** by an explicit user act inside one ship's viewer. The **only** place a
`.glb` URL is resolved and the **only** place the 3D lib is imported (already
lazy-imported today — keep that boundary).

- `ShipSkinsService.listSkins(shipId)` stays as the per-ship manifest (already
  carries `model_path`, `icon_path`, `model_bytes`).
- **Invariant:** a grep for `@google/model-viewer` or `.glb` must only ever hit the
  viewer boundary. Structurally enforced, not hoped for.

## Surfaces

### S1 — Showroom route `/codex/showroom` (P1)

Livery-first browse destination. Reads only the discovery plane (posters, no glb).

- **Spotlight hero** — one featured livery, large poster, "View in 3D" CTA (loads
  geometry only on click). Rotates as coverage grows.
- **"Newly modeled" rail** — dated cards (from `latest_added`); the freshness signal
  that brings regulars back.
- **Gallery** — livery-first cards: each card is one paint job (poster webp),
  tagged by source (Pirate/Subscriber/Store/Factory), with ship + manufacturer as
  metadata. Filters: source, manufacturer, ship. Looks curated at 7, proper at 200.
- **"Coming to the Showroom" rail** — ships that have liveries in the Codex but no
  `.glb` yet, shown with their **existing 2D preview art** (never greyed boxes).
  Framed as roadmap/momentum.
- **Empty/sparse states** owned here; structurally cannot look broken (renders only
  what exists + one curated teaser rail).

### S2 — Bridge billboard lane (P1)

A single cinematic hero lane on the Codex Bridge — the current spotlight livery as a
looping poster (no live WebGL, near-zero cost). Copy: "New: rotate real ship liveries
in 3D — N liveries ready." One CTA → the Showroom. This is the top billboard so
discovery is passive, not a click nobody makes.

### S3 — "Holo-Ready" badge (P1)

A distinct 3D/holo glyph on ship cards and ship-detail for ships that have models
(reads `hasLiveries`, from the shared cached list). Reads as prestige/rarity, so the
312 without it feel "not yet", never broken. Ships without models show nothing
broken — at most a quiet "3D coming later" line.

### S4 — Holo-Bay viewer v2 (P2)

Elevate `ShipSkinViewerComponent` into a reusable `HoloBayViewerComponent`
(`sc-holobay-viewer`), keeping the lazy `@google/model-viewer` import inside it.

- **Livery filmstrip** — swatch strip; tapping a livery **hot-swaps the texture on
  the already-loaded geometry** (instant, no reload). The core delight: pirate →
  subscriber → factory feels like flipping a collector's card. *(Requires the viewer
  to load a shared base model + swap material/texture, or preload sibling glbs on
  hover intent — evaluated at plan time; fallback is current per-glb switch.)*
- **Holo materialization loader** — the poster shows instantly and "materializes"
  (wireframe → solid dissolve) into the live model once geometry arrives. The
  skeleton is always the poster, never a blank spinner.
- **Environment presets** — Studio / Hangar / Deep-space starfield; one tap changes
  mood (model-viewer skybox/lighting). Cheapest possible wow.
- **Fullscreen inspection mode** — edge-to-edge, ship floating; where phones become
  worth it.
- **Compare two liveries** — split turntable with synced camera (reuses the compare
  mental model, for paints).
- **Mobile gestures** — one-finger orbit w/ momentum, pinch-zoom, two-finger pan,
  horizontally-scrolling filmstrip, visible chip controls (no hover-only), light
  haptic tick on swap.
- **Provenance card** per livery — source/rarity + verified badge (data already present).

### S5 — Delight (P3)

- **Hangar Photo Mode** — shutter captures current angle + livery into a clean,
  framed "hangar card" (ship name, livery name, manufacturer mark, optional user
  handle), sized for Reddit/Discord. Degrades to unstamped for anonymous users.
- **Deep-link / share** — a URL encodes ship + livery (+ camera preset); reopening
  restores that exact view. Every share is a discovery loop back into the app.
- **Favorite a livery** — lightweight, optional, auth-after-delight (never a login
  wall on the core wow).

## Uploader-side fixes (implemented directly, this work)

### U1 — Truthful size budget (not "force ≤1 MB")

`hull3d.py` sets `max_model_bytes = 1_000_000`, but the quality ladder only halves
**textures**, never mesh geometry, and the docstring itself says "~3 MB". Actual
uploads are 2.6–3.5 MB. Forcing 1 MB would crush textures on a **showcase hero
asset** — wrong.

Fix: set a **truthful, showcase-quality budget** (~4 MB) that preserves texture
fidelity, and reconcile the contradiction in `HULL3D.md` (the "≤1 MB" claim). The
heavy load is acceptable because the two-plane architecture gates it behind explicit
intent + a poster. *(If a genuinely smaller model is wanted later, that's mesh
decimation / meshopt — a separate quality tradeoff, out of scope here.)*

### U2 — Livery name quality

Some names are auto-derived and ugly ("Cutlass Graffiti Rr", `name_verified=false`).
Improve the fallback name derivation in `ship_discovery.py` (smarter title-casing,
strip trailing noise tokens) and/or widen the localization lookup so more names come
back `name_verified=true`. The frontend already renders a "verified" badge.

### U3 — Poster fallback for icon-less skins

2 of 7 skins have no `.webp` icon. Discovery/gallery needs a deterministic poster
fallback: prefer the skin's own icon → else the ship's Codex `previewImage` → else a
generated holo placeholder. Handled in `ShowroomService` (frontend), no uploader
change required, but documented here so the empty case is never a broken card.

## i18n

Extend `codex.skins.*` and add a `codex.showroom.*` block (DE + EN) for: showroom
title/subtitle, spotlight, newly-modeled, gallery filters, coming-soon rail, badge
label, viewer environments, compare, photo-mode, share. No hardcoded UI strings.

## Testing

- **Discovery plane** — `ShowroomService` spec: list mapping, `hasLiveries`,
  poster-fallback chain, empty-catalog vs error discrimination (mirror existing
  `ship-skins.service.spec.ts`).
- **View** — a migration + a query test that `ship_skins_index` returns 1 row for the
  current data and 0 for an empty table.
- **Viewer v2** — component specs for filmstrip swap, materialize states, fullscreen
  toggle, compare mode; mobile-gesture smoke.
- **Uploader** — pytest for the budget config truthfulness and the name-derivation
  helper (`PYTEST_DISABLE_PLUGIN_AUTOLOAD=1`, per repo convention).
- **Light verification** — browser snapshot of `/codex/showroom` at desktop + mobile
  once P1 lands (per `deep-knowledge/test-plan.md`).

## Non-Goals (explicit YAGNI)

- ❌ No full 313-ship 3D grid or "coming soon" placeholder cards for every ship.
- ❌ No auto-loading `.glb` on the Bridge, gallery scroll, or ship-page open.
- ❌ No geometry reload per livery swap where avoidable.
- ❌ No ownership/wishlist/store links, no purchasing (reference app).
- ❌ No user-generated custom paints / configurator save.
- ❌ No VR/AR, no model download/export.
- ❌ No XP/coins/levels/achievements — favoriting + optional "paint of the week" are
  the only light game-layer, both quiet and optional.
- ❌ No login wall on the core rotate/inspect wow (auth only after delight).
- ❌ No materialized-view refresh engine / CDC — a plain view suffices at this scale.

## Phasing (each phase = its own shippable PR)

- **P1 — Foundation (discovery):** `ship_skins_index` view + `ShowroomService` +
  `/codex/showroom` gallery + Bridge billboard lane + Holo-Ready badge + poster
  fallback + i18n. **Solves discoverability.** Small, clean.
- **P2 — Holo-Bay viewer v2:** filmstrip instant-swap, materialize loader,
  environments, fullscreen, compare, mobile gestures; reusable component.
- **P3 — Delight:** Photo Mode, deep-link share, favoriting.
- **U — Uploader fixes:** U1 (truthful budget + doc), U2 (name quality). Can land
  alongside P1 or P2.

Per the "design first, then ask" decision, implementation of each phase is confirmed
before it begins.
