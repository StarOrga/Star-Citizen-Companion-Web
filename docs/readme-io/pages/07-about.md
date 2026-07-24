---
slug: about-sc-companion
title: About SC Companion
category: documentation
position: 7
excerpt: What SC Companion is, what the API is for, and the project's alpha-phase ground rules.
---

**SC Companion** is a fan-made companion app for *Star Citizen*. It aggregates
the Verse News (Comm-Link, Spectrum, RSI status, patch notes, YouTube), tracks
patch versions across LIVE / PTU / EPTU, renders a browsable Codex of ships and
components, and hosts companion tools like the Starscape desktop wallpaper app.

- **Web app:** <https://sc-companion.vercel.app>
- **Stack:** Angular 21 PWA · Supabase (Auth, Postgres, Storage, Edge Functions) · Vercel
- **Licence:** MIT

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
- **The spec wins.** `GET /openapi.json` is generated from the running router.
  Where these guides and the spec disagree, believe the spec — and please
  report the drift.

## Support and reporting

Found a bug, a documentation error, or data that looks wrong? Open an issue on
the project repository at
[StarOrga/Star-Citizen-Companion-Web](https://github.com/StarOrga/Star-Citizen-Companion-Web/issues).

Useful details to include: the endpoint, the timestamp, the `error.code` if any,
and the value of `X-Patch-Version` from the response headers.

## Legal

SC Companion is an unofficial, fan-made project. It is **not affiliated with,
endorsed by, or sponsored by Cloud Imperium Games Corporation or Roberts Space
Industries Corp.** All Star Citizen content, artwork, and trademarks remain the
property of their respective owners.

The API returns links and metadata pointing at RSI's own public channels; it
does not rehost RSI media.
