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

### RLS summary

- `profiles`: self-only (read + insert + update on `auth.uid() = id`).
- `p4k_uploads`: self-only (select + insert + delete on `auth.uid() = user_id`). Updates blocked for authenticated users — **only the service role (edge functions) writes status/result back**.
- `storage.objects` in `p4k-uploads`: scoped to `(storage.foldername(name))[1] = auth.uid()::text`. Files MUST be uploaded under `<userId>/<filename>` paths or the policy rejects.

## Edge Functions (`supabase/functions/`)

| Function | Purpose | `verify_jwt` |
|---|---|---|
| `fetch-verse-news` | Proxies `api.star-citizen.wiki` Comm-Link + RSI status RSS into a single `VerseFeed` JSON. | `true` |
| `process-p4k` | Analyzes a P4K upload's first 64KB, writes back via service-role. | `true` |

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
