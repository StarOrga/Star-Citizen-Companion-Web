# Starscape (wallpaper-app) — Release & Publish Pipeline

How a Starscape build reaches end-users. Starscape is a tiny native Windows Rust
tray app (~0.3 MB, no installer). Since 2026-07-26 it **does** have an in-app
updater and alpha/beta/stable rings — but they work differently from the
data-uploader's, so do not assume the Electron flow applies
(`data-uploader-release.md` is the electron-updater one).

## What a release needs (all of these, or `/starscape` shows the old version)

1. **Bump `wallpaper-app/Cargo.toml` + `Cargo.lock`** (the `starscape-wallpaper`
   package version — grep `name = "starscape-wallpaper"` in the lock). The CI's
   winresource step bakes this into the exe's version resource, and the app
   compares its own `CARGO_PKG_VERSION` against the feed.
2. **Merge to `main` + push tag `wallpaper-app-v<X.Y.Z>`** → the `build` job in
   `.github/workflows/wallpaper-app-build.yml`. The tag (not the merge) is what
   publishes: it runs `cargo test`, generates + bakes a fresh `SC_RELEASE_TOKEN`,
   builds `--release`, publishes the versioned exe **plus one identically-byte
   copy per ring** to the PUBLIC mirror `StarOrga/Star-Citizen-Companion-Binaries`
   via `BINARIES_RELEASE_TOKEN`, refreshes the `wallpaper-app-latest` alias (the
   fixed fallback URL), and prints the register SQL. A plain main-push only
   build-checks it (path-filtered) — no publish.
3. **`desktop_releases` row registered + `desktop_channels` alpha pointer set** in
   Supabase (`hcnqhvzlavdycidqyaai`) with `product = 'starscape'`. Copy the CTE the
   CI prints; the full `release_token` UUID comes from the run's `release-token`
   artefact (only its 8-char fingerprint is ever logged). Promotion afterwards is
   `select promote_starscape_channel('<X.Y.Z>','beta')` then `…,'stable')` — the
   same monotonic stable ⊆ beta ⊆ alpha rule as the uploader.

## Rings — how Starscape differs from the data-uploader

Both products share `desktop_releases` (`product` discriminator, 2026-07-24) and
`desktop_channels`, which is keyed **`(product, channel)`** since 2026-07-26.
The differences that matter:

- **The ring is decided by the download, never in the app.** A ring is a promotion
  pointer, not a build, so it cannot be baked into the binary. CI therefore
  publishes `starscape-wallpaper-<ver>-{stable,beta,alpha}.exe` — same bytes,
  three names — and the website links the one for the ring you picked. Precedence
  at every start (`update.rs` `resolve_channel`):
  1. an explicit `-stable`/`-beta`/`-alpha` marker in the exe's own filename wins
     (that marker only exists on a per-ring download, i.e. a choice made on the
     website — so re-downloading another ring re-locks the install),
  2. else the ring stored in `%APPDATA%\StarscapeWallpaper\config.ini`
     (`channel=` + `channel_locked=1`), so the version-less `latest` alias, a
     `… (1).exe` copy, a user rename, or a self-updated exe never moves rings,
  3. else `stable`.
  There is no in-app switch at all — that is the deliberate difference from the
  uploader's runtime channel picker. Marking a copy `-alpha` by hand buys nothing:
  the feed clamps by role, so the tray just reports "alpha not enabled for this
  account".
- **The role clamp is always authoritative.** `desktop-latest?product=starscape`
  always resolves through `starscape_release_for_channel()` (viewer/anon→stable,
  collaborator→beta, admin→alpha). The release token is only proof of a known,
  non-revoked build plus the `token_revoked` kill switch — unlike the uploader's
  token path it is **never** a channel bypass. An unauthenticated app therefore
  silently self-updates on stable; beta/alpha need a website sign-in
  (`/desktop/connect`, the loopback handshake, session DPAPI-sealed on disk).
- **Platform keys**: `win-x64` (canonical, kept for back-compat) plus
  `win-x64-stable` / `win-x64-beta` / `win-x64-alpha`. Use `sha256` — the app
  verifies size + SHA-256 against the catalog before overwriting itself, and there
  is still **no code signing**.
- `starscape_latest_release()` (newest-by-`created_at`, anon) still exists and is
  the page's fallback when no ring pointer is registered.

Register SQL (the CI prints this filled-in; or compute it — `gh release download
wallpaper-app-v<ver> --repo StarOrga/Star-Citizen-Companion-Binaries`, then
`sha256sum` + byte size). All four platform keys share one sha256/size:

```sql
with new_rel as (
  insert into public.desktop_releases (product, version, release_token, platforms, notes)
  values ('starscape', '<X.Y.Z>', '<token-uuid>', jsonb_build_object(
    'win-x64',        jsonb_build_object('url','<base>/starscape-wallpaper-<X.Y.Z>.exe','kind','exe','sha256','<sha256>','size_bytes',<bytes>),
    'win-x64-stable', jsonb_build_object('url','<base>/starscape-wallpaper-<X.Y.Z>-stable.exe','kind','exe','sha256','<sha256>','size_bytes',<bytes>),
    'win-x64-beta',   jsonb_build_object('url','<base>/starscape-wallpaper-<X.Y.Z>-beta.exe','kind','exe','sha256','<sha256>','size_bytes',<bytes>),
    'win-x64-alpha',  jsonb_build_object('url','<base>/starscape-wallpaper-<X.Y.Z>-alpha.exe','kind','exe','sha256','<sha256>','size_bytes',<bytes>)
  ), 'Starscape wallpaper <X.Y.Z>') returning id
)
insert into public.desktop_channels (product, channel, release_id)
select 'starscape', 'alpha', id from new_rel
on conflict (product, channel) do update
  set release_id = excluded.release_id, updated_at = now();
```

`<base>` = `https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/wallpaper-app-v<X.Y.Z>`.

## The updater, in one paragraph

`wallpaper-app/src/update.rs` checks the feed 20 s after start and every 6 h.
A build that is **strictly newer** on the app's locked ring is downloaded from the
host-pinned mirror, checked against the catalog's `size_bytes` + `sha256` (CNG)
and for a `MZ` header, then written over the running exe (rename-aside + rollback
on failure) and the app relaunches — silently, unless the screensaver is up or the
tray menu is open, in which case it is deferred (the new build is already on disk).
A clamped response is never installed (no ring switch), and an equal-or-older
version is never installed (no downgrade).

The tray menu is the only surface — no balloons, no toasts, no dialogs. Its first
entry is the version readout, greyed unless clicking it actually does something:

| state | tray reads | clickable |
|---|---|---|
| up to date | `◈ Aktuell · v0.4.0 · Stable` | no |
| newer build on the ring | `▲ Update verfügbar · v0.4.1` → downloads at once | no (already running) |
| staged, relaunch deferred | `◈ v0.4.1 installiert · aktiv beim nächsten Start` | no |
| ring > anon tier, no session | `◈ Anmelden für Beta-Updates` | **yes** → browser sign-in |
| signed in, role too low | `◈ v0.4.0 · Beta für dieses Konto nicht freigegeben` | no (a click cannot grant a role) |
| download/verify failed | `▲ Update fehlgeschlagen · erneut versuchen` | **yes** → retry |
| feed unreachable | `◈ Starscape v0.4.0 · Stable` | no |

A **valid stored session updates beta/alpha with no click at all**: the poll calls
`session::ensure_access_token()`, which silently refreshes through GoTrue, so the
sign-in entry only ever appears once the refresh token is gone too. After an
interactive sign-in the app forces itself to the foreground (`util::force_foreground`,
`AttachThreadInput`) and re-opens the tray menu, so the user lands back where they
started instead of hunting for the tray icon.

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
