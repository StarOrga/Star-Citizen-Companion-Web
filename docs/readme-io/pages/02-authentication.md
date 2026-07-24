---
slug: authentication
title: Authentication
category: documentation
position: 2
excerpt: Bearer tokens, scopes, and the token lifecycle — how SC Companion authorises API calls.
---

The SC Companion Public API uses **bearer tokens**. There is no OAuth flow and
no API-key query parameter — a token always travels in the `Authorization`
header.

```
Authorization: Bearer scc_live_<32 chars>
```

## Token anatomy

| Property | Detail |
|---|---|
| Prefix | `scc_live_` |
| Length | prefix + 32 random characters |
| Storage | SHA-256 hash only — the plaintext is never persisted |
| Visibility | shown **once**, at creation |
| Owner | the admin user who created it |

Because only the hash is stored, SC Companion physically cannot show you a
token again. Treat the value like a password: keep it server-side, never commit
it, never ship it in a browser bundle.

## Creating a token

1. Sign in to [SC Companion](https://sc-companion.vercel.app) with an account
   that has the `admin` role.
2. Open [`/admin/api-tokens`](https://sc-companion.vercel.app/admin/api-tokens).
3. Give the token a descriptive name (`fleetview-bot`, `grafana-scrape`, …) and
   pick its scopes.
4. Copy the plaintext immediately — it disappears on reload.

The same operation is available over HTTP for automation, but it is
**session-authenticated**: it takes your Supabase session JWT, not an API
token, and the caller must be an admin.

```bash
curl -X POST \
  -H "Authorization: Bearer <supabase-session-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name":"fleetview-bot","scopes":["news:read","patch:read"]}' \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/v1/tokens"
```

The `201` response contains `data.plaintext` — the only time you will ever see it.

## Scopes

Scopes are checked per request. A token missing the required scope gets `403`,
not `401` — the credential was valid, the permission was not.

| Scope | Endpoint |
|---|---|
| `news:read` | `GET /v1/news` |
| `patch:read` | `GET /v1/patch` |
| `ships:read` | `GET /v1/ships` |
| `components:read` | `GET /v1/components` |
| `*:read` | all of the above |
| `admin:tokens` | token management |

Grant the narrowest set that does the job. A dashboard that only renders the
current patch version needs `patch:read` and nothing else.

## Listing and revoking

```bash
# list (metadata only — never plaintext)
curl -H "Authorization: Bearer <supabase-session-jwt>" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/v1/tokens"

# revoke
curl -X DELETE -H "Authorization: Bearer <supabase-session-jwt>" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/v1/tokens/<id>"
```

Revocation takes effect on the next request — there is no cached grace window.

## Public endpoints

Two routes need no credential at all:

- `GET /openapi.json` — the OpenAPI 3.1 description
- `GET /docs` — the rendered reference UI

They are deliberately open so that API explorers and AI tooling can discover
the surface without provisioning a token first.
