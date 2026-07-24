# Starscape (wallpaper-app) — Release & Publish Pipeline

How a Starscape build reaches end-users. Starscape is a tiny native Windows Rust
tray app (~0.3 MB, no installer, **no in-app updater**). It is a SEPARATE, simpler
flow from the data-uploader — do not confuse them (`data-uploader-release.md` is
the Electron one with channels + electron-updater).

## What a release needs (all of these, or `/starscape` shows the old version)

1. **Bump `wallpaper-app/Cargo.toml` + `Cargo.lock`** (the `starscape-wallpaper`
   package version — grep `name = "starscape-wallpaper"` in the lock). The CI's
   winresource step bakes this into the exe's version resource.
2. **Merge to `main` + push tag `wallpaper-app-v<X.Y.Z>`** → the `build` job in
   `.github/workflows/wallpaper-app-build.yml`. The tag (not the merge) is what
   publishes: it builds `--release`, publishes the versioned exe to the PUBLIC
   mirror `StarOrga/Star-Citizen-Companion-Binaries` via `BINARIES_RELEASE_TOKEN`,
   refreshes the `wallpaper-app-latest` alias (the fixed fallback URL), and prints
   the `desktop_releases` register SQL in the build log. A plain main-push only
   build-checks it (path-filtered) — no publish.
3. **`desktop_releases` row registered** in Supabase (`hcnqhvzlavdycidqyaai`) with
   `product = 'starscape'`. The public `/starscape` gallery page reads the current
   build through the `starscape_latest_release()` RPC (newest-by-`created_at`), NOT
   GitHub directly — without this row the page's download CTA falls back to the
   version-less `wallpaper-app-latest` alias and shows **no version number**.

## The `desktop_releases` row — how Starscape differs from the data-uploader

Both products share the `desktop_releases` table (`product` discriminator, added
2026-07-24). But Starscape uses **none** of the uploader's update machinery:

- **No channels.** Starscape is not in `desktop_channels` (alpha/beta/stable). The
  resolver is plain newest-`created_at` for `product='starscape'`. Do NOT call
  `promote_desktop_channel` for it (that RPC is hardened to `product='uploader'`).
- **No release-token gate / no in-app updater.** The binary is a public mirror
  asset and the app never self-updates, so the `release_token` column is just the
  table default (`gen_random_uuid()`) — unused. `starscape_latest_release()` is
  `anon`-executable and returns only public download metadata (never the token).
- **Single platform key** `win-x64` (one exe), vs the uploader's
  `win-x64-setup` / `win-x64-portable`. Use `sha256` (electron-updater's forced
  `sha512` is irrelevant here — no electron-updater).

Register SQL (the CI prints this filled-in; or compute it — `gh release download
wallpaper-app-v<ver> --repo StarOrga/Star-Citizen-Companion-Binaries`, then
`sha256sum` + byte size):

```sql
insert into public.desktop_releases (product, version, platforms, notes)
values ('starscape', '<X.Y.Z>', jsonb_build_object(
  'win-x64', jsonb_build_object(
    'url','https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-v<X.Y.Z>/starscape-wallpaper-<X.Y.Z>.exe',
    'kind','exe','sha256','<sha256>','size_bytes',<bytes>)
), 'Starscape wallpaper <X.Y.Z>');
```

## Registration needs Supabase write — but the routine env is authenticated

Steps 1–2 (bump, tag, CI build, mirror publish) are doable with `git` + `gh`
alone. Step 3 (`desktop_releases` row) needs Supabase **write**. In the routine's
session the Supabase MCP is authenticated, so register the row there (the usual
headless blocker — see `data-uploader-release.md` — does not apply here). If a
run ever lacks Supabase write, do steps 1–2, then flag the release as
"built + mirrored but NOT live" and hand off the register SQL — never report done
while the row is missing.

## Verify live before declaring done

A green CI build ≠ a visible release — the `desktop_releases` row is the "make it
live" switch. After registering, verify on the PUBLIC `/starscape` page (no auth):
the download CTA reads **"↓ … v<X.Y.Z>"**. The app is a PWA, so an already-open
visitor sees the new page only after a service-worker update (the in-app "new
version" prompt) — a fresh load shows it immediately; both are expected.
