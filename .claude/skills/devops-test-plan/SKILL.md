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

3. **Auto-update download URL needs to be publicly accessible.**
   After every `desktop-v*` release, probe the asset URL UNAUTHENTICATED
   (`curl -sIL <gh_asset_url>`) and flag if 404. Today the `desktop-latest`
   Edge Function returns a private GH Release asset URL — electron-updater
   has no GH credentials so end-user auto-update will fail. Known bug, see
   [reference.md § Auto-update bug](./reference.md#auto-update-bug). Track
   as a GitHub issue (one open at a time, link from reference.md).
