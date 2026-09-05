# Deployment Status

Current live-deploy state of SC Companion surfaces. Update this file when a
surface flips between deployed / pending / broken.

## Vercel (web app)

- **Vercel project:** `star-citizen-companion-website` (NOT `-web` — renaming the
  GitHub repo did not rename the Vercel project, and `star-citizen-companion-web.vercel.app`
  never existed; it 404s with `DEPLOYMENT_NOT_FOUND`)
- **Canonical URL:** `https://sc-companion.vercel.app` (short alias, primary)
- **Auto-assigned URL:** `https://star-citizen-companion-website.vercel.app` (307s to the canonical URL)
- **Status:** ✅ LIVE — auto-deployed from `main` via GitHub integration.
- **Implication for tasks:** every push to `main` triggers a Vercel
  build. `curl -sI https://sc-companion.vercel.app` (200 OK expected) proves the
  **site** is up; for a specific path, probe it directly:
  `curl -sI https://sc-companion.vercel.app/desktop`.
- **A 200 OK does NOT prove your change is live.** The site answers 200 the whole
  time it is serving the *previous* build, and a production build can be queued,
  skipped, or fail. Merge → live took 5.3–9.5 min in the four deploys before
  2026-09-05 22:38Z, and the merge of PR #534 (22:46Z) produced **no production
  deployment at all** — 30 minutes later production was still two merges behind.
  Verify against the **merge SHA** instead:

  ```bash
  SHA=$(git rev-parse origin/main)
  gh api "repos/StarOrga/Star-Citizen-Companion-Web/deployments?sha=$SHA&environment=Production" --jq '.[].id'
  gh api "repos/StarOrga/Star-Citizen-Companion-Web/deployments/<id>/statuses" --jq '.[0].state'
  ```

  An empty list means the build never started — that is a negative result, not
  "still building". The strongest cheap confirmation is a content probe on an
  **unhashed** asset with the service worker bypassed, e.g.
  `curl -s 'https://sc-companion.vercel.app/i18n/en.json?ngsw-bypass=true'` grepped
  for a string the merge introduced.
- **In a browser it is a PWA.** `ngsw` replays the cached shell to returning
  visitors, so a live deploy still looks unshipped until a hard reload
  (`Strg+Shift+R`) or `?ngsw-bypass=true`. Never conclude "not deployed" from a
  browser tab alone.
- **History note:** during the 2026-05-24 rebrand we briefly tried
  `scc.vercel.app` (shorter, cleaner) — but that hostname was already
  taken on Vercel by someone else. Fell back to `sc-companion.vercel.app`
  which is the original assumption from earlier sessions; the apparent
  404 in earlier probes was because the alias hadn't been added yet,
  not because the hostname was unassigned. Don't re-attempt `scc` until
  the existing owner releases it.

## Supabase Edge Functions

- **Project:** `hcnqhvzlavdycidqyaai` (eu-central-1)
- **Status:** ✅ deployed. `npm run functions:deploy` rolls out all
  functions in `supabase/functions/`. `desktop-latest` specifically is
  deployed with `--no-verify-jwt` so the release-token branch can hit
  the function without an auth header (see
  `supabase/functions/desktop-latest/index.ts` header comment).

## Supabase Postgres

- **Status:** ✅ migrations 00001–00006 applied. `npm run db:push` works
  cleanly after migration-history was repaired (the cloud DB had stale
  timestamp-version rows from earlier sessions; `supabase migration
  repair --status reverted/applied` reconciles them).

## Data Uploader — Windows binary

- **Status:** per-tag, see latest `data-uploader-build` workflow run on
  the `data-uploader-v*` tags. Check `gh run list --workflow=data-uploader-build.yml`
  before assuming a tag corresponds to a usable installer.
- **Release token:** generated per-build, uploaded as a separate
  `release-token` workflow artefact (retention 7d) — fetch with
  `gh run download <run-id> -n release-token`, then register the UUID
  in `desktop_releases` via the admin RPC so the Tool can authenticate
  against `desktop-latest` and `ingest-bundle`.

### Asset hosting — two-repo topology (since 2026-05-24, issue #7)

The Data Uploader's auto-update download URL must be publicly fetchable
(electron-updater has no GitHub credentials). This repo is private, so
a public mirror exists:

| Repo | Purpose |
|---|---|
| `Jerry0022/Star-Citizen-Companion-Web` (PRIVATE — this one) | Source code, releases include token-artefact + maintainer changelog |
| `StarOrga/Star-Citizen-Companion-Binaries` (PUBLIC) | Release mirror — `.exe` + `.blockmap` + `latest.yml`, end-user download URL |

When tagging `data-uploader-v*`, GH-Actions publishes the same assets to
**both** repos. The Edge Function `desktop-latest` returns YAML pointing
at the **public mirror's** URLs (set via `desktop_releases.platforms[*].url`
when admin registers a release).

**PAT setup:** the workflow needs `secrets.BINARIES_RELEASE_TOKEN` —
a fine-grained Personal Access Token whose **resource owner is the
`StarOrga` organization** (the repo moved there 2026-05-30), scoped to
`Contents: Read and write` on `StarOrga/Star-Citizen-Companion-Binaries`
only (no other repo, no other scope). A user-owned token cannot reach an
org repo — after the move the old `Jerry0022`-owned token stops working
and must be replaced. One-time setup at
https://github.com/settings/personal-access-tokens (the org must allow
fine-grained PATs, or an admin must approve the request); store in source
repo Actions secrets.

**Admin-registration URL pattern** (printed in each build's log under
"PUBLIC ASSET URLS"):

```
https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/data-uploader-v<X.Y.Z>/data-uploader-setup-<X.Y.Z>-x64.exe
```
