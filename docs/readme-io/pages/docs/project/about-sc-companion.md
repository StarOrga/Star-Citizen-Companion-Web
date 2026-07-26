---
title: About SC Companion
excerpt: What SC Companion is, what the API is for, and the project's alpha-phase ground rules.
---

**SC Companion** is a free, non-commercial, fan-made companion app for
*Star Citizen*. It aggregates the Verse News (Comm-Link, Spectrum, RSI status,
patch notes, YouTube), tracks patch versions across LIVE / PTU / EPTU, renders a
browsable Codex of ships and components datamined from the live build, gives you
a personal Hangar, and hosts companion tools like the Starscape desktop
wallpaper app.

- **Web app:** <https://sc-companion.vercel.app>
- **Source:** [StarOrga/Star-Citizen-Companion-Web](https://github.com/StarOrga/Star-Citizen-Companion-Web)
- **Stack:** Angular 21 PWA · Supabase (Auth, Postgres, Storage, Edge Functions) · Vercel
- **Licence:** MIT
- **Ads / tracking:** none

## Open source by default

The entire application is developed in the open. Every change is publicly
reviewable on GitHub, and it is the same code that runs on the live site —
there is no private fork.

## What the API is for

The Public API exposes the *aggregated, already-public* data SC Companion
collects, so you can build on top of it — dashboards, Discord bots, org tools,
overlays — without re-scraping RSI yourself.

It is deliberately **read-only**. There are no write endpoints, and there will
not be any: SC Companion is a reader of Verse data, not a system of record.

## Alpha-phase ground rules

SC Companion is in **alpha**. Concretely, that means:

- **Envelopes are stable, datasets are not.** `data` / `meta` and the error
  shape are settled and safe to integrate against. Which endpoints have real
  rows behind them is still moving — `/v1/ships` and `/v1/components` are
  documented stubs today.
- **Additive changes are unannounced.** New fields and new endpoints can appear
  at any time. Parse defensively: ignore keys you do not recognise.
- **Breaking changes get a new path.** If a response shape has to change
  incompatibly, it lands under a new version prefix rather than mutating `/v1`.
- **Schema rewrites can drop data.** Until the phase flips to `beta`, a
  migration may drop legacy tables — see [Accounts & data](doc:accounts-and-data).
- **The spec wins.** `GET /openapi.json` is the hand-maintained OpenAPI 3.1
  description of the running router. Where these guides and the spec disagree,
  believe the spec — and please report the drift.

## Legal

SC Companion is an unofficial, fan-made project. It is **not affiliated with,
endorsed by, or sponsored by Cloud Imperium Games Corporation or Roberts Space
Industries Corp.** All Star Citizen content, artwork, and trademarks remain the
property of their respective owners. The project never asks for your RSI account
credentials.

The API returns links and metadata pointing at RSI's own public channels; it
does not rehost RSI media. The same applies to [Starscape](doc:starscape),
which hotlinks the RSI CDN rather than storing imagery.

Full texts live in the app:
[privacy policy](https://sc-companion.vercel.app/legal/privacy) ·
[imprint](https://sc-companion.vercel.app/legal/imprint) ·
[about](https://sc-companion.vercel.app/about)
