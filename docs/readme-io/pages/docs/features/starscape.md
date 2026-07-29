---
title: Starscape
excerpt: A gallery of original-resolution RSI artwork harvested from the news crawl, plus a 0.3 MB Windows wallpaper app.
---

**Starscape** is the artwork side of the news crawl: high-resolution imagery
from RSI Comm-Links, collected as the feed is indexed. The gallery is public.

Every tile links straight to the original on the **RSI CDN** — SC Companion
stores the metadata and the link, never the bytes. Click a tile for full
resolution, the download link, and the source Comm-Link.

> All imagery © Cloud Imperium Games, served directly from the RSI CDN and
> linked with attribution to the source Comm-Link. Fan-made gallery — no
> re-sale, no re-hosting.

## Desktop wallpaper app

A tiny native Windows tray app rotates your desktop background through the same
gallery.

- **Native, no runtime.** Pure Win32 — the release binary is about **0.3 MB**
  and idles in the low single-digit MB of memory.
- **Prefetch.** A background thread keeps the next few images on disk, so a
  switch never stalls on a download.
- **No settings screen.** Everything is in the tray right-click menu.

Download it from the [Starscape page](https://sc-companion.vercel.app/starscape)
in the app. It is Windows-only and unsigned, so SmartScreen will warn on first
run (*More info → Run anyway*).

### Tray menu

| Item | What it does |
|---|---|
| **Next wallpaper** | Switch immediately (also on double-click of the tray icon) |
| **Paused** | Stop the timed rotation |
| **Mode ▸** | *Desktop background* (default), *Screensaver* (fullscreen slideshow after idle, wallpaper untouched), or *Both* |
| **Screensaver delay ▸** | Idle time before the screensaver appears — 5 / 10 / 15 / 30 / 60 min |
| **Fade transition** | Toggle the crossfade |
| **Weekly Verse News on start** | Show a weekly Verse-News summary image as the first wallpaper after boot or login, once per day. On by default |
| **Start with Windows** | Autostart via the user's `Run` key. On by default for new installs; existing installs keep their current setting. When enabled, the entry always follows the copy you actually launched — downloading a newer build and starting it once is enough to make it the installed one |
| **◈ v… (update status)** | Always names the running version plus the update state: up to date, update available, downloading, or *sign in for `<ring>` updates*. A signed-out install on a locked ring even flags "outdated" when a newer build is already public. Click to sign in, install, or retry |
| **Show Verse News summary now** | Re-fetch the summary and set it immediately |
| **Open Starscape website** | The web gallery |

See [Desktop tools](doc:desktop-tools) for the other companion binary.
