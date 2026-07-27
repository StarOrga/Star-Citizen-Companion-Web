---
title: Getting Started
excerpt: Make your first authenticated call against the SC Companion Public API in under five minutes.
metadata:
  title: SC Companion Public API — Getting Started
  description: Base URL, tokens, scopes and your first authenticated request against the read-only SC Companion Public API.
---

The **SC Companion Public API** gives you read-only access to Star Citizen Verse
data that SC Companion already aggregates: patch versions, Verse News from
Comm-Link / Spectrum / YouTube, and (as the ingestion pipelines land) ships and
components.

New to the project itself? Start at
[What is SC Companion?](doc:overview) instead.

> 🚧 **Alpha.** SC Companion is in its alpha phase. Endpoints marked *stub*
> return an empty `data` array with an explanatory `meta.message` until their
> ingestion pipeline ships. The response envelope itself is stable.

## Base URL

```
https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api
```

Every path below is relative to that base — so `/v1/patch` is
`https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/v1/patch`.

The machine-readable OpenAPI 3.1 description is public and needs no token:

```
GET https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/openapi.json
```

## 1. Get a token

API tokens are issued from the SC Companion **Integrations** page (profile menu
→ Integrations, i.e.
[`/admin/api-tokens`](https://sc-companion.vercel.app/admin/api-tokens)) by a
user with the `admin` role.

A token looks like `scc_live_<32 chars>`. It is **shown exactly once** at
creation — SC Companion stores only a SHA-256 hash, so it cannot be recovered
later. Lost it? Revoke and create a new one.

Each token carries one or more **scopes**, which decide what it may read:

| Scope | Grants |
|---|---|
| `news:read` | `GET /v1/news` |
| `patch:read` | `GET /v1/patch` |
| `ships:read` | `GET /v1/ships` |
| `components:read` | `GET /v1/components` |
| `*:read` | all read endpoints above |
| `admin:tokens` | token management endpoints |

## 2. Make your first call

Send the token as a bearer credential:

```bash
curl -H "Authorization: Bearer scc_live_your_token_here" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/v1/patch"
```

```json
{
  "data": {
    "live": "4.8.0-LIVE.1825000",
    "ptu": null,
    "eptu": null
  },
  "meta": {
    "detected_at": { "live": "2026-07-24T06:11:03.000Z", "ptu": null, "eptu": null }
  }
}
```

Every successful response uses the same envelope: payload under `data`,
context under `meta`.

## 3. Read the rate-limit headers

Responses carry the current budget so you never have to guess:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 1785000060
```

See [Rate Limits](doc:rate-limits) for the full contract.

## Next steps

- [Authentication](doc:authentication) — token lifecycle, scopes, revocation
- [Endpoints](doc:endpoints) — every route with parameters and response shapes
- [Errors](doc:errors) — the error envelope and what each code means
- [Recipes](doc:recipes) — copy-paste snippets for curl, JavaScript, and Python

---

*SC Companion is a fan-made project and is **not affiliated with Cloud Imperium
Games or Roberts Space Industries**.*
