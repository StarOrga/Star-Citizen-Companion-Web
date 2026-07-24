---
slug: recipes
title: Recipes
category: documentation
position: 6
excerpt: Copy-paste clients for curl, JavaScript/TypeScript, and Python — including retry and caching.
---

Working snippets for the common integrations. All of them assume the token
lives in an environment variable, never in source.

## curl

```bash
export SCC_TOKEN="scc_live_your_token_here"
export SCC_BASE="https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api"

# current patch versions
curl -sS -H "Authorization: Bearer $SCC_TOKEN" "$SCC_BASE/v1/patch" | jq .

# latest Comm-Links only
curl -sS -H "Authorization: Bearer $SCC_TOKEN" "$SCC_BASE/v1/news?source=comm-link" \
  | jq -r '.data[] | "\(.published_at)  \(.title)"'

# inspect the rate-limit budget without parsing the body
curl -sS -D- -o/dev/null -H "Authorization: Bearer $SCC_TOKEN" "$SCC_BASE/v1/patch" \
  | grep -i '^x-ratelimit'
```

## JavaScript / TypeScript

A small client with scope-aware errors and `Retry-After` handling:

```ts
const BASE = 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api';

export class SccApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message);
  }
}

export async function sccFetch<T>(
  path: string,
  token: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (res.status === 429 && attempt < 3) {
    const wait = Number(res.headers.get('Retry-After') ?? 2 ** attempt);
    await new Promise((r) => setTimeout(r, wait * 1000));
    return sccFetch<T>(path, token, init, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new SccApiError(
      body?.error?.code ?? 'unknown',
      body?.error?.message ?? res.statusText,
      res.status,
    );
  }

  return res.json() as Promise<T>;
}

// usage
const patch = await sccFetch<{ data: { live: string | null } }>(
  '/v1/patch',
  process.env.SCC_TOKEN!,
);
console.log(patch.data.live);
```

## Python

```python
import os, time, requests

BASE = "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api"
TOKEN = os.environ["SCC_TOKEN"]


def scc_get(path: str, params: dict | None = None, attempts: int = 3):
    for attempt in range(attempts):
        res = requests.get(
            f"{BASE}{path}",
            params=params,
            headers={"Authorization": f"Bearer {TOKEN}"},
            timeout=15,
        )
        if res.status_code == 429 and attempt < attempts - 1:
            time.sleep(int(res.headers.get("Retry-After", 2 ** attempt)))
            continue
        if not res.ok:
            err = res.json().get("error", {})
            raise RuntimeError(f"[{err.get('code')}] {err.get('message')}")
        return res.json()
    raise RuntimeError("rate limited — gave up")


print(scc_get("/v1/patch")["data"])
for item in scc_get("/v1/news", {"source": "comm-link"})["data"]:
    print(item["published_at"], item["title"])
```

## Poll for a new patch build

`/v1/patch` is the cheapest way to notice that CIG pushed a build. Poll it once
a minute and compare against the last value you saw:

```ts
let lastLive: string | null = null;

setInterval(async () => {
  const { data } = await sccFetch<{ data: { live: string | null } }>(
    '/v1/patch',
    token,
  );
  if (data.live && data.live !== lastLive) {
    lastLive = data.live;
    notify(`New LIVE build: ${data.live}`);
  }
}, 60_000);
```

One request per minute sits comfortably inside the 60/min budget and leaves
room for everything else your integration does.

## Generate a typed client

The spec is public, so any OpenAPI generator works without a token:

```bash
npx openapi-typescript \
  https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/api/openapi.json \
  -o src/scc-api.d.ts
```
