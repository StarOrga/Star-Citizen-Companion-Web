---
title: What is SC Companion?
excerpt: A fan-made companion for Star Citizen — Verse News, a datamined Codex, your Hangar, and a read-only Public API.
metadata:
  title: SC Companion — Star Citizen companion app
  description: SC Companion aggregates Verse News, a datamined ship and component Codex, a personal Hangar, the Starscape gallery, and a read-only Public API.
---

**SC Companion** is a fan-made companion app for *Star Citizen*. It pulls the
public Verse together in one place — news, patch versions, ships, components —
and adds the tools that sit around them.

- **Web app:** <https://sc-companion.vercel.app>
- **Source:** [StarOrga/Star-Citizen-Companion-Web](https://github.com/StarOrga/Star-Citizen-Companion-Web)
- **Licence:** MIT
- **Phase:** alpha

> 🚧 **Alpha.** Features and data schemas still move. What is documented here is
> what is live today; see [Roadmap](doc:roadmap) for what is coming and
> [About SC Companion](doc:about-sc-companion) for the alpha ground rules.

## What it does

| Area | What you get | Docs |
|---|---|---|
| **Verse News** | Comm-Link, Spectrum, YouTube and patch notes in one feed, plus the live RSI service status. Auto-refreshes every 5 minutes. | [Verse News](doc:verse-news) |
| **Codex** | Every ship, weapon, component, item, ammo and manufacturer — datamined from the live build and searchable. | [Codex](doc:codex) |
| **Hangar** | Your personal fleet: owned/wishlist ships, named configurations, component loadouts and role kits. | [Hangar](doc:hangar) |
| **Starscape** | A gallery of original-resolution RSI artwork harvested from the news crawl, plus a tiny Windows wallpaper app. | [Starscape](doc:starscape) |
| **Data Uploader** | A desktop tool that scans your own `Data.p4k` and uploads a pre-digested bundle, which is what keeps the Codex current. | [Desktop tools](doc:desktop-tools) |
| **Public API** | Read-only HTTP access to the aggregated data, for bots, dashboards and org tools. | [Getting Started](doc:getting-started) |

## How the data gets there

Nothing in SC Companion is typed in by hand:

1. A **news crawl** polls RSI's public channels (Comm-Link, Spectrum, the RSI
   status page, YouTube) and normalises everything into one feed. Artwork found
   along the way lands in [Starscape](doc:starscape).
2. The **Data Uploader** runs on a contributor's own machine, reads their local
   `Data.p4k`, and uploads a pre-digested *bundle* of extracted metadata —
   never the game files themselves.
3. Bundles are ingested into the **Codex catalog**, tagged with the patch
   version and channel (LIVE / PTU / EPTU) they came from.
4. The **Public API** serves the aggregate back out, read-only.

That pipeline is also why some data lags a patch: the Codex is only as current
as the most recent uploaded bundle.

## Where to go next

- New here? → [Quickstart](doc:quickstart)
- Building against the data? → [Getting Started](doc:getting-started)
- Wondering what is stored about you? → [Accounts & data](doc:accounts-and-data)

---

*SC Companion is an unofficial fan project and is **not affiliated with,
endorsed by, or sponsored by Cloud Imperium Games or Roberts Space
Industries**.*
