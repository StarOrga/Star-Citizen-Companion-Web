---
title: Utilities
excerpt: The smaller surfaces — release notes, in-app feedback, and the admin area.
---

Beyond the four big features, a handful of smaller surfaces round the app out.

## Release notes

`/release-notes` renders the project's changelog in-app, so you can see what
changed without leaving for GitHub.

## In-app feedback

A feedback button is available throughout the app. Reports land in a triage
queue the maintainers work through; see [Support](doc:support) for what to
include and when to open a GitHub issue instead.

## Admin area

Admin-only surfaces, listed here so the map is complete:

| Route | Purpose |
|---|---|
| `/admin` | User management and invitations |
| `/admin/api-tokens` | **Integrations** — app connections plus issuing, listing and revoking [Public API](doc:authentication) tokens. Reached from the profile (avatar) menu, not the main nav. |
| `/admin/telemetry` | Telemetry dashboard — every desktop client (SCC app, Data Uploader, Starscape) side by side, with a drill-down per product |
| `/admin/feedback` | Feedback triage queue |

## Languages and platforms

The web app is a **PWA** and ships fully localised in **English and German** —
switchable in Settings. The Data Uploader and the Starscape App are
Windows desktop binaries; see [Desktop tools](doc:desktop-tools).

**Language** and **region** are two separate settings, because they answer two
different questions. The language picks the translation and the month names;
the region decides how a date is *ordered* and whether the clock runs 12- or
24-hour. A German speaker in the US can therefore read a German UI with US
dates.

Both default to **Automatic**, resolved in this order:

1. your profile setting, if you picked one,
2. what your browser reports — its preferred languages, its locale, and its
   time zone (`Europe/Vienna` → Austria, even when the browser names no
   country),
3. English with a day-first region.

Dates are always written with the month spelled out, in your region's field
order: `31 / July / 2026` in Europe, `July / 31 / 2026` in the US,
`2026 / July / 31` in Japan. Settings shows a live preview of your current
combination.
