# Storage & caching — where each kind of data lives

Decided 2026-09-24 (storage plan, published as a claude.ai artifact). All tiers
below are free; the rule for adding a provider is **"it throttles or blocks at
its limit instead of billing"**, or, where no such tier exists (R2), the cap is
built in by design.

| Data | Home | Why |
|---|---|---|
| Relational: users, social, hangar, feedback, telemetry, codex catalog | Supabase Postgres (Free, 500 MB) | RLS, RPCs, Realtime. Blocks (402) at its limit, never bills |
| RLS-gated files (feedback attachments), codex previews | Supabase Storage (Free, 1 GB) | RLS per owner cannot be rebuilt elsewhere |
| Ship hulls + livery icons (`ship-skins`) | Cloudflare R2 `sc-companion-assets` (WEUR, account `115d75098864fcf13d36dc1aec1d874a`), read via `cloudflare/assets-worker` | 0 € egress, 10 GB. Falls back to Supabase until the R2 secrets exist |
| App bundle, icons, meshopt decoder | Vercel Hobby | Static hosting |
| Desktop installers | GitHub Releases in the public `Star-Citizen-Companion-Binaries` mirror | No bandwidth cap, trusted domain for AV scanners |
| Backups / codex build archive | *(planned)* Backblaze B2 EU with daily caps | Supabase Free has no downloadable backups |

## Database budget — the codex is the only thing that grows

- One LIVE codex build is ~160 MB after VACUUM (locale strings alone ~69 MB).
  The Free plan allows 500 MB for the whole database.
- 2026-09-24: 952 MB with six builds. The four obsolete ones were deleted by
  hand and every `codex_*` table got `VACUUM FULL` → 349 MB.
- `prune_codex_builds(2)` runs nightly (pg_cron job `codex-build-retention`,
  migration `20260925010000`): per channel the two newest builds stay, the
  `is_current` one always stays. Two, because the Holotable patch selector and
  the inline patch diff read the previous build.
- **Deleting rows does not shrink `pg_database_size`.** Autovacuum makes the
  pages reusable for the next ingest, so steady state is about three builds'
  worth of disk (~480–510 MB). Only `VACUUM FULL` gives space back, and it takes
  an ACCESS EXCLUSIVE lock, so it is a manual, off-hours step. It works through
  the Supabase MCP `execute_sql` one table per call.
- The durable fix before the next big patch: move `codex_locale_strings`
  (pure key→value per build and language, read in batches by
  `CodexService.resolveLocaleKeys`) to R2 as one JSON per build and language.

## R2 cost guard (R2 has no hard spending cap)

- **Reads** only through the Worker on `*.workers.dev`. Its Free plan stops at
  100k requests/day, below R2's free 10M Class-B ops/month. No public bucket,
  no `r2.dev`.
- **Writes** only through presigned PUTs that ingest-skins hands out after the
  usual JWT + release-token + role gate. `sign` refuses with 507 once the bucket
  holds `R2_QUOTA_BYTES` (default 8 GB of the free 10 GB).
- **Usage gate = the kill-switch** (`ingest-skins/_r2-usage.ts`, 0.100.0).
  Before signing, it reads this month's account-wide usage (storage, Class A,
  Class B) from the GraphQL Analytics API with `CF_ANALYTICS_TOKEN`, an
  Account Analytics Read token. At 80 % of any allowance it returns 507
  `r2_free_tier_guard`. If usage cannot be read it returns 503
  `r2_usage_unknown`: it fails closed, and unknown is never zero.
  - Only the edge function holds the R2 secret, so "stop signing" works as
    "stop writing".
  - **Deliberately not a token-deleting switch.** Deleting or disabling a
    token needs *Account API Tokens Write*, which can mint tokens with any
    permission. That makes it account-admin, and it would sit in a secret
    store.
  - If the R2 secret ever leaks, revoke the token by hand in the dashboard
    (R2 → Manage API Tokens). The Access Key ID is the token id.
- Cloudflare has **no** R2 spend cap and no suspend API. Budget alerts
  ($1 set) only send email, only after overage has started. Webhook alerts
  need a Pro zone.
- **Money-side cap:** the user withdraws Cloudflare's PayPal debit
  authorization (decided 2026-09-25). A charge then fails instead of going
  through. Any invoice still stands legally, so the gate above is what keeps
  it at $0.
- The API token is scoped to the one bucket and lives only as an Edge-Function
  secret.
- `*.workers.dev` may get the same Kaspersky treatment as `vercel.app`. A custom
  domain (~10 €/yr, not free) is the durable fix for both, and would also enable
  the Cloudflare CDN cache and an R2 custom domain.

## Caching — why there is no Redis

- Traffic is ~430 Supabase requests/day. Catalog and asset data change once
  per patch, so browser + ngsw caching with ETag revalidation beats a server
  cache: no network hop and nothing to meter.
- The API rate limiter is deliberately Postgres (`api/_rate-limit.ts`). RSI
  and UEX responses already sit in Postgres cache tables.
- Add **Upstash Redis Free** (Frankfurt, 256 MB, 500k commands/month, throttles
  rather than bills, no card) only when `api_request_log` or the proxy caches
  show measurable DB load, or once traffic is above ~5k requests/day.
  Cloudflare Workers KV is the alternative that hard-errors at its limit.

## Ruled out (2026-09-24 recheck)

AWS S3 (no always-free tier any more; the 6-month free plan closes the account),
Azure Blob (12 months / $200 for 30 days), GCS (free tier US regions only),
Vercel Blob (1 GB, and going over locks it for 30 days), Oracle Always Free
(reclaim risk; everything is deleted if more than 20 GB is held when the trial
ends). Also out: Storj, Tebi, IDrive e2, Wasabi, Bunny, Momento (free tier gone
or a minimum charge).

## Open: alpha installers are public

Every desktop build, alpha ring included, lands in the public binaries mirror.
The SQL ring clamp (`desktop_release_for_channel`) only hides the metadata. If
alpha must stay internal: publish only stable to the mirror, and put
alpha/beta in R2 under a prefix the Worker does **not** serve, handed out as a
5-minute presigned GET by an edge function after the role check.
