# Codex Rethink — Iteration 2: Sharpened Target

*Date: 2026-07-03 · Step 5 revise (Iterate decision). One concrete target instead of three sketches.*
*Choices made this iteration (correctable): sharpen the recommended line **B-on-A**; deepen **Compare + Loadout**; full **personalization ladder**; **atmosphere-dose** rules pinned.*

---

## The one target: **"The Ship Bay, entered through The Bridge"**

A single experience delivered in two phases — **A is literally B's phase 1**, so shipping
A-then-B is a ramp, not a redo. One protagonist per screen. The filter-list is gone from the
front door; it survives only as an opt-in **Index mode**.

- **Phase 1 (The Bridge):** hero + lanes + reused compare tray + read-only hardpoints. Ships fast.
- **Phase 2 (The Bay):** the hero becomes a lit, slowly-rotating *scene*; manufacturers become
  showrooms; hardpoints become interactive nodes; Compare becomes "park a second ship alongside."
- **Grafts from C (anytime):** stat-ring around the hero, on-demand Manifest drawer (full spec
  sheet + provenance), Scanner rail for search+lenses. Component-level, no spatial-nav cost.

---

## Screens & zones (concrete)

### 1. The Bridge — landing
**Desktop.** Top: a **Scanner** bar (always-present search; type a name → jump to object;
this is the fast path). Below it, ONE **hero panel** (~55% viewport height): the focal object
rendered large (2D WebP by default, 3D for the single focal ship), a short **vitals readout**
(1 headline stat + 1 "weak link"), a freshness badge ("Patch 4.2 LIVE · synced 6h ago"), and
two actions: *Open* and *+ Compare*. Beneath the hero, 3–4 horizontal **lanes** (medium cards,
scannable): **Your Hangar** · **Fresh this patch** · **Popular to compare** · **Explore by
role**. Filters are NOT here.

**Mobile.** Scanner collapses to a search icon + sticky bar. Hero becomes a full-width card
(art + 1 stat + weak-link + actions). Lanes become horizontally-swipeable rails, one per row.
Everything one-thumb reachable; motion off by default on phones.

### 2. Object view (Bay hero + detail) — the heart
**Phase-1 form:** identity header (render, manufacturer, role, patch badge) → **decision
stats grouped by what the thing is FOR** (not a flat dump) → **read-only hardpoint layout**
(ship silhouette with stock loadout as labelled slots) → collapsed **full spec table** below →
compare/hangar hooks.

**Phase-2 form:** the identity render becomes a **dim bay scene** — the ship in rim-light,
slowly rotating (reusing `ship-skin-viewer`), vitals ghosting in mobiGlas blue. The stat block
and hardpoints are unchanged in *content* — only the frame gets atmospheric. **Rule:** nothing
atmospheric sits between the user and a number they came to read.

### 3. Compare — "bring a second object alongside" (DEEPENED)
- **Entry from everywhere:** every card, search result, and object view has **+ Compare**. It
  drops the item into a persistent **compare tray** (edge-docked, 2–4 slots) that **survives
  navigation** — you assemble the set while browsing, not in a separate mode.
- **Like-for-like only:** the tray refuses mixed types (ship vs ship, quantum-drive vs
  quantum-drive) so columns are always meaningful. Adding a 5th bumps the oldest (FIFO) with an
  undo toast.
- **The compare surface:** side-by-side **spec columns**, one per object. Each stat row shows a
  **delta bar** + **winner highlight** (green = best-in-set, dim = worst). Rows are grouped by
  the same "what it's FOR" buckets as the detail view, so a novice reads meaning, not just
  numbers. A **"differences only"** toggle collapses identical rows for fast scanning.
- **Personal seeding:** when relevant, the tray **pre-seeds slot 1 with a hangar ship** ("compare
  against *your* Gladius"). Comparing a component pre-fills "the one currently in your ship."
- **Phase-2 felt version:** in the Bay, compared ships **park side by side in the same scene**
  at true relative scale — the size difference is *seen*, not just a mass number.
- **Reuse:** `_compare` signal (max 4) + `CodexCompareTrayComponent` already exist → tray is a
  re-skin, not a rebuild. `getCompatibleItems` unused here.

### 4. Loadout — the staged path (DEEPENED)
The success criterion is "the path stays open," delivered as a **3-rung ladder** on the *same*
hardpoint surface — no separate planner app, no re-architecture between rungs:

- **Rung 1 (Phase 1, read-only):** ship object view renders the **hardpoint layout** with the
  **stock/default loadout** resolved and labelled (size, type, installed item name). Tapping a
  slot opens the installed item's detail. This alone teaches the structure and satisfies "look
  up what this ship comes with." *Reuses `codex_item_ports` + default-loadout resolve.*
- **Rung 2 (Phase 2, swap-preview):** tapping a slot opens a **"what fits here" dock** (filtered
  to compatible items via `getCompatibleItems`). Selecting one shows a **preview delta** ("+12%
  DPS, −0.4 SCM") **without persisting** — a sandbox to answer "what if." No login needed.
- **Rung 3 (future, saved builds):** a preview becomes a **saved, shareable loadout** (stable
  className permalink), live-recomputing aggregate stats — the erkul-class endpoint. Gated behind
  account; everything up to here is viewer-open.
- **Atmosphere:** hardpoints as **glowing nodes** on the ship silhouette in Phase 2; a filled
  node pulses subtly, an empty one reads as an invitation.

### 5. Scanner + Index mode — the power-user escape hatch
- **Scanner** (always present): instant search over localized names AND classNames AND tags. A
  result row is a mini-card with **+ Compare** inline — search feeds compare directly.
- **Index mode** (opt-in, one click from Scanner): the **full dense table/grid with all facets**
  — manufacturer, size, grade, kind, weaponClass, variants. This is where today's filter-list
  *lives on*, for veterans doing bulk scanning. **Non-negotiable:** it must exist so the redesign
  never taxes the min-maxer. It is a *tool you choose*, never the front door.

### 6. Discover — showrooms & lanes
- **Phase 1:** the Bridge lanes ARE discovery (curated, role-shaped: fighters / haulers / miners,
  Fresh this patch, Manufacturer spotlight).
- **Phase 2:** opening a manufacturer becomes a **showroom** — its own light/mood, a curated
  caption ("Fresh this patch", "Newcomer-friendly"), ships staged as a small fleet. Browsing
  becomes a journey through themed rooms, not a scroll through an undifferentiated grid.

---

## Personalization ladder (DEEPENED — the "connection to me")

| State | Bridge hero | First lane | Compare seed | The pitch |
|---|---|---|---|---|
| **Guest (not logged in)** | Featured **ship of the patch** | Fresh this patch | empty | soft "sign in to make this *yours*" — personalization is *visible before* login, which IS the sell. Never blocks browsing. |
| **Logged in, empty hangar** | Featured ship + a "**start your hangar**" nudge on it | Explore by role | empty | first "+ to hangar" tips the hero to a personalized state next visit → immediate payoff loop. |
| **Logged in, populated hangar** | **Your flagship** (most-used / newest) with live vitals + weak-link | **Your Hangar** | pre-seeded with a hangar ship | "your ship, its situation" — the load-bearing personalized state. |
| **Returning power user** | last-viewed or flagship; **Scanner focused on keypress** | Your Hangar | last compare set restored | fast in/out; Index mode one click away. |

Component object views everywhere show **"fits N of your ships"** / **"your *Gladius* currently
runs a weaker one"** — the catalog reacts to *your* fleet. *Reuses `hangar.service`,
`getShipsByClassNames`, `resolveEntities`.*

**Risk owned:** *personalization emptiness.* The guest/empty-hangar hero must be genuinely
compelling on its own — featured hero + lanes carry the experience; personalization is an
amplifier, never the only reason the screen works.

---

## Atmosphere-dose rules (pinned, non-negotiable)

1. **Atmosphere lives in the chrome, the hero, and motion — never between the user and a number.**
2. **Motion budget:** any transition **< 300 ms**, **skippable**, and **`prefers-reduced-motion`
   safe** (falls back to instant). No motion by default on mobile.
3. **3D is opt-in per focal object only:** hero uses 2D WebP by default; true 3D reused from
   `ship-skin-viewer` for the single focal ship (and side-by-side compare in the Bay). Never a
   grid of 3D.
4. **Index mode is always one click away** — the atmospheric path can be fully bypassed.
5. **Legibility first:** stats stay crisp on a calm surface *inside* the atmospheric frame.

---

## Reuse map (what already exists — presentation-only rebuild)

Survives wholesale: `CodexService` (list/detail/ports/`getCompatibleItems`/locale/`previewUrl`),
`codex_builds` provenance, `hangar.service` + resolvers, `_compare` signal +
`CodexCompareTrayComponent`, `codex_item_ports` + default-loadout resolve, WebP renders, 3D
`ship-skin-viewer`. **No data/schema change** — inside the "data stays" no-go.

## Phasing → hand-off shape (when Implement is chosen)

- **P1 = The Bridge:** Scanner + hero + lanes + object view with grouped stats + read-only
  hardpoints (Rung 1) + re-skinned compare tray + Index mode. Ships the whole "not-a-list" frame
  on reused data.
- **P2 = The Bay:** atmospheric hero scene (3D focal), showrooms, hardpoint nodes, swap-preview
  (Rung 2), side-by-side-in-scene compare.
- **Grafts (opportunistic):** stat-ring, Manifest drawer, Scanner lenses.
- **Future:** saved/shareable loadouts (Rung 3, account-gated).

## Open questions to resolve before Implement

1. **Viewer-access:** the Codex is currently behind the invite-only auth wall — the brief wants
   it viewer-accessible. Does P1 include opening read paths to guests, or stay gated for now?
2. **"Flagship" rule:** how is the personalized hero chosen — most-used, newest, or user-pinned?
3. **Index-mode parity:** must Index mode reach 100% of today's facets on day 1, or is a subset ok?
4. **Phase cut:** ship P1 alone first (validate the frame), or hold for P1+P2 together?
