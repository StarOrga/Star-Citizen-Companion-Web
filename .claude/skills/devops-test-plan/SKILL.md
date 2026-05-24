---
name: devops-test-plan
description: Project-specific overrides for /devops-test-plan in SC Companion.
---

# /devops-test-plan — SC Companion overrides

This file extends the plugin skill at
`~/.claude/plugins/cache/dotclaude/devops/<v>/skills/devops-test-plan/`.
Plugin defaults still apply; only the rules below override or add.

## Project rules

1. **"Ist alles live?" → multi-surface probe in EINEM parallelen Bash-Call.**
   When the user asks about live deploy status ("ist alles live", "teste die
   original seite", "verify deploy"), probe all 5 surfaces in parallel:
   Vercel, GH Release page, GH Release asset, Edge Functions, Postgres.
   Never single-surface and declare "alles live". See
   [reference.md § Live-Probe-Snippet](./reference.md#live-probe-snippet) for the
   ready-to-paste command. Then cross-check results against
   `.claude/deep-knowledge/deployment-status.md`.

2. **GitHub auth wall: `curl` against private-repo URLs lies with 404.**
   github.com returns 404 (not 403) for private repos probed without an auth
   header. Always use `gh` CLI for any github.com URL — it injects the token.
   If a probe must use raw curl, explicitly note in the report: "404 here
   means private+unauthenticated, not missing".

3. **Auto-update download URL is the public mirror — probe it unauth.**
   Since issue #7's resolution, binaries are mirrored to public repo
   `Jerry0022/sc-companion-binaries`. After every `desktop-v*` release,
   `curl -sIL <mirror_asset_url>` UNAUTHENTICATED — expect 302→200 with
   Content-Length ~126 MB. 404 means the PAT `BINARIES_RELEASE_TOKEN` is
   missing/expired OR the mirror release wasn't created. See
   [reference.md § Auto-update download probe](./reference.md#auto-update-download-probe).
