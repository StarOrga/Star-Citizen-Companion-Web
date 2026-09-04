---
title: Desktop tools
excerpt: The Data Uploader that keeps the Codex current, and the Starscape App that rotates your wallpaper.
---

Two of SC Companion's pieces run on your own machine, because they need access
to things a browser cannot reach: your local Star Citizen installation, and
your desktop wallpaper.

## Data Uploader

The **Data Uploader** is the reason the [Codex](doc:codex) has data at all. It
is a standalone Electron desktop tool — separate from the web app — that scans
the `Data.p4k` of your own Star Citizen install and uploads a *pre-digested
bundle* of extracted metadata.

> **It never uploads game files.** What travels is extracted metadata — entity
> names, component trees, statistics — not the archive and not the assets.

### What it does

1. **Discovery cascade.** It finds your install in three escalating steps: read
   the RSI Launcher configuration, then scan the filesystem, then ask you to
   point at the folder manually.
2. **Channel selection.** LIVE, PTU, EPTU and tech-preview installs are
   detected separately, so a bundle always knows which build it came from.
3. **Scan with live progress.** Three performance profiles trade CPU against
   wall-clock time, and they do it by changing how many worker processes the
   record extraction runs in — from a single process pinned to one core up to
   every core but one. The profile is switchable mid-run for the resource
   knobs; the worker count itself is fixed when the scan starts.
4. **Quality score.** Every bundle gets a score describing how complete the
   extraction was, so a half-finished scan cannot quietly displace a good one.
5. **Verified upload.** Sign-in happens over an OAuth loopback with a
   release-token header, so only genuine builds of the tool can upload.

The tool speaks English and German, with stubs for ES / FR / PT / RU / ZH.

### Getting it

Downloads live at
[`/download`](https://sc-companion.vercel.app/download) in the web app and are
restricted to **admin and collaborator** accounts. The page shows the current
version, release date, notes, size and SHA-256, and lets admins promote a build
across the *alpha → beta → stable* channels.

> **On a phone or tablet, the download is not offered.** Both desktop tools are
> Windows applications, so the download buttons, the channel picker and the
> compact download menus in the Codex and Starscape headers only appear on a
> device that could actually install them. This is decided from the device
> itself — browser platform hints, the user agent and the pointer capabilities —
> not from the window width, so a narrow desktop window still gets the download.
> Following a shared `/download` or `/uploader` link on a phone still opens the
> page; it explains the platform requirement instead of handing out an installer
> that cannot run there.

### Bundle History

`/p4k` (**Bundle History**) is the receiving end: every uploaded bundle with
its channel, patch version, build number, quality score, entity counts, diff
against the previous build, tool version, uploader and timestamp.

Admins can disable a bundle with a reason, re-enable it, or delete it
permanently. Retention is automatic: the **last 3 uploader versions per build,
maximum 20 bundles overall** — older ones are removed.

Uploads happen **only through the tool**, never from the website.

## Starscape App

The **Starscape App** is a ~0.3 MB native Windows tray app that rotates your desktop through the
Starscape gallery, with prefetch, an optional crossfade, a screensaver mode and
one-click autostart. Full tray-menu reference on the
[Starscape](doc:starscape) page.
