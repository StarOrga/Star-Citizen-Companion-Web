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
- **Fade transition** — toggle the crossfade
- **Start with Windows** — autostart via `HKCU\…\Run`
- **Open Starscape** — the web gallery
- **Quit**

## How it works

1. Fetches the ordered wallpaper list from the public Supabase `verse_wallpapers`
   endpoint (`source_url` = original resolution). Only the **publishable** key is
   embedded — the same one shipped in the web bundle; no secret.
2. Downloads originals from the RSI media CDN (with a Referer, like the news crawl).
3. Sets the desktop wallpaper via `SystemParametersInfoW(SPI_SETDESKWALLPAPER)`;
   the crossfade uses a fullscreen layered overlay animated from transparent to
   opaque, then swaps the real wallpaper underneath it.

Config lives at `%APPDATA%\StarscapeWallpaper\config.ini` (rotation interval, fade,
paused); prefetched images in `…\cache`.

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
