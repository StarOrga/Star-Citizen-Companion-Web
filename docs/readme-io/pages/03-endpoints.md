---
slug: endpoints
title: Endpoints
category: documentation
position: 3
excerpt: Every route on the SC Companion Public API — parameters, response shapes, and current data status.
---

All routes are relative to
`https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api`.

| Method | Path | Scope | Status |
|---|---|---|---|
| `GET` | `/v1/patch` | `patch:read` | live data |
| `GET` | `/v1/news` | `news:read` | live data |
| `GET` | `/v1/ships` | `ships:read` | stub — ingestion pending |
| `GET` | `/v1/components` | `components:read` | stub — ingestion pending |
| `GET` | `/openapi.json` | — | public |
| `GET` | `/docs` | — | public |

---

## GET /v1/patch

Current LIVE / PTU / EPTU patch versions as detected by SC Companion's channel
detection.

**Parameters:** none.

```json
{
  "data": { "live": "4.8.0-LIVE.1825000", "ptu": null, "eptu": null },
  "meta": {
    "detected_at": { "live": "2026-07-24T06:11:03.000Z", "ptu": null, "eptu": null }
  }
}
```

A channel that has no build published right now returns `null` rather than
being omitted — the key is always present.

---

## GET /v1/news

Up to **50** Verse News items from the last **90 days**, ordered by
`published_at` descending.

**Parameters**

| Name | In | Type | Description |
|---|---|---|---|
| `source` | query | `comm-link` · `spectrum` · `youtube` · `patch` | Restrict to one channel. Omit for all. |

```bash
curl -H "Authorization: Bearer scc_live_…" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/v1/news?source=comm-link"
```

```json
{
  "data": [
    {
      "source": "comm-link",
      "title": "Star Citizen Alpha 4.8.0 Now Available",
      "url": "https://robertsspaceindustries.com/comm-link/...",
      "thumbnail": "https://media.robertsspaceindustries.com/...",
      "published_at": "2026-07-23T17:00:00.000Z"
    }
  ],
  "meta": { "count": 1, "patch_version": "4.8.0-LIVE.1825000", "cached_at": "2026-07-24T06:00:00.000Z" }
}
```

`thumbnail` may be `null`. `meta.cached_at` tells you how fresh the underlying
aggregation is; pair it with the `X-Cache` response header.

---

## GET /v1/ships

Ship roster for a patch version.

**Parameters**

| Name | In | Type | Description |
|---|---|---|---|
| `patch` | query | string | Patch version, e.g. `4.8.0-LIVE.1825000`. Omit for the current LIVE build. |

> 🚧 **Stub.** Returns `"data": []` until the ship-data ingestion pipeline
> lands. `meta.message` carries the current status. The envelope will not
> change when real rows arrive, so you can integrate against it today.

---

## GET /v1/components

Component catalog for a patch version. Same `patch` parameter and the same
stub behaviour as `/v1/ships`.

---

## GET /openapi.json

The hand-maintained OpenAPI 3.1 document describing everything above. Public,
unauthenticated, and always the source of truth if this page and the spec ever
disagree.

## GET /docs

A rendered API reference UI, served straight from the same spec.
