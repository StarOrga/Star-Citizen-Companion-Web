# Deployment Status

Current live-deploy state of SC Companion surfaces. Update this file when a
surface flips between deployed / pending / broken.

## Vercel (web app)

- **URL:** `https://sc-companion.vercel.app`
- **Status:** ❌ NOT DEPLOYED (404). The Vercel project has not been
  connected to the GitHub repo yet — "pending first deploy" per the root
  `CLAUDE.md`. Pushing to `main` does NOT trigger any deploy today.
- **Implication for tasks:** any work that touches Angular components,
  templates, or `public/` is verifiable only locally (`npm start`) or
  through the desktop tool's renderer-side webview. Do NOT add
  "after-deployment verification on sc-companion.vercel.app" to test
  plans — there's nothing to verify against until someone runs the
  interactive Vercel-link setup once.
- **Unblocks:** run `vercel link` from the repo root → connect the
  GitHub repo → first `vercel --prod` deploy → after that, GitHub-Vercel
  integration auto-deploys main pushes.

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
  the `desktop-v*` tags. `v0.3.0` failed (Python compat), `v0.3.1` also
  failed (3.11 still too new for numpy), `v0.3.2+` should succeed once
  the 3.10 hotfix lands. Check `gh run list --workflow=desktop-tool-build.yml`
  before assuming a tag corresponds to a usable installer.
- **Release token:** generated per-build, uploaded as a separate
  `release-token` workflow artefact (retention 7d) — fetch with
  `gh run download <run-id> -n release-token`, then register the UUID
  in `desktop_releases` via the admin RPC so the Tool can authenticate
  against `desktop-latest` and `ingest-bundle`.
