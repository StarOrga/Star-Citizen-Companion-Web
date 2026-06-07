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
3. **`desktop_releases` row registered** in Supabase (`hcnqhvzlavdycidqyaai`):
   `is_current = true` + `release_token` matching the build's `release-token`
   artifact + `platforms` (`win-x64-setup` / `win-x64-portable`: `url`, `kind`,
   `sha512`, `size_bytes`). The `/desktop` web page AND the in-app updater read
   `desktop_releases`, NOT GitHub directly — without this row the page shows the
   previous version even when the GitHub release is correct.

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

Then register `desktop_releases`: the `sha512` + `size_bytes` come from the
downloaded assets, the `release_token` UUID from the `release-token` workflow
artifact of the build run.

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
