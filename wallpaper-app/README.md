# Starscape Wallpaper

A tiny native Windows tray app that rotates your desktop background through the
Star Citizen Companion **Starscape** gallery — original-resolution RSI news art,
with an optional crossfade and one-click autostart.

- **Native, no runtime.** Pure Win32 via `windows-sys`. Release binary ≈ **0.3 MB**,
  idle memory in the low single-digit MB range.
- **No settings required.** Runs from the tray; right-click for the menu.
- **Prefetch.** A background thread keeps the next few images on disk, so a switch
  never stalls on a download.

## Tray menu

- **Next wallpaper** — switch immediately (also on double-click of the tray icon)
- **Paused** — stop the timed rotation
- **Mode ▸** — what Starscape imagery does with your screen:
  - *Desktop background* (default) — rotate the wallpaper on the interval timer
  - *Screensaver* — never touch the wallpaper; show a fullscreen slideshow after
    an idle period instead
  - *Both* — rotate the wallpaper **and** show the screensaver when idle
- **Screensaver delay ▸** — idle time before the screensaver appears (5/10/15/30/60 min)
- **Fade transition** — toggle the crossfade
- **Weekly Verse News on start** — show a weekly Verse-News summary image as the
  first wallpaper after boot/login (once per day, on by default)
- **Start with Windows** — autostart via `HKCU\…\Run` (**on by default for new
  installs**; existing installs keep whatever they already had)
- **Show Verse News summary now** — re-fetch the summary and set it as the
  wallpaper immediately, useful for testing without a reboot
- **Open Starscape website** — the web gallery
- **Quit**

## How it works

1. Fetches the ordered wallpaper list from the public Supabase `verse_wallpapers`
   endpoint (`source_url` = original resolution). Only the **publishable** key is
   embedded — the same one shipped in the web bundle; no secret.
2. Downloads originals from the RSI media CDN (with a Referer, like the news crawl).
3. Sets the desktop wallpaper via `SystemParametersInfoW(SPI_SETDESKWALLPAPER)`;
   the crossfade uses a fullscreen layered overlay animated from transparent to
   opaque, then swaps the real wallpaper underneath it.
4. **Screensaver mode** shows a fullscreen `WS_POPUP` slideshow (reusing the same
   image decode/paint code as the wallpaper crossfade) after `GetLastInputInfo`
   reports the configured idle time. It advances every ~8s through the same
   prefetched gallery images already cached on disk, newest first, and closes on
   any genuine keyboard input, mouse click, or mouse move beyond a tiny jitter
   threshold — it never traps input.
5. **Boot summary**: on startup, if due (once per calendar day, opt-out via the
   tray toggle), the app fetches a rendered weekly Verse-News summary image from
   the `starscape-summary` Supabase Edge Function and applies it as the **very
   first** wallpaper — before any gallery image — regardless of the configured
   mode. A 12s timeout guarantees the desktop is never left blank waiting on it;
   on failure or timeout it falls back to the first gallery image as before.
6. **Autostart default**: a genuinely new install (no existing `config.ini`)
   turns on "Start with Windows" automatically. Existing installs are migrated
   once (a flag is persisted) without changing their current autostart choice —
   nobody gets silently opted in later.

Config lives at `%APPDATA%\StarscapeWallpaper\config.ini` (rotation interval,
fade, paused, mode, screensaver delay, autostart-initialized flag, weekly-summary
opt-in + last-shown date); prefetched images and the cached summary image in
`…\cache`. Old config files (only `interval_min`/`fade`/`paused`) still load fine —
missing keys fall back to their defaults.

## Troubleshooting

If the app doesn't appear to start, check the diagnostics log at
`%APPDATA%\StarscapeWallpaper\starscape.log`. It records startup milestones, any
panic before the process exits, GDI+ init failures, and per-download outcomes —
including a wallpaper **rejected for being truncated/corrupt** (the cause of a
grainy "krisselig" background). The tray icon always appears (a system fallback
is used if the bundled `.ico` can't load), so a *missing* icon means the process
never launched at all — most often an antivirus/SmartScreen quarantine on the
unsigned binary.

## Build

```sh
cargo build --release
# → target/release/starscape-wallpaper.exe
```

Requires a Windows Rust toolchain (MSVC or GNU host). CI builds with
`stable-x86_64-pc-windows-msvc`.

## Release

Push a `wallpaper-app-v<version>` tag. The `wallpaper-app` GitHub Actions workflow
builds the release binary and publishes it to the public
[`StarOrga/Star-Citizen-Companion-Binaries`](https://github.com/StarOrga/Star-Citizen-Companion-Binaries)
mirror (via `BINARIES_RELEASE_TOKEN`), the same handoff the `data-uploader` uses.

Two releases are published per tag: the versioned `wallpaper-app-v<version>`
(history) and a stable **`wallpaper-app-latest`** alias carrying a version-less
`starscape-wallpaper.exe`. The Starscape page links the alias, so the download
URL always resolves to the newest build and never needs a manual bump.

The binary is **unsigned** (Phase-2 limitation) — Windows SmartScreen warns on
first run: **More info → Run anyway**.
