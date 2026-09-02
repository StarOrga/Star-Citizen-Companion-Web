---
title: Roadmap
excerpt: Where the project is today and what the phases after alpha look like.
---

SC Companion ships continuously — this is the direction, not a schedule. Dates
are deliberately absent; a fan project moves at the speed of the people
building it.

## Where we are

**Phase 1 — foundation. Shipped.**
Accounts, the [Verse News](doc:verse-news) feed with live RSI service status,
[Starscape](doc:starscape) plus the Starscape App, the
[Data Uploader](doc:desktop-tools) with discovery cascade and verified upload,
the [Codex](doc:codex) built from ingested bundles, the personal
[Hangar](doc:hangar), and the read-only [Public API](doc:getting-started).

## What is next

**Phase 2 — deeper extraction.**
More of the game archive turned into structured data: richer component trees,
per-ship statistics, and filling in the `/v1/ships` and `/v1/components`
endpoints that are documented stubs today. The response envelopes are already
final, so integrations written now keep working when the rows arrive.

**Phase 3 — loadout planning.**
A full planner in the spirit of erkul.games, backed by the extracted catalog
rather than hand-maintained tables — so it tracks the live build instead of
lagging it.

**Phase 4 — community.**
Shared and published loadouts, fleet views across an organisation, and org
linking by RSI handle.

## Beta

The phase flag flips from `alpha` to `beta` when the schema stops churning.
Until then the [alpha-phase data policy](doc:accounts-and-data) applies:
migrations may drop legacy tables, and personal data such as hangar contents
can be reset.

## Following along

- **Release notes** are rendered in the app at
  [`/release-notes`](https://sc-companion.vercel.app/release-notes).
- **Every change** is public on
  [GitHub](https://github.com/StarOrga/Star-Citizen-Companion-Web).
- **Requests** are welcome — see [Support & feedback](doc:support).
