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

- **Since 0.6.0 the ring follows the ROLE, and the tray can pin it.** A ring is a
  promotion pointer, not a build, so it cannot be baked into the binary. CI still
  publishes `starscape-wallpaper-<ver>-{stable,beta,alpha}.exe` — same bytes,
  three names. What changed is how the app decides which one it tracks
  (`util.rs` `RingPref`, `update.rs` `resolve_preference`):
  1. `config.ini` `channel_pref=` (`auto` | `stable` | `beta` | `alpha`) wins,
     always. It is written by the tray picker, and it has to outrank the filename
     because a self-update overwrites the exe **in place** — the name a copy was
     first downloaded under outlives every later choice, so letting the name win
     would silently revert the picker on each restart.
  2. On a genuine first run only (no config file yet), a `-beta`/`-alpha` marker
     in our own filename pins that ring. Those assets sit behind the website's
     per-ring overlay and are only offered to roles that already reach them, so
     the marker is a real choice — including the choice to sit BELOW the top ring.
  3. A `-stable` marker pins **nothing**. It is what the site's default download
     CTA (`promoDownloadUrl`) hands every visitor, so it is evidence of clicking
     the big button, not of wanting stable. Treating it as a lock is exactly what
     stranded an admin on 0.4.4 while alpha served 0.5.0 (feedback 8058fe9a).
  4. Absent `channel_pref` ⇒ `auto`. That is the deliberate migration: every
     pre-0.6.0 install, all of which were pinned by filename, moves to auto.
     `channel_locked` is no longer read at all.

  **`auto` is resolved by the SERVER, not the client.** It simply requests
  `?channel=alpha` and follows whatever ring comes back: `starscape_release_for_channel`
  clamps to `admin→alpha / collaborator→beta / else stable` and echoes the ring it
  actually served, so the clamp IS the answer to "what is my highest ring". No new
  endpoint, no migration, and no role table duplicated in the Rust client. In auto
  mode a clamp therefore never produces `NotEntitled` or the cross-ring refusal —
  those are pinned-mode states, and `clamp_is_only_nominal` is only consulted there.
  `config.ini` `channel=` keeps its meaning as *the ring the last check resolved
  to* (readout + launch telemetry), written back when the tray menu next opens.

- **The tray picker** (`Update-Kanal ▸` / `Update channel ▸`, directly under the
  version readout) offers *Automatisch (höchster verfügbarer)* plus all three
  rings. Rings above the account's reach are shown **greyed, not hidden** — a ring
  should be a visible fact ("Alpha exists, my account isn't in it"), not a
  capability that silently differs per machine. Until a check has succeeded the
  reach is unknown (`update::max_ring() == None`) and all three stay enabled:
  greying on a guess could hide the very entry that fixes a wrong ring. Picking a
  ring persists it, drops the cached verdict (it belonged to the old ring) and
  fires an **interactive** cycle at once — so a deliberate click can open the
  sign-in instead of waiting up to 6 h for the silent poll.
- **The role clamp is always authoritative.** `desktop-latest?product=starscape`
  always resolves through `starscape_release_for_channel()` (viewer/anon→stable,
  collaborator→beta, admin→alpha). The release token is only proof of a known,
  non-revoked build plus the `token_revoked` kill switch — unlike the uploader's
  token path it is **never** a channel bypass. An unauthenticated app therefore
  silently self-updates on stable; beta/alpha need a website sign-in
  (`/desktop/connect`, the loopback handshake, session DPAPI-sealed on disk).
- **The clamp costs the download, not the verdict.** Since
  `20260830120000_starscape_ring_version_hint` the resolver also returns
  `requested_version` — the version the caller's OWN ring is on, resolved
  *without* the clamp — and the feed forwards it as `requestedVersion`. A
  signed-out alpha install can therefore answer "am I up to date?" on its own and
  reports plain `Current`; the sign-in entry appears only when that ring is
  genuinely ahead. Only a version STRING crosses the clamp — no url, no sha256,
  no size — and Starscape's binaries are public mirror assets anyway, so the
  number was never a secret. Before this, alpha (which by definition runs ahead
  of stable) could never trigger the old "even stable is newer" hint, so the tray
  had nothing to say but "sign in for alpha updates" whether or not anything was
  waiting. Since 0.6.0 `requestedVersion` does double duty: in `auto` it is
  alpha's version (auto always asks for alpha), which is what lets a signed-out
  install say "v0.5.0 is on a pre-release ring" instead of nothing at all.
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
A build that is **strictly newer** on the ring the app follows is downloaded from
the host-pinned mirror, checked against the catalog's `size_bytes` + `sha256` (CNG)
and for a `MZ` header, then written over the running exe (rename-aside + rollback
on failure) and the app relaunches — silently, unless the screensaver is up or the
tray menu is open, in which case it is deferred (the new build is already on disk).
An equal-or-older version is never installed (no downgrade).

The cross-ring guard below applies **only under `RingPref::Pinned`** (0.6.0+). In
`auto` the request is deliberately for alpha and the clamp is the answer, so the
served ring is simply followed and the asset picked is `win-x64-<served ring>`.

Pinned: a clamped response is never installed (no ring switch) — with one
exception since 0.4.4: when the served ring is on the SAME version as ours there is
no gap left to cross, the payload IS our own build, and refusing it was a pure
deadlock (an alpha install with a broken session could not take a build the server
was already handing out unauthenticated). `clamp_is_only_nominal` turns false the
instant the two versions differ in either direction, so a viewer asking for alpha
while alpha leads stable still gets nothing, and the asset picked is
`win-x64-<our ring>` so the file keeps its ring-marked name.

The tray menu is the only surface — no balloons, no toasts, no dialogs. Its first
entry is the version readout, greyed unless clicking it actually does something:

| state | tray reads | clickable |
|---|---|---|
| up to date — **including signed-out on beta/alpha** | `◈ Aktuell · v0.4.0 · Stable` | no |
| newer build on the ring | `▲ Update verfügbar · v0.4.1` → downloads at once | no (already running) |
| staged, relaunch deferred | `◈ v0.4.1 installiert · aktiv beim nächsten Start` | no |
| **auto**, no session, a higher ring leads | `▲ v0.4.4 · v0.5.0 im Vorab-Ring · anmelden zum Prüfen` | **yes** → browser sign-in |
| **pinned** ring > anon tier, no session, ring **is** ahead | `▲ v0.4.0 → v0.4.1 · Anmelden zum Installieren` | **yes** → browser sign-in |
| **pinned** ring > anon tier, no session, feed cannot say (pre-`requestedVersion`) | `◈ v0.4.0 · Anmelden für Beta-Updates` | **yes** → browser sign-in |
| **pinned**, signed in, role too low | `◈ v0.4.0 · Beta für dieses Konto nicht freigegeben` | no (a click cannot grant a role) |
| download/verify failed | `▲ Update fehlgeschlagen · erneut versuchen` | **yes** → retry |
| feed unreachable | `◈ Starscape v0.4.0 · Stable` | no |

The auto row is worded as a **check**, not a promise: signed out, the app cannot
know whether the account reaches that ring at all. Signing in resolves it either
way — into the download, or into a plain `Aktuell` on whatever ring the role does
reach. The mirror case (a live session, and the role genuinely is the ceiling)
deliberately reports plain `Aktuell` instead of nagging: `PreRelease` with a token
that just survived `session::revalidate()` means the role is the limit, and no
click can move it.

A **valid stored session updates beta/alpha with no click at all**: the poll calls
`session::ensure_access_token()`, which silently refreshes through GoTrue, so the
sign-in entry only ever appears once the refresh token is gone too.

That used to happen about daily. Findings from digging into it on 2026-08-30,
because the obvious explanations are all wrong and the next person will reach for
them too:

- **It is not an expiry.** The project runs `sessions_timebox = 0` and
  `sessions_inactivity_timeout = 0` (`jwt_exp = 3600`), so an untouched session
  never ends. There is no "make it last a year" setting missing — it already
  lasts forever until something actively kills it.
- **It is not (currently) the shared refresh token.** `/desktop/connect` handed
  the app the BROWSER'S OWN `refresh_token`, so both clients rode one rotation
  chain and the second to refresh presents a spent token. Tested directly against
  this project: the spent token was still accepted 12 s later, well past the 10 s
  reuse window. Reuse-detection is not biting here, so this was a race waiting to
  happen, not the reported bug. Fixed anyway (`desktop-session` mints an
  independent session per client, verified by rotating one and refreshing the
  other) because the toggle that arms it is one dashboard click away.
- **The store was discarded on transport failures.** `session::refresh()`
  returned a bare `None` for "offline", "DNS", "5xx" and "401" alike, and
  `ensure_access_token()` cleared the store on any of them. The first update poll
  runs 20 s after start, which on a cold boot routinely lands before Wi-Fi, VPN or
  DNS are up. Now `RefreshError::{Rejected,Unavailable}` splits a verdict (4xx)
  from an outage, and only a verdict clears the store.
- **The whole path was mute.** `Session::load()` returned `None` without a word
  on an unreadable file, a failed DPAPI unseal, or bad UTF-8, and `refresh()`
  logged nothing when the request could not be sent at all. Forensics on the real
  install showed `session.bin` untouched since 29 Jul (decryptable, expired,
  refresh token intact) and **not one `session:` line** in a month of logs — even
  though every branch of `ensure_access_token()` is supposed to log one. That
  contradiction is still unexplained; the logging added here is what answers it on
  the next occurrence instead of another round of guessing.

A failed mint falls back to posting the browser session rather than breaking the
only way to connect an app. The uploader's `/uploader/auth` hand-off shared the
same shape and uses the same function. A global `signOut()` on the website still
revokes the minted session — signing out is supposed to disconnect the apps.

After an interactive sign-in the app forces itself to the foreground
(`util::force_foreground`, `AttachThreadInput`) and re-opens the tray menu, so the
user lands back where they started instead of hunting for the tray icon.

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
