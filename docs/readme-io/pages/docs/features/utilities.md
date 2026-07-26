---
title: Utilities
excerpt: The smaller surfaces — 3D printing guide, release notes, in-app feedback, and the admin area.
---

Beyond the four big features, a handful of smaller surfaces round the app out.

## 3D printing guide

`/tools/3d-print` documents how the community turns Star Citizen ships into
printable models — **using your own game files, on your own machine**.

The guide is explicit about where the line sits:

> Viewing is fine — downloads are not. You can inspect ship models in the
> Codex's 3D viewer, which is the established fan-tool practice CIG tolerates.
> SC Companion deliberately does **not** offer extracted geometry for download
> or redistribution: the RSI EULA prohibits redistributing extracted game
> assets, the Fankit & Fandom FAQ rules out offering game content for download,
> and downloadable models collide with CIG's own licensed model program.

What it does provide is the four-step workflow you run yourself — extract from
your own `Data.p4k`, convert the CryEngine chunks to a standard mesh format,
prepare the mesh in Blender (solidify for wall thickness, remesh to close
holes), then scale and slice — plus a list of vetted community tools and the
real ship dimensions from the Codex to scale against.

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
| `/admin/api-tokens` | Issue, list and revoke [Public API](doc:authentication) tokens |
| `/admin/telemetry` | Uploader and app telemetry dashboard |
| `/admin/feedback` | Feedback triage queue |

## Languages and platforms

The web app is a **PWA** and ships fully localised in **English and German** —
switchable in Settings. The Data Uploader and the Starscape wallpaper app are
Windows desktop binaries; see [Desktop tools](doc:desktop-tools).
