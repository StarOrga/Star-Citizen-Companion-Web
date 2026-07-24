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
| `20260604_news_image_cache.sql` | Public bucket `news-images` (post+cover variants) + `verse_image_cache` index for server-side caching of RSI news thumbnails |
| `20260724130000_user_ship_links.sql` | User-supplied RSI pledge links: `is_rsi_pledge_ship_url()` allowlist + `user_ship_links` (private) + `ship_pledge_links` (global, admin-only) |

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
| `fetch-verse-news` | Proxies `api.star-citizen.wiki` Comm-Link + RSI status RSS into a single `VerseFeed` JSON. Also **server-side caches** each news image into the public `news-images` bucket (service-role download w/ RSI `Referer`, post+cover variants, `verse_image_cache` index, ≤16 new downloads/request) and rewrites the urls — fixes broken hotlinked RSI CDN thumbnails. | `true` |
| `process-p4k` | Analyzes a P4K upload's first 64KB, writes back via service-role. | `true` |
| `ship-link` | Write authority for user-supplied RSI pledge links (`set`/`remove` own, admin `promote`/`unpromote` global). Enforces the URL allowlist server-side + a per-user rate limit. Uses **no service-role key** — it writes through the caller's own client so RLS still applies. | `true` |

Both functions deployed via Supabase MCP (`mcp__10628b5d-*__deploy_edge_function`).

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
