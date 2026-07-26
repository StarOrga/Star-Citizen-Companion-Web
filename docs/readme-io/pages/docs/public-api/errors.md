---
title: Errors
excerpt: One error envelope, a small set of stable codes, and what to do about each.
---

Every failure returns the same envelope, whatever the status code:

```json
{
  "error": {
    "code": "unauthorized",
    "message": "Invalid or revoked token."
  }
}
```

`error.code` is a stable, machine-readable string — branch on it. `error.message`
is human-readable and may be reworded at any time, so never parse it.

## Status codes

| Status | Typical `code` | What happened | Fix |
|---|---|---|---|
| `400` | `invalid_source` | Unknown value for a query parameter | Check the allowed values in [Endpoints](doc:endpoints) |
| `401` | `unauthorized` | Missing, malformed, or revoked token | Send `Authorization: Bearer scc_live_…`; reissue if revoked |
| `403` | `forbidden_scope` | Token is valid but lacks the required scope | Create a token with the scope from the endpoint table |
| `403` | `forbidden` | Session route called by a non-admin | Sign in with an `admin` account |
| `403` | `forbidden_origin` | Browser origin is not allowed | Call from a server, not a page |
| `404` | `not_found` | No such route, or no such token to revoke | Verify the base URL, path and id |
| `429` | `rate_limited` | Budget exhausted | Back off using `Retry-After` — see [Rate Limits](doc:rate-limits) |
| `500` | `query_failed` · `internal_error` | Something broke server-side | Retry with backoff; if it persists, report it |
| `500` | `server_misconfigured` | The deployment is missing configuration | Not fixable client-side — please report it |

### Token-management codes

The session-authenticated routes under `/v1/tokens` add a few of their own:

| Status | `code` | Meaning |
|---|---|---|
| `400` | `invalid_body` | The request body was not valid JSON |
| `400` | `invalid_name` | Name missing or longer than 80 characters |
| `400` | `invalid_scopes` | No scopes given, or a scope is unknown |
| `400` | `invalid_id` | The token id in the path is not a UUID |
| `409` | `duplicate_name` | You already have a token with that name |
| `500` | `create_failed` · `list_failed` · `revoke_failed` | Database error |

## 401 vs 403 — the distinction matters

- **`401`** means *we do not know who you are*: the token is absent, malformed,
  or has been revoked. Re-authenticate.
- **`403`** means *we know who you are, and you may not do this*: the token is
  valid but its scopes do not cover the endpoint. Re-issuing the same token
  will not help — you need a token with the right scope.

Retrying a `403` unchanged will never succeed.

## Empty is not an error

The stub endpoints (`/v1/ships`, `/v1/components`) return `200` with
`"data": []` and an explanatory `meta.message`. That is a successful response
describing an empty dataset — not a failure. Handle it as data, not as an
error path.

## Suggested client handling

```js
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

if (res.status === 429) {
  const wait = Number(res.headers.get('Retry-After') ?? 5);
  await new Promise((r) => setTimeout(r, wait * 1000));
  return retry();
}

if (!res.ok) {
  const { error } = await res.json();
  throw new Error(`[${error.code}] ${error.message}`);
}

const { data, meta } = await res.json();
```
