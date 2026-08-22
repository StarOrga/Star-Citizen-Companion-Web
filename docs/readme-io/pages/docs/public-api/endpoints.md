---
title: Endpoints
excerpt: Every route on the SC Companion Public API — parameters, response shapes, and current data status.
---

All routes are relative to
`https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api`.

| Method | Path | Auth | Scope | Status |
|---|---|---|---|---|
| `GET` | `/v1/patch` | API token | `patch:read` | live data |
| `GET` | `/v1/news` | API token | `news:read` | live data |
| `GET` | `/v1/ships` | API token | `ships:read` | stub — ingestion pending |
| `GET` | `/v1/components` | API token | `components:read` | stub — ingestion pending |
| `GET` | `/v1/keybinds` | API token | `keybinds:read` | live — input actions + curated categories |
| `POST` | `/v1/tokens` | session JWT (admin) | — | live |
| `GET` | `/v1/tokens` | session JWT (admin) | — | live |
| `DELETE` | `/v1/tokens/:id` | session JWT (admin) | — | live |
| `GET` | `/openapi.json` | none | — | public |
| `GET` | `/docs` | none | — | public |

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

An unrecognised `source` is rejected with `400 invalid_source` rather than
silently returning everything.

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

## GET /v1/keybinds

Every default input action of the current LIVE build — the actionmap, the
default binding per device, and the **curated category hierarchy** on top.

| Parameter | Values | Effect |
|---|---|---|
| `assigned_only` | `true` | only actions that carry a curated category |
| `actionmap` | e.g. `spaceship_movement` | restrict to one actionmap |

The bindings come from the datamined `defaultProfile.xml`; `categories` is the
part curated by hand in the admin UI and is `null` while an action is still
unclassified. Its five layers are the Context half of the SCC Input-Actions
hierarchy:

| Field | Layer | Values |
|---|---|---|
| `scope` | L1 | `verse`, `in_game`, `out_of_game` |
| `environment` | L2 | `on_foot`, `in_vehicle`, `spectator`, `mobiglas`, `starmap`, `chat`, `console` |
| `role` | L3 | `pilot`, `copilot`, `gunner`, `driver`, `normal`, `eva`, `ladder` |
| `activity` | L4 | `combat`, `mining`, `salvage`, `exploring`, `medical`, `trading`, `racing`, `engineering`, `hacking` |
| `action_group` | L5 | `flight_control`, `weapons`, `targeting`, `shields`, `power`, `mfd_hud`, `mining_tools`, `movement`, `camera`, `communication`, `interaction` |

A child layer is only ever set together with its parent: `environment` belongs
to exactly one `scope`, and `role` to exactly one `environment`.

```json
{
  "data": [
    {
      "actionmap": "spaceship_movement",
      "action_name": "v_strafe_forward",
      "bindings": { "keyboard": "w", "mouse": null, "gamepad": null, "joystick": null },
      "categories": {
        "scope": "verse",
        "environment": "in_vehicle",
        "role": "pilot",
        "activity": null,
        "action_group": "flight_control"
      }
    }
  ],
  "meta": { "build_number": "9600000", "patch_version": "4.2", "count": 1142, "assigned_count": 318 }
}
```

---

## Token management

These three routes are **session-authenticated**: they take a Supabase session
JWT from an `admin` account, not an `scc_live_*` API token, and they bypass the
rate limiter. See [Authentication](doc:authentication) for the full lifecycle.

| Method | Path | Returns |
|---|---|---|
| `POST` | `/v1/tokens` | `201 { data: { plaintext, token } }` — the only time the secret is shown |
| `GET` | `/v1/tokens` | `200 { data: [...] }` — your non-revoked tokens, metadata only |
| `DELETE` | `/v1/tokens/:id` | `200 { ok: true }`, or `404 not_found` if it is already revoked |

Request body for `POST`:

```json
{ "name": "fleetview-bot", "scopes": ["news:read", "patch:read"] }
```

---

## GET /openapi.json

The hand-maintained OpenAPI 3.1 document describing everything above. Public,
unauthenticated, and always the source of truth if this page and the spec ever
disagree.

## GET /docs

A rendered API reference UI, served straight from the same spec.
