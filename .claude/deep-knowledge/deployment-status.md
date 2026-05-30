# Deployment Status

Current live-deploy state of SC Companion surfaces. Update this file when a
surface flips between deployed / pending / broken.

## Vercel (web app)

- **Vercel project:** `star-citizen-companion-website`
- **Canonical URL:** `https://sc-companion.vercel.app` (short alias, primary)
- **Auto-assigned URL:** `https://star-citizen-companion-website.vercel.app` (alias too — keep both for any deep links already shared)
- **Status:** ✅ LIVE — auto-deployed from `main` via GitHub integration.
- **Implication for tasks:** every push to `main` triggers a Vercel
  build. Use `curl -sI https://sc-companion.vercel.app` as the probe (200 OK
  expected). For verifying a specific path (e.g. `/desktop`, `/p4k`),
  probe directly: `curl -sI https://sc-companion.vercel.app/desktop`.
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

## Desktop tool — Windows binary

- **Status:** per-tag, see latest `desktop-tool-build` workflow run on
  the `desktop-v*` tags. Check `gh run list --workflow=desktop-tool-build.yml`
  before assuming a tag corresponds to a usable installer.
- **Release token:** generated per-build, uploaded as a separate
  `release-token` workflow artefact (retention 7d) — fetch with
  `gh run download <run-id> -n release-token`, then register the UUID
  in `desktop_releases` via the admin RPC so the Tool can authenticate
  against `desktop-latest` and `ingest-bundle`.

### Asset hosting — two-repo topology (since 2026-05-24, issue #7)

The desktop tool's auto-update download URL must be publicly fetchable
(electron-updater has no GitHub credentials). This repo is private, so
a public mirror exists:

| Repo | Purpose |
|---|---|
| `Jerry0022/Star-Citizen-Companion-Website` (PRIVATE — this one) | Source code, releases include token-artefact + maintainer changelog |
| `StarOrga/Star-Citizen-Companion-Binaries` (PUBLIC) | Release mirror — `.exe` + `.blockmap` + `latest.yml`, end-user download URL |

When tagging `desktop-v*`, GH-Actions publishes the same assets to
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
https://github.com/StarOrga/Star-Citizen-Companion-Binaries/releases/download/desktop-v<X.Y.Z>/sc-companion-setup-<X.Y.Z>-x64.exe
```
