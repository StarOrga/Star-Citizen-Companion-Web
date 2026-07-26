# Data Uploader — Release & Publish Pipeline

How a data-uploader binary actually reaches end-users. The encoding/Python
constraints live in `data-uploader-python.md`; this file is the SHIP path.

## What a release needs (all of these, or it is NOT "live")

A data-uploader release is not visible to users until ALL of:

1. **Merge to `main` + push tag `data-uploader-v<X.Y.Z>`** — triggers the
   `build-windows` job in `.github/workflows/data-uploader-build.yml`. Bump
   `data-uploader/package.json` (NOT the root web version); see `devops-ship`
   extension rule 4.
2. **Public mirror release** on `StarOrga/Star-Citizen-Companion-Binaries`
   exists AND is a **full release, not a prerelease**. A prerelease leaves the
   prior `v*.*.0` as "Latest", and GitHub `/releases/latest` + the download page
   skip prereleases → users keep seeing the old version. `ship_release`'s
   `prerelease: true` (a 0.x convention for the *private* source release) must
   NOT leak into the public mirror.
3. **`desktop_releases` row registered + `desktop_channels` alpha pointer set**
   in Supabase (`hcnqhvzlavdycidqyaai`). `desktop_releases` is an immutable build
   catalog; `desktop_channels` (alpha/beta/stable → release_id) decides which
   build each ring serves. A new uploader release defaults to the **alpha** ring;
   promotion to beta/stable is a deliberate later step via the
   `/admin/desktop-releases` panel or `promote_desktop_channel(version, channel)`.
   The row needs `release_token` matching the build's `release-token` artifact +
   `platforms` (`win-x64-setup` / `win-x64-portable`: `url`, `kind`, `sha512`,
   `size_bytes`). Register with the CTE the CI prints (its "Print catalog-register
   SQL" step) — insert the build and point alpha at it in one statement:

       WITH new_rel AS (
         INSERT INTO public.desktop_releases (version, release_token, platforms, notes)
         VALUES (...) RETURNING id
       )
       INSERT INTO public.desktop_channels (product, channel, release_id)
       SELECT 'uploader', 'alpha', id FROM new_rel
       ON CONFLICT (product, channel) DO UPDATE
         SET release_id = EXCLUDED.release_id, updated_at = now();

   `desktop_channels` is keyed **`(product, channel)`** since 2026-07-26 (Starscape
   got its own rings). Naming `product` in the conflict target is not optional: the
   old single-column constraint is gone, so `ON CONFLICT (channel)` now errors out.

   The `/desktop` web page AND the in-app updater resolve the release through the
   channel pointer (role-clamped: admin→alpha, collaborator→beta, viewer→stable),
   NOT GitHub directly — without the row + pointer the page shows the previous
   version even when the GitHub release is correct.

## BINARIES_RELEASE_TOKEN (cross-repo publish PAT)

The CI step "Publish to PUBLIC binaries-mirror" uses the `BINARIES_RELEASE_TOKEN`
secret — a fine-grained PAT with Contents:write on the binaries repo. The
**StarOrga org forbids fine-grained PATs with lifetime > 366 days** → a
"No expiration" or >1-year PAT 403s ("Resource not accessible by personal access
token"). Always create it with expiry **≤ 366 days**. Fine-grained PATs cannot
be edited after creation — regenerate to change the lifetime.

## Manual-mirror fallback (CI public-publish failed on the token)

The binary is also published to the private source-repo release (for
maintainers), so when the public mirror step fails, do NOT rebuild via CI —
mirror the already-built assets directly with admin `gh` auth (no PAT, no
~15-min rebuild):

    gh release download data-uploader-v<X.Y.Z> --repo StarOrga/Star-Citizen-Companion-Web --dir <tmp>
    gh release create   data-uploader-v<X.Y.Z> --repo StarOrga/Star-Citizen-Companion-Binaries \
        --latest  <tmp>/*.exe <tmp>/*.blockmap        # NOT --prerelease (see point 2)

Then register the release the same way as a normal ship — the `desktop_releases`
row + `desktop_channels` alpha pointer (the CTE in "What a release needs" point
3): the `sha512` + `size_bytes` come from the downloaded assets, the
`release_token` UUID from the `release-token` workflow artifact of the build run.

## The `desktop_releases` row is the usual headless blocker (Supabase auth)

Points 1–2 (tag → CI build → GitHub release → public mirror) are doable with
`gh` alone. Point 3 (the `desktop_releases` row) needs Supabase **write**
access, and the **Supabase MCP is normally NOT authenticated in headless /
automated sessions** (it needs interactive OAuth). When it isn't:

- The build, GitHub release, and public mirror can all be green while `/desktop`
  still serves the old version — the row + its alpha channel pointer are the true
  "make it live" switch.
- Register it through an authenticated path instead: interactive Supabase MCP
  (`/mcp` in a terminal session), the Supabase SQL editor, or a linked
  `supabase` CLI / psql with the project connection. The `release_token` UUID
  comes from the build run's `release-token` artifact; `sha512` / `size_bytes`
  from the built assets — so the row can only be written **after** the build.
- Until the row lands, report the release as "binary built + mirrored but NOT
  live", never as done. (Observed 2026-07-09 shipping uploader 0.13.0: Supabase
  MCP unauthenticated → row deferred; tag/build/mirror done, `/desktop` stale.)

## Verify live in Edge before declaring done

A green pipeline ≠ a visible release. The prerelease, `desktop_releases`, and
token gaps above all pass CI yet hide the version from users. So after any
release, verify the actual user-facing surfaces live in Edge (Claude-in-Chrome)
— not just that the merge/tag landed:

- `sc-companion.vercel.app/desktop` shows the new version + correct hashes and
  download links (the page is auth-gated → admin/collaborator session in Edge)
- GitHub `/releases/latest` on the binaries repo returns the new tag

This "verify the real surface before saying done" habit is the project instance
of a general ship practice — see upstream FEAT in `Jerry0022/dotclaude`.
