# Codex Rethink — Decision (LOCKED)

*Date: 2026-07-04 · Action: implement (via /devops-concept feedback bridge, submission _version 1).*

## Locked target

**"The Ship Bay, entered through The Bridge"** — the merged approach. All three
variants marked *Miteinbeziehen* → build B (Ship Bay) on A's spine (Bridge) with
C (Holo-Table) ideas grafted as components. Presentation-layer rebuild; data/schema
stays. Corridor = whole Codex (in-corridor).

## Resolved open questions

1. **Viewer access — GATED.** Keep the Codex behind the existing invite/login wall.
   Do NOT build an anonymous-guest read path. The personalization "guest" state in
   the ladder collapses to "logged-in, empty hangar" (there is no anonymous viewer).
2. **Flagship — USER-PINNED.** The personalized hero is the user's *pinned standard
   ship*. A user may own several hangar ships, but can designate one default/pinned
   ship that drives the Bridge hero. (New tiny capability: pin-a-flagship on the hangar.)
3. **Index parity — ALL DATA + erkul-class presentation, EXTENDED TO FPS & GROUND
   VEHICLES.** Index/data completeness: yes, all data. But the north-star is
   erkul.games-level presentation of *relationships and results* plus live
   configuration — and the owner explicitly wants this SAME depth not only for ships
   but also for **FPS (character) loadouts** and **ground vehicles**, not ships alone.
4. **Phase cut — DISCARDED** by the owner (does not want to micro-decide phasing) →
   sensible default staging applies: ship P1 first.

## North-star (expanded scope — carry through all phases)

The end state is an **erkul-class configurator with first-class result/relationship
display, across three domains: ships, FPS character loadouts, and ground vehicles.**
This materially grows the "Loadout" job (Rung 2/3) and the breadth of configurable
entities. The Codex data layer already extracts FPS weapons/armor and vehicle items,
so the breadth is a presentation/interaction build, not new extraction. This is the
direction every phase heads toward; it is NOT all built in P1.

## Staging (owner left phasing to me)

- **P1 — The Bridge (present-mode build now):** kill the filter-list front door.
  Scanner (fast search) + one focal hero (user's pinned flagship if set, else a
  featured ship) + horizontal lanes (Your Hangar · Fresh this patch · Popular to
  compare · Explore by role) + object view with stats grouped by purpose + read-only
  hardpoint layout (Rung 1) + re-skinned compare tray + opt-in Index mode (today's
  full facet list survives here). Pin-a-flagship on the hangar. Atmosphere-dose rules
  apply (motion <300ms, skippable, reduced-motion, 3D opt-in per focal object,
  legibility first). Gated to logged-in users.
- **P2 — The Bay + configurator ramp:** atmospheric hero scene (3D focal), manufacturer
  showrooms, hardpoint nodes, swap-preview (Rung 2), compare-in-scene — and the
  erkul-class result/relationship display begins here.
- **P3+ — Full configurator across ships + FPS + ground vehicles** (the north-star),
  saved/shareable loadouts (Rung 3, still gated).

## Method note

Owner is present → implemented in present-mode (NOT /devops-autonomous afk mode,
which can power off the PC). P1 delegated to a feature/frontend build against the
existing CodexService / hangar.service / compare tray / item-ports data.

Artifacts: brief.md · approaches.md · iteration-2.md · this file.
