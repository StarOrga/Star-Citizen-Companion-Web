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
- **Send anonymous diagnostics** — anonymous crash + launch telemetry
  (**on by default, opt-out**); see [Telemetry](#telemetry)
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
   opaque, then swaps the real wallpaper underneath it. **That overlay lives
   inside Explorer's wallpaper layer**, not on top of the desktop: before it is
   ever shown it is re-parented (`SetParent`) into the `WorkerW` behind the
   desktop icons — or into `Progman` itself, which is what current Windows 11
   builds use since they no longer spawn a separate `WorkerW`. It is never
   `WS_EX_TOPMOST` and carries `WS_EX_NOACTIVATE`, so a wallpaper change can
   neither cover an application (fullscreen games included) nor move the focus.
   If that layer cannot be reached, the crossfade is skipped and the wallpaper
   switches instantly rather than risking a window over the user's work.
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

## Telemetry

Starscape reports through the **same** signed ingest path as the SCC app and the
Data Uploader — one endpoint, one table, one signature scheme (`src/telemetry.rs`,
`supabase/functions/ingest-telemetry`). Rows are tagged `product='starscape'`,
which is what the admin dashboard's per-product view filters on.

What is sent, and only this:

| When | Wire | Content |
| --- | --- | --- |
| Every launch (~20 s in) | `usage` | metric `app_start`, plus the configuration: mode, fade, paused, interval, screensaver delay, Verse-News-on-start |
| Next launch after a panic | `crash` | the panic message + its `src/*.rs:line`, bucketed as `errorType=panic` |

- **Opt-out** via the tray menu (*Send anonymous diagnostics*, on by default —
  the same default the Data Uploader uses). Switching it off deletes any stored
  crash record immediately; it does not just stop the sending.
- A panic is **written to disk and reported on the next start**, never from
  inside the dying process — this binary is built with `panic = "abort"` and a
  blocking HTTPS call in the panic hook would hang a crash.
- `installId` / `sessionId` are opaque random hex; the server only ever stores
  salted hashes of them. There is no account, no IP, and no file path beyond
  this crate's own source locations.
- Signing key: `SC_TELEMETRY_HMAC_KEY`, baked in at build time via `option_env!`
  (mirroring the uploader's Vite define). It is a shared anti-abuse secret, not
  a credential — writes are service-role-only and reads are admin-RPC-only. A
  local `cargo build` gets the public dev fallback and its reports are rejected.

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
