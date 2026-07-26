# ReadMe Git Sync — one-time setup

**Audience:** the admin of the ReadMe project. Everything in the repository is
already done; what remains are the steps that need a human in the ReadMe and
GitHub dashboards.

**Time:** about 10 minutes.

- Docs site: <https://star-citizen-companion.readme.io>
- ReadMe dashboard: <https://dash.readme.com>
- Source of truth: [`docs/readme-io/pages/`](./pages)

---

## Why this is needed at all

The ReadMe project is **Git-backed**. ReadMe blocks its content API for
Git-backed projects by design — verified against the live project with the real
`README_IO_API_KEY`:

| Call | Result |
|---|---|
| `GET /v1/docs` | `403 API_ACCESS_UNAVAILABLE` |
| `GET /v1/categories` | `403 API_ACCESS_UNAVAILABLE` |
| `GET /v2/branches` | `200` |
| `GET /v2/branches/1.0/guides` | `404` |

> *"Your project uses our Git-backed systems, which prevents access to this
> API. Please reach out to support@readme.io."*

So the site can only be published from Git. ReadMe's Git Sync, in turn, has two
constraints that are not configurable
([Bi-Directional Sync](https://docs.readme.com/main/docs/bi-directional-sync),
[Sync with GitHub](https://docs.readme.com/main/docs/sync-with-github)):

1. **It syncs the root of a repository.** There is no "content directory"
   setting — the fixed top-level folders `docs/`, `reference/`, `recipes/`,
   `custom_pages/`, `custom_blocks/` *are* the contract.
2. **The repository must be empty when you connect it** — *"The repository
   you're syncing to must be empty—no commits or files (e.g., README.md)—before
   connecting to ReadMe. You can add or remove files after setup."*

Neither works against this monorepo. Hence a small **mirror repository**: the
docs stay authored and reviewed here, and CI copies `docs/readme-io/pages/`
into the mirror's root on every push to `main`. ReadMe watches the mirror.

```
Star-Citizen-Companion-Web            sc-companion-readme-docs        ReadMe
  docs/readme-io/pages/     ──CI──▶     (repo root)          ──sync──▶  site
    docs/…                                docs/…
```

---

## Step 1 — create the mirror repository (GitHub)

It must be **completely empty**: no README, no `.gitignore`, no licence.

```bash
gh repo create StarOrga/sc-companion-readme-docs \
  --public \
  --description "ReadMe Git-Sync mirror of Star-Citizen-Companion-Web/docs/readme-io/pages. Do not edit."
```

Do **not** pass `--add-readme`, and do not click "Initialize this repository
with a README" if you create it in the web UI. ReadMe refuses a repo that has
any commits.

> If you want a different name, change `MIRROR_REPO` in
> `.github/workflows/readme-docs-sync.yml` to match, in the same PR.

## Step 2 — connect ReadMe to the mirror (ReadMe dashboard)

Do this **before** the first mirror push, while the repo is still empty.

1. Open <https://dash.readme.com> and select the
   **star-citizen-companion** project.
2. Go to **Settings → Git Connection**.
3. Click **Sync with GitHub**.
4. Install / authorise the **ReadMe Sync** GitHub App
   (<https://github.com/apps/readme-sync>) and grant it access to
   **`StarOrga/sc-companion-readme-docs`** — only that repository.
5. Select `sc-companion-readme-docs` as the repository to sync.
6. Confirm the branch mapping. The repository's default branch (`main`) maps to
   the project's main version (`1.0`).

There is no folder or path to choose in this flow — that is expected. ReadMe
takes the whole repo root and looks for its own top-level folders.

## Step 3 — create the mirror token (GitHub)

CI pushes to a *different* repository, so the workflow's own `GITHUB_TOKEN`
cannot do it. Create a token that can write to the mirror and nothing else:

1. <https://github.com/settings/personal-access-tokens/new> — a **fine-grained**
   personal access token.
2. **Resource owner:** `StarOrga`.
3. **Repository access:** *Only select repositories* →
   `sc-companion-readme-docs`.
4. **Repository permissions:** `Contents: Read and write`. Nothing else.
5. Set an expiry you will actually renew (12 months is reasonable) and copy the
   token.

Then store it on the **main** repository:

```bash
gh secret set README_DOCS_MIRROR_TOKEN \
  --repo StarOrga/Star-Citizen-Companion-Web
# paste the token when prompted
```

Until this secret exists, the `readme-docs` workflow still validates the tree
on every PR — it just skips the mirror step and says so in the log.

## Step 4 — trigger the first sync

```bash
gh workflow run readme-docs-sync.yml --repo StarOrga/Star-Citizen-Companion-Web
```

or simply merge any change under `docs/readme-io/`.

Watch it:

```bash
gh run watch --repo StarOrga/Star-Citizen-Companion-Web
```

Then check, in order:

1. `StarOrga/sc-companion-readme-docs` has a `docs/` folder with four category
   folders and 18 pages.
2. ReadMe's **Settings → Git Connection** shows a recent successful sync.
3. <https://star-citizen-companion.readme.io> shows the new navigation:
   **Welcome · Features · Public API · Project**.

## Step 5 — confirm the API is still where we think it is

```bash
curl -H "Authorization: Bearer <admin-session-jwt>" \
  "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/readme-sync"
```

Expected: `{"ok":true,"state":"git_backed", …}` plus the page inventory the
repository expects to be live. `state` other than `git_backed` means something
changed on ReadMe's side and the publishing strategy is worth revisiting — see
[README.md](./README.md).

---

## Afterwards

- **Author in the repository, never in ReadMe's web editor.** ReadMe commits
  editor changes back into the mirror, and the next mirror run overwrites them.
- **A docs change is a normal PR.** CI validates the Git-Sync tree
  (`npm run check:readme-docs`) before merge.
- **Deleting a page here deletes it on the site.** The mirror is a replacement,
  not a merge, so an orphaned page cannot keep publishing.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| ReadMe refuses the repo when connecting | The repo has commits | Delete and recreate it empty (Step 1) |
| Workflow logs *"README_DOCS_MIRROR_TOKEN is not set"* | Step 3 not done | Create the secret |
| Mirror push fails `403` | Token lacks `Contents: write`, expired, or is scoped to the wrong repo | Reissue (Step 3) |
| Mirror updates but the site does not | ReadMe App not installed on the mirror, or branch mapping wrong | Re-check Step 2 |
| A page is missing from the sidebar | Its slug is absent from the folder's `_order.yaml` | Add it; `npm run check:readme-docs` catches this |
| Sidebar order looks random | Same — `_order.yaml`, not the file name, decides | Fix the order file |

## References

- [Bi-Directional Sync](https://docs.readme.com/main/docs/bi-directional-sync)
- [Sync with GitHub](https://docs.readme.com/main/docs/sync-with-github)
- [Documentation Structure](https://docs.readme.com/main/docs/documentation-structure)
- [ReadMe Sync GitHub App](https://github.com/apps/readme-sync)
