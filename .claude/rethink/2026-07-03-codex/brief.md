# Rethink Brief — The "Codex" (Star Citizen Companion, web)

*Date: 2026-07-03 · Status: fresh-phase input · This document is the ONLY context the ideation agents receive. It is deliberately code-free.*

---

## What the Codex is

The Codex is the reference section of a Star Citizen companion web app (a bilingual
DE/EN fan-site PWA). Star Citizen is a space-sim game with hundreds of spaceships and
thousands of items (weapons, shields, power plants, coolers, quantum drives, thrusters,
ammunition, manufacturers). The Codex is a catalog of all of these, built from data
extracted directly out of the real game files — so its numbers are authoritative and
freshly tied to a specific game patch/build, not copied from a wiki.

Alongside the Codex the app has a personal **Hangar** (the ships a given user owns) and,
as a data source, a separate **desktop uploader** tool that extracts the game data and
publishes each new patch's catalog.

## The purpose (what a user actually comes to do)

The Codex must serve **four jobs at once** — all confirmed as real:

1. **Look up** — see the stats of ONE ship or component fast (wiki-entry feel).
2. **Compare** — put 2–4 options side by side before buying or fitting (decision tool).
3. **Discover** — browse what even exists; inspiration and overview, no fixed goal.
4. **Plan a loadout** — build a ship up across its hardpoints with live-updating stats
   (the big, erkul.games-class ambition; may be staged as future, but the Codex should
   be heading there, not away from it).

## The gap (why we are rethinking)

Today the Codex reads like a spreadsheet with pictures — a database browser. The owner's
verdict: *"it feels too much like an Excel list."* Four specific frustrations, all
confirmed:

- **Data, not experience.** It feels like a table of records. No sense of Star Citizen —
  no atmosphere, no immersion, none of the "space-sim" feeling the subject deserves.
- **Everything weighted equally.** Every entry looks the same. No hierarchy, no hero, no
  focal point — nothing pulls the eye or signals "start here / look at this."
- **No entry, no narrative.** You drop straight into a filter-and-scroll list. There is no
  hook, no journey, no reason-to-be-here framing, no guided way in.
- **No connection to *me*.** Nothing ties the catalog to the individual — their hangar,
  their goals, their situation. It is an anonymous database, not *my* companion.

The section has been iterated many times (data extraction, previews, i18n, a detail view,
3D ship-skins, icons, provenance badges) — but every pass polished the same
filter-list frame instead of changing it. Incremental fixes have stopped helping. That is
why this is a from-scratch rethink, not another polish pass.

## What "good" looks like (success criteria)

- Opening the Codex **feels like Star Citizen** — an experience, not a data grid.
- There is a **clear way in**: a hero / focal entry point and a sense of narrative or
  journey, not an undifferentiated wall of equal items.
- **Visual + informational hierarchy**: some things are big and important, others recede.
- It **connects to the individual** — reflects or reacts to the person using it (their
  hangar, interests, or context), so it feels like *my* companion.
- Without losing the four jobs: lookup stays fast, compare stays first-class, discovery
  feels inviting, and the path toward loadout-planning stays open.
- Trust is preserved: the data is authoritative and tied to a known game patch; users can
  still see how fresh it is.

## Hard no-gos / constraints

- The **underlying data and its schema stay** — this is a presentation/experience/structure
  rethink, not a data-model rewrite. The catalog contents (ships, items, stats, localized
  names, patch/build provenance) are a given.
- **Bilingual (DE/EN)** is mandatory — every user-facing idea must work in both languages.
- Read/browse must work for a **broad audience** (no assumption that only power users with
  accounts arrive; the experience should welcome a viewer, not just a logged-in fitter).
- The **desktop uploader is a background data source only.** Do NOT design an experience
  that leans on it in the foreground. Its only permitted surface in the Codex is a
  *subtle* freshness/provenance cue ("data current as of patch X"). Do not redesign the
  uploader's own interface here.
- Mobile + desktop both matter (it is a responsive PWA).

## Demolition corridor (agreed with the owner)

**The whole Codex may be torn down and rebuilt.** Layout, information architecture, and the
entire interaction model are open to a from-scratch redesign. The only thing that must
survive is the data/schema layer beneath it. Nothing about the current filter-list UI is
sacred — treat it as replaceable.

## Your task (ideation)

Propose a genuinely fresh approach to the Codex that reaches the purpose above and closes
the gap. Think about the *idea and the shape* of the experience — the way in, the
hierarchy, the feeling, the connection to the individual, and how the four jobs (look up,
compare, discover, plan) coexist — not implementation details. Do not assume anything about
how it is built today; imagine it new.
