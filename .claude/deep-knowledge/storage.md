# Storage & caching — where each kind of data lives

Decided 2026-09-24 (storage plan, published as a claude.ai artifact). All tiers
below are free; the rule for adding a provider is **"it throttles or blocks at
its limit instead of billing"**, or, where no such tier exists (R2), the cap is
built in by design.

| Data | Home | Why |
|---|---|---|
| Relational: users, social, hangar, feedback, telemetry, codex catalog | Supabase Postgres (Free, 500 MB) | RLS, RPCs, Realtime. Blocks (402) at its limit, never bills |
| RLS-gated files (feedback attachments — private since `20260928211217`, shown via signed URLs, 1 h), codex previews | Supabase Storage (Free, 1 GB) | RLS per owner cannot be rebuilt elsewhere |
| Codex localization strings (`codex-locale/`, since 2026-10-03) | R2, same bucket and Worker | ~31 MB per build, immutable per build; see § Localization strings |
| Ship hulls + livery icons (`ship-skins`) | Cloudflare R2 `sc-companion-assets` (WEUR, account `115d75098864fcf13d36dc1aec1d874a`), read via `cloudflare/assets-worker` at `https://sc-assets.sc-assets-worker.workers.dev` (live 2026-09-25) | 0 € egress, 10 GB. A key the bucket lacks is streamed from Supabase by the Worker |
| News thumbnails (`news-images`, written by `fetch-verse-news`) | Same R2 bucket under `news-images/<hash>/w<N>.<ext>`, read via the same Worker at `/news-images/…` (code 2026-10-03, `feat/news-images-r2`) | Every thumbnail view used to count against the 5 GB/month Supabase egress. Legacy objects stay in Supabase and are streamed by the Worker |
| App bundle, icons, meshopt decoder | Vercel Hobby | Static hosting |
| Desktop installers | GitHub Releases in the public `Star-Citizen-Companion-Binaries` mirror | No bandwidth cap, trusted domain for AV scanners |
| Backups / codex build archive | *(planned)* Backblaze B2 EU with daily caps | Supabase Free has no downloadable backups |

**News images on R2.** `fetch-verse-news` PUTs new variants to R2
(`news-image-r2.ts`, R2 config + usage gate imported from `ingest-skins`) and
hands out `<ASSETS_BASE_URL>/news-images/<path>` (secret optional, defaults to
the workers.dev Worker). A refused or unknown usage gate, missing R2 secrets or
a failed PUT fall back to the Supabase upload per object, so the feed never
depends on R2. The video-retention prune deletes a cache entry from R2 *and*
Supabase and keeps the `verse_image_cache` row if either fails. Rows written
before the move keep their Supabase url in the DB; the client rewrites that
prefix to the Worker at read time (`toNewsImageUrl` in
`src/app/news/news-image-variants.ts`). `scripts/r2-migrate-news-images.mjs`
copies the existing objects (dry run unless `--apply`); a change to
`ingest-skins/_r2*.ts` does not redeploy `fetch-verse-news` by itself.

## Database budget — the codex is the only thing that grows

- One LIVE codex build is ~160 MB after VACUUM (locale strings alone ~69 MB).
  The Free plan allows 500 MB for the whole database.
- 2026-09-24: 952 MB with six builds. The four obsolete ones were deleted by
  hand and every `codex_*` table got `VACUUM FULL` → 349 MB.
- `prune_codex_builds(2)` runs nightly (pg_cron job `codex-build-retention`,
  migration `20260925010000`): per channel the two newest builds stay, the
  `is_current` one always stays. Two, because the Holotable patch selector and
  the inline patch diff read the previous build.
- Since `20260928231143` (plan D02) only **finalized** builds count:
  `codex_builds.finalized_at` is set by `set_current_codex_build` (ingest
  `finalize`), so a running or abandoned import never pushes the previous LIVE
  build out. Never-finalized, non-current builds are swept after 7 days. The
  app-side filter (patch selector and inline diff read finalized builds only)
  ships separately on `fix/d02-finalized-filter`, after the migration is live.
- **Deleting rows does not shrink `pg_database_size`.** Autovacuum makes the
  pages reusable for the next ingest, so steady state is about three builds'
  worth of disk (~480–510 MB). Only `VACUUM FULL` gives space back, and it takes
  an ACCESS EXCLUSIVE lock, so it is a manual, off-hours step. It works through
  the Supabase MCP `execute_sql` one table per call.
- `codex_locale_strings` moved to R2 (2026-10-03, § Localization strings).
  The table is now only an ingest's staging area.

## Localization strings (R2 since 2026-10-03)

Measured 2026-10-03 before the move: database 496 MB, `codex_locale_strings`
185 MB (117 MB heap + 68 MB pkey) for two builds (4.9.0, 4.10.0), 11
languages each, ~323k rows and ~31 MB of raw text per build (English 90k
keys / 10 MB, German 23k / 2.2 MB). Later the same day, before any backfill,
the database read 385 MB and the table 137 MB (not this change).

**Layout** (`supabase/functions/ingest-catalog/_locale-shards.ts`, the one
source of truth; the client copy in `src/app/codex/codex-locale-shards.ts` is
pinned to it by shared golden vectors in both test suites):

| Key | Cache |
|---|---|
| `codex-locale/<build uuid>/<lang>/index.json` | `max-age=300` (names the current gen) |
| `codex-locale/<build uuid>/<lang>/<gen>/<shard>.json` | immutable (a new gen per publish) |

A page needs few keys (a detail page 1-5, `/codex/keybinds` ~1 250 `ui_*`
keys), so neither one file per language (10 MB) nor one per key fits. Keys
are grouped by their lower-cased first `_` segment (`ui`, `item`, `pu`, …);
a group of at least 16 kB gets `ceil(bytes / 96 kB)` shards picked by
FNV-1a of the key, everything smaller lands in hashed `_misc-<n>` shards. The
index stores the split, so a client computes a key's shard with no extra
lookup. Keybinds then loads ~3 shards per language.

**Write path.** The uploader is unchanged: it still sends row chunks
(`locale_strings` op), so the table stays the staging area of a running
ingest (~95 MB for one build while it runs). After `finalize` answers,
ingest-catalog publishes every language (`EdgeRuntime.waitUntil`): keyset-paged
export RPC (`codex_locale_export`, 20k rows per call — the authenticator's
8 s statement_timeout: the whole English export took 5.0 s, its delete
6.4 s), shards, then the index, read-back of index and one shard **through the
public Worker**, removal of older gens, and only then the paged row delete
(`codex_locale_delete`). Same cost guard as ingest-skins (usage gate + bucket
quota) before any write. Any failure leaves the rows; the client keeps
reading them. Redo: `locale_publish` op or the backfill script.

**Read path.** `CodexService.resolveLocaleKeys` → `CodexLocaleShards.resolve`:
index per build+language (404 = "not in R2", remembered → database table;
outage → database, asked again next time), then one request per needed
shard, both cached as promises for the session. A missing key or a failed
shard leaves the key raw, as a missing row did. The Worker host is already in
`connect-src`.

**Backfill / redo.** `node scripts/codex-locale-to-r2.mjs` (dry run) →
`--apply` → `--apply --delete-source`; `--build`, `--lang` narrow it. It only
needs `SUPABASE_ACCESS_TOKEN` and calls `locale_publish` with the service key,
so no R2 credentials leave the edge function. Order of deployment: migration
`20261003150000` (db push), Worker (`wrangler deploy` in
`cloudflare/assets-worker`, without it the read-back fails and nothing is
deleted), `functions deploy ingest-catalog`, the web app, then the script.
Deleting rows does not shrink the database file: `vacuum full
public.codex_locale_strings;` off-hours afterwards.

**Not collected yet:** a build pruned by `prune_codex_builds` leaves its
`codex-locale/<build>/` prefix in R2 (~10 MB as JSON per build). Counts
against the 8 GB write gate; a GC would delete prefixes of build ids no
longer in `codex_builds`.

Only `de` and `en` reach the staging table: the `locale_strings` op drops every
other language (the app reads no other), which halves an ingest's temporary
table growth and the R2 writes. A publish the R2 usage gate refuses leaves the
rows in place and clients keep reading the table; the catalog import is never
aborted for it.

The assets Worker also serves `news-images/<hash>/<variant>.<webp|jpg|jpeg|png|gif|avif>`
with the short cache and a stream-from-Supabase fallback to the public
`news-images` bucket (the fallback bucket is the key's first segment).

## Log retention

- `api_request_log`: 1 day (pg_cron `api-request-log-purge`, 04:15 UTC). The
  API rate limiter only reads the last minute.
- `telemetry_events`: 120 days (pg_cron `telemetry-events-retention`, 04:25
  UTC) — the admin telemetry dashboard's widest window is 90 days, plus a
  30-day buffer. `ingest-telemetry` caps `detail` at 4 KiB (larger values
  become `{ _truncated: true, bytes }`).
- Both since `20260928231143_delete_paths_and_log_retention.sql` (plan D02).

## 3D asset packages (ships, FPS weapons)

Pre-built by the uploader, so the web only fetches and displays. All keys sit in
R2 under `ship-skins/` and are content-addressed (sha256 of the bytes), so the
Worker serves them `public, max-age=31536000, immutable`:

| Key | What | Size |
|---|---|---|
| `_hulls/<sha>.glb` | ship hull (existing hull flow) | ~0.6 MB |
| `_parts/<sha>.glb` | shared geometry-only part; an FPS weapon's root too | 10-300 kB |
| `_interiors/<sha>.glb` | optional ship interior | a few MB |
| `_manifests/<sha>.json` | the package manifest (plain JSON) | ~100 kB |

A ship package is ~1.3-2.9 MB before cross-ship dedup (parts are shared across
ships, so the bucket grows far less than packages x ships). The DB holds only
`asset_packages` (PK `kind, entity_class`; manifest sha, root/interior sha,
counts, bytes) — public read, writes by `ingest-skins` (service role) only.
Web path: row -> `/ship-skins/_manifests/<manifest_sha256>.json` -> each part at
`/ship-skins/_parts/<sha>.glb`. Orphans (a replaced manifest and parts no
manifest names any more) are not collected yet; a GC pass would list the three
prefixes, subtract everything the current manifests name, delete the rest. They
count against the 8 GB write gate like everything else.

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
  `r2_usage_unknown`: it fails closed, and unknown is never zero. Exception
  (D13): a good reading of the same calendar month, at most 24 h old, still
  decides while Analytics is down (`usageGate`). That reading lives per warm
  isolate only, so a cold start during an outage stays fail-closed. The
  uploader stops the whole livery run at the first gate refusal.
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
