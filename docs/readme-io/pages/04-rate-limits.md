---
slug: rate-limits
title: Rate Limits
category: documentation
position: 4
excerpt: A sliding 60-second window per token, with the remaining budget exposed on every response.
---

Rate limiting is applied **per token** over a sliding **60-second** window. The
default budget is **60 requests per minute**.

Public routes (`/openapi.json`, `/docs`) and the session-authenticated token
management routes bypass the limiter entirely.

## Headers on every response

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Requests allowed per minute for this token |
| `X-RateLimit-Remaining` | Requests left in the current window |
| `X-RateLimit-Reset` | Unix epoch (seconds) when the window resets |

Read them rather than counting client-side — the window slides, so a fixed
local counter drifts out of sync.

## When you exceed it

```
HTTP/1.1 429 Too Many Requests
Retry-After: 12
```

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Try again shortly."
  }
}
```

`Retry-After` is in seconds. Honour it — retrying earlier just burns budget.

## Staying inside the budget

- **Back off exponentially** on `429`, seeded from `Retry-After`.
- **Cache aggressively.** `/v1/patch` changes a handful of times per patch
  cycle; polling it every second is pure waste. Once a minute is plenty.
- **Watch `X-Cache`.** A `HIT` means SC Companion served you cached data — a
  strong hint that polling faster will not surface anything new.
- **Use one token per workload.** Separate tokens get separate budgets, and a
  runaway job then cannot starve your dashboard.
- **Filter server-side.** `?source=comm-link` costs one request; fetching
  everything and filtering locally costs the same request but more bytes.
