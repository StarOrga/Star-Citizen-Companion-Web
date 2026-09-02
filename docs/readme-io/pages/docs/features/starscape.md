---
title: Starscape
excerpt: A gallery of original-resolution RSI artwork harvested from the news crawl, plus the 0.3 MB Windows Starscape App.
---

**Starscape** is the artwork side of the news crawl: high-resolution imagery
from RSI Comm-Links, collected as the feed is indexed. The gallery is public.

Every tile links straight to the original on the **RSI CDN** — SC Companion
stores the metadata and the link, never the bytes. Click a tile for full
resolution, the download link, and the source Comm-Link.

> All imagery © Cloud Imperium Games, served directly from the RSI CDN and
> linked with attribution to the source Comm-Link. Fan-made gallery — no
> re-sale, no re-hosting.

## Thumbs up, and the Top 7

Every tile carries a **thumbs up** — the stacked double triangle Spectrum uses
for an upvote. Hover a tile on a desktop to reveal it; on a phone or tablet it
is simply always there, and it is also in the opened tile next to *Share*.

One vote per person per image, and it is permanent until you take it back —
tapping it again removes your vote. Signed-out visitors still see how many
votes an image has; casting one needs an account.

Nobody can see *who* voted. The gallery only ever publishes the tally: the
votes themselves are readable by their owner and by no one else, and the count
is served by a database function that never returns a user.

**Show top 7 only** narrows the gallery to the seven highest-voted wallpapers
across all users. Early on, when barely anything has been voted for, the
newest images fill the remaining slots — the list is never short and never
empty. The setting is remembered per account.

> The same **Top 7** switch is planned for the desktop app's tray menu, so the
> rotation can follow the community's favourites. It is not in the tray yet —
> the ranking already lives in the database so both sides can share it.

## On a phone

The gallery is a single full-width column you scroll straight through. Most of
this artwork is ultrawide desktop wallpaper — wider than 2.2:1 — so a
side-by-side grid would squeeze each picture into a band barely a finger tall.
One image per row keeps every wallpaper at a size you can actually look at.

Phones are served the CDN's light preview variant instead of the wide one —
roughly a quarter of the bytes for the same tile — and opening a tile shows a
screen-sized copy rather than the multi-megabyte original. **Download original**
still gives you the untouched file. Tablets and desktops, whose tiles are wide
enough to show the difference, get the sharper variant.

**Share** in the opened tile hands the wallpaper to the Android/iOS share
sheet, so it can go straight into a chat, a note or your own timeline. The link
it shares reopens exactly that wallpaper. Browsers without a share sheet
(most desktops) copy the link to the clipboard instead.

## Starscape App

The **Starscape App** is a tiny native Windows tray app that rotates your desktop
background through the same gallery.

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
| **Send anonymous diagnostics** | Anonymous crash + launch telemetry, on by default. See [Diagnostics](#diagnostics) below — switching it off also deletes anything already recorded |
| **◈ v… (update status)** | Always names the running version plus the update state: up to date, update available, downloading, or *sign in to check*. Click to sign in, install, or retry |
| **Update channel ▸** | Which release ring the app follows. *Automatic (highest available)* is the default and picks the highest ring your account may use — alpha for admins, beta for collaborators, stable for everyone else — and re-checks that on every update poll. Pin *Stable*, *Beta* or *Alpha* instead if you want a fixed one; rings your account cannot use are shown greyed out rather than hidden |
| **Show Verse News summary now** | Re-fetch the summary and set it immediately |
| **Open Starscape website** | The web gallery |

#### Update channels

Starscape ships on three rings: **alpha** first, then **beta**, then **stable**.
They are pointers at the same build, promoted one after another — the binary is
identical, only *when* you receive it differs.

Which ring you get is decided by your account role, and by default the app takes
the **highest one you are entitled to**. Nothing has to be configured for that,
but two things are worth knowing:

- **Alpha and beta need a signed-in app.** Signed out, the update feed can only
  serve you stable, so the tray shows *"v… on a pre-release ring · sign in to
  check"* when a higher ring has moved ahead. Signing in through
  **Open Starscape website** resolves it — either into the newer build, or into a
  quiet "up to date" if your role does not reach that ring after all.
- **Pinning is a one-click escape hatch.** Pick a specific ring under
  **Update channel** to stop following the highest one; the choice survives
  restarts and self-updates. Downloading a `-beta` or `-alpha` build from the
  website also pins that ring, but only on a brand-new install.

### Diagnostics

Starscape reports the same anonymous telemetry as the other desktop clients —
one shared, signed endpoint, one table, and a `product` tag that keeps the
three apart in the admin dashboard.

Exactly two things are sent:

- **Once per launch** — that it started, plus how it is configured (mode, fade,
  paused, rotation interval, screensaver delay, Verse-News-on-start).
- **After a crash** — the panic message and the source line, reported on the
  *next* start. Nothing is sent from inside the crashing process.

There is no account, no IP address and no file path in any of it. The install
and session identifiers are random values that the server only ever stores as
salted hashes. Turn it off any time via **Send anonymous diagnostics** in the
tray menu; that also deletes any crash record still waiting on disk.

See [Desktop tools](doc:desktop-tools) for the other companion binary.
