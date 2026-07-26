---
title: Codex
excerpt: Every ship, weapon, component, item, ammo and manufacturer — datamined from the live build and searchable.
---

The **Codex** is the reference half of SC Companion: ships, weapons,
components, items, ammunition and manufacturers, extracted from the live game
build rather than transcribed by hand. It is public — no account needed.

## The Bridge

`/codex` opens on **The Bridge**, the browsing surface:

- **Scanner** — one search box that matches display names *and* class names,
  so both `Gladius` and `AEGS_*` work.
- **Featured hero** — your flagship if you have one, otherwise a highlighted
  ship, stamped with the patch and build it came from.
- **Lanes** — *Your Hangar*, *Fresh this patch*, *Popular to compare*, and
  *Explore by manufacturer*.
- **Compare** — add ships to a comparison tray and view them side by side.

### Index mode

`/codex/index` is the power-user escape hatch: the full filter list with kind
tabs, every facet, a result grid, load-more paging and the compare tray. One
click from the Bridge.

## Blueprints

Blueprint pages break a ship down into its hardpoint layout and the components
it carries, driven by the same extracted catalog.

## Keybinds

`/codex/keybinds` renders the game's keybinding tables from the extracted
default profile — useful when a patch quietly moves a binding.

## Upcoming Ships

`/codex/upcoming` is the **difference between what RSI lists and what the live
build actually contains**: ships announced on the RSI ship matrix that have no
match in the datamined data yet. They are split into

- **In concept** — RSI is still building these, not flyable yet, and
- **Flight-ready on RSI** — RSI lists them as flight-ready, but our game data
  has no match.

You can search this list, filter to favourites only, and star ships to be
notified in [Verse News](doc:verse-news) when their status changes.

## Where the data comes from

The Codex is populated from bundles produced by the
[Data Uploader](doc:desktop-tools) against a real `Data.p4k`, tagged with the
patch version and channel (LIVE / PTU / EPTU) they were extracted from. The
Codex is therefore exactly as current as the newest ingested bundle — the
freshness stamp on the hero tells you which build you are looking at.

Ships and components are also exposed over the
[Public API](doc:endpoints).

## Flagship

Pin any ship as your **flagship**. It then opens at the top of the Codex, is
marked with a ★ in your [Hangar](doc:hangar), and is stored on your profile so
it follows you across devices.
