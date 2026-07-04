# Reconciled Approaches — Codex Rethink

*Date: 2026-07-03 · Step 5 output (fresh-phase approaches evaluated against the real codebase).*

## Headline: the three lenses converged

Three code-blind agents (product-value, ux-design, enduser-feel) independently landed on
the **same direction**: kill the filter-list front door; open on **one focal hero object**
(the user's own ship if logged in, else the patch's featured ship) in a diegetic
**mobiGlas / holo** frame; make **compare = "bring a second object alongside"**; make
**loadout = the same surface with hardpoints unlocked**; keep **search as a fast "scanner"**
and **demote filters to an opt-in secondary mode**. That convergence is a strong signal the
direction is right — the three surviving proposals are *intensity variants of one idea*,
not rival ideas.

## What the codebase says (reconciliation facts)

**Survives wholesale (no rewrite):**
- `CodexService` — list/detail/ports/`getCompatibleItems` RPC/locale/`previewUrl`.
- Provenance: `codex_builds` (patch_version, build_number, extracted_at, quality_score).
- Personalization inputs: `hangar.service`, `getShipsByClassNames`, `resolveEntities`.
- Compare state: `_compare` signal (max 4) + `CodexCompareTrayComponent`.
- Hardpoint scaffolding: `codex_item_ports` + `getCompatibleItems` + default-loadout resolve.
- Assets: WebP entity renders via `previewUrl`; a working **3D `ship-skin-viewer`**.

**Implication:** the rethink is a **presentation-layer rebuild**, not a data/model change —
squarely inside the "data/schema stays" no-go. The shared **3D-performance risk** all three
agents flagged is largely pre-mitigated: hero = existing 2D WebP by default, true 3D reused
from `ship-skin-viewer` only for the single focal object.

**Blast radius vs corridor:** corridor = *whole Codex*. All three variants are **in-corridor**.
None is over-corridor. No corridor-widening question needed.

---

## Variant A — "The Bridge" (pragmatic hero + lanes)  ·  effort: M

Landing = a **Bridge**: one hero (your hangar flagship / featured ship) with a short vitals
readout, beneath it horizontal **lanes** (Your Hangar · Fresh this patch · Popular to compare ·
Explore by role) and three plain doors (Look up · Compare · Build). Filters live *inside* a
lane you open, never at the front. One protagonist per screen.

- **Serves:** lookup (search→detail, 2 actions) · compare (existing tray, first-class) ·
  discover (curated lanes) · plan (ship detail shows read-only hardpoint layout → editable later).
- **Reuses:** compare tray as-is; `previewUrl` heroes; no new 3D in v1.
- **Departure from list:** app arrives pre-pointed at something; routes are human-shaped
  (lanes/doors), not facets.
- **Risk:** personalization emptiness — a guest / empty hangar must still feel compelling
  (featured hero + lanes must stand on their own).
- **Serves criteria:** hierarchy ✓ entry/narrative ✓ personal ✓ SC-feel ◐ (atmosphere via
  chrome + renders, lighter on immersion) — **lowest delivery risk.**

## Variant B — "The Ship Bay" (hero scene + showrooms)  ·  effort: M–L

Landing = a dim **bay scene**: one hero ship in rim-light slowly rotating, vitals ghosting in
mobiGlas blue, a terminal status line ("Codex online · Patch 4.2 LIVE · synced 6h ago").
Compare = "park a second ship in the bay." Discover = manufacturers become **showrooms** with
their own light/mood + curated captions ("Fresh this patch", "Newcomer-friendly"). Hardpoints
are glowing nodes; tapping opens "what fits here" (staged read-only → live). A demoted **index
mode** exists for power-user bulk scanning.

- **Serves:** all four as *felt moments*; newcomer-guided + veteran fast-path (scan-search).
- **Reuses:** compare tray (re-skinned), `getCompatibleItems` for the node dock, hangar hero.
- **Departure from list:** starts from "the one that matters to you," grid demoted to opt-in tool.
- **Risk:** atmosphere-as-tax — cinematic framing must not add latency/clicks for min-maxers;
  motion must be fast (<300ms), skippable, reduced-motion-safe; index mode mandatory.
- **Serves criteria:** hierarchy ✓ entry/narrative ✓✓ personal ✓✓ SC-feel ✓✓ — **best
  balance of feeling vs deliverability.**

## Variant C — "The Holo-Table" (spatial-verb, full diegetic)  ·  effort: L

Landing = a **holo-table console**: center-stage rotating hero + orbiting **stat-ring**; left
**Scanner rail** (search + snap-on "lens" filters); right **Plinths** (2–4 compare slots as
mini-holograms); bottom **Manifest drawer** (full spec sheet + provenance on demand). Navigation
is spatial-verb: you never open a "view," you pick up an object and the table reconfigures.
Strongest mobiGlas immersion; ships at real relative scale.

- **Serves:** all four on one continuous surface; compare/plan grow out of lookup gesture.
- **Reuses:** compare state; heaviest new custom interaction + shader/FUI chrome; most 3D.
- **Departure from list:** the *filter* stops being the primary object; a single focal entity is.
- **Risk:** highest build + perf/legibility cost; most surface to get wrong on mobile; largest
  bespoke interaction model (spatial nav) to validate.
- **Serves criteria:** hierarchy ✓✓ entry/narrative ✓✓ personal ✓✓ SC-feel ✓✓✓ — **max
  atmosphere, max effort/risk.**

---

## Recommendation

**Variant B (Ship Bay) as the target, built on A's spine, with C's ideas staged in.**
B hits every success criterion with a deliverable effort profile and reuses the most existing
code. A is effectively B's phase-1 (hero + lanes + reused compare + read-only hardpoints) — so
shipping A-then-B is a smooth ramp, not a redo. C's stat-ring, manifest drawer and scanner-rail
are excellent *component-level* ideas to graft onto B without adopting its full spatial-nav
cost. Shared non-negotiable across all: **fast scan-search + skippable motion + a power-user
index/list mode**, so the experience never taxes the four jobs it exists to serve.
