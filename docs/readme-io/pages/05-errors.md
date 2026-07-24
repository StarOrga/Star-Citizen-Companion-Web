---
slug: errors
title: Errors
category: documentation
position: 5
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
| `400` | `bad_request` | Malformed body or parameter | Check the request against [Endpoints](doc:endpoints) |
| `401` | `unauthorized` | Missing, malformed, or revoked token | Send `Authorization: Bearer scc_live_…`; reissue if revoked |
| `403` | `forbidden` | Token is valid but lacks the required scope | Create a token with the scope from the endpoint table |
| `404` | `not_found` | No such route | Verify the base URL and path |
| `405` | `method_not_allowed` | Wrong HTTP verb | All read endpoints are `GET` |
| `429` | `rate_limited` | Budget exhausted | Back off using `Retry-After` — see [Rate Limits](doc:rate-limits) |
| `500` | `query_failed` / `internal` | Something broke server-side | Retry with backoff; if it persists, report it |

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
