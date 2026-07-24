# readme.io documentation source

The public documentation site at <https://star-citizen-companion.readme.io> is
**generated from this folder**. ReadMe's web editor is not the source of truth —
a sync overwrites remote page bodies, so anything typed there is lost on the
next run. Author here, review in a PR, then sync.

```
docs/readme-io/
  pages/*.md      the documentation, one file per ReadMe page
supabase/functions/readme-sync/
  content.ts      GENERATED bundle of pages/*.md  (do not edit)
  readme-api.ts   ReadMe API v2 client
  index.ts        admin-gated edge function that performs the sync
scripts/gen-readme-content.mjs
```

## ⚠ Current blocker: the ReadMe project is Git-backed

Verified against the live project on **2026-07-24** with the real
`README_IO_API_KEY`:

| Call | Result |
|---|---|
| `GET /v2/branches` | `200` — one branch, `1.0` |
| `GET /v2/branches/1.0/guides` | `404` *The endpoint doesn't exist.* |
| `GET /v2/branches/1.0/categories` | `404` |
| `GET /v1/categories` | **`403 API_ACCESS_UNAVAILABLE`** |
| `GET /v1/docs` | **`403 API_ACCESS_UNAVAILABLE`** |

> *"Your project uses our Git-backed systems, which prevents access to this
> API. Please reach out to support@readme.io."*

Two things follow:

1. **v2's content endpoints are ReadMe-Refactored-only.** The project is not
   migrated, so only the `/branches` compatibility endpoint answers. This is why
   the client auto-detects instead of pinning v2.
2. **v1 is blocked outright** because the project is on ReadMe's **Git-backed**
   sync. In that mode ReadMe treats a connected Git repository as the source of
   truth and refuses API writes by design.

So the sync function is complete and correct but cannot publish until one of
these is resolved:

- **Connect ReadMe's Git sync to this repo** and point it at
  `docs/readme-io/pages/` — then the markdown here publishes on push and the
  edge function is unnecessary for content (keep it for probing).
- **Ask ReadMe support to enable API access** (or migrate the project to
  Refactored) — then `mode=sync` publishes immediately, v2 preferred, with no
  code change.

`mode=probe` re-runs this diagnosis in one call at any time.

## Why v1 → v2

The site was originally published against ReadMe's **API v1**. v2 changes
enough to be a real migration, not a base-URL swap:

| | v1 | v2 |
|---|---|---|
| Base | `https://dash.readme.com/api/v1` | `https://api.readme.com/v2` |
| Auth | HTTP Basic (key as username) | `Authorization: Bearer <key>` |
| Grouping | versions | **branches** |
| List pages | `GET /docs` | `GET /branches/{branch}/guides` |
| Update page | `PUT /docs/{slug}` | `PATCH /branches/{branch}/guides/{slug}` |
| Page body | `body` | `content.body` |
| Category | bare id | `category.uri` |

v2 is served only to projects on **ReadMe Refactored**. `mode=probe` (below)
answers whether this project is, using read-only calls.

## Authoring a page

One markdown file per page, with a small frontmatter block:

```markdown
---
slug: getting-started
title: Getting Started
category: documentation
position: 1
excerpt: One-line summary shown in ReadMe's page list.
---

Page body in markdown…
```

- `slug` is the page's **stable identity** across syncs. Changing it creates a
  new page and orphans the old one — rename deliberately.
- The filename prefix (`01-`, `02-`, …) sets authoring order; `position` is what
  ReadMe actually sorts by and defaults to the file's index when omitted.
- Cross-link with ReadMe's own syntax: `[Rate Limits](doc:rate-limits)`.

After editing, regenerate the bundle:

```bash
npm run gen:readme-content
```

Commit both the markdown **and** the regenerated `content.ts`: the Supabase
deploy bundler ships only what the JS import graph reaches, so the pages have
to travel as code (the same constraint that makes `starscape-summary` embed its
fonts in `fonts.ts`).

## Syncing

The API key lives only as the Supabase edge-function secret
**`README_IO_API_KEY`** — never in the repo, never in the client bundle.

```bash
npm run functions:deploy readme-sync
```

Then call the function with an **admin** session JWT:

```bash
# 1. read-only: what does the v2 API expose, and do the categories resolve?
curl -H "Authorization: Bearer <admin-session-jwt>" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/readme-sync?mode=probe"

# 2. dry run: which pages would be created vs updated?
curl -X POST -H "Authorization: Bearer <admin-session-jwt>" \
  -H "Content-Type: application/json" -d '{"mode":"sync","dryRun":true}' \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/readme-sync"

# 3. publish
curl -X POST -H "Authorization: Bearer <admin-session-jwt>" \
  -H "Content-Type: application/json" -d '{"mode":"sync"}' \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/readme-sync"
```

Always probe before the first sync after a ReadMe-side change.

## Safety properties

- **One-way, repo → ReadMe.** Remote edits are never read back.
- **Never deletes.** A page removed from `pages/` is left standing in ReadMe for
  a human to retire, so a bad generator run cannot wipe the site.
- **Admin-only.** `verify_jwt = true` plus a `profiles.role = 'admin'` check in
  the handler.
- **Idempotent.** Slug decides create-vs-update; re-running a sync is a no-op
  when nothing changed.
