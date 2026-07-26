# readme.io documentation source

The public documentation site at <https://star-citizen-companion.readme.io> is
**published from this folder** by ReadMe's own Git Sync. ReadMe's web editor is
not the source of truth — a sync overwrites it, so anything typed there is lost.
Author here, review in a PR.

**Setting it up for the first time?** → [GIT-SYNC-SETUP.md](./GIT-SYNC-SETUP.md)

```
docs/readme-io/
  pages/                       the ReadMe Git-Sync repository ROOT (mirrored 1:1)
    docs/                        Guides
      _order.yaml                  category order
      <category>/
        _order.yaml                page order within the category
        <page>.md                  one page; the file name is the slug
  GIT-SYNC-SETUP.md            one-time dashboard steps (admin)
  MIRROR-README.md             copied into the mirror repo as its README
scripts/gen-readme-content.mjs validator + bundler
.github/workflows/readme-docs-sync.yml
supabase/functions/readme-sync/
  content.ts                   GENERATED page inventory (do not edit)
  readme-api.ts                read-only ReadMe API client
  index.ts                     admin-gated health check (does NOT publish)
```

## How publishing works

The ReadMe project is **Git-backed**, which means ReadMe blocks its content API
(`403 API_ACCESS_UNAVAILABLE` on every v1 content endpoint, v2 content endpoints
404 because they are Refactored-only). There is no API path to the site and
there will not be one while the project stays Git-backed.

ReadMe's Git Sync fills that gap, with two constraints that are not
configurable: it syncs a repository **root**, and the repository must be
**empty when connected**. Neither fits a monorepo. So:

```
docs/readme-io/pages/  ──CI mirror──▶  StarOrga/sc-companion-readme-docs  ──ReadMe Git Sync──▶  live site
```

`.github/workflows/readme-docs-sync.yml` copies this subtree into the mirror's
root on every push to `main`, replacing its contents wholesale — a page deleted
here disappears from the site rather than lingering as an orphan.

## The Git-Sync contract

This is ReadMe's schema, not ours, and it is unforgiving. See
[Documentation Structure](https://docs.readme.com/main/docs/documentation-structure).

| Concept | Expressed as | **Not** |
|---|---|---|
| Category | the folder under `docs/` | a `category:` field |
| Page slug | the file name (`rate-limits.md` → `rate-limits`) | a `slug:` field |
| Order | `_order.yaml` in the folder | a `position:` field |
| Subpages | a folder + `index.md` inside it | a `parentDoc:` field |

`_order.yaml` is a flat list of slugs with no extensions, and must **never**
contain an `index` entry — that one is implied by the presence of `index.md`.

```yaml
- getting-started
- authentication
- endpoints
```

### Frontmatter

Only the keys ReadMe reads. Anything else is silently ignored on the live site,
so the validator rejects it.

```markdown
---
title: Rate Limits                     # required
excerpt: One-line summary in the nav.  # optional
hidden: false                          # optional
deprecated: false                      # optional
icon: fad fa-gauge-high                # optional, Font Awesome
metadata:                              # optional, SEO
  title: …
  description: …
  robots: index
next:                                  # optional, "what's next" links
  pages:
    - type: basic
      slug: errors
      title: Errors
---

Page body in markdown…
```

Cross-link with ReadMe's own syntax: `[Rate Limits](doc:rate-limits)`. The
validator resolves every `doc:` target against the tree, so a broken internal
link fails CI instead of shipping.

## Authoring a page

1. Put the file in the right category folder, named after the slug you want.
   **Renaming a file changes the page's URL** and orphans the old one — do it
   deliberately.
2. Add the slug to that folder's `_order.yaml`.
3. Validate and regenerate:

   ```bash
   npm run check:readme-docs      # validate only (what CI runs)
   npm run gen:readme-content     # validate + rewrite content.ts
   ```

4. Commit the markdown **and** the regenerated `content.ts`.

`content.ts` is committed because the Supabase deploy bundler only ships what
the JS import graph reaches — a `Deno.readFile` of a static `.md` is not
included (the same constraint that makes `starscape-summary` embed its fonts in
`fonts.ts`). CI fails if it is stale.

## The `readme-sync` edge function

It no longer syncs, and it is honest about that: the name is kept only so the
deployed function URL and its secret stay stable.

What it does now is a **read-only health check**, admin-gated as before:

```bash
curl -H "Authorization: Bearer <admin-session-jwt>" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/readme-sync"
```

```jsonc
{
  "ok": true,
  "state": "git_backed",       // expected — ReadMe is enforcing Git publishing
  "publish": { "channel": "readme-git-sync", "source": "docs/readme-io/pages/" },
  "api": { "v1Guides": { "status": 403 }, "v2Guides": { "status": 404 } },
  "repo": { "pages": 18, "categories": ["welcome", "features", "public-api", "project"] }
}
```

| `state` | Meaning |
|---|---|
| `git_backed` | Expected. The API is closed because the project publishes from Git. |
| `api_open` | A content endpoint answered. ReadMe changed something — revisit the strategy. |
| `unauthorized` | `README_IO_API_KEY` was rejected. |
| `unknown` | Neither — read the raw statuses in `api`. |

`POST {"mode":"sync"}`, the old publish call, now returns **`409
publish_via_git_sync`** with a link to the setup guide. It never silently
no-ops.

Deploy it with:

```bash
npm run functions:deploy readme-sync
```

The API key lives only as the Supabase edge-function secret
**`README_IO_API_KEY`** — never in the repo, never in the client bundle.

## Safety properties

- **One-way, repo → ReadMe.** Edits made in ReadMe's editor are overwritten by
  the next mirror run.
- **Deletions propagate.** The mirror is a replacement, not a merge.
- **Nothing publishes unreviewed.** The mirror only runs on `main`; PRs get the
  validator.
- **Admin-only diagnostics.** `verify_jwt = true` plus a `profiles.role = 'admin'`
  check in the handler.
