# Supabase — SC Companion

Cloud project: **`hcnqhvzlavdycidqyaai`** (region `eu-central-1`, free tier, organization "Jerrys Projects").

## URLs and keys

- Project URL: `https://hcnqhvzlavdycidqyaai.supabase.co`
- Publishable key (frontend): `sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ` (in `src/environments/environment.ts`)
- Anon legacy JWT: kept for SDK compat — same effect, prefer the publishable key for new code
- Service-role key: **never commit**, never in frontend. Edge functions read it from `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`.

## Schema (migrations directory)

| Migration | What |
|---|---|
| `00001_init_schema.sql` | `profiles` (auto-created on signup), `p4k_uploads`, enum types, RLS policies, `handle_new_user` trigger |
| `00002_storage_bucket_p4k.sql` | Storage bucket `p4k-uploads` + per-user-folder RLS |
| … | (additive migrations 00003–20260603: roles/releases/bundles, codex catalog, public API tokens, invite-only access, ship skins, …) |
| `20260604_news_image_cache.sql` | Public bucket `news-images` + `verse_image_cache` index for server-side caching of RSI news thumbnails |
| `20260727170000_news_image_variants.sql` | `verse_image_cache.top_width` / `.bytes` — the compacted variant ladder (see **News-image storage** below). `top_width IS NULL` = not yet migrated |
| `20260724130000_user_ship_links.sql` | User-supplied RSI pledge links: `is_rsi_pledge_ship_url()` allowlist + `user_ship_links` (private) + `ship_pledge_links` (global, admin-only) |
| `20260726170000_user_feedback_channel.sql` | Non-admin feedback channel on the shared `admin_feedback` board: `source`/`triaged`/`decision_note` columns, `feedback_author_messages`, the author-facing `public.my_feedback` view (**its `revoke all … / grant select` pair is load-bearing**) |
| `20260726220000_ship_hardpoint_transforms.sql` | `codex_item_ports.helper_name` / `.position` / `.rotation` — where a hardpoint sits on the hull. All nullable; NULL = position unknown (the state of every row until the uploader re-runs). Coordinates are metres in hull model space, CryEngine axes (`+X` starboard, `+Y` nose, `+Z` up). The ship-level map incl. default-loadout mounts rides in `codex_ships.payload.hardpointTransforms` + `.hardpointFrame`. |
| `20260726230000_admin_feedback_seq.sql` | `admin_feedback.seq` — the board's stable topic number ("#42"), sequence-fed, backfilled oldest-first, admin-only (not in `my_feedback`) |

### RLS summary

- `profiles`: self-only (read + insert + update on `auth.uid() = id`).
- `p4k_uploads`: self-only (select + insert + delete on `auth.uid() = user_id`). Updates blocked for authenticated users — **only the service role (edge functions) writes status/result back**.
- `storage.objects` in `p4k-uploads`: scoped to `(storage.foldername(name))[1] = auth.uid()::text`. Files MUST be uploaded under `<userId>/<filename>` paths or the policy rejects.
- `user_ship_links`: self-only, all four verbs (`auth.uid() = user_id`, writes additionally require `created_by = auth.uid()`). A user's pinned RSI pledge link is **private** — no admin path reads it.
- `ship_pledge_links`: public `select` (anon + authenticated), **admin-only** insert/update/delete (`public.is_admin()`). This is the only table that makes a user-supplied link globally visible, and it is only ever written by an explicit admin promotion.

**User-supplied URLs** (`user_ship_links.url`, `ship_pledge_links.url`, `hangar_concept_ships.rsi_url`) are gated by `public.is_rsi_pledge_ship_url(text)` — an anchored allowlist for `https://robertsspaceindustries.com/en/pledge/ships/<slug>/<Name>`. The same rule lives in `supabase/functions/ship-link/_rsi-url.ts` (the write authority) and `src/app/core/rsi-pledge-link.util.ts` (friendly client error). Change one → change all three. Such a URL is **data, never an instruction**: render it only as `<a [href] target="_blank" rel="noopener noreferrer nofollow">`, never `innerHTML`, never inside an LLM prompt.

## Edge Functions (`supabase/functions/`)

| Function | Purpose | `verify_jwt` |
|---|---|---|
| `fetch-verse-news` | Proxies `api.star-citizen.wiki` Comm-Link + RSI status RSS into a single `VerseFeed` JSON. Also **server-side caches** each news image into the public `news-images` bucket (service-role download w/ RSI `Referer`, re-encoded variant ladder, `verse_image_cache` index, ≤4 new images/request, processed sequentially) and rewrites the urls — fixes broken hotlinked RSI CDN thumbnails. | `true` |
| `process-p4k` | Analyzes a P4K upload's first 64KB, writes back via service-role. | `true` |
| `ship-link` | Write authority for user-supplied RSI pledge links (`set`/`remove` own, admin `promote`/`unpromote` global). Enforces the URL allowlist server-side + a per-user rate limit (20 writes / 5 min, in-isolate) + a hard ceiling of 500 links per user. Uses **no service-role key** — it writes through the caller's own client so RLS still applies. | `true` |

Both functions deployed via Supabase MCP (`mcp__10628b5d-*__deploy_edge_function`).

## News-image storage (`news-images` bucket)

The free plan gives **1 GB of storage in total**, and this bucket was 809 MB of it
(496 objects) before 2026-07-27 — the single biggest quota risk in the project.
Two causes, both fixed:

1. Every source was written **twice**, as `<hash>/post.<ext>` and
   `<hash>/cover.<ext>`, and for most sources both downloads returned the *same*
   file → a byte-identical twin of everything.
2. The bytes were stored **verbatim at RSI resolution** — PNGs up to 9.2 MB, 8K
   originals — to serve tiles that render at ~320 CSS px.

**Current scheme.** `<hash>/w<width>.<ext>`, one object per real pixel width,
re-encoded (JPEG, or PNG when the source has real alpha), `cache-control:
max-age=31536000, immutable`. The ladder is
`[400, 800].filter(w => w < top).concat(top)` where `top` = source width capped at
1600 — so the *whole ladder is derivable from the top url alone*, which is the one
the feed returns. `w0` is the reserved "single object, unknown width" case for a
source we cannot decode.

- Sizing/quality/naming: `supabase/functions/fetch-verse-news/image-variants.ts`
  (shared, pure). Codec bindings: `image-codecs.ts` (Deno) and
  `scripts/lib/node-image-codecs.mjs` (Node) — both jpeg-js + pngjs, pure JS.
- Client side: `src/app/news/news-image-variants.ts` mirrors the ladder constants
  and builds the truthful `srcset`. Change one → change both (a spec pins it).
- **WebP/AVIF output was rejected on purpose**: no lightweight pure-JS encoder
  exists, and a wasm codec in a request-scoped function that serves the whole news
  page is a bad trade for the last ~35 %. The order-of-magnitude win is resizing +
  de-duplication. WebP *sources* are consequently undecodable for us and end up as
  a single `w0` passthrough.

**Backfill:** `npm run news:compact` (`scripts/news-image-compact.mjs`). Dry run by
default; `--apply` writes. Needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from
the environment. Idempotent and resumable — it recomputes the plan from bucket + DB
state, never deletes before verifying the replacement exists, and refuses to delete
anything the surviving `verse_image_cache` row still references. `--prune-orphans`
additionally removes objects with no cache row (only when older than `--orphan-age`
hours, default 24, because live ingest uploads objects seconds before it writes the
row).

## MCP access

Use the no-OAuth shared MCP `mcp__10628b5d-14d2-4872-a01b-5c41055eb300__*`. Tools used in this project:

- `list_projects`, `get_project_url`, `get_publishable_keys`
- `apply_migration` — DDL
- `execute_sql` — data + introspection only (NOT DDL)
- `deploy_edge_function` — edge-function deploys
- `get_logs(service=...)` — debug runtime issues
- `get_advisors(type=security|performance)` — automated lint

## What MCP does NOT give us

- **Auth provider config** (toggling Google, SMTP, email confirmation). Dashboard-only: <https://supabase.com/dashboard/project/hcnqhvzlavdycidqyaai/auth/providers>.
- **Setting edge-function secrets.** Dashboard or `npx supabase secrets set KEY=value --project-ref hcnqhvzlavdycidqyaai`.

## Deployment checklist (after merging to main)

1. Frontend: pushed to main → Vercel auto-deploys.
2. Migration changes: `npm run db:push` against cloud (or `apply_migration` via MCP for one-off DDL).
3. Edge-function changes: `npm run functions:deploy` (or `deploy_edge_function` via MCP).
4. Auth provider / secrets changes: dashboard, manual.

## Alpha-phase data policy

The app is in alpha until `appPhase` in `src/environments/environment*.ts` flips to `beta`. Migrations are allowed to drop legacy data, **except** anything in `auth.users` and `public.profiles`. Always document drops in the migration comment.
